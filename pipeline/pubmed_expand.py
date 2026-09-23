"""Add a previous SQLite corpus and year/MeSH-stratified PubMed supplements.

Existing PMIDs are never updated or deleted. Raw E-utilities responses, immutable
inputs, checksums and the initial SQLite backup allow audit and safe resumption.
This is a targeted sample, not a complete baseline or a representative census.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
import gzip
import hashlib
from itertools import zip_longest
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from map_store import digest, import_file
from pubmed_bulk import article_event
from pubmed_ingest import BRANCHES, EUTILS
from pubmed_sync import writer_lock

SOURCE = "PubMed partial baseline + preserved earlier corpus + year/MeSH-stratified E-utilities sample"


def now():
    return datetime.now(timezone.utc).isoformat()


def save_json(path, value):
    pending = path.with_suffix(path.suffix + ".part")
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    pending.replace(path)


def readonly(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


def distribution(db):
    return dict(db.execute("SELECT year,COUNT(*) FROM articles GROUP BY year ORDER BY year"))


def write_records(path, records):
    pending = path.with_suffix(path.suffix + ".part")
    count = 0
    with gzip.open(pending, "wt", encoding="utf-8") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    pending.replace(path)
    return count


def export_previous(source, destination):
    with closing(readonly(source)) as db:
        def records():
            for row in db.execute("SELECT * FROM articles ORDER BY pmid"):
                record = dict(row)
                record["authors"] = json.loads(record["authors"]) if record["authors"] else []
                record["mesh"] = [dict(item) for item in db.execute(
                    "SELECT mesh_id AS id,label,major FROM article_mesh JOIN mesh ON mesh.id=mesh_id WHERE pmid=? ORDER BY mesh_id",
                    (record["pmid"],))]
                yield record
        return write_records(destination, records())


class Entrez:
    def __init__(self, root):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.last_request = 0

    def request(self, endpoint, params, parse):
        identity = {"endpoint": endpoint, "params": params}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        path = self.root / (key + ".gz")
        if path.exists():
            return parse(gzip.decompress(path.read_bytes()))
        args = {**params, "tool": "biodiscovery_corpus"}
        if os.getenv("NCBI_API_KEY"):
            args["api_key"] = os.environ["NCBI_API_KEY"]
        if os.getenv("NCBI_EMAIL"):
            args["email"] = os.environ["NCBI_EMAIL"]
        # Always below the unauthenticated 3 requests/second limit; serial writer.
        for attempt in range(5):
            time.sleep(max(0, .4 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                request = urllib.request.Request(EUTILS + "/" + endpoint,
                    data=urllib.parse.urlencode(args).encode())
                with urllib.request.urlopen(request, timeout=120) as response:
                    payload = response.read()
                result = parse(payload)  # HTTP 200 with an API error is not success.
                pending = path.with_suffix(".part")
                pending.write_bytes(gzip.compress(payload, mtime=0))
                pending.replace(path)
                save_json(self.root / (key + ".json"), {**identity, "retrieved_at": now(),
                    "sha256": digest(path), "response": path.name})
                return result
            except Exception as error:
                if attempt == 4:
                    raise
                print(json.dumps({"retry": attempt + 1, "endpoint": endpoint,
                                  "error": type(error).__name__}), flush=True)
                time.sleep(2 ** (attempt + 1))

    def search(self, term, count):
        def parse(payload):
            data = json.loads(payload)
            result = data.get("esearchresult", {})
            if data.get("error") or result.get("errorlist") or "idlist" not in result:
                raise ValueError("E-utilities search error: " + str(data))
            return result["idlist"]
        return self.request("esearch.fcgi", {"db": "pubmed", "term": term,
            "retmax": min(10000, count), "retmode": "json", "sort": "relevance"}, parse)

    def fetch(self, ids):
        def parse(payload):
            root = ET.fromstring(payload)
            if root.tag != "PubmedArticleSet" or root.find(".//ERROR") is not None:
                raise ValueError("E-utilities returned an invalid article response")
            records = [article_event(article) for article in root.findall("PubmedArticle")]
            records = [record for record in records if record]
            if ids and not records:
                raise ValueError("E-utilities returned no articles for the requested PMIDs")
            return records
        return self.request("efetch.fcgi", {"db": "pubmed", "id": ",".join(ids), "retmode": "xml"}, parse)


def collect_year(client, year, needed, seen):
    # Round-robin across broad MeSH branches prevents one branch consuming the quota.
    query = f'{year}[dp] AND medline[sb]'
    pools = [client.search(f'"{name}"[MeSH Terms] AND {query}',
                           max(600, math.ceil(needed / len(BRANCHES)) * 3))
             for name in BRANCHES.values()]
    candidates = dict.fromkeys(pmid for row in zip_longest(*pools) for pmid in row if pmid)
    records, rejected, attempted = [], Counter(), set()

    def fetch_candidates(ids):
        fresh = [pmid for pmid in ids if pmid not in seen and pmid not in attempted]
        for offset in range(0, len(fresh), 200):
            batch = fresh[offset:offset + 200]
            attempted.update(batch)
            fetched = client.fetch(batch)
            returned = {record["pmid"] for record in fetched}
            if not returned.issubset(set(batch)):
                raise ValueError("E-utilities returned an unexpected PMID")
            rejected["not_returned"] += len(set(batch) - returned)
            for record in fetched:
                if record["year"] != year:
                    rejected["different_publication_year"] += 1
                elif not record["mesh"]:
                    rejected["without_mesh"] += 1
                elif record["pmid"] not in seen:
                    records.append(record)
                    seen.add(record["pmid"])
                if len(records) >= needed:
                    return
            if offset % 1000 == 0:
                print(json.dumps({"year": year, "downloaded": len(records), "needed": needed}), flush=True)
    fetch_candidates(candidates)
    if len(records) < needed:
        fetch_candidates(client.search(query, 10000))
    return records, {"attempted": len(attempted), "accepted": len(records), "excluded": dict(rejected)}


def expand(args):
    if not args.db.is_file() or not args.merge_db.is_file():
        raise ValueError("Both the current and previous databases must already exist")
    if args.db.resolve() == args.merge_db.resolve():
        raise ValueError("The previous database must be distinct from the active database")
    args.root.mkdir(parents=True, exist_ok=True)
    with writer_lock(args.root, args.db):
        manifest_path = args.root / "manifest.json"
        config = {"db": str(args.db.resolve()), "merge_db": str(args.merge_db.resolve()),
                  "start": args.start, "end": args.end, "target_per_year": args.target_per_year}
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest["config"] != config:
                raise ValueError("Use a new expansion directory for a different configuration")
            if manifest["previous_sha256"] != digest(args.merge_db):
                raise ValueError("Previous corpus changed; use a new expansion directory")
        else:
            backup = args.root / "before-expansion.sqlite"
            temporary = backup.with_suffix(".part")
            with closing(readonly(args.db)) as current, closing(sqlite3.connect(temporary)) as snapshot:
                current.backup(snapshot)
                if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Backup integrity check failed")
                before = distribution(current)
            temporary.replace(backup)
            manifest = {"config": config, "started_at": now(), "source": SOURCE,
                        "backup": str(backup), "backup_sha256": digest(backup),
                        "previous_sha256": digest(args.merge_db), "before": before, "files": {}}
            save_json(manifest_path, manifest)
        trees = json.loads(Path("pipeline/cache/mesh_trees.json").read_text(encoding="utf-8"))
        template = json.loads(Path("public/data/graph-2018.json").read_text(encoding="utf-8"))
        template["meta"]["source"] = SOURCE
        with closing(sqlite3.connect(args.db, timeout=60)) as db:
            db.execute("INSERT INTO metadata VALUES('supplemental_corpus',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (json.dumps({"manifest": str(manifest_path), "source": SOURCE}),))
            db.commit()

        def incorporate(path, details):
            checksum = digest(path)
            prior = manifest["files"].get(path.name)
            if prior and prior["sha256"] != checksum:
                raise ValueError("Supplement changed after it was recorded")
            manifest["files"][path.name] = {**details, "sha256": checksum, "status": "pending"}
            save_json(manifest_path, manifest)
            print(json.dumps({"importing": path.name}), flush=True)
            result = import_file(args.db, path, trees, template, insert_only=True)
            manifest["files"][path.name].update(result)
            save_json(manifest_path, manifest)

        previous = args.root / "previous-corpus.jsonl.gz"
        if not previous.exists():
            export_previous(args.merge_db, previous)
        incorporate(previous, {"origin": str(args.merge_db)})
        if args.merge_only:
            return
        with closing(readonly(args.db)) as db:
            counts = distribution(db)
            seen = {row[0] for row in db.execute("SELECT pmid FROM articles")}
        client = Entrez(args.root / "raw")

        def prepare_year(year):
            path = args.root / f"year-{year}.jsonl.gz"
            details_path = args.root / f"year-{year}.json"
            if path.exists():
                details = json.loads(details_path.read_text(encoding="utf-8")) if details_path.exists() else {"year": year}
                return path, details
            elif counts.get(year, 0) < args.target_per_year:
                needed = args.target_per_year - counts.get(year, 0)
                records, details = collect_year(client, year, needed, seen)
                details.update({"year": year, "initial": counts.get(year, 0), "retrieved_at": now()})
                save_json(details_path, details)
                write_records(path, records)
                return path, details
            return None, None

        # One downloader overlaps the next year's requests with the single SQL
        # writer. Only the downloader owns `seen` and the Entrez rate limiter.
        years = sorted(range(args.start, args.end + 1), key=lambda y: (counts.get(y, 0), y))
        with ThreadPoolExecutor(max_workers=1) as downloader:
            prepared = downloader.submit(prepare_year, years[0])
            for index, year in enumerate(years):
                path, details = prepared.result()
                if index + 1 < len(years):
                    prepared = downloader.submit(prepare_year, years[index + 1])
                if path:
                    incorporate(path, details)
                with closing(readonly(args.db)) as db:
                    actual = db.execute("SELECT COUNT(*) FROM articles WHERE year=?", (year,)).fetchone()[0]
                print(json.dumps({"year": year, "articles": actual, "target": args.target_per_year}), flush=True)
        with closing(readonly(args.db)) as db:
            after = distribution(db)
            manifest.update({"finished_at": now(), "after": after,
                "total": sum(after.values()), "integrity": db.execute("PRAGMA integrity_check").fetchone()[0],
                "foreign_key_errors": [list(row) for row in db.execute("PRAGMA foreign_key_check")],
                "below_target": {year: after.get(year, 0) for year in range(args.start, args.end + 1)
                                 if after.get(year, 0) < args.target_per_year}})
        save_json(manifest_path, manifest)
        print(json.dumps({key: manifest[key] for key in ("total", "integrity", "below_target")}), flush=True)
        if manifest["integrity"] != "ok" or manifest["foreign_key_errors"] or manifest["below_target"]:
            raise RuntimeError("Expansion audit incomplete; see manifest (existing articles preserved)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path("pipeline/data/indexes/pubmed.sqlite"))
    parser.add_argument("--merge-db", type=Path, default=Path("pipeline/data/indexes/map.sqlite"))
    parser.add_argument("--root", type=Path, default=Path("pipeline/data/expansions/diversified-1974-2026"))
    parser.add_argument("--start", type=int, default=1974)
    parser.add_argument("--end", type=int, default=2026)
    parser.add_argument("--target-per-year", type=int, default=5000)
    parser.add_argument("--merge-only", action="store_true")
    args = parser.parse_args()
    if args.start > args.end or args.target_per_year < 1:
        parser.error("Invalid year interval or annual target")
    expand(args)


if __name__ == "__main__":
    main()
