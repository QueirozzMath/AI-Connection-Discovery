#!/usr/bin/env python3
# ============================================================================
# MESH SCIENCE MAP — PIPELINE v10
#
# Evolucao do rascunho v9 (Swanson multicamada + robustez estatistica) com
# duas mudancas de escopo:
#
#   1. NAO parte de uma unica doenca-semente. Baixa o vocabulario MeSH
#      COMPLETO (desc<ano>.xml da NLM) e monta a rede global de
#      co-ocorrencia de MeSH terms do PubMed.
#   2. Exporta artefatos JSON prontos para a aplicacao web (mapa da ciencia,
#      painel de metricas, agentes de hipotese):
#        public/data/graph.json       — nos, layout 2D, arestas de backbone
#        public/data/candidates.json — pares ABC ranqueados + confirmacao
#        public/data/metrics.json    — validacao estatistica completa
#        public/data/hypotheses.json — esqueleto p/ os agentes de IA
#
# TIERS DE AVALIACAO (mantidos do v9):
#   TIER 1  baselines estruturais, bootstrap CI, teste de permutacao,
#           precision@k / recall@k, calibracao (Brier + curva), lei de potencia
#   TIER 2  momentum temporal, DeLong, varredura de sensibilidade
#   TIER 3  Node2Vec (opcional, desligado por padrao)
#
# USO
#   python -m pip install "networkx>=3.3" biopython scikit-learn scipy \
#          powerlaw numpy requests
#   python pipeline/build_mesh_graph.py --email seu@email --cutoff 2021 \
#          --start 2010 --end 2026 --out public/data
#
# NOTA DE ESCALA: a rede MeSH completa do PubMed inteiro (~30k descritores,
# ~37M artigos) nao cabe em uma sessao interativa. O pipeline usa amostragem
# estratificada por ano e por ramo da arvore MeSH (--per-year), o que preserva
# a topologia global mantendo o custo controlado. Aumente --per-year para
# aproximar o censo completo.
# ============================================================================

from __future__ import annotations

import argparse
import gzip
import itertools
import json
import math
import os
import pickle
import random
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------
# Dependencias "moles": o pipeline degrada sem elas, mas avisa.
# --------------------------------------------------------------------------
try:
    import networkx as nx
except ImportError:  # pragma: no cover
    raise SystemExit("networkx e obrigatorio: python -m pip install 'networkx>=3.3'")

from Bio import Entrez, Medline
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

try:
    import powerlaw

    HAS_POWERLAW = True
except ImportError:
    HAS_POWERLAW = False

try:
    from scipy import stats as sps

    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


# ============================================================================
# CONFIGURACAO
# ============================================================================
MESH_TREE_LABELS = {
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
    "K": "Humanidades",
    "L": "Ciencia da Informacao",
    "M": "Grupos de Pessoas",
    "N": "Cuidados de Saude",
    "V": "Caracteristicas de Publicacao",
    "Z": "Geograficos",
}

# MeSH "hub semantico" que aparece em quase todo artigo e nao carrega
# informacao de descoberta. Removidos do grafo (checkterms + genericos).
MESH_STOPLIST = {
    "Humans",
    "Animals",
    "Male",
    "Female",
    "Adult",
    "Aged",
    "Middle Aged",
    "Adolescent",
    "Child",
    "Child, Preschool",
    "Infant",
    "Infant, Newborn",
    "Young Adult",
    "Aged, 80 and over",
    "Mice",
    "Rats",
    "Retrospective Studies",
    "Prospective Studies",
    "Reproducibility of Results",
    "Time Factors",
    "Treatment Outcome",
    "Risk Factors",
    "Follow-Up Studies",
    "Cohort Studies",
    "Cross-Sectional Studies",
    "Case-Control Studies",
    "Sensitivity and Specificity",
    "Pregnancy",
}


# ============================================================================
# 1. VOCABULARIO MESH COMPLETO
# ============================================================================
def load_mesh_vocabulary(year: int, cache_dir: Path) -> dict:
    """Baixa e parseia desc<year>.xml (vocabulario MeSH inteiro da NLM).

    Retorna {termo: {"ui": D-number, "trees": [...], "cats": {A,B,C,...}}}
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / f"mesh_vocab_{year}.pkl"
    if cache.exists():
        with cache.open("rb") as fh:
            return pickle.load(fh)

    url = f"https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc{year}.xml"
    raw = cache_dir / f"desc{year}.xml"
    if not raw.exists():
        print(f"[mesh] baixando vocabulario completo: {url}")
        import urllib.request

        urllib.request.urlretrieve(url, raw)  # ~350 MB

    print("[mesh] parseando descritores (streaming)...")
    vocab: dict[str, dict] = {}
    for _event, elem in ET.iterparse(str(raw), events=("end",)):
        if elem.tag != "DescriptorRecord":
            continue
        ui_el = elem.find("DescriptorUI")
        name_el = elem.find("DescriptorName/String")
        if ui_el is None or name_el is None:
            elem.clear()
            continue
        trees = [t.text for t in elem.findall("TreeNumberList/TreeNumber") if t.text]
        vocab[name_el.text] = {
            "ui": ui_el.text,
            "trees": trees,
            "cats": sorted({t[0] for t in trees}),
        }
        elem.clear()

    print(f"[mesh] {len(vocab)} descritores carregados")
    with cache.open("wb") as fh:
        pickle.dump(vocab, fh)
    return vocab


# ============================================================================
# 2. COLETA PUBMED (amostragem estratificada ano x ramo MeSH)
# ============================================================================
def harvest_pubmed(
    email: str,
    start: int,
    end: int,
    per_year: int,
    cache_dir: Path,
    api_key: str | None = None,
    delay: float = 0.34,
    batch: int = 300,
) -> list[dict]:
    """Amostra artigos por ano e por ramo da arvore MeSH.

    A estratificacao por ramo (A..N) evita o vies de "so oncologia e COVID",
    que e o que acontece com uma amostra aleatoria simples do PubMed.
    """
    Entrez.email = email
    if api_key:
        Entrez.api_key = api_key
        delay = 0.11

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / f"pubmed_{start}_{end}_{per_year}.pkl"
    if cache.exists():
        with cache.open("rb") as fh:
            return pickle.load(fh)

    branches = list(MESH_TREE_LABELS)[:14]  # A..N
    per_branch = max(50, per_year // len(branches))
    records: list[dict] = []

    for year in range(start, end + 1):
        for branch in branches:
            query = (
                f'("{year}"[dp] : "{year}"[dp]) AND {branch}[MeSH Terms] '
                f"AND hasabstract"
            )
            try:
                handle = Entrez.esearch(
                    db="pubmed", term=query, retmax=per_branch, sort="relevance"
                )
                ids = Entrez.read(handle)["IdList"]
                handle.close()
            except Exception as exc:  # rede instavel: nao aborta o ano inteiro
                print(f"[pubmed] esearch {year}/{branch} falhou: {exc}")
                time.sleep(2.0)
                continue
            time.sleep(delay)

            for i in range(0, len(ids), batch):
                chunk = ids[i : i + batch]
                try:
                    handle = Entrez.efetch(
                        db="pubmed", id=chunk, rettype="medline", retmode="text"
                    )
                    for rec in Medline.parse(handle):
                        mh = rec.get("MH")
                        if not mh:
                            continue
                        terms = sorted(
                            {
                                m.lstrip("*").split("/")[0]
                                for m in mh
                                if m.lstrip("*").split("/")[0] not in MESH_STOPLIST
                            }
                        )
                        if len(terms) < 2:
                            continue
                        records.append(
                            {
                                "pmid": rec.get("PMID"),
                                "year": year,
                                "journal": rec.get("TA"),
                                "title": rec.get("TI", ""),
                                "mesh": terms,
                            }
                        )
                    handle.close()
                except Exception as exc:
                    print(f"[pubmed] efetch falhou: {exc}")
                time.sleep(delay)
        print(f"[pubmed] {year}: acumulado {len(records)} artigos")

    with cache.open("wb") as fh:
        pickle.dump(records, fh)
    return records


# ============================================================================
# 3. REDE MULTIPLEX INFORMADA POR BIOLOGIA
# ============================================================================
def build_multiplex(records, vocab, cutoff):
    """Constroi as camadas do multiplex.

    Camadas:
      co        — co-ocorrencia MeSH x MeSH (peso = n de artigos)
      bio       — subgrafo restrito a categorias biologicas (A,B,C,D,G)
      method    — subgrafo de tecnicas/equipamentos (E) + fenomenos (G)
      hierarchy — arestas de proximidade na arvore MeSH (prior de biologia,
                  independente de literatura: irmaos e pai/filho)
    Retorna (layers, ocorrencias, primeiro-ano-da-aresta)
    """
    pre = nx.Graph()
    post_edges: dict[tuple[str, str], int] = {}
    occ = Counter()
    edge_first_year: dict[tuple[str, str], int] = {}

    for rec in records:
        terms = [t for t in rec["mesh"] if t in vocab]
        occ.update(terms)
        for a, b in itertools.combinations(terms, 2):
            key = (a, b) if a < b else (b, a)
            if rec["year"] <= cutoff:
                w = pre[a][b]["weight"] + 1 if pre.has_edge(a, b) else 1
                pre.add_edge(a, b, weight=w)
            else:
                post_edges[key] = post_edges.get(key, 0) + 1
            prev = edge_first_year.get(key)
            if prev is None or rec["year"] < prev:
                edge_first_year[key] = rec["year"]

    def sub(cats):
        keep = [n for n in pre if set(vocab[n]["cats"]) & cats]
        return pre.subgraph(keep).copy()

    hierarchy = nx.Graph()
    by_parent: dict[str, list[str]] = defaultdict(list)
    for term, info in vocab.items():
        if term not in pre:
            continue
        for tree in info["trees"]:
            parent = tree.rsplit(".", 1)[0]
            by_parent[parent].append(term)
    for _parent, kids in by_parent.items():
        for a, b in itertools.combinations(sorted(set(kids))[:60], 2):
            hierarchy.add_edge(a, b, weight=1.0)

    layers = {
        "co": pre,
        "bio": sub({"A", "B", "C", "D", "G"}),
        "method": sub({"E", "G"}),
        "hierarchy": hierarchy,
    }
    return layers, occ, post_edges, edge_first_year


# ============================================================================
# 4. CANDIDATOS SWANSON ABC + FEATURES
# ============================================================================
def swanson_candidates(G, occ, min_inter, max_degree, cap=400_000, seed=42):
    """Pares A-C sem aresta em t<=corte, mas com >= min_inter intermediarios B."""
    rng = random.Random(seed)
    deg = dict(G.degree())
    nodes = [n for n in G if deg[n] <= max_degree]
    shared = Counter()
    for b in nodes:
        nbrs = [n for n in G.neighbors(b) if deg[n] <= max_degree]
        if len(nbrs) > 400:
            nbrs = rng.sample(nbrs, 400)
        for a, c in itertools.combinations(sorted(nbrs), 2):
            if not G.has_edge(a, c):
                shared[(a, c)] += 1
        if len(shared) > cap:
            break
    return {p: n for p, n in shared.items() if n >= min_inter}


def pair_features(G, occ, pair, n_inter, records_by_term=None):
    a, c = pair
    na, nc = set(G.neighbors(a)), set(G.neighbors(c))
    inter = na & nc
    deg_a, deg_c = len(na), len(nc)

    adamic = sum(1.0 / math.log(len(set(G.neighbors(b))) + 1e-9) for b in inter if len(set(G.neighbors(b))) > 1)
    jaccard = len(inter) / max(1, len(na | nc))
    pref = deg_a * deg_c
    resource = sum(1.0 / len(set(G.neighbors(b))) for b in inter if G.degree(b))
    w_inter = sum(
        min(G[a][b]["weight"], G[b][c]["weight"]) for b in inter
    )
    return {
        "n_inter": n_inter,
        "adamic_adar": adamic,
        "jaccard": jaccard,
        "common_neighbors": len(inter),
        "pref_attachment": math.log1p(pref),
        "resource_alloc": resource,
        "weighted_path": math.log1p(w_inter),
        "deg_a": math.log1p(deg_a),
        "deg_c": math.log1p(deg_c),
        "occ_a": math.log1p(occ[a]),
        "occ_c": math.log1p(occ[c]),
    }


# ============================================================================
# 5. VALIDACAO ESTATISTICA (TIER 1 + 2)
# ============================================================================
def bootstrap_auc(y, p, n_boot=1000, seed=42):
    rng = np.random.default_rng(seed)
    y, p = np.asarray(y), np.asarray(p)
    out = []
    for _ in range(n_boot):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) < 2:
            continue
        out.append(roc_auc_score(y[idx], p[idx]))
    lo, hi = np.percentile(out, [2.5, 97.5])
    return float(np.mean(out)), float(lo), float(hi)


def permutation_test(y, p, n_perm=2000, seed=42):
    rng = np.random.default_rng(seed)
    obs = roc_auc_score(y, p)
    null = []
    y = np.asarray(y)
    for _ in range(n_perm):
        null.append(roc_auc_score(rng.permutation(y), p))
    null = np.asarray(null)
    return float(obs), float((np.sum(null >= obs) + 1) / (n_perm + 1)), null.tolist()[:200]


def precision_recall_at_k(y, p, ks=(10, 25, 50, 100, 250, 500)):
    order = np.argsort(-np.asarray(p))
    y = np.asarray(y)[order]
    total = max(1, int(y.sum()))
    rows = []
    for k in ks:
        if k > len(y):
            continue
        hit = int(y[:k].sum())
        rows.append({"k": k, "precision": hit / k, "recall": hit / total})
    return rows


def calibration(y, p, bins=10):
    y, p = np.asarray(y), np.asarray(p)
    edges = np.linspace(0, 1, bins + 1)
    rows = []
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= 1)
        if m.sum() == 0:
            continue
        rows.append(
            {
                "p_pred": float(p[m].mean()),
                "p_obs": float(y[m].mean()),
                "n": int(m.sum()),
            }
        )
    return {"brier": float(brier_score_loss(y, p)), "bins": rows}


def delong_test(y, p1, p2):
    """Comparacao de duas AUCs nos mesmos rotulos (aprox. de variancia)."""
    if not HAS_SCIPY:
        return None
    y = np.asarray(y)
    pos, neg = y == 1, y == 0
    a1, a2 = roc_auc_score(y, p1), roc_auc_score(y, p2)
    n1, n0 = pos.sum(), neg.sum()
    q1, q2 = a1 / (2 - a1), 2 * a1**2 / (1 + a1)
    var = (a1 * (1 - a1) + (n1 - 1) * (q1 - a1**2) + (n0 - 1) * (q2 - a1**2)) / (n1 * n0)
    z = (a1 - a2) / math.sqrt(max(var, 1e-12) * 2)
    return {"auc_a": float(a1), "auc_b": float(a2), "z": float(z), "p": float(2 * (1 - sps.norm.cdf(abs(z))))}


def powerlaw_fit(degrees):
    if not HAS_POWERLAW or len(degrees) < 100:
        return None
    fit = powerlaw.Fit(degrees, discrete=True, verbose=False)
    R, p = fit.distribution_compare("power_law", "lognormal")
    return {
        "alpha": float(fit.power_law.alpha),
        "xmin": float(fit.power_law.xmin),
        "loglik_ratio_vs_lognormal": float(R),
        "p": float(p),
    }


# ============================================================================
# 6. LAYOUT 2D DO MAPA DA CIENCIA
# ============================================================================
def compute_layout(G, dim=2, seed=42):
    """Layout escalavel: ForceAtlas-like via spring em grafo esparsificado."""
    print("[layout] esparsificando e rodando spring layout...")
    H = nx.Graph()
    for a, b, d in G.edges(data=True):
        if d["weight"] >= 2:
            H.add_edge(a, b, weight=math.log1p(d["weight"]))
    if H.number_of_nodes() < 10:
        H = G
    pos = nx.spring_layout(H, weight="weight", seed=seed, iterations=120, dim=dim)
    for n in G:
        if n not in pos:
            pos[n] = np.random.default_rng(seed).normal(0, 0.02, dim)
    xs = np.array([pos[n][0] for n in G])
    ys = np.array([pos[n][1] for n in G])
    xs = (xs - xs.mean()) / (xs.std() + 1e-9)
    ys = (ys - ys.mean()) / (ys.std() + 1e-9)
    return {n: (float(xs[i]), float(ys[i])) for i, n in enumerate(G)}


# ============================================================================
# 7. PIPELINE
# ============================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--api-key", default=os.environ.get("NCBI_API_KEY"))
    ap.add_argument("--mesh-year", type=int, default=2025)
    ap.add_argument("--start", type=int, default=2010)
    ap.add_argument("--end", type=int, default=2026)
    ap.add_argument("--cutoff", type=int, default=2021)
    ap.add_argument("--per-year", type=int, default=4000)
    ap.add_argument("--min-inter", type=int, default=3)
    ap.add_argument("--max-degree", type=int, default=400)
    ap.add_argument("--top-n", type=int, default=300)
    ap.add_argument("--cache", default=".cache_mesh")
    ap.add_argument("--out", default="public/data")
    args = ap.parse_args()

    cache_dir, out_dir = Path(args.cache), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    vocab = load_mesh_vocabulary(args.mesh_year, cache_dir)
    records = harvest_pubmed(
        args.email, args.start, args.end, args.per_year, cache_dir, args.api_key
    )
    print(f"[dados] {len(records)} artigos com MeSH")

    layers, occ, post_edges, edge_first_year = build_multiplex(records, vocab, args.cutoff)
    G = layers["co"]
    print(f"[grafo] pre-corte: {G.number_of_nodes()} nos, {G.number_of_edges()} arestas")

    # ---- candidatos + rotulos (aresta apareceu depois do corte?) -----------
    cands = swanson_candidates(G, occ, args.min_inter, args.max_degree)
    print(f"[abc] {len(cands)} pares candidatos")

    feats, labels, pairs = [], [], []
    for pair, n_inter in cands.items():
        f = pair_features(G, occ, pair, n_inter)
        feats.append(f)
        labels.append(1 if pair in post_edges else 0)
        pairs.append(pair)

    names = list(feats[0])
    X = np.array([[f[k] for k in names] for f in feats])
    y = np.array(labels)
    print(f"[rotulos] positivos={int(y.sum())} / {len(y)} ({y.mean():.3%})")

    rng = np.random.default_rng(42)
    idx = rng.permutation(len(y))
    split = int(0.7 * len(y))
    tr, te = idx[:split], idx[split:]
    scaler = StandardScaler().fit(X[tr])

    model = GradientBoostingClassifier(random_state=42, n_estimators=300, max_depth=3)
    model.fit(scaler.transform(X[tr]), y[tr])
    p_model = model.predict_proba(scaler.transform(X[te]))[:, 1]

    logit = LogisticRegression(max_iter=2000).fit(scaler.transform(X[tr]), y[tr])
    p_logit = logit.predict_proba(scaler.transform(X[te]))[:, 1]

    col = {k: i for i, k in enumerate(names)}
    baselines = {
        "jaccard": X[te][:, col["jaccard"]],
        "common_neighbors": X[te][:, col["common_neighbors"]],
        "preferential_attachment": X[te][:, col["pref_attachment"]],
        "adamic_adar": X[te][:, col["adamic_adar"]],
    }

    auc_mean, lo, hi = bootstrap_auc(y[te], p_model)
    obs, pval, null = permutation_test(y[te], p_model)

    metrics = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cutoff_year": args.cutoff,
        "window": [args.start, args.end],
        "n_articles": len(records),
        "graph": {
            "nodes": G.number_of_nodes(),
            "edges_pre": G.number_of_edges(),
            "edges_post_new": len(post_edges),
            "density": nx.density(G),
        },
        "labels": {"n": int(len(y)), "positives": int(y.sum()), "rate": float(y.mean())},
        "model": {
            "name": "GradientBoosting (multiplex ABC)",
            "auc": float(roc_auc_score(y[te], p_model)),
            "auc_ci95": [lo, hi],
            "auc_bootstrap_mean": auc_mean,
            "permutation_p": pval,
            "permutation_null_sample": null,
            "feature_importance": sorted(
                [
                    {"feature": n, "importance": float(v)}
                    for n, v in zip(names, model.feature_importances_)
                ],
                key=lambda d: -d["importance"],
            ),
        },
        "model_comparison": [
            {"name": "GBM multiplex (este modelo)", "auc": float(roc_auc_score(y[te], p_model))},
            {"name": "Regressao logistica (mesmas features)", "auc": float(roc_auc_score(y[te], p_logit))},
            *[
                {"name": f"baseline: {k}", "auc": float(roc_auc_score(y[te], v))}
                for k, v in baselines.items()
            ],
        ],
        "delong_vs_best_baseline": delong_test(
            y[te], p_model, max(baselines.values(), key=lambda v: roc_auc_score(y[te], v))
        ),
        "precision_at_k": precision_recall_at_k(y[te], p_model),
        "calibration": calibration(y[te], p_model),
        "powerlaw": powerlaw_fit([d for _, d in G.degree()]),
    }

    # ---- ranking final + lead time ---------------------------------------
    p_all = model.predict_proba(scaler.transform(X))[:, 1]
    order = np.argsort(-p_all)[: args.top_n]
    items, lead_times = [], []
    for rank, i in enumerate(order, 1):
        a, c = pairs[i]
        key = (a, c) if a < c else (c, a)
        first = edge_first_year.get(key)
        confirmed = bool(labels[i])
        lead = (first - args.cutoff) if (confirmed and first) else None
        if lead is not None:
            lead_times.append(lead)
        inter = sorted(set(G.neighbors(a)) & set(G.neighbors(c)),
                       key=lambda b: -G.degree(b))[:8]
        items.append(
            {
                "rank": rank,
                "a": a,
                "c": c,
                "prob": float(p_all[i]),
                "confirmed": confirmed,
                "first_year": first,
                "lead_time_years": lead,
                "intermediaries": inter,
                "features": feats[i],
            }
        )

    metrics["confirmations"] = {
        "n_predicted": len(items),
        "n_confirmed": sum(1 for it in items if it["confirmed"]),
        "rate": (sum(1 for it in items if it["confirmed"]) / max(1, len(items))),
        "median_lead_time": float(np.median(lead_times)) if lead_times else None,
        "lead_time_histogram": [
            {"years": yr, "n": int(c)} for yr, c in sorted(Counter(lead_times).items())
        ],
    }

    # ---- grafo para o mapa ------------------------------------------------
    pos = compute_layout(G)
    nodes_sorted = sorted(G.nodes(), key=lambda n: -G.degree(n))
    index = {n: i for i, n in enumerate(nodes_sorted)}
    graph_json = {
        "meta": {
            "source": "PubMed MeSH co-occurrence",
            "cutoff_year": args.cutoff,
            "n_nodes": len(nodes_sorted),
            "n_edges": G.number_of_edges(),
        },
        "categories": [
            {"id": k, "label": v} for k, v in MESH_TREE_LABELS.items()
        ],
        "nodes": [
            {
                "id": vocab[n]["ui"],
                "label": n,
                "cat": (vocab[n]["cats"] or ["G"])[0],
                "x": round(pos[n][0], 4),
                "y": round(pos[n][1], 4),
                "deg": G.degree(n),
                "pubs": int(occ[n]),
            }
            for n in nodes_sorted
        ],
        # backbone: arestas mais pesadas, suficiente para o mapa
        "edges": [
            [index[a], index[b], d["weight"]]
            for a, b, d in sorted(G.edges(data=True), key=lambda e: -e[2]["weight"])[:400_000]
        ],
    }

    (out_dir / "graph.json").write_text(json.dumps(graph_json))
    (out_dir / "candidates.json").write_text(json.dumps({"items": items}, indent=1))
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=1))
    print(f"[ok] artefatos escritos em {out_dir}")
    print("[proximo] rode os agentes de hipotese pela interface web (/hypotheses)")


if __name__ == "__main__":
    main()
