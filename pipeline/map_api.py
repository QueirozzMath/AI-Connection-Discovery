"""Local Map query API. Deploy behind the application server, never expose SQLite.

GET /metadata; POST /graph {start,end}; POST /articles {start,end,meshIds,cursor}.
All queries are parameterized. Graphs and article pages have explicit size budgets.
"""
import argparse
from contextlib import closing
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
from map_store import connect

DB = Path("pipeline/data/indexes/map.sqlite")
QUERY_LOCK = threading.BoundedSemaphore(2)


def metadata(db):
    row = db.execute("SELECT MIN(year),MAX(year),COUNT(*) FROM articles WHERE year IS NOT NULL").fetchone()
    revision = json.loads(db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0])
    return {"start": row[0], "end": row[1], "articles": row[2], "revision": revision,
            "source": json.loads(db.execute("SELECT value FROM metadata WHERE key='source'").fetchone()[0])}


def period(data, catalog):
    start, end = data.get("start"), data.get("end")
    if type(start) is not int or type(end) is not int or not catalog["start"] <= start <= end <= catalog["end"]:
        raise ValueError("Period must be within the imported corpus")
    return start, end


@lru_cache(maxsize=12)
def graph_query(path, revision, start, end):
    with closing(connect(path)) as db:
        template = json.loads(db.execute("SELECT value FROM metadata WHERE key='template'").fetchone()[0])
        rows = db.execute("""SELECT m.*,SUM(n.count) AS pubs FROM node_year n JOIN mesh m ON m.id=n.mesh_id
          WHERE n.year BETWEEN ? AND ? GROUP BY m.id ORDER BY pubs DESC,m.id LIMIT 4500""", (start, end)).fetchall()
        db.execute("CREATE TEMP TABLE selected_mesh(id TEXT PRIMARY KEY) WITHOUT ROWID")
        db.executemany("INSERT INTO selected_mesh VALUES(?)", ((r["id"],) for r in rows))
        edges = db.execute("""SELECT p.mesh_a,p.mesh_b,SUM(p.weight) AS weight FROM pair_year p
          JOIN selected_mesh a ON a.id=p.mesh_a JOIN selected_mesh b ON b.id=p.mesh_b
          WHERE p.year BETWEEN ? AND ? GROUP BY p.mesh_a,p.mesh_b
          ORDER BY weight DESC,p.mesh_a,p.mesh_b LIMIT 30000""", (start, end)).fetchall()
        growth_rows = db.execute("""SELECT mesh_id,
          SUM(CASE WHEN year>=? THEN count ELSE 0 END) AS recent,
          SUM(CASE WHEN year<? THEN count ELSE 0 END) AS older
          FROM node_year WHERE year BETWEEN ? AND ? GROUP BY mesh_id""", (end-4, end-4, end-9, end)).fetchall()
        growth = {r[0]: max(-2, min(2, math.log((r[1]+1)/(r[2]+1)))) for r in growth_rows}
        first_year = db.execute("SELECT MIN(year) FROM articles").fetchone()[0]
        nodes = [{"id": r["id"], "label": r["label"], "cat": r["category"], "tree": r["tree"],
                  "x": r["x"], "y": r["y"], "z": 0, "hx": r["hx"], "hy": r["hy"],
                  "deg": 0, "pubs": r["pubs"], "growth": growth.get(r["id"], 0),
                  "growthAvailable": end-9 >= first_year} for r in rows]
        indices = {node["id"]: i for i, node in enumerate(nodes)}
        links = []
        for a, b, weight in edges:
            ai, bi = indices[a], indices[b]
            nodes[ai]["deg"] += 1
            nodes[bi]["deg"] += 1
            links.append([ai, bi, weight])
        articles = db.execute("SELECT COUNT(*) FROM articles WHERE year BETWEEN ? AND ?", (start, end)).fetchone()[0]
        total = db.execute("SELECT COUNT(DISTINCT mesh_id) FROM node_year WHERE year BETWEEN ? AND ?", (start, end)).fetchone()[0]
        return {**template, "nodes": nodes, "edges": links, "meta": {**template["meta"],
            "corpus_max_year": db.execute("SELECT MAX(year) FROM articles").fetchone()[0],
            "cutoff_year": end, "n_nodes": len(nodes), "n_edges": len(links), "n_articles": articles,
            "period_start": start, "period_end": end, "total_concepts": total,
            "node_limit": 4500, "edge_limit": 30000, "revision": revision}}


@lru_cache(maxsize=128)
def article_query(path, revision, start, end, ids, cursor):
    if not ids:
        return {"items": [], "total": 0, "years": [], "next": None}
    with closing(connect(path)) as db:
        db.execute("CREATE TEMP TABLE requested_mesh(id TEXT PRIMARY KEY) WITHOUT ROWID")
        db.executemany("INSERT INTO requested_mesh VALUES(?)", ((mid,) for mid in ids))
        # Indexed semijoin: only article IDs satisfying the displayed concept set.
        condition = """a.year BETWEEN ? AND ? AND a.pmid IN
          (SELECT am.pmid FROM article_mesh am JOIN requested_mesh r ON r.id=am.mesh_id)"""
        years = db.execute("SELECT a.year,COUNT(*) FROM articles a WHERE " + condition + " GROUP BY a.year", (start, end)).fetchall()
        params = [start, end]
        if cursor:
            year, pmid = cursor.split(":", 1)
            if not year.isdigit() or not pmid.isdigit():
                raise ValueError("Invalid cursor")
            condition += " AND (a.year<? OR (a.year=? AND a.pmid<?))"
            params.extend([int(year), int(year), pmid])
        rows = db.execute("SELECT a.* FROM articles a WHERE " + condition + " ORDER BY a.year DESC,a.pmid DESC LIMIT 21", params).fetchall()
        items = []
        for row in rows[:20]:
            headings = db.execute("""SELECT m.id,m.label,m.category,am.major FROM article_mesh am
              JOIN mesh m ON m.id=am.mesh_id WHERE am.pmid=? ORDER BY m.id""", (row["pmid"],)).fetchall()
            items.append({"pmid": row["pmid"], "year": row["year"], "title": row["title"],
                          "journal": row["journal"], "doi": row["doi"],
                          "authors": json.loads(row["authors"]) if row["authors"] else [],
                          "mesh": [dict(mesh) for mesh in headings]})
        return {"items": items, "total": sum(r[1] for r in years),
                "years": [{"year": r[0], "count": r[1]} for r in years],
                "next": f"{rows[19]['year']}:{rows[19]['pmid']}" if len(rows) > 20 else None}


class Handler(BaseHTTPRequestHandler):
    def respond(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        token = os.getenv("MAP_API_TOKEN")
        if token and self.headers.get("Authorization") != "Bearer " + token:
            self.respond(401, {"error": "Unauthorized"})
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        if self.path != "/metadata":
            return self.respond(404, {"error": "Not found"})
        try:
            with closing(connect(DB)) as db:
                self.respond(200, metadata(db))
        except sqlite3.Error:
            self.respond(503, {"error": "Import the corpus before starting queries"})

    def do_POST(self):
        if not self.authorized():
            return
        if self.path not in ("/graph", "/articles"):
            return self.respond(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 100000:
                return self.respond(413, {"error": "Payload too large"})
            data = json.loads(self.rfile.read(length))
            with QUERY_LOCK, closing(connect(DB)) as db:
                catalog = metadata(db)
                start, end = period(data, catalog)
                if self.path == "/graph":
                    result = graph_query(str(DB), catalog["revision"], start, end)
                else:
                    ids = data.get("meshIds", [])
                    if not isinstance(ids, list) or len(ids) > 4500 or any(not isinstance(i, str) or len(i) > 24 for i in ids):
                        raise ValueError("At most 4500 valid concept IDs")
                    cursor = data.get("cursor") or ""
                    if not isinstance(cursor, str) or len(cursor) > 40:
                        raise ValueError("Invalid cursor")
                    result = article_query(str(DB), catalog["revision"], start, end, tuple(sorted(set(ids))), cursor)
                self.respond(200, result)
        except (ValueError, TypeError, KeyError, AttributeError):
            self.respond(400, {"error": "Invalid query"})
        except sqlite3.Error:
            self.respond(503, {"error": "Database unavailable"})


def main():
    global DB
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DB)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    DB = args.db.resolve()
    if not DB.is_file():
        parser.error("Database missing: run map_store.py first")
    print(f"Map API: http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
