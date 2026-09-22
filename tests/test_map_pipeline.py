from contextlib import closing
import gzip
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from map_store import import_file, connect
import map_store
from map_api import graph_query, article_query, metadata
from pubmed_bulk import process, iter_events


class MapPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with gzip.open(ROOT / "pipeline/cache/pubmed_corpus.jsonl.gz", "rt", encoding="utf-8") as stream:
            cls.records = [json.loads(next(stream)) for _ in range(60)]
        cls.template = json.loads((ROOT / "public/data/graph-2018.json").read_text())
        cls.trees = json.loads((ROOT / "pipeline/cache/mesh_trees.json").read_text())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = self.root / "map.sqlite"
        self.source = self.write_records("corpus.jsonl.gz", self.records)
        import_file(self.db, self.source, self.trees, self.template, batch=17)

    def tearDown(self):
        self.temp.cleanup()

    def write_records(self, name, records):
        path = self.root / name
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            for record in records:
                stream.write(json.dumps(record) + "\n")
        return path

    def test_idempotence_and_annual_aggregates(self):
        self.assertEqual(import_file(self.db, self.source, self.trees, self.template)["status"], "skipped")
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM articles").fetchone()[0], 60)
            expected = sum(len({m[0] for m in r["mesh"]}) for r in self.records)
            self.assertEqual(db.execute("SELECT SUM(count) FROM node_year").fetchone()[0], expected)
            count = sum(len(r["mesh"]) * (len(r["mesh"]) - 1) // 2 for r in self.records)
            self.assertEqual(db.execute("SELECT SUM(weight) FROM pair_year").fetchone()[0], count)

    def test_upsert_delete_and_restart(self):
        first = self.records[0]
        changed = {**first, "mesh": first["mesh"][:1]}
        updates = self.write_records("updates.jsonl.gz", [changed, {"op": "delete", "pmid": self.records[1]["pmid"]}])
        import_file(self.db, updates, self.trees, self.template, batch=1)
        self.assertEqual(import_file(self.db, updates, self.trees, self.template)["status"], "skipped")
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM articles").fetchone()[0], 59)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM article_mesh WHERE pmid=?", (first["pmid"],)).fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM pair_year WHERE weight<=0").fetchone()[0], 0)
            remaining = [changed] + self.records[2:]
            expected = sum(len(r["mesh"]) * (len(r["mesh"])-1)//2 for r in remaining)
            self.assertEqual(db.execute("SELECT SUM(weight) FROM pair_year").fetchone()[0], expected)

    def test_interrupted_batch_resumes_without_duplicate_counts(self):
        other = self.root / "resumed.sqlite"
        original = map_store.apply_event
        calls = 0
        def interrupted(*args):
            nonlocal calls
            calls += 1
            if calls == 22:
                raise RuntimeError("simulated interruption")
            return original(*args)
        with patch("map_store.apply_event", interrupted):
            with self.assertRaises(RuntimeError):
                import_file(other, self.source, self.trees, self.template, batch=17)
        with closing(connect(other)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM articles").fetchone()[0], 17)
        import_file(other, self.source, self.trees, self.template, batch=17)
        with closing(connect(other)) as db, closing(connect(self.db)) as baseline:
            self.assertEqual(db.execute("SELECT SUM(weight) FROM pair_year").fetchone()[0], baseline.execute("SELECT SUM(weight) FROM pair_year").fetchone()[0])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM articles").fetchone()[0], 60)

    def test_official_updates_must_be_applied_in_order(self):
        later = self.write_records("pubmed26n0002.xml.gz.metadata.jsonl.gz", [self.records[0]])
        earlier = self.write_records("pubmed26n0001.xml.gz.metadata.jsonl.gz", [self.records[0]])
        import_file(self.db, later, self.trees, self.template)
        with self.assertRaisesRegex(ValueError, "Out-of-order"):
            import_file(self.db, earlier, self.trees, self.template)

    def test_mesh_only_preserves_metadata_but_explicit_null_clears_it(self):
        record = self.records[0]
        minimal = {key: value for key, value in record.items() if key != "title"}
        path = self.write_records("mesh-only.jsonl.gz", [minimal])
        import_file(self.db, path, self.trees, self.template)
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT title FROM articles WHERE pmid=?", (record["pmid"],)).fetchone()[0], record["title"])
        path = self.write_records("metadata-removal.jsonl.gz", [{**minimal, "title": None}])
        import_file(self.db, path, self.trees, self.template)
        with closing(connect(self.db)) as db:
            self.assertIsNone(db.execute("SELECT title FROM articles WHERE pmid=?", (record["pmid"],)).fetchone()[0])

    def test_period_pagination_and_article_membership(self):
        with closing(connect(self.db)) as db:
            catalog = metadata(db)
        graph = graph_query(str(self.db), catalog["revision"], catalog["start"], catalog["end"])
        ids = tuple(n["id"] for n in graph["nodes"])
        page = article_query(str(self.db), catalog["revision"], catalog["start"], catalog["end"], ids, "")
        self.assertEqual(page["total"], 60)
        self.assertEqual(len(page["items"]), 20)
        second = article_query(str(self.db), catalog["revision"], catalog["start"], catalog["end"], ids, page["next"])
        self.assertFalse({r["pmid"] for r in page["items"]} & {r["pmid"] for r in second["items"]})
        mid = self.records[0]["mesh"][0][0]
        subset = article_query(str(self.db), catalog["revision"], catalog["start"], catalog["end"], (mid,), "")
        self.assertEqual(subset["total"], sum(any(m[0] == mid for m in r["mesh"]) for r in self.records))
        self.assertTrue(all(mid in {m["id"] for m in r["mesh"]} for r in subset["items"]))
        year = self.records[0]["year"]
        annual = graph_query(str(self.db), catalog["revision"], year, year)
        self.assertEqual(annual["meta"]["n_articles"], sum(r["year"] == year for r in self.records))
        self.assertEqual(article_query(str(self.db), catalog["revision"], year, year, (), "")["total"], 0)

    def test_streaming_xml_normalization_and_checkpoint(self):
        # XML fixture encodes only real metadata from the checked-in corpus.
        record = self.records[0]
        root = ET.Element("PubmedArticleSet")
        article = ET.SubElement(root, "PubmedArticle")
        citation = ET.SubElement(article, "MedlineCitation")
        ET.SubElement(citation, "PMID").text = record["pmid"]
        detail = ET.SubElement(citation, "Article")
        ET.SubElement(detail, "ArticleTitle").text = record["title"]
        journal = ET.SubElement(detail, "Journal")
        issue = ET.SubElement(journal, "JournalIssue")
        date = ET.SubElement(issue, "PubDate")
        ET.SubElement(date, "Year").text = str(record["year"])
        mesh = ET.SubElement(citation, "MeshHeadingList")
        for mid, label, major in record["mesh"]:
            heading = ET.SubElement(mesh, "MeshHeading")
            ET.SubElement(heading, "DescriptorName", UI=mid, MajorTopicYN="Y" if major else "N").text = label
        delete = ET.SubElement(root, "DeleteCitation")
        ET.SubElement(delete, "PMID").text = self.records[1]["pmid"]
        path = self.root / "pubmed26n0001.xml.gz"
        with gzip.open(path, "wb") as stream:
            stream.write(ET.tostring(root))
        events = list(iter_events(path))
        self.assertEqual(events[0]["title"], record["title"])
        self.assertEqual(events[0]["year"], record["year"])
        self.assertEqual(events[1]["op"], "delete")
        self.assertIsNone(events[0]["doi"])
        result = process(path, self.root / "bulk")
        self.assertEqual(process(path, self.root / "bulk"), result)
        minimal = list(iter_events(path, mesh_only=True))[0]
        self.assertNotIn("title", minimal)
        self.assertEqual(minimal["mesh"], events[0]["mesh"])


if __name__ == "__main__":
    unittest.main()
