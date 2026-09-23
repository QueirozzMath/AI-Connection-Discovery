"""Indexed, transactional local store for the Map API (stdlib SQLite).

The annual aggregates are maintained with article upsert/delete, so graph queries
never scan or transfer the article corpus. Import checkpoints commit with batches.
"""
import argparse
from collections import Counter
from contextlib import closing
import gzip
import hashlib
from itertools import combinations
import json
import math
import re
from pathlib import Path
import sqlite3
import os
from sql_backend import connect_database

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS articles (
 pmid TEXT PRIMARY KEY, year INTEGER, title TEXT, journal TEXT, doi TEXT, authors TEXT
);
CREATE INDEX IF NOT EXISTS articles_year_pmid ON articles(year, pmid);
CREATE TABLE IF NOT EXISTS mesh (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL, tree TEXT NOT NULL,
 x REAL NOT NULL, y REAL NOT NULL, hx REAL NOT NULL, hy REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS mesh_category ON mesh(category,id);
CREATE TABLE IF NOT EXISTS article_mesh (
 pmid TEXT NOT NULL REFERENCES articles(pmid) ON DELETE CASCADE,
 mesh_id TEXT NOT NULL REFERENCES mesh(id), major INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(pmid,mesh_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS article_mesh_mesh ON article_mesh(mesh_id,pmid);
CREATE TABLE IF NOT EXISTS node_year (
 year INTEGER NOT NULL, mesh_id TEXT NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(year,mesh_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS node_year_mesh ON node_year(mesh_id,year);
CREATE TABLE IF NOT EXISTS pair_year (
 year INTEGER NOT NULL, mesh_a TEXT NOT NULL, mesh_b TEXT NOT NULL, weight INTEGER NOT NULL,
 PRIMARY KEY(year,mesh_a,mesh_b)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pair_year_mesh ON pair_year(mesh_a,mesh_b,year);
CREATE TABLE IF NOT EXISTS imports (
 source TEXT PRIMARY KEY, checksum TEXT NOT NULL, line INTEGER NOT NULL, complete INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ingestion_files (
 filename TEXT PRIMARY KEY, kind TEXT NOT NULL, cycle INTEGER NOT NULL,
 url TEXT NOT NULL, checksum TEXT, size BIGINT, downloaded_at TEXT,
 processed_at TEXT, incorporated_at TEXT, status TEXT NOT NULL,
 records BIGINT NOT NULL DEFAULT 0, inserts BIGINT NOT NULL DEFAULT 0,
 updates BIGINT NOT NULL DEFAULT 0, deletes BIGINT NOT NULL DEFAULT 0,
 checkpoint BIGINT NOT NULL DEFAULT 0, error TEXT
);
"""


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def connect(path):
    return connect_database(path)


def adjust(db, pmid, delta, nodes, pairs):
    row = db.execute("SELECT year FROM articles WHERE pmid=?", (pmid,)).fetchone()
    if row is None or row[0] is None:
        return
    year = row[0]
    ids = [r[0] for r in db.execute("SELECT mesh_id FROM article_mesh WHERE pmid=? ORDER BY mesh_id", (pmid,))]
    for mesh in ids:
        nodes[(year, mesh)] += delta
    for a, b in combinations(ids, 2):
        pairs[(year, a, b)] += delta


def apply_event(db, record, trees, positions, node_delta, pair_delta):
    pmid = str(record["pmid"])
    if not pmid.isdigit():
        raise ValueError("Invalid PMID")
    adjust(db, pmid, -1, node_delta, pair_delta)
    if record.get("op") == "delete":
        db.execute("DELETE FROM articles WHERE pmid=?", (pmid,))
        return
    previous = db.execute("SELECT * FROM articles WHERE pmid=?", (pmid,)).fetchone()
    def value(field):
        if field in record:
            return json.dumps(record[field] or [], ensure_ascii=False) if field == "authors" else record[field]
        return previous[field] if previous else None
    db.execute("""INSERT INTO articles VALUES(?,?,?,?,?,?) ON CONFLICT(pmid) DO UPDATE SET
      year=excluded.year, title=excluded.title,
      journal=excluded.journal, doi=excluded.doi, authors=excluded.authors""",
      (pmid, record.get("year"), value("title"), value("journal"), value("doi"), value("authors")))
    db.execute("DELETE FROM article_mesh WHERE pmid=?", (pmid,))
    for item in record.get("mesh", []):
        mid, label, major = (item["id"], item["label"], item.get("major", False)) if isinstance(item, dict) else item
        if not mid:
            continue
        tree = (trees.get(mid) or [""])[0]
        base = positions.get(mid)
        category = base["cat"] if base else tree[:1] or "X"
        # Only initial positions for newly encountered concepts; worker uses real edges.
        angle = int(hashlib.sha256(mid.encode()).hexdigest()[:8], 16) / 2**32 * math.tau
        x, y = (base["x"], base["y"]) if base else (math.cos(angle) * 80, math.sin(angle) * 80)
        hx, hy = (base["hx"], base["hy"]) if base else (x, y)
        db.execute("""INSERT INTO mesh VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          label=excluded.label,category=excluded.category,tree=excluded.tree""", (mid, label, category, tree, x, y, hx, hy))
        db.execute("INSERT INTO article_mesh VALUES(?,?,?) ON CONFLICT(pmid,mesh_id) DO UPDATE SET major=excluded.major", (pmid, mid, int(major)))
    adjust(db, pmid, 1, node_delta, pair_delta)


def import_file(db_path, path, trees, template, batch=500, ingestion_key=None, insert_only=False):
    if not str(db_path).startswith(("postgresql://", "postgres://")):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    checksum = digest(path)
    source = "pubmed:" + ingestion_key if ingestion_key else str(path.resolve())
    if insert_only:
        source = "additive:" + source
    positions = {n["id"]: n for n in template["nodes"]}
    with closing(connect(db_path)) as db:
        db.executescript(SCHEMA)
        previous = db.execute("SELECT * FROM imports WHERE source=?", (source,)).fetchone()
        if previous and previous["checksum"] != checksum:
            raise ValueError("Imported input changed: use a new immutable update file")
        if previous and previous["complete"]:
            return {"status": "skipped", "source": source, "records": previous["line"]}
        official = None if insert_only else re.search(r"pubmed(\d+)n(\d+)", path.name)
        sequence = [int(value) for value in official.groups()] if official else None
        last = db.execute("SELECT value FROM metadata WHERE key='last_pubmed_sequence'").fetchone()
        if sequence and last and sequence < json.loads(last[0]):
            raise ValueError("Out-of-order PubMed update: import baseline then daily files numerically")
        start = previous["line"] if previous else 0
        db.execute("INSERT INTO metadata VALUES('template',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps({k: v for k, v in template.items() if k not in ("nodes", "edges")}),))
        db.execute("INSERT INTO metadata VALUES('source',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(template["meta"]["source"]),))
        db.commit()
        opener = gzip.open if path.suffix == ".gz" else open
        count = start
        with opener(path, "rt", encoding="utf-8") as stream:
            chunk = []
            def commit_chunk(complete):
                nodes, pairs = Counter(), Counter()
                inserts = updates = deletes = 0
                with db:
                    for record in chunk:
                        exists = db.execute("SELECT pmid FROM articles WHERE pmid=?", (str(record["pmid"]),)).fetchone() is not None
                        if insert_only:
                            if record.get("op") == "delete":
                                raise ValueError("Additive imports cannot delete articles")
                            if exists:
                                continue
                        if record.get("op") == "delete": deletes += int(exists)
                        elif exists: updates += 1
                        else: inserts += 1
                        apply_event(db, record, trees, positions, nodes, pairs)
                    db.executemany("""INSERT INTO node_year VALUES(?,?,?) ON CONFLICT(year,mesh_id)
                      DO UPDATE SET count=node_year.count+excluded.count""", ((*key, value) for key, value in nodes.items() if value))
                    db.executemany("""INSERT INTO pair_year VALUES(?,?,?,?) ON CONFLICT(year,mesh_a,mesh_b)
                      DO UPDATE SET weight=pair_year.weight+excluded.weight""", ((*key, value) for key, value in pairs.items() if value))
                    db.executemany("DELETE FROM node_year WHERE year=? AND mesh_id=? AND count<=0",
                                   (key for key, delta in nodes.items() if delta < 0))
                    db.executemany("DELETE FROM pair_year WHERE year=? AND mesh_a=? AND mesh_b=? AND weight<=0",
                                   (key for key, delta in pairs.items() if delta < 0))
                    db.execute("INSERT INTO imports VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET checksum=excluded.checksum,line=excluded.line,complete=excluded.complete", (source, checksum, count, int(complete)))
                    db.execute("INSERT INTO metadata VALUES('revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(checksum + ':' + str(count)),))
                    if ingestion_key:
                        db.execute("""UPDATE ingestion_files SET records=?,checkpoint=?,inserts=inserts+?,updates=updates+?,deletes=deletes+?,status=? WHERE filename=?""",
                          (count,count,inserts,updates,deletes,"incorporated" if complete else "processing",ingestion_key))
                    if sequence:
                        db.execute("INSERT INTO metadata VALUES('last_pubmed_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(sequence),))
                chunk.clear()
            for line_number, line in enumerate(stream, 1):
                if line_number <= start:
                    continue
                chunk.append(json.loads(line))
                count = line_number
                if len(chunk) >= batch:
                    commit_chunk(False)
                    if count % 10000 == 0:
                        print(json.dumps({"imported": count, "file": path.name}), flush=True)
            commit_chunk(True)
        db.execute("PRAGMA optimize")
    return {"status": "complete", "source": source, "records": count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--db", default=os.getenv("DATABASE_URL", "pipeline/data/indexes/map.sqlite"))
    parser.add_argument("--trees", type=Path, default=Path("pipeline/cache/mesh_trees.json"))
    parser.add_argument("--template", type=Path, default=Path("public/data/graph-2018.json"))
    args = parser.parse_args()
    trees = json.loads(args.trees.read_text(encoding="utf-8"))
    template = json.loads(args.template.read_text(encoding="utf-8"))
    for path in sorted(args.input):
        print(json.dumps(import_file(args.db, path, trees, template)), flush=True)


if __name__ == "__main__":
    main()
