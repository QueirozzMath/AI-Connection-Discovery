#!/usr/bin/env python3
"""Ingestao real do PubMed via E-utilities.

Baixa uma amostra estratificada (ano x ramo MeSH) de citacoes reais do PubMed e
grava um corpus JSONL com: pmid, ano de publicacao e lista de MeSH descriptors
(UI, nome, major topic). Esse corpus alimenta pipeline/build_from_corpus.py.

Uso:
    python3 pipeline/pubmed_ingest.py --start 1980 --end 2024 --per-cell 220

Para cobertura total do PubMed use --mode baseline (ver README no fim do arquivo).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
API_KEY = os.environ.get("NCBI_API_KEY", "")
RATE = 0.11 if API_KEY else 0.36  # segundos entre requisicoes

BRANCHES = {
    "A": "Anatomy",
    "B": "Organisms",
    "C": "Diseases",
    "D": "Chemicals and Drugs",
    "E": "Analytical, Diagnostic and Therapeutic Techniques, and Equipment",
    "F": "Psychiatry and Psychology",
    "G": "Phenomena and Processes",
    "H": "Disciplines and Occupations",
    "I": "Anthropology, Education, Sociology, and Social Phenomena",
    "J": "Technology, Industry, and Agriculture",
    "L": "Information Science",
    "N": "Health Care",
}

_last = [0.0]


def _throttle() -> None:
    dt = time.time() - _last[0]
    if dt < RATE:
        time.sleep(RATE - dt)
    _last[0] = time.time()


def _get(path: str, params: dict, tries: int = 5) -> bytes:
    if API_KEY:
        params = {**params, "api_key": API_KEY}
    params = {**params, "tool": "meshmap", "email": "meshmap@example.org"}
    encoded = urllib.parse.urlencode(params)
    url = f"{EUTILS}/{path}?{encoded}"
    for attempt in range(tries):
        _throttle()
        try:
            # Long PMID lists exceed proxy and server URI limits. E-utilities
            # accepts the same form fields by POST, which also enables larger,
            # faster fetch batches while preserving rate limiting.
            request = (
                urllib.request.Request(
                    f"{EUTILS}/{path}",
                    data=encoded.encode("utf-8"),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                if len(url) > 3000
                else url
            )
            with urllib.request.urlopen(request, timeout=120) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            wait = 2 ** attempt
            print(f"  ! {type(exc).__name__} {exc} -> retry em {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def esearch(term: str, retmax: int) -> list[str]:
    raw = _get(
        "esearch.fcgi",
        {"db": "pubmed", "term": term, "retmax": retmax, "retmode": "json", "sort": "relevance"},
    )
    data = json.loads(raw)
    return data.get("esearchresult", {}).get("idlist", [])


def _year(article: ET.Element) -> int | None:
    for xp in (
        ".//Article/Journal/JournalIssue/PubDate/Year",
        ".//Article/Journal/JournalIssue/PubDate/MedlineDate",
        ".//DateCompleted/Year",
    ):
        el = article.find(xp)
        if el is not None and el.text:
            digits = "".join(ch for ch in el.text[:4] if ch.isdigit())
            if len(digits) == 4:
                return int(digits)
    return None


def efetch_records(pmids: list[str]) -> list[dict]:
    raw = _get("efetch.fcgi", {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"})
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        print(f"  ! XML invalido ({exc}); lote ignorado", flush=True)
        return []
    out: list[dict] = []
    for art in root.iter("PubmedArticle"):
        pmid_el = art.find(".//MedlineCitation/PMID")
        if pmid_el is None or not pmid_el.text:
            continue
        year = _year(art)
        mesh: list[list] = []
        for mh in art.iter("MeshHeading"):
            d = mh.find("DescriptorName")
            if d is None or not d.text:
                continue
            mesh.append([d.get("UI", ""), d.text, 1 if d.get("MajorTopicYN") == "Y" else 0])
        if not mesh or year is None:
            continue
        title_el = art.find(".//Article/ArticleTitle")
        out.append(
            {
                "pmid": pmid_el.text,
                "year": year,
                "title": ("".join(title_el.itertext())[:300] if title_el is not None else ""),
                "mesh": mesh,
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=1980)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--per-cell", type=int, default=220, help="artigos por (ano, ramo)")
    ap.add_argument("--out", default="pipeline/cache/pubmed_corpus.jsonl.gz")
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    if out_path.exists():
        try:
            with gzip.open(out_path, "rt", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        seen.add(json.loads(line)["pmid"])
                    except Exception:  # noqa: BLE001
                        pass
        except EOFError:
            print("aviso: corpus truncado; continuando", flush=True)
        print(f"corpus existente: {len(seen)} artigos", flush=True)

    cells = [(y, b, name) for y in range(args.start, args.end + 1) for b, name in BRANCHES.items()]
    random.Random(7).shuffle(cells)

    pending: list[str] = []
    written = 0
    fh = gzip.open(out_path, "at", encoding="utf-8")
    try:
        for i, (year, code, name) in enumerate(cells, 1):
            term = f'"{name}"[MeSH Terms] AND {year}[dp] AND medline[sb]'
            try:
                ids = esearch(term, args.per_cell)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! esearch falhou {year}/{code}: {exc}", flush=True)
                continue
            fresh = [p for p in ids if p not in seen]
            seen.update(fresh)
            pending.extend(fresh)
            while len(pending) >= args.batch:
                chunk, pending = pending[: args.batch], pending[args.batch :]
                for rec in efetch_records(chunk):
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    written += 1
                fh.flush()
            if i % 20 == 0:
                print(f"[{i}/{len(cells)}] {year}/{code} · {written} artigos gravados", flush=True)
        while pending:
            chunk, pending = pending[: args.batch], pending[args.batch :]
            for rec in efetch_records(chunk):
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                written += 1
            fh.flush()
    finally:
        fh.close()
    print(f"OK · {written} artigos novos · total {len(seen)} · {out_path}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
