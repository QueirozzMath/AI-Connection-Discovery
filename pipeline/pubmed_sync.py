"""Discover, archive and ingest official PubMed files in a single ordered writer."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import time
import urllib.request

from map_store import connect, SCHEMA, import_file
from pubmed_bulk import download, process, checksum

BASE = "https://ftp.ncbi.nlm.nih.gov/pubmed/"
PATTERN = re.compile(r"pubmed(\d+)n(\d+)\.xml\.gz$")

def now(): return datetime.now(timezone.utc).isoformat()

class Listing(HTMLParser):
    def __init__(self): super().__init__(); self.files = set()
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href", "")
            if PATTERN.fullmatch(href): self.files.add(href)

def discover(kind):
    directory = "baseline" if kind == "baseline" else "updatefiles"
    with urllib.request.urlopen(BASE + directory + "/", timeout=60) as response:
        parser = Listing(); parser.feed(response.read(4_000_000).decode())
    return [{"filename": name, "kind": kind, "cycle": int(PATTERN.fullmatch(name)[1]),
             "sequence": int(PATTERN.fullmatch(name)[2]), "url": BASE+directory+"/"+name}
            for name in sorted(parser.files)]

@contextmanager
def writer_lock(root, db_path):
    root.mkdir(parents=True, exist_ok=True)
    if str(db_path).startswith(("postgres://", "postgresql://")):
        with closing(connect(db_path)) as db:
            if not db.execute("SELECT pg_try_advisory_lock(74201901)").fetchone()[0]:
                raise RuntimeError("Another PubMed writer is active")
            try: yield
            finally: db.execute("SELECT pg_advisory_unlock(74201901)")
    else:
        # OS lock is released on crash, unlike a stale 'lock exists' marker.
        lock_path = Path(db_path).resolve().with_suffix(".writer.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "a+b") as lock:
            lock.seek(0); lock.write(b"0"); lock.flush(); lock.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try: yield
            finally:
                if os.name == "nt":
                    lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else: fcntl.flock(lock, fcntl.LOCK_UN)

class Archive:
    def __init__(self):
        self.bucket = os.getenv("R2_BUCKET")
        self.client = None
        if self.bucket:
            import boto3
            self.client = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"],
                aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    def put(self, path, key):
        if not self.client: return
        from botocore.exceptions import ClientError
        identity = checksum(path)
        try:
            meta = self.client.head_object(Bucket=self.bucket, Key=key)
            if meta.get("Metadata",{}).get("sha256") == identity: return
        except ClientError as error:
            if error.response["Error"]["Code"] not in ("404","NoSuchKey","NotFound"): raise
        self.client.upload_file(str(path),self.bucket,key,ExtraArgs={"Metadata":{"sha256":identity}})

def sync(root, db_path, trees, template, max_files=None, listing=None, archive=None):
    root = Path(root)
    if not str(db_path).startswith(("postgres://", "postgresql://")):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with writer_lock(root, db_path), closing(connect(db_path)) as db:
        db.executescript(SCHEMA)
        files = listing if listing is not None else discover("baseline") + discover("update")
        files.sort(key=lambda f: (f["cycle"], f["kind"] != "baseline", f["sequence"]))
        cycles = {f["cycle"] for f in files if f["kind"] == "baseline"}
        if len(cycles) != 1: raise ValueError("Exactly one official baseline cycle is required")
        cycle = next(iter(cycles))
        previous = db.execute("SELECT value FROM metadata WHERE key='ingestion_cycle'").fetchone()
        if previous and json.loads(previous[0]) != cycle:
            raise ValueError("New annual baseline detected: initialize a new database and switch after validation")
        # An unordered/sample corpus must not silently be mixed with a new baseline.
        if not previous and db.execute("SELECT COUNT(*) FROM articles").fetchone()[0]:
            raise ValueError("Baseline requires a new database; the existing local sample is preserved")
        db.execute("INSERT INTO metadata VALUES('ingestion_cycle',?) ON CONFLICT(key) DO NOTHING", (json.dumps(cycle),))
        for file in files:
            if file["cycle"] != cycle: continue
            db.execute("""INSERT INTO ingestion_files(filename,kind,cycle,url,status) VALUES(?,?,?,?,'discovered')
              ON CONFLICT(filename) DO NOTHING""", (file["filename"],file["kind"],cycle,file["url"]))
        db.commit()
        # Keep previously discovered failures even if a later directory listing
        # no longer includes them; never silently jump over a pending update.
        files = [dict(row) for row in db.execute("SELECT filename,kind,cycle,url FROM ingestion_files WHERE cycle=?",(cycle,))]
        files.sort(key=lambda f:(f["kind"] != "baseline",int(PATTERN.fullmatch(f["filename"])[2])))
        archive = archive or Archive()
        incorporated = 0
        for file in files:
            if file["cycle"] != cycle: continue
            name = file["filename"]
            state = db.execute("SELECT * FROM ingestion_files WHERE filename=?", (name,)).fetchone()
            if state["status"] == "incorporated": continue
            if max_files is not None and incorporated >= max_files: break
            try:
                db.execute("UPDATE ingestion_files SET status='downloading',error=NULL WHERE filename=?",(name,)); db.commit()
                raw = download(file["url"],root/"raw"/file["kind"])
                md5 = checksum(raw,"md5")
                db.execute("UPDATE ingestion_files SET status='validated',checksum=?,size=?,downloaded_at=? WHERE filename=?",(md5,raw.stat().st_size,now(),name)); db.commit()
                archive.put(raw, f"pubmed/{'baseline' if file['kind']=='baseline' else 'updates'}/{name}")
                marker = root/"checksums"/(name+".md5"); marker.parent.mkdir(parents=True,exist_ok=True)
                marker.write_text(md5,encoding="utf-8"); archive.put(marker,"pubmed/checksums/"+marker.name)
                result = process(raw,root)
                db.execute("UPDATE ingestion_files SET status='processed',processed_at=? WHERE filename=?",(now(),name)); db.commit()
                import_file(db_path,Path(result["output"]),trees,template,ingestion_key=name)
                db.execute("UPDATE ingestion_files SET incorporated_at=?,status='incorporated' WHERE filename=?",(now(),name)); db.commit()
                state = dict(db.execute("SELECT * FROM ingestion_files WHERE filename=?",(name,)).fetchone())
                manifest = root/"manifests"/(name+".json"); manifest.parent.mkdir(parents=True,exist_ok=True)
                manifest.write_text(json.dumps(state),encoding="utf-8")
                archive.put(manifest,"pubmed/processed/"+manifest.name)
                incorporated += 1
            except Exception as error:
                db.execute("UPDATE ingestion_files SET status='error',error=? WHERE filename=?",(str(error)[:2000],name)); db.commit()
                raise  # Never skip a failed update and apply a later one.
        return {"incorporated":incorporated,"cycle":cycle}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,default=Path("pipeline/data"))
    parser.add_argument("--db",default=os.getenv("DATABASE_URL","pipeline/data/indexes/pubmed.sqlite"))
    parser.add_argument("--max-files",type=int)
    parser.add_argument("--interval",type=int,default=0,help="Seconds between syncs; 0 runs once")
    args = parser.parse_args()
    Path(args.root/"indexes").mkdir(parents=True,exist_ok=True)
    trees=json.loads(Path("pipeline/cache/mesh_trees.json").read_text(encoding="utf-8"))
    template=json.loads(Path("public/data/graph-2018.json").read_text(encoding="utf-8"))
    template["meta"]["source"]="PubMed official baseline and daily updates"
    while True:
        print(json.dumps(sync(args.root,args.db,trees,template,args.max_files)),flush=True)
        if not args.interval: break
        time.sleep(max(60,args.interval))

if __name__ == "__main__": main()
