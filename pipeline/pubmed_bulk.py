#!/usr/bin/env python3
"""Stream official PubMed XML batches to restartable normalized upsert/delete files.

No full text, database provisioning, or bulk download is performed implicitly.
Use --file for an already downloaded XML.gz, or --url for an explicit NCBI file.
The output contract is independent of the eventual SQL service / deployment.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def text(element, path):
    node = element.find(path)
    return " ".join("".join(node.itertext()).split()) if node is not None else ""


def article_event(article, mesh_only=False):
    citation = article.find("MedlineCitation")
    if citation is None:
        return None
    pmid = text(citation, "PMID")
    if not pmid.isdigit():
        return None
    date = text(citation, "Article/Journal/JournalIssue/PubDate/Year") or text(
        citation, "Article/Journal/JournalIssue/PubDate/MedlineDate")
    year_match = re.search(r"\b(\d{4})\b", date)
    mesh = []
    for descriptor in citation.findall("MeshHeadingList/MeshHeading/DescriptorName"):
        mesh.append({"id": descriptor.get("UI", ""),
                     "label": "".join(descriptor.itertext()),
                     "major": descriptor.get("MajorTopicYN") == "Y"})
    record = {"op": "upsert", "pmid": pmid,
              "year": int(year_match[1]) if year_match else None, "mesh": mesh}
    if not mesh_only:
        record.update({"title": text(citation, "Article/ArticleTitle"),
                       "journal": text(citation, "Article/Journal/Title"),
                       "authors": [text(author, "CollectiveName") or " ".join(filter(None, [
                           text(author, "ForeName"), text(author, "LastName")]))
                           for author in citation.findall("Article/AuthorList/Author")],
                       "doi": next((node.text.strip() for node in article.findall(
                           "PubmedData/ArticleIdList/ArticleId")
                           if node.get("IdType") == "doi" and node.text), None)})
    return record


def iter_events(path, mesh_only=False):
    """Bound memory to one citation; do not retain the XML document tree."""
    with gzip.open(path, "rb") as stream:
        context = ET.iterparse(stream, events=("start", "end"))
        _, root = next(context)
        for event, element in context:
            if event != "end":
                continue
            if element.tag == "PubmedArticle":
                record = article_event(element, mesh_only)
                if record:
                    yield record
                root.clear()
            elif element.tag == "DeleteCitation":
                for node in element.findall("PMID"):
                    if node.text and node.text.strip().isdigit():
                        yield {"op": "delete", "pmid": node.text.strip()}
                root.clear()
            elif element.tag == "PubmedBookArticle":
                # Different schema; never invent MeSH metadata for book records.
                root.clear()


def checksum(path, algorithm="sha256"):
    result = hashlib.new(algorithm)
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def download(url, raw):
    parsed = urllib.parse.urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != "ftp.ncbi.nlm.nih.gov"
            or not re.fullmatch(r"/pubmed/(baseline|updatefiles)/pubmed\d+n\d+\.xml\.gz", parsed.path)):
        raise ValueError("Use an explicit official HTTPS PubMed baseline/updatefiles XML.gz URL")
    raw.mkdir(parents=True, exist_ok=True)
    target = raw / Path(parsed.path).name
    with urllib.request.urlopen(url + ".md5", timeout=60) as response:
        match = re.search(r"\b[0-9a-fA-F]{32}\b", response.read().decode())
    if not match:
        raise ValueError("Official checksum unavailable")
    expected = match[0].lower()
    if target.exists() and checksum(target, "md5") == expected:
        return target
    partial = target.with_suffix(target.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset and checksum(partial, "md5") == expected:
        partial.replace(target)
        return target
    request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"} if offset else {})
    with urllib.request.urlopen(request, timeout=120) as response:
        append = offset > 0 and response.status == 206
        with open(partial, "ab" if append else "wb") as output:
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                output.write(chunk)
    if checksum(partial, "md5") != expected:
        # Do not keep a corrupt partial as a resumable prefix.
        partial.replace(partial.with_suffix(".corrupt"))
        raise ValueError("Checksum mismatch; invalid payload retained as .corrupt")
    partial.replace(target)
    return target


def process(path, root, mesh_only=False):
    processed, indexes = root / "processed", root / "indexes"
    processed.mkdir(parents=True, exist_ok=True)
    indexes.mkdir(parents=True, exist_ok=True)
    identity = checksum(path)
    suffix = ".mesh" if mesh_only else ".metadata"
    destination = processed / (path.name + suffix + ".jsonl.gz")
    marker = indexes / (path.name + suffix + ".json")
    if marker.exists() and destination.exists():
        previous = json.loads(marker.read_text())
        if previous.get("sha256") == identity:
            print(json.dumps({"status": "skipped", "file": path.name}))
            return previous
    temporary = destination.with_suffix(".tmp")
    count = deletes = 0
    try:
        with gzip.open(temporary, "wt", encoding="utf-8") as output:
            for record in iter_events(path, mesh_only):
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1
                deletes += record["op"] == "delete"
                if count % 10000 == 0:
                    print(json.dumps({"file": path.name, "records": count}), flush=True)
        temporary.replace(destination)
        result = {"file": path.name, "sha256": identity, "records": count,
                  "deletes": deletes, "mesh_only": mesh_only, "output": str(destination)}
        pending = marker.with_suffix(".tmp")
        pending.write_text(json.dumps(result), encoding="utf-8")
        pending.replace(marker)
        print(json.dumps(result), flush=True)
        return result
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, action="append", default=[])
    parser.add_argument("--url", action="append", default=[])
    parser.add_argument("--directory", type=Path, help="Directory of already downloaded XML.gz files")
    parser.add_argument("--manifest", type=Path, help="Text file with one official XML.gz URL per line")
    parser.add_argument("--root", type=Path, default=Path("pipeline/data"))
    parser.add_argument("--mesh-only", action="store_true")
    args = parser.parse_args()
    urls = args.url + ([line.strip() for line in args.manifest.read_text().splitlines()
                       if line.strip() and not line.lstrip().startswith("#")] if args.manifest else [])
    files = args.file + list(args.directory.glob("*.xml.gz") if args.directory else [])
    # Download/process one file at a time; interrupted manifests can be rerun.
    for url in sorted(set(urls)):
        process(download(url, args.root / "raw"), args.root, args.mesh_only)
    if not files and not urls:
        parser.error("Specify at least one --file or --url; no automatic full baseline download")
    # The caller must supply baseline before daily updates. Official names sort numerically.
    for path in sorted(set(files), key=lambda path: path.name):
        process(path, args.root, args.mesh_only)


if __name__ == "__main__":
    main()
