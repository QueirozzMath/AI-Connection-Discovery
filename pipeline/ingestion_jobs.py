"""Durable, idempotent job inbox for the existing external SQL service."""
from contextlib import closing
from pathlib import Path
import json
import os
import threading
import time
from map_store import connect
from pubmed_sync import sync, now

SCHEMA = """CREATE TABLE IF NOT EXISTS ingestion_jobs (
 id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
 completed_at TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0
);"""

def enqueue(path, identity):
    if not isinstance(identity,str) or not identity.startswith("pubmed-") or len(identity)>100:
        raise ValueError("Invalid job identity")
    with closing(connect(path)) as db:
        db.executescript(SCHEMA)
        db.execute("INSERT INTO ingestion_jobs(id,status,created_at) VALUES(?,'pending',?) ON CONFLICT(id) DO NOTHING",(identity,now()))
        db.commit()
    return {"id":identity,"accepted":True}

def start_worker(path, root):
    def loop():
        trees=json.loads(Path("pipeline/cache/mesh_trees.json").read_text(encoding="utf-8"))
        template=json.loads(Path("public/data/graph-2018.json").read_text(encoding="utf-8"))
        template["meta"]["source"]="PubMed official baseline and daily updates"
        with closing(connect(path)) as db:
            db.executescript(SCHEMA)
            db.execute("UPDATE ingestion_jobs SET status='pending' WHERE status='running'"); db.commit()
        while True:
            with closing(connect(path)) as db:
                job=db.execute("SELECT id FROM ingestion_jobs WHERE status IN ('pending','error') ORDER BY created_at LIMIT 1").fetchone()
                if job:
                    db.execute("UPDATE ingestion_jobs SET status='running',attempts=attempts+1 WHERE id=?",(job[0],)); db.commit()
                    try:
                        sync(root,path,trees,template)
                        db.execute("UPDATE ingestion_jobs SET status='complete',completed_at=?,error=NULL WHERE id=?",(now(),job[0]))
                    except Exception as error:
                        db.execute("UPDATE ingestion_jobs SET status='error',error=? WHERE id=?",(str(error)[:2000],job[0]))
                    db.commit()
            time.sleep(60)
    threading.Thread(target=loop,daemon=True,name="pubmed-ingestion").start()
