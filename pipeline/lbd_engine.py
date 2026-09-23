"""Publication-time ABC discovery, independent of LLMs and Canvas rendering.

Policy abc-zero-v1: no A-C coindexation anywhere in the corpus through T.
Generation budgets are explicit; exact detail/evidence queries use SQL aggregates.
"""
from collections import defaultdict
from contextlib import closing
import hashlib
import json
import math
import unicodedata

from map_store import connect

VERSION = "abc-zero-v1"
MESH_SCHEMA = """CREATE TABLE IF NOT EXISTS mesh_versions (
 id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL,
 valid_from INTEGER NOT NULL, valid_to INTEGER, label TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(id,version,kind)
);"""
DEFINITIONS = {
    "novelty": "1 quando A-C não coocorre no corpus até T; não é novidade mundial.",
    "bridgeStrength": "Soma de min(nAB,nBC) entre pontes B distintas até T.",
    "surprise": "Média do menor PMI de cada caminho: log2(nXY*N/(nX*nY)); expectativa de independência, não p-valor.",
    "temporalEmergence": "log((ocorrências nos últimos 5 anos+1)/(ocorrências nos 5 anos anteriores+1)) dos caminhos.",
    "semanticDistance": "1 - Jaccard das vizinhanças pré-corte; proxy estrutural, não distância semântica validada.",
    "meshTreeDistance": "Menor distância em segmentos da árvore MeSH, apenas com versão temporal disponível.",
    "evidenceStrength": "Artigos distintos que coindexam A-B ou B-C, contados no banco.",
    "pathCount": "Número de pontes B distintas; não prova independência estatística dos estudos.",
    "persistence": "Média, entre caminhos, de anos ativos / anos desde a primeira ocorrência até T.",
    "contradictionSignal": "Não determinado automaticamente por coocorrência ou por títulos.",
}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.lower()) if not unicodedata.combining(c))


def validate_period(db, data):
    start, end = data.get("startYear"), data.get("endYear")
    bounds = db.execute("SELECT MIN(year),MAX(year) FROM articles").fetchone()
    if type(start) is not int or type(end) is not int or bounds[0] is None or not bounds[0] <= start <= end <= bounds[1]:
        raise ValueError("Período fora da cobertura disponível")
    return start, end


def neighbours(db, mid, start, end):
    result = {}
    for sql in ("SELECT mesh_b AS id,year,weight FROM pair_year WHERE mesh_a=? AND year BETWEEN ? AND ?",
                "SELECT mesh_a AS id,year,weight FROM pair_year WHERE mesh_b=? AND year BETWEEN ? AND ?"):
        for other, year, weight in db.execute(sql, (mid, start, end)):
            result.setdefault(other, {})[year] = weight
    return result


def concepts(db, start, end, query="", categories=(), operator="or", seeds=(), limit=50):
    if operator not in ("and", "or") or len(seeds) > 20 or len(categories) > 26 or len(query) > 300:
        raise ValueError("Filtros inválidos")
    rows = [dict(r) for r in db.execute("""SELECT m.id,m.label,m.category,m.tree,SUM(n.count) AS pubs
        FROM node_year n JOIN mesh m ON m.id=n.mesh_id WHERE n.year BETWEEN ? AND ?
        GROUP BY m.id,m.label,m.category,m.tree ORDER BY pubs DESC,m.id""", (start, end))]
    cats = set(categories)
    eligible = {r["id"] for r in rows if not cats or r["category"] in cats}
    if cats and operator == "and":
        coverage = {r["id"]: {r["category"]} for r in rows if r["id"] in eligible}
        labels = {r["id"]: r["category"] for r in rows}
        for a,b in db.execute("SELECT DISTINCT mesh_a,mesh_b FROM pair_year WHERE year BETWEEN ? AND ?", (start,end)):
            if a in coverage: coverage[a].add(labels.get(b))
            if b in coverage: coverage[b].add(labels.get(a))
        eligible = {mid for mid, covered in coverage.items() if cats <= covered}
    if seeds:
        active = set(seeds) & eligible
        near = set(active)
        for mid in active: near.update(neighbours(db,mid,start,end))
        eligible &= near
    q = normalize(query.strip())
    template_row=db.execute("SELECT value FROM metadata WHERE key='template'").fetchone()
    category_labels={c['id']:c['label'] for c in json.loads(template_row[0]).get('categories',[])} if template_row else {}
    matched = [r for r in rows if r["id"] in eligible and (not q or q in normalize(" ".join(str(r[k]) for k in ("id","label","category","tree"))+' '+category_labels.get(r['category'],'')))]
    return {"items": matched[:limit] if limit else matched, "total": len(matched), "startYear":start,"endYear":end}


def resolve(db, value, cutoff=None):
    if not isinstance(value,str) or not value or len(value)>300: raise ValueError("Conceito inválido")
    row = db.execute("SELECT id,label,category FROM mesh WHERE id=? OR LOWER(label)=LOWER(?) ORDER BY id LIMIT 1", (value,value)).fetchone()
    if row is None: raise ValueError("Conceito não encontrado")
    result=dict(row)
    if cutoff is not None:
        version=db.execute("SELECT label,version,payload FROM mesh_versions WHERE id=? AND kind='Descriptor' AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY valid_from DESC LIMIT 1",(result['id'],cutoff,cutoff)).fetchone()
        result.update(category=None,meshVersion=None)
        if version:
            result.update(label=version[0],meshVersion=version[1],category=json.loads(version[2]).get('category'))
    return result


def pair_count(db, a, c, end, start=1800):
    a,c=sorted((a,c))
    return db.execute("SELECT COALESCE(SUM(weight),0),MIN(year) FROM pair_year WHERE mesh_a=? AND mesh_b=? AND year BETWEEN ? AND ?", (a,c,start,end)).fetchone()


def edge_evidence(db, a, b, start, end, limit=12):
    rows = db.execute("""SELECT x.pmid,x.year,x.title,x.journal FROM articles x
        JOIN article_mesh l ON l.pmid=x.pmid JOIN article_mesh r ON r.pmid=x.pmid
        WHERE l.mesh_id=? AND r.mesh_id=? AND x.year BETWEEN ? AND ?
        ORDER BY x.year,x.pmid LIMIT ?""", (a,b,start,end,limit)).fetchall()
    return [dict(r) for r in rows]


def tree_distance(db, a, c, cutoff):
    # Current unversioned mesh.tree is deliberately never used here.
    found=[]
    for mid in (a,c):
        row=db.execute("SELECT version,payload FROM mesh_versions WHERE id=? AND kind='Descriptor' AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY valid_from DESC LIMIT 1",(mid,cutoff,cutoff)).fetchone()
        if not row: return None
        found.append((row[0],json.loads(row[1]).get("treeNumbers",[])))
    if found[0][0]!=found[1][0] or not all(trees for _,trees in found): return None
    distances=[]
    for left in found[0][1]:
        for right in found[1][1]:
            x,y=left.split("."),right.split(".")
            same=0
            for u,v in zip(x,y):
                if u!=v: break
                same+=1
            distances.append(len(x)+len(y)-2*same)
    return {"value":min(distances),"meshVersion":found[0][0]}


def candidate(db, a, c, cutoff, start=1800, strict=False, candidate_type='closed'):
    if candidate_type not in ('open','closed','global'): raise ValueError('Modo de descoberta inválido')
    left,right=resolve(db,a,cutoff),resolve(db,c,cutoff)
    a,c=left["id"],right["id"]
    if a==c: raise ValueError("A e C devem ser distintos")
    observed,first=pair_count(db,a,c,cutoff)
    na,nc=neighbours(db,a,1800,cutoff),neighbours(db,c,1800,cutoff)
    common=sorted(set(na)&set(nc))
    if not common: raise ValueError("Nenhum caminho A-B-C anterior ao corte")
    n=db.execute("SELECT COUNT(*) FROM articles WHERE year<=?",(cutoff,)).fetchone()[0]
    counts=dict(db.execute("SELECT mesh_id,SUM(count) FROM node_year WHERE year<=? GROUP BY mesh_id",(cutoff,)))
    common.sort(key=lambda b:(-min(sum(na[b].values()),sum(nc[b].values())),b))
    strength=surprise=persistence=0
    recent=older=0
    for b in common:
        ab,bc=sum(na[b].values()),sum(nc[b].values())
        strength+=min(ab,bc)
        surprise+=min(math.log2(ab*n/(counts[a]*counts[b])),math.log2(bc*n/(counts[b]*counts[c])))
        years=set(na[b])|set(nc[b])
        persistence+=len(years)/(cutoff-min(years)+1)
        for year in years:
            value=na[b].get(year,0)+nc[b].get(year,0)
            if cutoff-4<=year<=cutoff: recent+=value
            elif cutoff-9<=year<cutoff-4: older+=value
    paths=[]
    for b in common[:8]:
        bridge=resolve(db,b,cutoff)
        edges=[]
        for x,y,series in ((a,b,na[b]),(b,c,nc[b])):
            expected=counts[x]*counts[y]/n
            edges.append({"from":x,"to":y,"count":sum(series.values()),"expected":expected,
                "pmi":math.log2(sum(series.values())/expected),"firstYear":min(series),
                "years":[{"year":year,"count":weight} for year,weight in sorted(series.items())],
                "articles":edge_evidence(db,x,y,1800,cutoff)})
        paths.append({"B":bridge,"AB":edges[0],"BC":edges[1]})
    db.execute("CREATE TEMP TABLE IF NOT EXISTS lbd_bridges(id TEXT PRIMARY KEY)")
    db.execute("DELETE FROM lbd_bridges")
    db.executemany("INSERT INTO lbd_bridges VALUES(?)",((b,) for b in common))
    evidence_count=db.execute("""SELECT COUNT(DISTINCT x.pmid) FROM articles x
        JOIN article_mesh endpoint ON endpoint.pmid=x.pmid JOIN article_mesh bridge ON bridge.pmid=x.pmid
        JOIN lbd_bridges b ON b.id=bridge.mesh_id WHERE endpoint.mesh_id IN (?,?) AND x.year<=?""",(a,c,cutoff)).fetchone()[0]
    distance=tree_distance(db,a,c,cutoff)
    if strict and distance is None: raise ValueError("MeSH histórico indisponível para o corte; validação estrutural estrita recusada")
    revision=json.loads(db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0])
    metrics={"novelty":int(not observed),"bridgeStrength":strength,"surprise":surprise/len(common),
        "temporalEmergence":math.log((recent+1)/(older+1)),"semanticDistance":1-len(common)/len(set(na)|set(nc)),
        "meshTreeDistance":distance,"evidenceStrength":evidence_count,"pathCount":len(common),
        "persistence":persistence/len(common),"contradictionSignal":None}
    result={"A":left,"C":right,"B":[resolve(db,b,cutoff) for b in common],"paths":paths,"metrics":metrics,
        "definitions":DEFINITIONS,"knownBeforeCutoff":bool(observed),"directCount":observed,"firstKnownYear":first,
        "knowledgeCutoff":cutoff,"explorationStart":start,"candidateType":candidate_type,"policyVersion":VERSION,
        "corpusRevision":revision,"eligible":not observed,"evidencePathsShown":len(paths),
        "limitations":["Corpus parcial; coindexação não comprova mecanismo.","Evidências textuais limitadas a títulos.",
            "Indexação de artigos antigos pode ter sido revisada após o corte.",
            "Sem versão MeSH histórica, categorias e distância histórica ficam indisponíveis; filtros exploratórios usam a indexação atual.",
            "Pontes distintas podem compartilhar estudos e não são independência estatística."]}
    result["fingerprint"]=hashlib.sha256(json.dumps(result,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return result


def discover(db, data):
    start,end=validate_period(db,data)
    mode=data.get("mode","open")
    if mode not in ("open","closed","global"): raise ValueError("Modo de descoberta inválido")
    allowed={r["id"] for r in concepts(db,start,end,data.get("q",""),data.get("categories",()),data.get("operator","or"),data.get("seedIds",()),limit=0)["items"]}
    if mode=="closed":
        a,c=resolve(db,data.get('a'))['id'],resolve(db,data.get('c'))['id']
        if a not in allowed or c not in allowed: return {'items':[],'reason':'A ou C fora dos filtros/período'}
        detail=candidate(db,a,c,end,start,data.get("strictHistorical",False))
        return {"items":[detail],"policyVersion":VERSION}
    # Independent scientific budget, not a read of rendered nodes/edges.
    if mode=="open":
        anchor=resolve(db,data.get("a"))["id"]
        if anchor not in allowed: return {"items":[],"reason":"A fora dos filtros/período"}
        anchors=[anchor]
    else:
        anchors=[r["id"] for r in concepts(db,start,end,limit=0)["items"] if r["id"] in allowed][:30]
    scores=defaultdict(lambda:[0,set()])
    cache={}
    def near(mid):
        if mid not in cache:
            cache[mid]=sorted(((b,sum(v.values())) for b,v in neighbours(db,mid,1800,end).items()),key=lambda x:(-x[1],x[0]))[:80]
        return cache[mid]
    for a in anchors:
        for b,ab in near(a):
            if b not in allowed: continue
            for c,bc in near(b):
                if a==c or c not in allowed: continue
                key=(a,c) if mode=="open" else tuple(sorted((a,c)))
                if b not in scores[key][1]:
                    scores[key][0]+=min(ab,bc);scores[key][1].add(b)
    # Check novelty against ALL annual pairs, including edges outside generation budgets.
    items=[]
    for (a,c),(strength,bridges) in sorted(scores.items(),key=lambda item:(-item[1][0],-len(item[1][1]),item[0])):
        if pair_count(db,a,c,end)[0]: continue
        items.append({"A":resolve(db,a,end),"C":resolve(db,c,end),"bridgeIds":sorted(bridges),
            "generationBridgeStrength":strength,"generationPathCount":len(bridges),"rank":len(items)+1,
            "knowledgeCutoff":end,"candidateType":mode})
        if len(items)>=40: break
    return {"items":items,"policyVersion":VERSION,"knowledgeCutoff":end,
        "ranking":"bridgeStrength desc; pathCount desc; IDs asc (geração limitada, não probabilidade)",
        "budget":{"anchors":len(anchors),"neighboursPerNode":80,"results":40},
        "reason":None if items else "Nenhum candidato não observado encontrado no orçamento de geração."}
