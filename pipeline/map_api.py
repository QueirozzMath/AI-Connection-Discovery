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
import socket
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from map_store import connect

DB = Path("pipeline/data/indexes/map.sqlite")
QUERY_LOCK = threading.BoundedSemaphore(2)
JOBS = OrderedDict()
JOBS_LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1)

def execute_analysis(path, revision, start, end, validate, allowed_ids, seed_ids):
    from temporal_model import analyze, train
    result = analyze(path, revision, start, end, validate, allowed_ids, seed_ids)
    with closing(connect(path)) as db:
        if metadata(db)["revision"] != revision:
            train.cache_clear()
            return {"available": False, "items": [], "reason": "O corpus foi atualizado durante a análise. Atualize o catálogo e execute novamente."}
    return result


def analysis_job(path, revision, start, end, validate, allowed_ids=None, seed_ids=()):
    from temporal_model import analyze
    key = (str(path), revision, start, end, validate,allowed_ids,seed_ids)
    with JOBS_LOCK:
        if key not in JOBS:
            if sum(not job.done() for job in JOBS.values()) >= 4:
                return {"status": "busy", "reason": "Fila de análise ocupada. Tente novamente."}
            while len(JOBS) >= 12:
                completed = next((k for k,v in JOBS.items() if v.done()), None)
                if completed is None: break
                del JOBS[completed]
            JOBS[key] = EXECUTOR.submit(execute_analysis, str(path), revision, start, end, validate,allowed_ids,seed_ids)
        job = JOBS[key]
    if not job.done(): return {"status": "pending"}
    try:
        return {"status": "complete", **job.result()}
    except Exception as error:
        print(f"Analysis failed: {type(error).__name__}: {error}", flush=True)
        with JOBS_LOCK: JOBS.pop(key, None)
        return {"status": "error", "reason": "Falha ao executar análise científica. Verifique o serviço e suas dependências."}


def metadata(db):
    row = db.execute("SELECT MIN(year),MAX(year),COUNT(*) FROM articles WHERE year IS NOT NULL").fetchone()
    revision = json.loads(db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0])
    return {"start": row[0], "end": row[1], "articles": row[2], "revision": revision,
            "source": json.loads(db.execute("SELECT value FROM metadata WHERE key='source'").fetchone()[0])}


def period(data, catalog):
    start, end = data.get("startYear", data.get("start")), data.get("endYear", data.get("end"))
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
                  "growthAvailable": end-9 >= first_year,
                  "growthReason": None if end-9 >= first_year else "O corpus não cobre os dez anos necessários às duas janelas de cinco anos."} for r in rows]
        indices = {node["id"]: i for i, node in enumerate(nodes)}
        links = []
        for a, b, weight in edges:
            ai, bi = indices[a], indices[b]
            nodes[ai]["deg"] += 1
            nodes[bi]["deg"] += 1
            links.append([ai, bi, weight])
        articles = db.execute("SELECT COUNT(*) FROM articles WHERE year BETWEEN ? AND ?", (start, end)).fetchone()[0]
        total = db.execute("SELECT COUNT(DISTINCT mesh_id) FROM node_year WHERE year BETWEEN ? AND ?", (start, end)).fetchone()[0]
        return {**template, "model": {"type": "logistic", "available": False,
            "reason": "Execute a inferência para calibrar o modelo neste corte.", "mean": [], "std": [], "coef": [], "intercept": 0},
            "nodes": nodes, "edges": links, "meta": {**template["meta"],
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


def evidence_query(db, data, start, end):
    # Names from the client are resolved against stored descriptors. Never trust
    # client-provided probabilities, bridges, PMIDs or publication years.
    a, c = data.get("a"), data.get("c")
    if not isinstance(a, str) or not isinstance(c, str) or max(len(a),len(c)) > 300:
        raise ValueError("Invalid concepts")
    ids = []
    for value in (a,c):
        row = db.execute("SELECT id,label FROM mesh WHERE id=? OR LOWER(label)=LOWER(?) ORDER BY id LIMIT 1", (value,value)).fetchone()
        if not row: return {"a": [], "c": [], "together": [], "bridges": []}
        ids.append(row[0])
    allowed = data.get("meshIds")
    if allowed is not None:
        if not isinstance(allowed, list) or len(allowed) > 4500 or any(not isinstance(i,str) for i in allowed):
            raise ValueError("Invalid allowed concepts")
        if any(mid not in allowed for mid in ids):
            raise ValueError("Concept outside selected universe")
    def articles(mid):
        return [dict(r) for r in db.execute("""SELECT a.pmid,a.year,a.title FROM articles a
          JOIN article_mesh am ON am.pmid=a.pmid WHERE am.mesh_id=? AND a.year BETWEEN ? AND ?
          ORDER BY a.year DESC,a.pmid DESC LIMIT 12""", (mid,start,end))]
    together = [dict(r) for r in db.execute("""SELECT a.pmid,a.year,a.title FROM articles a
      JOIN article_mesh x ON x.pmid=a.pmid JOIN article_mesh y ON y.pmid=a.pmid
      WHERE x.mesh_id=? AND y.mesh_id=? AND a.year BETWEEN ? AND ? ORDER BY a.year,a.pmid LIMIT 20""", (*ids,start,end))]
    neighbours = []
    for mid in ids:
        neighbours.append({r[0] for r in db.execute("""SELECT CASE WHEN mesh_a=? THEN mesh_b ELSE mesh_a END FROM pair_year
            WHERE (mesh_a=? OR mesh_b=?) AND year BETWEEN ? AND ?""", (mid,mid,mid,start,end))})
    common = neighbours[0]&neighbours[1]
    if allowed is not None: common &= set(allowed)
    bridges = [db.execute("SELECT label FROM mesh WHERE id=?",(mid,)).fetchone()[0] for mid in sorted(common)[:6]]
    return {"a": articles(ids[0]), "c": articles(ids[1]), "together": together, "bridges": bridges}


class MapHTTPServer(ThreadingHTTPServer):
    """Reject a second API process on the same address, including on Windows."""

    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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
        if self.path == "/ingestion-jobs":
            import hmac
            token = os.getenv("INGESTION_API_TOKEN", "")
            if not os.getenv("ENABLE_INGESTION") == "1" or not token or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                return self.respond(403, {"error": "Ingestion endpoint disabled or unauthorized"})
            try:
                length=int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1000: raise ValueError("Invalid payload")
                from ingestion_jobs import enqueue
                return self.respond(202, enqueue(DB, json.loads(self.rfile.read(length))["id"]))
            except (ValueError,KeyError): return self.respond(400, {"error":"Invalid job"})
        if not self.authorized():
            return
        if self.path not in ("/graph", "/articles", "/analysis", "/evidence"):
            return self.respond(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 100000:
                return self.respond(413, {"error": "Payload too large"})
            data = json.loads(self.rfile.read(length))
            with QUERY_LOCK, closing(connect(DB)) as db:
                catalog = metadata(db)
                start, end = period(data, catalog)
                if self.path == "/analysis":
                    ids=data.get("meshIds")
                    seeds=data.get("seedIds",[])
                    for value in [ids,seeds]:
                        if value is not None and (not isinstance(value,list) or len(value)>4500 or any(not isinstance(i,str) or len(i)>24 for i in value)):
                            raise ValueError("Invalid concepts")
                    result = analysis_job(DB, catalog["revision"], start, end, data.get("operation") == "validate",
                        tuple(sorted(set(ids))) if ids is not None else None,tuple(sorted(set(seeds))))
                elif self.path == "/evidence":
                    result = evidence_query(db, data, start, end)
                elif self.path == "/graph":
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
        except Exception:
            self.respond(503, {"error": "Scientific service unavailable"})


def main():
    global DB
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.getenv("DATABASE_URL", str(DB)))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    DB = args.db if args.db.startswith(("postgres://", "postgresql://")) else Path(args.db).resolve()
    if isinstance(DB, Path) and not DB.is_file() and os.getenv("ENABLE_INGESTION") != "1":
        parser.error("Database missing: run map_store.py first")
    if os.getenv("ENABLE_INGESTION") == "1":
        if isinstance(DB, Path): DB.parent.mkdir(parents=True, exist_ok=True)
        from ingestion_jobs import start_worker
        start_worker(DB, Path(os.getenv("PUBMED_ROOT", "pipeline/data")))
    server = MapHTTPServer((args.host, args.port), Handler)
    print(f"Map API: http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
