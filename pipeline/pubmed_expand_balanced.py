#!/usr/bin/env python3
"""Complementa o corpus até uma meta anual uniforme com citações MEDLINE reais."""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path

from pubmed_ingest import efetch_records, esearch


def read_existing(paths: list[Path]) -> tuple[set[str], Counter]:
    seen: set[str] = set()
    years: Counter = Counter()
    for path in paths:
        if not path.exists():
            continue
        try:
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                for line in stream:
                    try:
                        record = json.loads(line)
                        pmid = str(record["pmid"])
                        if pmid not in seen:
                            seen.add(pmid)
                            years[int(record["year"])] += 1
                    except (json.JSONDecodeError, KeyError, ValueError):
                        pass
        except EOFError:
            raise SystemExit(f"Corpus gzip truncado: {path}")
    return seen, years


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="pipeline/cache/pubmed_corpus.jsonl.gz")
    parser.add_argument("--out", default="pipeline/cache/pubmed_expansion.jsonl.gz")
    parser.add_argument("--start", type=int, default=1985)
    parser.add_argument("--end", type=int, default=2025)
    parser.add_argument("--target", type=int, default=3500)
    parser.add_argument("--batch", type=int, default=400)
    args = parser.parse_args()

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    seen, counts = read_existing([Path(args.base), output])
    print(f"início: {len(seen)} artigos únicos", flush=True)
    ordered_years = sorted(range(args.start, args.end + 1), key=lambda year: (counts[year], year))

    with gzip.open(output, "at", encoding="utf-8") as stream:
        for year in ordered_years:
            needed = max(0, args.target - counts[year])
            if not needed:
                continue
            query = f'"{year}"[dp] AND medline[sb] AND hasabstract'
            ids = esearch(query, min(10000, counts[year] + needed * 3))
            fresh = [pmid for pmid in ids if pmid not in seen]
            # Some fetched records lack descriptors; overfetch and stop at the target.
            fresh = fresh[: min(len(fresh), int(needed * 1.45) + args.batch)]
            added = 0
            for offset in range(0, len(fresh), args.batch):
                if counts[year] >= args.target:
                    break
                for record in efetch_records(fresh[offset : offset + args.batch]):
                    pmid = str(record["pmid"])
                    if pmid in seen or int(record["year"]) != year:
                        continue
                    seen.add(pmid)
                    counts[year] += 1
                    added += 1
                    stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                    if counts[year] >= args.target:
                        break
                stream.flush()
            print(f"{year}: +{added} = {counts[year]} artigos", flush=True)
    print(f"fim: {len(seen)} artigos únicos", flush=True)


if __name__ == "__main__":
    main()
