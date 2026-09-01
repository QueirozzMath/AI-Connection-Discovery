#!/usr/bin/env python3
"""Gera um dataset de DEMONSTRACAO no mesmo schema do pipeline real.

Serve para a interface web funcionar (mapa, metricas, hipoteses) enquanto o
harvest real do PubMed (pipeline/build_mesh_graph.py) nao foi executado.
Os arquivos gerados sao substituidos 1:1 pelos reais.
"""
from __future__ import annotations

import json
import math
import random
from collections import Counter
from pathlib import Path

import numpy as np

OUT = Path("public/data")
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)
pyrng = random.Random(7)

CATS = {
    "A": "Anatomia",
    "B": "Organismos",
    "C": "Doencas",
    "D": "Quimicos e Farmacos",
    "E": "Tecnicas e Equipamentos",
    "F": "Psiquiatria e Psicologia",
    "G": "Fenomenos e Processos",
    "H": "Disciplinas e Ocupacoes",
    "I": "Antropologia e Educacao",
    "J": "Tecnologia e Alimentos",
    "L": "Ciencia da Informacao",
    "N": "Cuidados de Saude",
}

HEADS = {
    "A": ["Cortex", "Hippocampus", "Myocardium", "Endothelium", "Hepatocytes", "Synapses", "Microglia", "Nephron", "Alveoli", "Gut Epithelium"],
    "B": ["SARS-CoV-2", "Escherichia coli", "Plasmodium", "Bacteroides", "Influenza A", "Mycobacterium", "Lactobacillus", "Zika Virus", "Candida", "Herpesvirus"],
    "C": ["Alzheimer Disease", "Pancreatic Neoplasms", "Type 2 Diabetes", "Sepsis", "Multiple Sclerosis", "Heart Failure", "Crohn Disease", "Glioblastoma", "Long COVID", "Fibrosis"],
    "D": ["Metformin", "Rapamycin", "Statins", "Interleukin-6", "Amyloid beta", "Butyrate", "Dopamine", "Melatonin", "Cannabidiol", "Tryptophan"],
    "E": ["Single-Cell RNA-Seq", "CRISPR-Cas9", "Cryo-EM", "Mass Spectrometry", "Optogenetics", "Diffusion MRI", "Spatial Transcriptomics", "Organoids", "Flow Cytometry", "Wearable Sensors"],
    "F": ["Depression", "Cognitive Reserve", "Sleep Deprivation", "Anhedonia", "Working Memory", "Chronic Stress", "Anxiety Disorders", "Placebo Effect"],
    "G": ["Autophagy", "Inflammaging", "Oxidative Stress", "Circadian Rhythm", "Mitochondrial Dynamics", "Epigenetic Drift", "Ferroptosis", "Neuroinflammation", "Gut-Brain Axis", "Immunometabolism"],
    "H": ["Bioinformatics", "Epidemiology", "Pharmacology", "Public Health"],
    "I": ["Health Literacy", "Social Determinants", "Caregiving"],
    "J": ["Fermented Foods", "Nanoparticle Carriers", "Biosensors", "Dietary Fiber"],
    "L": ["Knowledge Graphs", "Text Mining", "Ontology Alignment", "Open Data"],
    "N": ["Clinical Trials", "Screening Programs", "Telemedicine", "Care Pathways"],
}
MODS = ["", "Signaling", "Regulation", "Dysfunction", "Remodeling", "Profiling", "Metabolism", "Biomarkers", "Plasticity", "Trafficking", "Homeostasis", "Subtypes", "Imaging", "Modulation", "Resistance", "Phenotype"]

# ---------------------------------------------------------------- nodes
N_CLUSTERS = 26
cluster_cat = [pyrng.choice(list(CATS)) for _ in range(N_CLUSTERS)]
centers = rng.normal(0, 1.0, (N_CLUSTERS, 2)) * 2.4

nodes = []
labels_seen = set()
n_nodes = 6200
for i in range(n_nodes):
    c = int(rng.integers(0, N_CLUSTERS))
    cat = cluster_cat[c]
    spread = 0.28 + 0.22 * pyrng.random()
    x, y = centers[c] + rng.normal(0, spread, 2)
    head = pyrng.choice(HEADS[cat])
    mod = pyrng.choice(MODS)
    label = f"{head}, {mod}" if mod else head
    k = 2
    base = label
    while label in labels_seen:
        label = f"{base} {k}"
        k += 1
    labels_seen.add(label)
    deg = int(max(2, rng.pareto(1.6) * 9))
    nodes.append(
        {
            "id": f"D{1000000+i}",
            "label": label,
            "cat": cat,
            "cluster": c,
            "x": round(float(x), 4),
            "y": round(float(y), 4),
            "deg": deg,
            "pubs": int(deg * (6 + rng.integers(0, 50))),
        }
    )

# ---------------------------------------------------------------- edges
by_cluster = {}
for i, n in enumerate(nodes):
    by_cluster.setdefault(n["cluster"], []).append(i)

edges = set()
for c, members in by_cluster.items():
    for _ in range(len(members) * 5):
        a, b = pyrng.sample(members, 2)
        edges.add((min(a, b), max(a, b)))
for _ in range(9000):  # pontes inter-cluster
    a, b = pyrng.randrange(n_nodes), pyrng.randrange(n_nodes)
    if a != b:
        edges.add((min(a, b), max(a, b)))
edges = [[a, b, int(1 + abs(rng.normal(3, 4)))] for a, b in edges]

deg = Counter()
for a, b, _w in edges:
    deg[a] += 1
    deg[b] += 1
for i, n in enumerate(nodes):
    n["deg"] = int(deg.get(i, 1))
    n["pubs"] = int(n["deg"] * (8 + pyrng.randrange(60)))
    n.pop("cluster")

graph = {
    "meta": {
        "source": "DEMO — substituir por saida de pipeline/build_mesh_graph.py",
        "demo": True,
        "cutoff_year": 2021,
        "n_nodes": len(nodes),
        "n_edges": len(edges),
    },
    "categories": [{"id": k, "label": v} for k, v in CATS.items()],
    "nodes": nodes,
    "edges": edges,
}
(OUT / "graph.json").write_text(json.dumps(graph, separators=(",", ":")))

# ---------------------------------------------------------------- candidates
adj = {}
for a, b, _w in edges:
    adj.setdefault(a, set()).add(b)
    adj.setdefault(b, set()).add(a)

items = []
seen = set()
tries = 0
while len(items) < 300 and tries < 400000:
    tries += 1
    a = pyrng.randrange(n_nodes)
    na = adj.get(a, set())
    if len(na) < 4:
        continue
    b = pyrng.choice(list(na))
    nb = adj.get(b, set())
    c = pyrng.choice(list(nb)) if nb else None
    if c is None or c == a or c in na:
        continue
    key = (min(a, c), max(a, c))
    if key in seen:
        continue
    seen.add(key)
    inter = sorted(na & adj.get(c, set()), key=lambda i: -nodes[i]["deg"])[:8]
    if len(inter) < 2:
        continue
    n_inter = len(inter)
    aa = sum(1 / math.log(nodes[i]["deg"] + 1.5) for i in inter)
    jac = n_inter / max(1, len(na | adj.get(c, set())))
    prob = 1 / (1 + math.exp(-(0.55 * aa + 5.5 * jac + 0.28 * n_inter - 3.4)))
    prob = float(min(0.985, max(0.01, prob + rng.normal(0, 0.06))))
    confirmed = bool(rng.random() < prob * 0.82)
    lead = int(pyrng.choice([1, 1, 2, 2, 2, 3, 3, 4, 5])) if confirmed else None
    items.append(
        {
            "a": nodes[a]["label"],
            "c": nodes[c]["label"],
            "a_idx": a,
            "c_idx": c,
            "prob": round(prob, 4),
            "confirmed": confirmed,
            "first_year": (2021 + lead) if lead else None,
            "lead_time_years": lead,
            "intermediaries": [nodes[i]["label"] for i in inter],
            "features": {
                "n_inter": n_inter,
                "adamic_adar": round(aa, 3),
                "jaccard": round(jac, 4),
                "common_neighbors": n_inter,
                "pref_attachment": round(math.log1p(nodes[a]["deg"] * nodes[c]["deg"]), 3),
            },
        }
    )

items.sort(key=lambda d: -d["prob"])
for r, it in enumerate(items, 1):
    it["rank"] = r
(OUT / "candidates.json").write_text(json.dumps({"items": items}, indent=1))

# ---------------------------------------------------------------- metrics
y = np.array([1 if it["confirmed"] else 0 for it in items])
p = np.array([it["prob"] for it in items])


def auc(y, p):
    from itertools import product

    pos, neg = p[y == 1], p[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    wins = sum((a > b) + 0.5 * (a == b) for a, b in product(pos[:400], neg[:400]))
    return float(wins / (len(pos[:400]) * len(neg[:400])))


boot = [auc(y[i], p[i]) for i in (rng.integers(0, len(y), (400, len(y))))]
model_auc = auc(y, p)
lead_times = [it["lead_time_years"] for it in items if it["lead_time_years"]]

pk = []
for k in (10, 25, 50, 100, 200, 300):
    if k <= len(items):
        hit = int(y[:k].sum())
        pk.append({"k": k, "precision": hit / k, "recall": hit / max(1, int(y.sum()))})

bins = []
for i in range(10):
    lo, hi = i / 10, (i + 1) / 10
    m = (p >= lo) & (p < hi if i < 9 else p <= 1)
    if m.sum():
        bins.append({"p_pred": float(p[m].mean()), "p_obs": float(y[m].mean()), "n": int(m.sum())})

metrics = {
    "demo": True,
    "generated_at": "2026-09-01T00:00:00Z",
    "cutoff_year": 2021,
    "window": [2010, 2026],
    "n_articles": 1_284_500,
    "graph": {"nodes": len(nodes), "edges_pre": len(edges), "edges_post_new": 41_820, "density": 0.0017},
    "labels": {"n": len(items), "positives": int(y.sum()), "rate": float(y.mean())},
    "model": {
        "name": "GBM multiplex ABC (bio + metodo + hierarquia MeSH)",
        "auc": model_auc,
        "auc_ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
        "auc_bootstrap_mean": float(np.mean(boot)),
        "permutation_p": 0.0005,
        "feature_importance": [
            {"feature": "adamic_adar", "importance": 0.31},
            {"feature": "n_inter", "importance": 0.22},
            {"feature": "weighted_path", "importance": 0.14},
            {"feature": "jaccard", "importance": 0.12},
            {"feature": "hierarchy_prior", "importance": 0.09},
            {"feature": "momentum_3y", "importance": 0.07},
            {"feature": "pref_attachment", "importance": 0.05},
        ],
    },
    "model_comparison": [
        {"name": "GBM multiplex (este modelo)", "auc": model_auc},
        {"name": "Regressao logistica (mesmas features)", "auc": round(model_auc - 0.041, 4)},
        {"name": "baseline: adamic_adar", "auc": round(model_auc - 0.068, 4)},
        {"name": "baseline: jaccard", "auc": round(model_auc - 0.093, 4)},
        {"name": "baseline: common_neighbors", "auc": round(model_auc - 0.112, 4)},
        {"name": "baseline: preferential_attachment", "auc": round(model_auc - 0.187, 4)},
    ],
    "delong_vs_best_baseline": {"auc_a": model_auc, "auc_b": round(model_auc - 0.068, 4), "z": 3.41, "p": 0.00065},
    "precision_at_k": pk,
    "calibration": {"brier": float(np.mean((p - y) ** 2)), "bins": bins},
    "powerlaw": {"alpha": 2.34, "xmin": 12.0, "loglik_ratio_vs_lognormal": -1.12, "p": 0.26},
    "confirmations": {
        "n_predicted": len(items),
        "n_confirmed": int(y.sum()),
        "rate": float(y.mean()),
        "median_lead_time": float(np.median(lead_times)) if lead_times else None,
        "lead_time_histogram": [{"years": k, "n": v} for k, v in sorted(Counter(lead_times).items())],
    },
    "hypothesis_eval": {"n": 0, "correct": 0, "partial": 0, "unsupported": 0},
}
(OUT / "metrics.json").write_text(json.dumps(metrics, indent=1))
(OUT / "hypotheses.json").write_text(json.dumps({"items": []}, indent=1))
print("demo dataset gerado:", sorted(pth.name for pth in OUT.iterdir()))
