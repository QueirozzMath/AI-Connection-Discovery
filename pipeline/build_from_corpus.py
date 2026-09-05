#!/usr/bin/env python3
"""Constroi os artefatos do app a partir do corpus real do PubMed.

Entrada : pipeline/cache/pubmed_corpus.jsonl.gz (pipeline/pubmed_ingest.py)
Saida   : public/data/index.json
          public/data/graph-<corte>.json
          public/data/candidates-<corte>.json
          public/data/metrics-<corte>.json
          public/data/timeline.json

Para cada ano de corte: monta a rede de co-ocorrencia MeSH ate o corte, treina um
modelo temporal (treino em corte-6 -> corte, teste em corte -> hoje), compara com
baselines estruturais e mede confirmacoes reais e lead time.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import random
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

OUT = Path("public/data")
CACHE = Path("pipeline/cache")
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
API_KEY = os.environ.get("NCBI_API_KEY", "")

FEATURES = [
    "common_neighbors",
    "adamic_adar",
    "resource_allocation",
    "jaccard",
    "pref_attachment",
    "cosine_profile",
    "bridge_strength",
    "bridge_max",
    "deg_ratio",
    "same_branch",
    "tree_distance",
    "growth_min",
    "growth_max",
    "drug_disease_pair",
]

BRANCH_LABELS = {
    "A": "Anatomia",
    "B": "Organismos",
    "C": "Doencas",
    "D": "Quimicos e farmacos",
    "E": "Tecnicas e equipamentos",
    "F": "Psiquiatria e psicologia",
    "G": "Fenomenos e processos",
    "H": "Disciplinas e ocupacoes",
    "I": "Ciencias sociais",
    "J": "Tecnologia e industria",
    "K": "Humanidades",
    "L": "Ciencia da informacao",
    "M": "Grupos de pessoas",
    "N": "Assistencia a saude",
    "V": "Tipo de publicacao",
    "Z": "Geografia",
}


# --------------------------------------------------------------------------- IO
def load_corpus(path: Path) -> list[dict]:
    recs = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            try:
                recs.append(json.loads(line))
            except Exception:  # noqa: BLE001
                pass
    return recs


def fetch_tree_numbers(uis: list[str]) -> dict[str, list[str]]:
    """Busca tree numbers dos descriptors MeSH via E-utilities (com cache local)."""
    cache_path = CACHE / "mesh_trees.json"
    cache: dict[str, list[str]] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())
    missing = [u for u in uis if u not in cache and u.startswith("D")]
    print(f"tree numbers: {len(cache)} em cache, {len(missing)} a buscar")
    delay = 0.12 if API_KEY else 0.37
    for i in range(0, len(missing), 300):
        chunk = missing[i : i + 300]
        ids = ",".join("68" + u[1:] for u in chunk)
        params = {"db": "mesh", "id": ids, "retmode": "json"}
        if API_KEY:
            params["api_key"] = API_KEY
        url = f"{EUTILS}/esummary.fcgi?{urllib.parse.urlencode(params)}"
        ok = False
        for attempt in range(4):
            try:
                time.sleep(delay)
                with urllib.request.urlopen(url, timeout=120) as resp:
                    data = json.loads(resp.read())
                ok = True
                break
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {exc} retry", flush=True)
                time.sleep(2 ** attempt)
        if not ok:
            continue
        result = data.get("result", {})
        for u in chunk:
            rec = result.get("68" + u[1:], {})
            trees = [lk.get("treenum", "") for lk in rec.get("ds_idxlinks", []) or []]
            cache[u] = [t for t in trees if t]
        if i % 3000 == 0:
            cache_path.write_text(json.dumps(cache))
        print(f"  tree numbers {min(i + 300, len(missing))}/{len(missing)}", flush=True)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache))
    return cache


# ------------------------------------------------------------------------ grafo
def build_pairs(recs: list[dict], max_mesh: int = 25):
    """Retorna (pubs_por_ui_ano, primeiro_ano_do_par, peso_do_par_por_ano)."""
    node_year: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    label: dict[str, str] = {}
    pair_first: dict[tuple[str, str], int] = {}
    pair_w: dict[tuple[str, str], dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for r in recs:
        year = r["year"]
        uis = []
        for ui, name, major in r["mesh"]:
            if not ui.startswith("D"):
                continue
            label[ui] = name
            node_year[ui][year] += 1
            uis.append(ui)
        uis = sorted(set(uis))
        if len(uis) > max_mesh:
            continue
        for i in range(len(uis)):
            for j in range(i + 1, len(uis)):
                key = (uis[i], uis[j])
                pair_w[key][year] += 1
                if key not in pair_first or year < pair_first[key]:
                    pair_first[key] = year
    return node_year, label, pair_first, pair_w


def adjacency(pair_w, cutoff: int, keep: set[str], min_w: int = 1):
    adj: dict[str, dict[str, int]] = defaultdict(dict)
    for (a, b), years in pair_w.items():
        if a not in keep or b not in keep:
            continue
        w = sum(n for y, n in years.items() if y <= cutoff)
        if w >= min_w:
            adj[a][b] = w
            adj[b][a] = w
    return adj


# ---------------------------------------------------------------------- layouts
def spectral_layout(nodes: list[str], adj, dims: int = 3, seed: int = 7):
    """Layout force-directed estocastico (atracao por aresta + repulsao amostrada)."""
    idx = {n: i for i, n in enumerate(nodes)}
    n = len(nodes)
    rng = np.random.default_rng(seed)
    pos = rng.normal(scale=30.0, size=(n, dims))
    edges = [(idx[a], idx[b], math.log1p(w))
             for a, nb in adj.items() if a in idx
             for b, w in nb.items() if b in idx and idx[a] < idx[b]]
    if not edges:
        return pos
    ea = np.array([e[0] for e in edges])
    eb = np.array([e[1] for e in edges])
    ew = np.array([e[2] for e in edges], dtype=float)
    ew /= ew.max()
    iters = 160
    sample = min(160, n)
    for it in range(iters):
        temp = 1.0 - it / iters
        disp = np.zeros_like(pos)
        d = pos[eb] - pos[ea]
        contrib = d * (ew * 0.06)[:, None]
        np.add.at(disp, ea, contrib)
        np.add.at(disp, eb, -contrib)
        s_idx = rng.choice(n, size=sample, replace=False)
        diff = pos[:, None, :] - pos[None, s_idx, :]
        dist2 = np.sum(diff * diff, axis=2) + 4.0
        disp += np.sum(diff / dist2[:, :, None], axis=1) * (900.0 / sample)
        norm = np.linalg.norm(disp, axis=1, keepdims=True) + 1e-9
        step = np.minimum(norm, 8.0 * temp + 0.5)
        pos += disp / norm * step
        pos -= pos.mean(axis=0)
    scale = np.percentile(np.abs(pos), 98) or 1.0
    return pos / scale * 100


def hierarchy_layout(nodes: list[str], trees: dict[str, list[str]]):
    """Layout radial deterministico: setor angular por ramo, raio por profundidade."""
    branches = sorted({(trees.get(n) or ["Z"])[0][0] for n in nodes})
    sector = {b: i for i, b in enumerate(branches)}
    span = 2 * math.pi / max(1, len(branches))
    buckets: dict[str, list[str]] = defaultdict(list)
    for n in nodes:
        t = (trees.get(n) or ["Z"])[0]
        buckets[t[0]].append(t + "|" + n)
    out: dict[str, tuple[float, float]] = {}
    for b, items in buckets.items():
        items.sort()
        base = sector[b] * span
        for k, item in enumerate(items):
            t, n = item.split("|", 1)
            depth = t.count(".") + 1
            frac = (k + 0.5) / len(items)
            ang = base + span * frac * 0.94 + span * 0.03
            rad = 18 + depth * 13 + (k % 7) * 1.2
            out[n] = (math.cos(ang) * rad, math.sin(ang) * rad)
    return out


# --------------------------------------------------------------- features / ABC
def candidate_pairs(adj, nodes: list[str], rng: random.Random, max_pairs: int, min_cn: int = 3):
    """Pares A-C sem co-ocorrencia direta, com pelo menos min_cn pontes B."""
    nodeset = set(nodes)
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    order = list(nodes)
    rng.shuffle(order)
    for a in order:
        nb_a = adj.get(a, {})
        if len(nb_a) < 3:
            continue
        counts: dict[str, int] = defaultdict(int)
        for b in nb_a:
            for c in adj.get(b, {}):
                if c == a or c in nb_a or c not in nodeset:
                    continue
                counts[c] += 1
        for c, cn in counts.items():
            if cn < min_cn:
                continue
            key = (a, c) if a < c else (c, a)
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
        if len(out) >= max_pairs:
            break
    rng.shuffle(out)
    return out[:max_pairs]


def pair_features(pairs, adj, meta):
    trees, branch, growth = meta["trees"], meta["branch"], meta["growth"]
    rows = np.zeros((len(pairs), len(FEATURES)), dtype=np.float32)
    bridges: list[list[str]] = []
    for i, (a, c) in enumerate(pairs):
        na, nc = adj.get(a, {}), adj.get(c, {})
        shared = set(na) & set(nc)
        cn = len(shared)
        aa = ra = 0.0
        bstr = bmax = 0.0
        for b in shared:
            d = len(adj.get(b, {})) or 1
            aa += 1.0 / math.log(d + 1.5)
            ra += 1.0 / d
            m = min(na[b], nc[b])
            bstr += m
            bmax = max(bmax, float(m))
        da, dc = len(na) or 1, len(nc) or 1
        union = len(set(na) | set(nc)) or 1
        dot = sum(math.log1p(na[b]) * math.log1p(nc[b]) for b in shared)
        norm_a = math.sqrt(sum(math.log1p(w) ** 2 for w in na.values())) or 1
        norm_c = math.sqrt(sum(math.log1p(w) ** 2 for w in nc.values())) or 1
        ta = (trees.get(a) or [""])[0]
        tc = (trees.get(c) or [""])[0]
        pa_parts, pc_parts = ta.split("."), tc.split(".")
        common = 0
        for x, y in zip(pa_parts, pc_parts):
            if x == y:
                common += 1
            else:
                break
        tree_dist = (len(pa_parts) + len(pc_parts) - 2 * common) / 12.0
        ba, bc = branch.get(a, "Z"), branch.get(c, "Z")
        drug_disease = 1.0 if {ba, bc} & {"D"} and {ba, bc} & {"C", "F"} else 0.0
        rows[i] = [
            cn,
            aa,
            ra,
            cn / union,
            math.log1p(da * dc),
            dot / (norm_a * norm_c),
            math.log1p(bstr),
            math.log1p(bmax),
            min(da, dc) / max(da, dc),
            1.0 if ba == bc else 0.0,
            tree_dist,
            min(growth.get(a, 0.0), growth.get(c, 0.0)),
            max(growth.get(a, 0.0), growth.get(c, 0.0)),
            drug_disease,
        ]
        top = sorted(shared, key=lambda b: -min(na[b], nc[b]))[:6]
        bridges.append(top)
    return rows, bridges


def labels_for(pairs, pair_first, lo: int, hi: int) -> np.ndarray:
    y = np.zeros(len(pairs), dtype=np.int8)
    for i, key in enumerate(pairs):
        fy = pair_first.get(key)
        if fy is not None and lo < fy <= hi:
            y[i] = 1
    return y


# ------------------------------------------------------------------- estatistica
def bootstrap_auc(y, p, n_boot=200, seed=3):
    rng = np.random.default_rng(seed)
    vals = []
    idx = np.arange(len(y))
    for _ in range(n_boot):
        s = rng.choice(idx, size=len(idx), replace=True)
        if len(np.unique(y[s])) < 2:
            continue
        vals.append(roc_auc_score(y[s], p[s]))
    if not vals:
        return 0.5, (0.5, 0.5)
    return float(np.mean(vals)), (
        float(np.percentile(vals, 2.5)),
        float(np.percentile(vals, 97.5)),
    )


def permutation_p(y, p, n_perm=500, seed=5):
    rng = np.random.default_rng(seed)
    obs = roc_auc_score(y, p)
    ge = sum(1 for _ in range(n_perm) if roc_auc_score(rng.permutation(y), p) >= obs)
    return (ge + 1) / (n_perm + 1)


def delong(y, p1, p2):
    y = np.asarray(y)
    pos, neg = y == 1, y == 0
    n1, n0 = pos.sum(), neg.sum()
    if n1 < 2 or n0 < 2:
        return None

    def structural(p):
        px, py = p[pos], p[neg]
        v10 = np.array([np.mean((py < x) + 0.5 * (py == x)) for x in px])
        v01 = np.array([np.mean((px > y_) + 0.5 * (px == y_)) for y_ in py])
        return v10, v01

    a10, a01 = structural(p1)
    b10, b01 = structural(p2)
    auc1, auc2 = roc_auc_score(y, p1), roc_auc_score(y, p2)
    s10 = np.cov(np.vstack([a10, b10]))
    s01 = np.cov(np.vstack([a01, b01]))
    var = (s10 / n1 + s01 / n0)
    v = var[0, 0] + var[1, 1] - 2 * var[0, 1]
    if v <= 0:
        return None
    z = (auc1 - auc2) / math.sqrt(v)
    p = math.erfc(abs(z) / math.sqrt(2))
    return {"auc_a": float(auc1), "auc_b": float(auc2), "z": float(z), "p": float(p)}


def calibration(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= 1)
        if m.sum() < 5:
            continue
        out.append(
            {
                "p_pred": float(p[m].mean()),
                "p_obs": float(y[m].mean()),
                "n": int(m.sum()),
            }
        )
    brier = float(np.mean((p - y) ** 2))
    return {"brier": brier, "bins": out}


def precision_at_k(y, p, ks=(10, 25, 50, 100, 200, 500, 1000)):
    order = np.argsort(-p)
    total = max(1, int(y.sum()))
    rows = []
    for k in ks:
        if k > len(y):
            break
        top = y[order[:k]]
        rows.append(
            {"k": int(k), "precision": float(top.mean()), "recall": float(top.sum() / total)}
        )
    return rows


def powerlaw_fit(degrees: np.ndarray):
    d = degrees[degrees >= 3].astype(float)
    if len(d) < 50:
        return None
    xmin = 3.0
    alpha = 1 + len(d) / np.sum(np.log(d / (xmin - 0.5)))
    ll_pl = np.sum(np.log((alpha - 1) / xmin) - alpha * np.log(d / xmin))
    lg = np.log(d)
    mu, sigma = lg.mean(), lg.std() + 1e-9
    ll_ln = np.sum(-np.log(d * sigma * math.sqrt(2 * math.pi)) - (lg - mu) ** 2 / (2 * sigma**2))
    ratio = float(ll_pl - ll_ln)
    return {
        "alpha": float(alpha),
        "xmin": xmin,
        "loglik_ratio_vs_lognormal": ratio,
        "p": float(math.erfc(abs(ratio) / (math.sqrt(2 * len(d)) + 1e-9))),
    }


# ----------------------------------------------------------------------- runner
def run_cutoff(cutoff, recs, corpus_max_year, node_year, label, pair_first, pair_w,
               trees, args):
    print(f"\n=== corte {cutoff} ===", flush=True)
    pubs_pre = {u: sum(n for y, n in ys.items() if y <= cutoff) for u, ys in node_year.items()}
    keep = {u for u, n in pubs_pre.items() if n >= args.min_pubs}
    print(f"  conceitos com >= {args.min_pubs} artigos: {len(keep)}")

    adj_now = adjacency(pair_w, cutoff, keep, min_w=args.min_edge)
    train_cut = cutoff - args.gap
    adj_train = adjacency(pair_w, train_cut, keep, min_w=args.min_edge)

    branch = {u: ((trees.get(u) or ["Z"])[0][0]) for u in keep}
    growth: dict[str, float] = {}
    for u in keep:
        ys = node_year[u]
        recent = sum(n for y, n in ys.items() if cutoff - 4 <= y <= cutoff)
        older = sum(n for y, n in ys.items() if cutoff - 9 <= y <= cutoff - 5) + 1
        growth[u] = float(np.clip(math.log((recent + 1) / older), -2, 2))
    meta = {"trees": trees, "branch": branch, "growth": growth}

    rng = random.Random(args.seed)
    nodes_now = sorted(adj_now.keys(), key=lambda u: -len(adj_now[u]))
    nodes_train = sorted(adj_train.keys(), key=lambda u: -len(adj_train[u]))

    pairs_tr = candidate_pairs(adj_train, nodes_train, rng, args.max_pairs, args.min_cn)
    X_tr, _ = pair_features(pairs_tr, adj_train, meta)
    y_tr = labels_for(pairs_tr, pair_first, train_cut, cutoff)

    pairs_te = candidate_pairs(adj_now, nodes_now, rng, args.max_pairs, args.min_cn)
    X_te, bridges_te = pair_features(pairs_te, adj_now, meta)
    y_te = labels_for(pairs_te, pair_first, cutoff, corpus_max_year)
    print(f"  treino {len(pairs_tr)} pares ({y_tr.sum()} pos) · teste {len(pairs_te)} pares ({y_te.sum()} pos)")
    if y_tr.sum() < 20 or y_te.sum() < 20:
        print("  ! positivos insuficientes, corte ignorado")
        return None

    gbm = HistGradientBoostingClassifier(max_iter=220, learning_rate=0.08, max_depth=6,
                                         random_state=args.seed)
    gbm.fit(X_tr, y_tr)
    p_te = gbm.predict_proba(X_te)[:, 1]
    auc = float(roc_auc_score(y_te, p_te))

    mu, sd = X_tr.mean(0), X_tr.std(0) + 1e-6
    lr = LogisticRegression(max_iter=2000)
    lr.fit((X_tr - mu) / sd, y_tr)
    p_lr = lr.predict_proba((X_te - mu) / sd)[:, 1]

    fi_cols = {
        "common_neighbors": 0, "adamic_adar": 1, "resource_allocation": 2,
        "jaccard": 3, "pref_attachment": 4, "cosine_profile": 5,
    }
    comparison = [{"name": "Multiplex MeSH (GBM)", "auc": auc},
                  {"name": "Regressao logistica multiplex", "auc": float(roc_auc_score(y_te, p_lr))}]
    baseline_names = {
        "common_neighbors": "Vizinhos comuns", "adamic_adar": "Adamic-Adar",
        "resource_allocation": "Resource allocation", "jaccard": "Jaccard",
        "pref_attachment": "Preferential attachment", "cosine_profile": "Cosseno de perfis",
    }
    best_base, best_auc = None, 0.0
    for name, col in fi_cols.items():
        a = float(roc_auc_score(y_te, X_te[:, col]))
        comparison.append({"name": baseline_names[name], "auc": a})
        if a > best_auc:
            best_auc, best_base = a, X_te[:, col].astype(float)

    boot_mean, ci = bootstrap_auc(y_te, p_te)
    perm_p = permutation_p(y_te, p_te, n_perm=args.n_perm)
    imp = np.abs(lr.coef_[0])
    imp = imp / (imp.sum() or 1)

    order = np.argsort(-p_te)
    top = order[: args.top_candidates]
    items = []
    for rank, i in enumerate(top, 1):
        a, c = pairs_te[i]
        fy = pair_first.get(pairs_te[i])
        confirmed = bool(fy is not None and fy > cutoff)
        items.append({
            "rank": rank,
            "a": label.get(a, a), "c": label.get(c, c),
            "a_ui": a, "c_ui": c,
            "prob": float(p_te[i]),
            "confirmed": confirmed,
            "first_year": int(fy) if fy else None,
            "lead_time_years": int(fy - cutoff) if confirmed and fy else None,
            "intermediaries": [label.get(b, b) for b in bridges_te[i]],
            "features": {f: float(X_te[i, k]) for k, f in enumerate(FEATURES)},
        })
    leads = [it["lead_time_years"] for it in items if it["lead_time_years"]]
    hist = defaultdict(int)
    for l in leads:
        hist[l] += 1

    # ------------- grafo exportado (limitado para renderizar bem no navegador)
    export_nodes = nodes_now[: args.max_nodes]
    node_set = set(export_nodes)
    pos3 = spectral_layout(export_nodes, adj_now, dims=3, seed=args.seed)
    hier = hierarchy_layout(export_nodes, trees)
    edges = []
    idx = {n: i for i, n in enumerate(export_nodes)}
    for a, nb in adj_now.items():
        if a not in idx:
            continue
        for b, w in nb.items():
            if b in idx and idx[a] < idx[b] and w >= args.min_edge_export:
                edges.append([idx[a], idx[b], int(w)])
    edges.sort(key=lambda e: -e[2])
    edges = edges[: args.max_edges]

    graph = {
        "meta": {
            "source": "PubMed E-utilities (MEDLINE, amostra estratificada real)",
            "cutoff_year": cutoff,
            "corpus_max_year": corpus_max_year,
            "n_nodes": len(export_nodes),
            "n_edges": len(edges),
            "n_articles": len(recs),
        },
        "categories": [
            {"id": b, "label": BRANCH_LABELS.get(b, b)}
            for b in sorted({branch.get(u, "Z") for u in export_nodes})
        ],
        "features": FEATURES,
        "model": {
            "type": "logistic",
            "mean": [float(v) for v in mu],
            "std": [float(v) for v in sd],
            "coef": [float(v) for v in lr.coef_[0]],
            "intercept": float(lr.intercept_[0]),
        },
        "nodes": [
            {
                "id": u,
                "label": label.get(u, u),
                "cat": branch.get(u, "Z"),
                "tree": (trees.get(u) or [""])[0],
                "x": round(float(pos3[i, 0]), 2),
                "y": round(float(pos3[i, 1]), 2),
                "z": round(float(pos3[i, 2]), 2),
                "hx": round(hier.get(u, (0.0, 0.0))[0], 2),
                "hy": round(hier.get(u, (0.0, 0.0))[1], 2),
                "deg": len(adj_now.get(u, {})),
                "pubs": int(pubs_pre.get(u, 0)),
                "growth": round(growth.get(u, 0.0), 3),
            }
            for i, u in enumerate(export_nodes)
        ],
        "edges": edges,
    }

    degrees = np.array([len(v) for v in adj_now.values()])
    metrics = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": graph["meta"]["source"],
        "cutoff_year": cutoff,
        "train_cutoff": train_cut,
        "window": [cutoff + 1, corpus_max_year],
        "n_articles": len(recs),
        "graph": {
            "nodes": len(adj_now),
            "edges_pre": int(sum(len(v) for v in adj_now.values()) // 2),
            "edges_post_new": int(sum(1 for k, fy in pair_first.items() if fy > cutoff
                                      and k[0] in keep and k[1] in keep)),
            "density": float(2 * sum(len(v) for v in adj_now.values()) / 2
                             / max(1, len(adj_now) * (len(adj_now) - 1))),
        },
        "labels": {"n": len(y_te), "positives": int(y_te.sum()), "rate": float(y_te.mean())},
        "model": {
            "name": "Gradient boosting sobre features multiplex MeSH",
            "auc": auc,
            "auc_ci95": [ci[0], ci[1]],
            "auc_bootstrap_mean": boot_mean,
            "permutation_p": float(perm_p),
            "feature_importance": [
                {"feature": f, "importance": float(imp[k])} for k, f in enumerate(FEATURES)
            ],
        },
        "model_comparison": sorted(comparison, key=lambda d: -d["auc"]),
        "delong_vs_best_baseline": delong(y_te, p_te, best_base) if best_base is not None else None,
        "precision_at_k": precision_at_k(y_te, p_te),
        "calibration": calibration(y_te.astype(float), p_te),
        "powerlaw": powerlaw_fit(degrees),
        "confirmations": {
            "n_predicted": len(items),
            "n_confirmed": int(sum(1 for it in items if it["confirmed"])),
            "rate": float(sum(1 for it in items if it["confirmed"]) / max(1, len(items))),
            "median_lead_time": float(np.median(leads)) if leads else None,
            "mean_lead_time": float(np.mean(leads)) if leads else None,
            "lead_time_histogram": [{"years": k, "n": v} for k, v in sorted(hist.items())],
        },
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"graph-{cutoff}.json").write_text(json.dumps(graph, separators=(",", ":")))
    (OUT / f"candidates-{cutoff}.json").write_text(
        json.dumps({"cutoff_year": cutoff, "items": items}, separators=(",", ":"))
    )
    (OUT / f"metrics-{cutoff}.json").write_text(json.dumps(metrics, indent=1))
    print(f"  AUC {auc:.3f} · confirmadas {metrics['confirmations']['n_confirmed']}/{len(items)}")
    return metrics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="pipeline/cache/pubmed_corpus.jsonl.gz")
    ap.add_argument("--cutoffs", default="2006,2010,2014,2018")
    ap.add_argument("--gap", type=int, default=6)
    ap.add_argument("--min-pubs", type=int, default=12)
    ap.add_argument("--min-edge", type=int, default=1)
    ap.add_argument("--min-edge-export", type=int, default=2)
    ap.add_argument("--min-cn", type=int, default=3)
    ap.add_argument("--max-pairs", type=int, default=120000)
    ap.add_argument("--max-nodes", type=int, default=6000)
    ap.add_argument("--max-edges", type=int, default=90000)
    ap.add_argument("--top-candidates", type=int, default=500)
    ap.add_argument("--n-perm", type=int, default=300)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()

    recs = load_corpus(Path(args.corpus))
    print(f"corpus: {len(recs)} artigos reais")
    corpus_max_year = max(r["year"] for r in recs)
    node_year, label, pair_first, pair_w = build_pairs(recs)
    print(f"conceitos: {len(node_year)} · pares co-ocorrentes: {len(pair_w)}")

    counts = {u: sum(ys.values()) for u, ys in node_year.items()}
    used = [u for u, n in counts.items() if n >= 5]
    trees = fetch_tree_numbers(used)

    timeline = []
    for cutoff in [int(c) for c in args.cutoffs.split(",")]:
        m = run_cutoff(cutoff, recs, corpus_max_year, node_year, label, pair_first,
                       pair_w, trees, args)
        if m:
            timeline.append({
                "cutoff_year": cutoff,
                "auc": m["model"]["auc"],
                "auc_ci95": m["model"]["auc_ci95"],
                "n_predicted": m["confirmations"]["n_predicted"],
                "n_confirmed": m["confirmations"]["n_confirmed"],
                "rate": m["confirmations"]["rate"],
                "median_lead_time": m["confirmations"]["median_lead_time"],
                "mean_lead_time": m["confirmations"]["mean_lead_time"],
                "precision_at_50": next((r["precision"] for r in m["precision_at_k"]
                                         if r["k"] == 50), None),
                "positives_rate": m["labels"]["rate"],
                "nodes": m["graph"]["nodes"],
            })

    index = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "PubMed E-utilities (MEDLINE)",
        "n_articles": len(recs),
        "corpus_years": [min(r["year"] for r in recs), corpus_max_year],
        "cutoffs": [t["cutoff_year"] for t in timeline],
        "default_cutoff": timeline[-1]["cutoff_year"] if timeline else None,
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    (OUT / "timeline.json").write_text(json.dumps({"items": timeline}, indent=1))
    print("\npronto:", index)


if __name__ == "__main__":
    main()
