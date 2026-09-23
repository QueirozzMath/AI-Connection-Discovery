"""Regression checks for additive imports; all databases are temporary fixtures."""
from contextlib import closing
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from map_store import connect, import_file
from pubmed_expand import Entrez, collect_year, expand, export_previous, write_records
from pubmed_sync import sync


class AdditiveImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.db = self.root / "current.sqlite"
        self.template = {"nodes": [], "meta": {"source": "test fixture"}}
        self.original = {"pmid": "1", "year": 1974, "title": "Original",
                         "authors": ["Author"], "journal": "Journal", "doi": "doi:original",
                         "mesh": [["D1", "One", 1], ["D2", "Two", 0]]}
        self.load("initial.gz", [self.original])

    def load(self, name, records, **options):
        path = self.root / name
        write_records(path, records)
        return import_file(self.db, path, {}, self.template, **options)

    def rows(self, table):
        with closing(connect(self.db)) as db:
            return [tuple(row) for row in db.execute("SELECT * FROM " + table + " ORDER BY 1,2")]

    def test_preserve_duplicate_and_add_new_with_exact_aggregates(self):
        original = self.rows("articles")
        updated = {**self.original, "year": 2026, "title": "Must not overwrite", "mesh": []}
        added = {**self.original, "pmid": "2", "year": 2026}
        path = self.root / "pubmed26n1334.gz"
        write_records(path, [updated, added, added])
        import_file(self.db, path, {}, self.template, batch=1, insert_only=True)
        self.assertEqual(self.rows("articles")[0], original[0])
        self.assertEqual(self.rows("pair_year"), [(1974, "D1", "D2", 1), (2026, "D1", "D2", 1)])
        self.assertEqual(len(self.rows("article_mesh")), 4)
        before = {table: self.rows(table) for table in ("articles", "article_mesh", "node_year", "pair_year")}
        self.assertEqual(import_file(self.db, path, {}, self.template, insert_only=True)["status"], "skipped")
        self.assertEqual(before, {table: self.rows(table) for table in before})
        with closing(connect(self.db)) as db:
            self.assertIsNone(db.execute("SELECT value FROM metadata WHERE key='last_pubmed_sequence'").fetchone())

    def test_delete_rejected_and_transaction_rolled_back(self):
        with self.assertRaisesRegex(ValueError, "cannot delete"):
            self.load("delete.gz", [{**self.original, "pmid": "2"}, {"pmid": "1", "op": "delete"}], insert_only=True)
        self.assertEqual(len(self.rows("articles")), 1)
        self.assertEqual(self.rows("pair_year"), [(1974, "D1", "D2", 1)])

    def test_resume_checkpoint_without_duplicate_aggregates(self):
        path = self.root / "resume.gz"
        write_records(path, [self.original, {**self.original, "pmid": "2"}])
        import_file(self.db, path, {}, self.template, insert_only=True)
        with closing(connect(self.db)) as db:
            db.execute("UPDATE imports SET complete=0,line=1 WHERE source=?", ("additive:" + str(path.resolve()),))
            db.commit()
        import_file(self.db, path, {}, self.template, insert_only=True)
        self.assertEqual(self.rows("pair_year"), [(1974, "D1", "D2", 2)])

    def test_previous_export_preserves_full_metadata_and_mesh(self):
        exported = self.root / "previous.gz"
        self.assertEqual(export_previous(self.db, exported), 1)
        destination = self.root / "merged.sqlite"
        import_file(destination, exported, {}, self.template, insert_only=True)
        with closing(connect(destination)) as db:
            self.assertEqual([tuple(row) for row in db.execute("SELECT * FROM articles")], self.rows("articles"))

    def test_ordered_sync_refuses_to_overwrite_supplemented_database(self):
        with closing(connect(self.db)) as db:
            db.execute("INSERT INTO metadata VALUES('supplemental_corpus',?)", (json.dumps({"sample": True}),))
            db.commit()
        with self.assertRaisesRegex(ValueError, "additive supplements"):
            sync(self.root, self.db, {}, self.template, listing=[])

    def test_publication_year_and_mesh_are_checked_after_fetch(self):
        class Client:
            def search(self, term, count):
                return ["1", "2", "3", "4"]
            def fetch(self, ids):
                return [record for record in [
                    {"pmid": "1", "year": 2026, "mesh": ["D1"]},
                    {"pmid": "2", "year": 2025, "mesh": ["D1"]},
                    {"pmid": "3", "year": 2026, "mesh": []},
                    {"pmid": "4", "year": 2026, "mesh": ["D1"]}] if record["pmid"] in ids]
        records, details = collect_year(Client(), 2026, 1, {"1"})
        self.assertEqual([record["pmid"] for record in records], ["4"])
        self.assertEqual(details["excluded"]["different_publication_year"], 1)
        self.assertEqual(details["excluded"]["without_mesh"], 1)

    def test_expansion_backup_merge_download_and_resume(self):
        previous = self.root / "previous.sqlite"
        previous_input = self.root / "previous.gz"
        write_records(previous_input, [{**self.original, "pmid": "2", "year": 1975}])
        import_file(previous, previous_input, {}, self.template)
        downloaded = [{**self.original, "pmid": "3"},
                      {**self.original, "pmid": "4", "year": 1975}]
        class Client:
            def search(self, term, count): return ["1", "2", "3", "4"]
            def fetch(self, ids): return [row for row in downloaded if row["pmid"] in ids]
        for name, data in (("pipeline/cache/mesh_trees.json", {}),
                           ("public/data/graph-2018.json", self.template)):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding="utf-8")
        args = SimpleNamespace(db=self.db, merge_db=previous, root=self.root / "expansion",
                               start=1974, end=1975, target_per_year=2, merge_only=False)
        cwd = Path.cwd()
        try:
            os.chdir(self.root)
            with patch("pubmed_expand.Entrez", return_value=Client()):
                expand(args)
            before = self.rows("articles")
            with patch("pubmed_expand.Entrez") as client:
                expand(args)
                client.return_value.search.assert_not_called()
                client.return_value.fetch.assert_not_called()
            self.assertEqual(self.rows("articles"), before)
            self.assertEqual(len(before), 4)
            with closing(connect(args.root / "before-expansion.sqlite")) as backup:
                self.assertEqual(backup.execute("SELECT COUNT(*) FROM articles").fetchone()[0], 1)
            report = json.loads((args.root / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(report["total"], 4)
            self.assertEqual(report["below_target"], {})
            self.assertEqual(report["integrity"], "ok")
            with closing(connect(previous)) as db:
                db.execute("UPDATE articles SET title='Changed source'")
                db.commit()
            with self.assertRaisesRegex(ValueError, "Previous corpus changed"):
                expand(args)
        finally:
            os.chdir(cwd)

    def test_empty_fetch_response_is_an_error(self):
        client = Entrez(self.root / "raw")
        with patch.object(client, "request", side_effect=lambda endpoint, params, parse:
                          parse(b"<PubmedArticleSet/>")):
            with self.assertRaisesRegex(ValueError, "no articles"):
                client.fetch(["1"])


if __name__ == "__main__":
    unittest.main()
