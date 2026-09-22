import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mapSearchIndex, selectMapNodes, selectKeywordNodes } from "../src/lib/map-selection.ts";

// Isolated fixture: real article/MeSH records with controlled test dates.
const script = `
import sys,json,gzip,tempfile
from pathlib import Path
sys.path.insert(0,'pipeline')
from map_store import import_file
from map_api import graph_query
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder); db=p/'map.sqlite'; source=p/'input.jsonl.gz'
 with gzip.open('pipeline/cache/pubmed_corpus.jsonl.gz','rt',encoding='utf-8') as f: records=[json.loads(next(f)) for _ in range(60)]
 with gzip.open(source,'wt',encoding='utf-8') as f:
  for i,r in enumerate(records): r['year']=2018+i%2; f.write(json.dumps(r)+'\\n')
 import_file(db,source,json.loads(Path('pipeline/cache/mesh_trees.json').read_text()),json.loads(Path('public/data/graph-2018.json').read_text()))
 print(json.dumps([graph_query(str(db),'fixture',2018,end) for end in (2018,2019)]))
`;
const python = process.env.PYTHON ?? (process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const graphs = JSON.parse(execFileSync(python,["-c",script],{encoding:"utf8",maxBuffer:8*1024*1024}));
for (const [index,graph] of graphs.entries()) {
  test(`global and keyword search respect ${index ? "range" : "single year"}, categories and AND/OR`,()=>{
    const searchIndex=mapSearchIndex(graph);
    const seed=0, text=graph.nodes[seed].label;
    const found=selectMapNodes(graph,searchIndex,text,[],"or");
    assert.ok(found.has(seed));
    const categories=[graph.nodes[seed].cat];
    const allowed=selectMapNodes(graph,searchIndex,"",categories,"or");
    const keywords=selectKeywordNodes(graph,allowed,[seed]);
    assert.ok(keywords.has(seed));
    assert.ok([...keywords].every(i=>allowed.has(i)));
    const cross=graph.edges.find(([a,b])=>graph.nodes[a].cat!==graph.nodes[b].cat);
    assert.ok(cross);
    const cats=cross.slice(0,2).map(i=>graph.nodes[i].cat);
    const or=selectMapNodes(graph,searchIndex,"",cats,"or");
    const and=selectMapNodes(graph,searchIndex,"",cats,"and");
    assert.ok(and.size>0);assert.ok([...and].every(i=>or.has(i)));
    assert.equal(graph.meta.n_articles,index ? 60 : 30);
  });
}
