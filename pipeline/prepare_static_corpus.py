#!/usr/bin/env python3
"""Empacota o corpus PubMed ampliado para o cliente e registra sua cobertura."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import time
from collections import Counter
from pathlib import Path

BRANCHES = {
    "A": "Anatomia", "B": "Organismos", "C": "Doenças",
    "D": "Químicos e fármacos", "E": "Técnicas e equipamentos",
    "F": "Psiquiatria e psicologia", "G": "Fenômenos e processos",
    "H": "Disciplinas e ocupações", "I": "Ciências sociais",
    "J": "Tecnologia e indústria", "K": "Humanidades",
    "L": "Ciência da informação", "M": "Grupos de pessoas",
    "N": "Assistência à saúde", "V": "Tipo de publicação", "Z": "Geografia", "X": "X",
}


def load_json_gzip(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def fallback_position(ui: str, tree: str, branch_index: int) -> tuple[float, float, float, float]:
    digest = hashlib.blake2b(ui.encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    branch_angle = branch_index * 2.399963229728653
    anchor_radius = math.sqrt(branch_index) * 7.5
    anchor_x = math.cos(branch_angle) * anchor_radius
    anchor_y = math.sin(branch_angle) * anchor_radius
    angle = (value / 2**64) * math.tau
    radius = 4 + ((value >> 12) % 4200) / 100
    x = anchor_x + math.cos(angle) * radius
    y = anchor_y + math.sin(angle) * radius * 0.82
    depth = tree.count(".") + 1
    h_angle = branch_angle + ((value >> 24) % 1000) / 1000 * 0.35
    h_radius = 14 + depth * 9 + ((value >> 36) % 500) / 100
    return x, y, math.cos(h_angle) * h_radius, math.sin(h_angle) * h_radius


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        action="append",
        default=None,
        help="Pode ser repetido; padrão: corpus base e expansão balanceada.",
    )
    parser.add_argument("--existing", default="public/data/corpus.json.gz")
    parser.add_argument("--vocabulary", default="public/data/mesh-vocabulary.json.gz")
    parser.add_argument("--output", default="public/data/corpus.json.gz")
    parser.add_argument("--start", type=int, default=1985)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()

    vocabulary = load_json_gzip(Path(args.vocabulary))
    vocab = {row[0]: row for row in vocabulary["descriptors"]}
    old = load_json_gzip(Path(args.existing)) if Path(args.existing).exists() else {"concepts": []}
    old_positions = {row[0]: row[2:7] for row in old.get("concepts", [])}
    records: dict[str, dict] = {}
    inputs = args.input or [
        "pipeline/cache/pubmed_corpus.jsonl.gz",
        "pipeline/cache/pubmed_expansion.jsonl.gz",
    ]
    for input_name in inputs:
        input_path = Path(input_name)
        if not input_path.exists():
            continue
        with gzip.open(input_path, "rt", encoding="utf-8") as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                except (json.JSONDecodeError, EOFError):
                    continue
                year = int(record.get("year") or 0)
                pmid = str(record.get("pmid") or "")
                if pmid and args.start <= year <= args.end:
                    records[pmid] = record

    used = sorted(
        {
            ui
            for record in records.values()
            for ui, _name, _major in record.get("mesh", [])
            if ui.startswith("D")
        }
    )
    branch_order = sorted(BRANCHES)
    concepts = []
    for ui in used:
        descriptor = vocab.get(ui)
        label = descriptor[1] if descriptor else ui
        trees = descriptor[2] if descriptor else []
        tree = trees[0] if trees else (old_positions.get(ui, ["X"])[0] or "X")
        category = tree[:1] if tree[:1] in BRANCHES else "X"
        previous = old_positions.get(ui)
        if previous and all(value is not None for value in previous[1:]):
            x, y, hx, hy = previous[1:]
        else:
            x, y, hx, hy = fallback_position(ui, tree, branch_order.index(category))
        concepts.append([ui, label, tree, round(x, 2), round(y, 2), round(hx, 2), round(hy, 2)])
    concept_index = {row[0]: index for index, row in enumerate(concepts)}

    articles = []
    for record in records.values():
        indices = sorted(
            {
                concept_index[ui]
                for ui, _name, _major in record.get("mesh", [])
                if ui in concept_index
            }
        )
        if indices:
            articles.append([
                str(record["pmid"]), int(record["year"]), record.get("title") or None, indices
            ])
    articles.sort(key=lambda row: (row[1], row[0]))
    categories = [{"id": key, "label": value} for key, value in BRANCHES.items()]
    payload = {"concepts": concepts, "articles": articles, "categories": categories}
    with gzip.open(args.output, "wt", encoding="utf-8", compresslevel=9) as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))

    years = Counter(row[1] for row in articles)
    counts = [years[year] for year in range(args.start, args.end + 1)]
    stats = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "PubMed E-utilities (MEDLINE), amostra estratificada por ano e ramo MeSH",
        "mesh_version": vocabulary["version"],
        "mesh_descriptors": vocabulary["descriptor_count"],
        "mesh_terms": vocabulary["term_count"],
        "articles": len(articles),
        "article_descriptors": len(concepts),
        "years": [[year, years[year]] for year in range(args.start, args.end + 1)],
        "annual_min": min(counts),
        "annual_max": max(counts),
        "annual_mean": sum(counts) / len(counts),
    }
    Path("public/data/corpus-stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    index_path = Path("public/data/index.json")
    index = json.loads(index_path.read_text())
    index.update({
        "generated_at": stats["generated_at"],
        "source": stats["source"],
        "n_articles": len(articles),
        "corpus_years": [args.start, args.end],
        "mesh_version": vocabulary["version"],
        "mesh_descriptors": vocabulary["descriptor_count"],
        "mesh_terms": vocabulary["term_count"],
        "cutoffs": list(range(args.start, args.end + 1)),
        "default_cutoff": 2018 if args.start <= 2018 <= args.end else args.end,
    })
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
