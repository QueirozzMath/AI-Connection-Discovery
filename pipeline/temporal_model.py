"""Bounded temporal training using the project's existing features and estimators.

No artifact from a published cutoff is used. Training features are frozen at the
inner cutoff; labels end at the outer cutoff. Holdout is read only for evaluation.
"""
from contextlib import closing
from functools import lru_cache
import random
import math
import time

from map_store import connect

GAP = 6
MAX_PAIRS = 6000
MIN_POSITIVES = 20


def snapshot(path, at):
    from map_api import graph_query
    # Revision is supplied by callers; this noncached snapshot reads only <= at.
    graph = graph_query.__wrapped__(path, "training", 1800, at)
    kept = [i for i,n in enumerate(graph["nodes"]) if n["pubs"] >= 12]
    remap = {old:new for new,old in enumerate(kept)}
    graph["nodes"] = [graph["nodes"][i] for i in kept]
    graph["edges"] = [[remap[a],remap[b],w] for a,b,w in graph["edges"] if a in remap and b in remap]
    graph["meta"].update(n_nodes=len(graph["nodes"]),n_edges=len(graph["edges"]))
    nodes = {n["id"]: n for n in graph["nodes"]}
    adj = {mid: {} for mid in nodes}
    for a, b, w in graph["edges"]:
        ai, bi = graph["nodes"][a]["id"], graph["nodes"][b]["id"]
        adj[ai][bi] = w
        adj[bi][ai] = w
    meta = {"trees": {i: [n["tree"]] for i, n in nodes.items()},
            "branch": {i: n["cat"] for i, n in nodes.items()},
            "growth": {i: n["growth"] for i, n in nodes.items()}}
    return graph, adj, meta


def observed_pairs(path, start, end):
    with closing(connect(path)) as db:
        return {(r[0], r[1]): r[2] for r in db.execute(
            "SELECT mesh_a,mesh_b,MIN(year) FROM pair_year WHERE year BETWEEN ? AND ? GROUP BY mesh_a,mesh_b", (start, end))}


def unseen_pairs(path, pairs, cutoff):
    # Rendered edges are capped. Absence from the Canvas is not absence from the corpus.
    with closing(connect(path)) as db:
        db.execute("CREATE TEMP TABLE candidate_check (a TEXT,b TEXT,PRIMARY KEY(a,b))")
        db.executemany("INSERT INTO candidate_check VALUES(?,?)",pairs)
        seen = {(r[0],r[1]) for r in db.execute("""SELECT DISTINCT c.a,c.b FROM candidate_check c
          JOIN pair_year p ON p.mesh_a=c.a AND p.mesh_b=c.b WHERE p.year<=?""",(cutoff,))}
    return [pair for pair in pairs if pair not in seen]


@lru_cache(maxsize=6)
def train(path, revision, cutoff):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import HistGradientBoostingClassifier
    from build_from_corpus import candidate_pairs, pair_features
    from map_api import metadata
    with closing(connect(path)) as db:
        catalog = metadata(db)
    inner = cutoff - GAP
    if catalog["start"] is None or inner - 9 < catalog["start"]:
        return {"available": False, "reason": "Dados insuficientes para treinamento: são necessários dez anos de histórico antes da janela de calibração de seis anos."}
    graph, adj, meta = snapshot(path, inner)
    pairs = candidate_pairs(adj, sorted(adj), random.Random(42), MAX_PAIRS)
    pairs = unseen_pairs(path,pairs,inner)
    if not pairs:
        return {"available": False, "reason": "Dados insuficientes para treinamento: nenhum par ABC elegível."}
    x, _ = pair_features(pairs, adj, meta)
    future = observed_pairs(path, inner + 1, cutoff)
    y = np.array([int(pair in future) for pair in pairs])
    if y.sum() < MIN_POSITIVES or (1-y).sum() < MIN_POSITIVES:
        return {"available": False, "reason": "Dados insuficientes para treinamento: menos de 20 exemplos em uma das classes antes do corte."}
    mean, std = x.mean(0), x.std(0) + 1e-6
    lr = LogisticRegression(max_iter=2000).fit((x-mean)/std, y)
    gbm = HistGradientBoostingClassifier(max_iter=220, learning_rate=0.08, max_depth=6, random_state=42).fit(x,y)
    return {"available": True, "lr": lr, "gbm": gbm, "mean": mean, "std": std,
            "trainedThrough": cutoff, "featureCutoff": inner, "trainingPairs": len(pairs), "trainingStart":catalog["start"],
            "model": {"type": "logistic", "available": True, "trainedThrough": cutoff,
                      "mean": mean.tolist(), "std": std.tolist(), "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0])}}


def analyze(path, revision, start, end, validate=False, allowed_ids=None, seed_ids=()):
    import numpy as np
    from sklearn.metrics import roc_auc_score
    from build_from_corpus import (candidate_pairs, pair_features, FEATURES,
        bootstrap_auc, permutation_p, precision_at_k, calibration)
    from map_api import metadata, graph_query
    trained = train(path, revision, end)
    if not trained["available"]:
        return {"available": False, "reason": trained["reason"], "items": []}
    # Exploration is strictly the selected interval; validation uses all history <= cutoff.
    if validate:
        graph, adj, meta = snapshot(path, end)
    else:
        graph = graph_query(path, revision, start, end)
        nodes = graph["nodes"]
        adj = {n["id"]: {} for n in nodes}
        for a,b,w in graph["edges"]:
            adj[nodes[a]["id"]][nodes[b]["id"]] = w
            adj[nodes[b]["id"]][nodes[a]["id"]] = w
        meta = {"trees": {n["id"]:[n["tree"]] for n in nodes}, "branch": {n["id"]:n["cat"] for n in nodes}, "growth": {n["id"]:n["growth"] for n in nodes}}
    if not validate and allowed_ids is not None:
        allowed = set(allowed_ids)
        adj = {a:{b:w for b,w in neighbours.items() if b in allowed} for a,neighbours in adj.items() if a in allowed}
    anchors = sorted(set(seed_ids)&set(adj)) if seed_ids else sorted(adj)
    pairs = candidate_pairs(adj, sorted(adj), random.Random(42), MAX_PAIRS, anchors=anchors)
    if seed_ids: pairs = [pair for pair in pairs if set(pair)&set(anchors)]
    pairs = unseen_pairs(path,pairs,end)
    if not pairs:
        return {"available": False, "reason": "Nenhum par ABC elegível no universo selecionado.", "items": []}
    x, bridges = pair_features(pairs, adj, meta)
    p = trained["gbm"].predict_proba(x)[:,1]
    labels = {n["id"]: n["label"] for n in graph["nodes"]}
    order = np.argsort(-p)
    items = [{"rank": rank, "a": labels[a], "c": labels[c], "a_ui": a, "c_ui": c,
              "prob": float(p[i]), "confirmed": False, "first_year": None, "lead_time_years": None,
              "intermediaries": [labels[b] for b in bridges[i]], "features": dict(zip(FEATURES, map(float,x[i])))}
             for rank,i in enumerate(order[:200],1) for a,c in [pairs[i]]]
    result = {"available": True, "items": items, "model": trained["model"],
              "training": {"startYear": trained["trainingStart"], "endYear": end, "featureCutoff": trained["featureCutoff"]}}
    if not validate:
        return result
    with closing(connect(path)) as db:
        catalog = metadata(db)
    if end >= catalog["end"]:
        return {"available": False, "items": [], "reason": "Dados insuficientes para validação temporal neste corte: não há holdout posterior."}
    holdout = observed_pairs(path, end+1, catalog["end"])
    y = np.array([int(pair in holdout) for pair in pairs])
    if y.sum() < MIN_POSITIVES or (1-y).sum() < MIN_POSITIVES:
        return {"available": False, "items": [], "reason": "Dados insuficientes para validação temporal neste corte: menos de 20 exemplos em uma das classes de teste."}
    auc = float(roc_auc_score(y,p))
    boot, ci = bootstrap_auc(y,p)
    plr = trained["lr"].predict_proba((x-trained["mean"])/trained["std"])[:,1]
    comparison = [{"name":"Gradient boosting multiplex", "auc":auc}, {"name":"Regressão logística multiplex", "auc":float(roc_auc_score(y,plr))}]
    comparison += [{"name":name, "auc":float(roc_auc_score(y,x[:,i]))} for i,name in enumerate(FEATURES[:6])]
    leads = []
    for item in items:
        pair = tuple(sorted((item["a_ui"],item["c_ui"])))
        first = holdout.get(pair)
        if first:
            item.update(confirmed=True, first_year=first, lead_time_years=first-end)
            leads.append(first-end)
    imp = np.abs(trained["lr"].coef_[0]); imp /= imp.sum() or 1
    n = len(graph["nodes"]); e = len(graph["edges"])
    result["metrics"] = {"generated_at":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source":catalog["source"], "cutoff_year":end, "train_cutoff":trained["featureCutoff"],
        "window":[end+1,catalog["end"]], "n_articles":graph["meta"]["n_articles"],
        "graph":{"nodes":n,"edges_pre":e,"edges_post_new":int(y.sum()),"density":2*e/max(1,n*(n-1))},
        "labels":{"n":len(y),"positives":int(y.sum()),"rate":float(y.mean())},
        "model":{"name":"Gradient boosting multiplex", "auc":auc,"auc_ci95":list(ci),"auc_bootstrap_mean":boot,
                 "permutation_p":float(permutation_p(y,p,n_perm=100)),
                 "feature_importance":[{"feature":f,"importance":float(imp[i])} for i,f in enumerate(FEATURES)]},
        "model_comparison":comparison,"delong_vs_best_baseline":None,
        "precision_at_k":precision_at_k(y,p),"calibration":calibration(y.astype(float),p),"powerlaw":None,
        "confirmations":{"n_predicted":len(items),"n_confirmed":len(leads),"rate":len(leads)/len(items),
          "median_lead_time":float(np.median(leads)) if leads else None,
          "lead_time_histogram":[{"years":v,"n":leads.count(v)} for v in sorted(set(leads))]}}
    return result
