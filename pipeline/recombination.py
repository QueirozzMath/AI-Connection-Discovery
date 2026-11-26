"""Experimental generalized A--B--C search; standard library only.
Publication-year snapshots are NOT historical indexing reconstructions.
No graph score is a probability of biological truth.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from math import exp, log, sqrt
import argparse
import gzip
import json
import random


def pair(a, b):
    return tuple(sorted((a, b)))


@dataclass
class Snapshot:
    cutoff: int
    records: list
    edges: dict
    adjacency: dict
    documents: dict
    provenance: dict


def build_snapshot(records, cutoff, require_availability=False, max_mesh=25):
    """Deduplicate before eligibility: conflicting PMID versions fail closed."""
    by_id, conflicts = {}, set()
    for raw in records:
        pmid = str(raw.get('pmid', '')).strip()
        if not pmid:
            continue
        rec = dict(raw)
        if pmid in by_id and by_id[pmid] != rec:
            conflicts.add(pmid)
        by_id[pmid] = rec
    eligible, docs, edges = [], {}, defaultdict(set)
    for pmid, r in sorted(by_id.items()):
        y, available = r.get('year'), r.get('available_year')
        if pmid in conflicts or not isinstance(y, int) or isinstance(y, bool) or y > cutoff:
            continue
        if require_availability and (not isinstance(available, int) or isinstance(available, bool)):
            continue
        if available is not None and (not isinstance(available, int) or isinstance(available, bool) or available > cutoff):
            continue
        terms = sorted({m[0] if isinstance(m, (list, tuple)) else m
                        for m in r.get('mesh', []) if m})
        terms = [t for t in terms if isinstance(t, str) and t.startswith('D')]
        if not 2 <= len(terms) <= max_mesh:
            continue
        docs[pmid] = {'pmid': pmid, 'year': y, 'title': r.get('title', ''),
                      'abstract': r.get('abstract', ''), 'available_year': available}
        eligible.append((pmid, y, terms))
        for e in combinations(terms, 2):
            edges[e].add(pmid)
    adjacency = defaultdict(set)
    for a, b in edges:
        adjacency[a].add(b); adjacency[b].add(a)
    return Snapshot(cutoff, eligible, dict(edges), dict(adjacency), docs,
                    {'temporal_mode': 'availability_and_publication' if require_availability else 'publication_only',
                     'conflicting_pmids_excluded': len(conflicts), 'max_mesh': max_mesh,
                     'eligible_documents': len(docs)})


def null_statistics(snapshot, requested_pairs, samples=64, swaps_per_incidence=10, seed=0):
    """Year-stratified bipartite switches preserve article size and term frequency.
    Fresh chain per sample; finite mixing is diagnostic, not an exact null sampler.
    Zero-variance pairs have undefined z and must not be labelled atypical.
    """
    if samples < 2 or swaps_per_incidence < 1:
        raise ValueError('Need >=2 samples and positive swap effort')
    rng = random.Random(seed)
    keys = sorted({pair(*p) for p in requested_pairs})
    values = {p: [] for p in keys}
    accepted = 0
    for _ in range(samples):
        strata = defaultdict(list)
        for _, year, terms in snapshot.records:
            strata[year].append(set(terms))
        counts = Counter()
        for rows in strata.values():
            slots = [(i, t) for i, row in enumerate(rows) for t in sorted(row)]
            for _ in range(len(slots) * swaps_per_incidence):
                if len(slots) < 2:
                    break
                i, j = rng.sample(range(len(slots)), 2)
                a, x = slots[i]; b, y = slots[j]
                if a == b or x == y or y in rows[a] or x in rows[b]:
                    continue
                rows[a].remove(x); rows[a].add(y)
                rows[b].remove(y); rows[b].add(x)
                slots[i], slots[j] = (a, y), (b, x)
                accepted += 1
            for row in rows:
                counts.update(combinations(sorted(row), 2))
        for p in keys:
            values[p].append(counts[p])
    result = {}
    for p, xs in values.items():
        mean = sum(xs) / samples
        sd = sqrt(sum((x - mean) ** 2 for x in xs) / (samples - 1))
        result[p] = {'mean': mean, 'sd': sd,
                     'z': (len(snapshot.edges.get(p, ())) - mean) / sd if sd > 0 else None}
    return result, {'samples': samples, 'seed': seed, 'accepted_swaps': accepted,
                    'swaps_per_incidence': swaps_per_incidence, 'mixing_verified': False}


def enumerate_candidates(snapshot, seeds, proposals=(), max_hops=4, max_states=10000,
                         min_support=2, max_speculative=1, max_speculative_fraction=1/3):
    """All eligible nonadjacent subpaths, including intermediate endpoints.
    External proposals only open a search frontier; they never become observed edges.
    Length-two paths reproduce ABC. Output is a bounded, not exhaustive search.
    """
    if not 2 <= max_hops <= 8 or max_states < 1 or min_support < 1:
        raise ValueError('Invalid search limits')
    if max_speculative < 0 or not 0 <= max_speculative_fraction <= 1:
        raise ValueError('Invalid speculative budget')
    virtual = defaultdict(set)
    for a, b in proposals:
        if a != b and a in snapshot.adjacency and b in snapshot.adjacency and pair(a, b) not in snapshot.edges:
            virtual[a].add(b); virtual[b].add(a)
    frontier = [(tuple([s]), 0) for s in sorted(set(seeds)) if s in snapshot.adjacency]
    found, states, cursor = {}, 0, 0
    while cursor < len(frontier) and states < max_states:
        path, nvirtual = frontier[cursor]; cursor += 1; states += 1
        if len(path) - 1 >= max_hops:
            continue
        u = path[-1]
        neighbors = snapshot.adjacency.get(u, set()) | virtual.get(u, set())
        for v in sorted(neighbors):
            if v in path:
                continue
            e = pair(u, v); speculative = e not in snapshot.edges
            if not speculative and len(snapshot.edges[e]) < min_support:
                continue
            nv = nvirtual + int(speculative)
            if nv > max_speculative:
                continue
            new = path + (v,)
            if len(frontier) < max_states:
                frontier.append((new, nv))
            for start in range(len(new) - 2):
                segment = new[start:]
                if pair(segment[0], segment[-1]) in snapshot.edges:
                    continue  # Check full analytical graph, even edges below support threshold.
                links = list(zip(segment, segment[1:]))
                missing = [pair(a, b) for a, b in links if pair(a, b) not in snapshot.edges]
                if len(missing) > max_speculative or len(missing)/len(links) > max_speculative_fraction:
                    continue
                if len(links) - len(missing) < 2:
                    continue
                canonical = min(segment, segment[::-1])
                found[canonical] = {'path': list(canonical),
                    'target': list(pair(segment[0], segment[-1])),
                    'speculative_edges': [list(e) for e in sorted(missing)],
                    'observed_edges': [list(pair(a,b)) for a,b in zip(canonical,canonical[1:]) if pair(a,b) in snapshot.edges]}
    return [found[k] for k in sorted(found)], {'states': states,
        'truncated': len(frontier) >= max_states, 'candidate_count': len(found)}


def score_candidates(snapshot, candidates, stats):
    result = []
    for c in candidates:
        path = c['path']; obs = [tuple(x) for x in c['observed_edges']]
        support = min(len(snapshot.edges[e]) for e in obs)
        grounding = 1 - exp(-support / 2)
        zs = [stats[p]['z'] for p in combinations(sorted(path),2) if p in stats and stats[p]['z'] is not None]
        zs.sort()
        # Atypicality is a separate structural descriptor, not evidence confidence.
        conventionality = zs[len(zs)//2] if zs else None
        tail = zs[int(.1*(len(zs)-1))] if zs else None
        novelty = max(0., min(1., -(tail or 0.) / 3))
        anchored = max(0., min(1., (conventionality or 0.) / 3))
        penalty = .1 * (len(path)-3) + .5 * len(c['speculative_edges'])
        score = grounding + .25 * anchored * novelty - penalty
        result.append({**c, 'grounding': grounding, 'conventionality': conventionality,
                       'tail_z': tail, 'null_pair_coverage': len(zs)/(len(path)*(len(path)-1)/2),
                       'score': score, 'score_kind': 'heuristic_not_probability'})
    return sorted(result, key=lambda c: (-c['score'], c['path']))


def select_portfolio(candidates, k=10, diversity_weight=.3):
    if k < 0 or diversity_weight < 0:
        raise ValueError('Invalid portfolio limits')
    remaining, selected, targets = list(candidates), [], set()
    while remaining and len(selected) < k:
        def value(c):
            nodes = set(c['path'])
            overlap = max((len(nodes & set(s['path']))/len(nodes | set(s['path'])) for s in selected),default=0.)
            return c['score'] - diversity_weight * overlap
        chosen = sorted(remaining, key=lambda c: (-value(c), c['path']))[0]
        selected.append({**chosen, 'portfolio_marginal_score': value(chosen)})
        targets.add(tuple(chosen['target']))
        remaining = [c for c in remaining if tuple(c['target']) not in targets]
    return selected


def evidence_dossier(snapshot, candidate, min_articles=2):
    arms, all_ids = [], set()
    for e in candidate['observed_edges']:
        ids = [p for p in sorted(snapshot.edges.get(tuple(e), ()))
               if len(snapshot.documents[p]['abstract'].strip()) >= 80]
        all_ids.update(ids)
        arms.append({'edge': e, 'status': 'retrieved' if len(ids)>=min_articles else 'insufficient',
                     'documents': [snapshot.documents[p] for p in ids]})
    passed = all(a['status']=='retrieved' for a in arms) and len(all_ids)>=len(arms)+1
    return {'cutoff':snapshot.cutoff, 'temporal_mode':snapshot.provenance['temporal_mode'],
            'candidate':candidate, 'arms':arms, 'unverified_links':candidate['speculative_edges'],
            'eligible_for_generation':passed, 'scope':'bibliographic support, not causal entailment'}


def run_agents(dossier, invoke, max_calls=5):
    """Provider-injected separate calls; no credential, network or paid-provider defaults.
    invoke(role,payload) returns {text:str,citations:[PMID,...]}.
    Bounded workflow, not autonomous evidence retrieval or laboratory validation.
    """
    if not dossier['eligible_for_generation']:
        return {'status':'abstained', 'calls':[], 'reason':'insufficient_evidence'}
    allowed = {d['pmid'] for a in dossier['arms'] for d in a['documents']}
    roles = ['mechanism','alternative','skeptic','experiment','synthesis']
    instructions = {
        'mechanism':'Propose a mechanism; distinguish observation, transfer and speculation.',
        'alternative':'Independently propose a competing mechanism and null explanation.',
        'skeptic':'Compare mechanisms; audit context, contradictions and all unverified links.',
        'experiment':'Design a discriminating experiment with comparator, outcome and falsifier.',
        'synthesis':'Preserve disagreements and unsupported links; produce a provisional research proposal.'}
    calls=[]
    for role in roles:
        if len(calls)>=max_calls:
            return {'status':'budget_exhausted','calls':calls}
        prior = [] if role in ('mechanism','alternative') else list(calls)
        try:
            answer=invoke(role,{'instruction':instructions[role], 'dossier':dossier, 'prior':prior})
        except Exception as exc:
            return {'status':'provider_error','calls':calls,'role':role,'error_type':type(exc).__name__}
        if not isinstance(answer,dict) or not isinstance(answer.get('text'),str) or not answer['text'].strip() or not isinstance(answer.get('citations'),list) or not all(isinstance(p,str) and p in allowed for p in answer['citations']):
            return {'status':'invalid_output','calls':calls,'role':role}
        calls.append({'role':role,'output':answer})
    return {'status':'completed_unvalidated','calls':calls}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--corpus',required=True); ap.add_argument('--cutoff',type=int,required=True)
    ap.add_argument('--seed',action='append',required=True,help='MeSH descriptor; repeat for multiple seeds')
    ap.add_argument('--proposals',help='JSON list of speculative descriptor pairs')
    ap.add_argument('--output',required=True);ap.add_argument('--strict-availability',action='store_true')
    ap.add_argument('--max-states',type=int,default=10000);ap.add_argument('--null-samples',type=int,default=64)
    args=ap.parse_args()
    opener=gzip.open if args.corpus.endswith('.gz') else open
    with opener(args.corpus,'rt',encoding='utf8') as f:
        snap=build_snapshot((json.loads(line) for line in f if line.strip()),args.cutoff,args.strict_availability)
    proposals=[]
    if args.proposals:
        with open(args.proposals) as f: proposals=json.load(f)
    candidates,search=enumerate_candidates(snap,args.seed,proposals,max_states=args.max_states)
    pairs={p for c in candidates for p in combinations(sorted(c['path']),2)}
    stats,null=null_statistics(snap,pairs,samples=args.null_samples)
    ranked=score_candidates(snap,candidates,stats)
    portfolio=select_portfolio(ranked)
    output={'status':'experimental_candidates_not_validated_discoveries','cutoff':args.cutoff,
            'provenance':snap.provenance,'search':search,'null':null,'candidates':ranked,
            'portfolio':[evidence_dossier(snap,c) for c in portfolio]}
    with open(args.output,'w',encoding='utf8') as f:json.dump(output,f,ensure_ascii=False,indent=2)


if __name__=='__main__':main()
