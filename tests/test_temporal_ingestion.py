from contextlib import closing
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"pipeline"))
from map_store import import_file, connect
from map_api import metadata, period, graph_query, article_query, evidence_query
from pubmed_sync import sync, Listing
from ingestion_jobs import enqueue

class TemporalIngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.db=self.root/"map.sqlite"
        with gzip.open(ROOT/"pipeline/cache/pubmed_corpus.jsonl.gz","rt",encoding="utf-8") as stream:
            self.records=[json.loads(next(stream)) for _ in range(60)]
        self.template=json.loads((ROOT/"public/data/graph-2018.json").read_text())
        self.trees=json.loads((ROOT/"pipeline/cache/mesh_trees.json").read_text())
    def tearDown(self): self.temp.cleanup()
    def source(self,name,records):
        path=self.root/name
        with gzip.open(path,"wt",encoding="utf-8") as output:
            for record in records: output.write(json.dumps(record)+"\n")
        return path
    def ingest(self,records,name="corpus.jsonl.gz"):
        return import_file(self.db,self.source(name,records),self.trees,self.template)
    def test_one_year_range_graph_articles_and_evidence(self):
        # Modified dates are isolated test fixtures, never application data.
        records=[{**r,"year":2018+i%2} for i,r in enumerate(self.records)]
        self.ingest(records)
        with closing(connect(self.db)) as db:
            catalog=metadata(db)
            self.assertEqual(period({"startYear":2018,"endYear":2018},catalog),(2018,2018))
            for start,end,expected in [(2018,2018,30),(2018,2019,60)]:
                graph=graph_query(str(self.db),catalog["revision"],start,end)
                self.assertEqual(graph["meta"]["n_articles"],expected)
                articles=article_query(str(self.db),catalog["revision"],start,end,tuple(n["id"] for n in graph["nodes"]),"")
                self.assertTrue(all(start<=a["year"]<=end for a in articles["items"]))
            a,c=records[0]["mesh"][:2]
            evidence=evidence_query(db,{"a":a[0],"c":c[0]},2018,2018)
            self.assertTrue(evidence["a"])
            self.assertTrue(all(a["year"]==2018 for key in ("a","c","together") for a in evidence[key]))
    def test_new_year_revision_delete_and_aggregates(self):
        self.ingest(self.records)
        with closing(connect(self.db)) as db: before=metadata(db)
        new={**self.records[0],"pmid":"999999999","year":2027}
        self.ingest([new],"new.jsonl.gz")
        with closing(connect(self.db)) as db:
            after=metadata(db);self.assertEqual(after["end"],2027);self.assertNotEqual(after["revision"],before["revision"])
        graph=graph_query(str(self.db),after["revision"],2027,2027)
        self.assertEqual(graph["meta"]["n_articles"],1)
        self.ingest([{**new,"mesh":new["mesh"][:1]}],"revised.jsonl.gz")
        with closing(connect(self.db)) as db: self.assertEqual(db.execute("SELECT COUNT(*) FROM pair_year WHERE year=2027").fetchone()[0],0)
        self.ingest([{"op":"delete","pmid":new["pmid"]}],"deleted.jsonl.gz")
        with closing(connect(self.db)) as db:
            self.assertEqual(metadata(db)["end"],before["end"])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM node_year WHERE year=2027").fetchone()[0],0)
    def test_sync_order_idempotence_and_audit_counts(self):
        baseline=self.source("base.jsonl.gz",self.records[:2])
        update=self.source("upd.jsonl.gz",[{**self.records[0],"mesh":self.records[0]["mesh"][:1]}, {"op":"delete","pmid":self.records[1]["pmid"]}])
        files=[{"filename":f"pubmed26n{i:04d}.xml.gz","kind":kind,"cycle":26,"sequence":i,"url":f"https://test/{i}"} for i,kind in [(2,"update"),(1,"baseline")]]
        calls=[]
        def downloader(url,raw):
            calls.append(url);return baseline if url.endswith("/1") else update
        def processor(path,root): return {"output":str(path)}
        class Archive:
            def put(self,*args): pass
        with patch("pubmed_sync.download",side_effect=downloader),patch("pubmed_sync.process",side_effect=processor):
            result=sync(self.root,self.db,self.trees,self.template,listing=files,archive=Archive())
            self.assertEqual(result["incorporated"],2)
            self.assertEqual(calls,["https://test/1","https://test/2"])
            sync(self.root,self.db,self.trees,self.template,listing=files,archive=Archive())
            self.assertEqual(len(calls),2)
        with closing(connect(self.db)) as db:
            row=db.execute("SELECT * FROM ingestion_files WHERE kind='update'").fetchone()
            self.assertEqual((row["updates"],row["deletes"],row["checkpoint"]),(1,1,2))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM articles").fetchone()[0],1)
    def test_failed_baseline_stops_updates_and_retains_error(self):
        files=[{"filename":f"pubmed26n{i:04d}.xml.gz","kind":kind,"cycle":26,"sequence":i,"url":f"https://test/{i}"} for i,kind in [(1,"baseline"),(2,"update")]]
        with patch("pubmed_sync.download",side_effect=OSError("interrupted")) as download:
            with self.assertRaises(OSError): sync(self.root,self.db,self.trees,self.template,listing=files)
            self.assertEqual(download.call_count,1)
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT status FROM ingestion_files WHERE kind='update'").fetchone()[0],"discovered")
            self.assertIn("interrupted",db.execute("SELECT error FROM ingestion_files WHERE kind='baseline'").fetchone()[0])
    def test_job_inbox_deduplicates(self):
        enqueue(self.db,"pubmed-2026-09-22");enqueue(self.db,"pubmed-2026-09-22")
        with closing(connect(self.db)) as db: self.assertEqual(db.execute("SELECT COUNT(*) FROM ingestion_jobs").fetchone()[0],1)
    def test_directory_parser_only_accepts_official_filenames(self):
        listing=Listing();listing.feed('<a href="pubmed26n0001.xml.gz">file</a><a href="../../bad.xml.gz">bad</a>')
        self.assertEqual(listing.files,{"pubmed26n0001.xml.gz"})

if __name__=="__main__":unittest.main()
