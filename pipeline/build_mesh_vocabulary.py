#!/usr/bin/env python3
"""Exporta o vocabulário MeSH oficial completo em um artefato compacto.

O arquivo produzido é independente do corpus de artigos: assim, descritores que
ainda não aparecem na amostra PubMed continuam pesquisáveis e navegáveis.
"""
from __future__ import annotations

import argparse
import gzip
import json
import time
import xml.etree.ElementTree as ET
from pathlib import Path


def text(node: ET.Element | None) -> str:
    return "" if node is None or node.text is None else node.text.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="pipeline/cache/desc2026.xml.gz")
    parser.add_argument("--output", default="public/data/mesh-vocabulary.json.gz")
    parser.add_argument("--year", type=int, default=2026)
    args = parser.parse_args()

    descriptors: list[list] = []
    source = Path(args.input)
    opener = gzip.open if source.suffix == ".gz" else open
    with opener(source, "rb") as stream:
        for _event, elem in ET.iterparse(stream, events=("end",)):
            if elem.tag != "DescriptorRecord":
                continue
            ui = text(elem.find("DescriptorUI"))
            name = text(elem.find("DescriptorName/String"))
            if not ui or not name:
                elem.clear()
                continue
            trees = sorted(
                {text(node) for node in elem.findall("TreeNumberList/TreeNumber") if text(node)}
            )
            terms = sorted(
                {
                    text(node)
                    for node in elem.findall("ConceptList/Concept/TermList/Term/String")
                    if text(node) and text(node) != name
                },
                key=str.casefold,
            )
            descriptors.append([ui, name, trees, terms])
            elem.clear()

    descriptors.sort(key=lambda row: (row[1].casefold(), row[0]))
    payload = {
        "version": args.year,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": f"NLM Medical Subject Headings {args.year}",
        "descriptor_count": len(descriptors),
        "term_count": sum(1 + len(row[3]) for row in descriptors),
        "descriptors": descriptors,
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(target, "wt", encoding="utf-8", compresslevel=9) as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))
    print(
        f"MeSH {args.year}: {payload['descriptor_count']} descritores, "
        f"{payload['term_count']} termos -> {target}"
    )


if __name__ == "__main__":
    main()
