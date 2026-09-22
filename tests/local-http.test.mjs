// Opt-in integration: MAP_TEST_URL=http://127.0.0.1:8083 node --test tests/local-http.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { toJSON, fromCrossJSON } from "seroval";

test("real app server functions use one temporal contract", {skip:!process.env.MAP_TEST_URL,timeout:120000},async()=>{
  const base=process.env.MAP_TEST_URL;
  const source=await (await fetch(`${base}/src/lib/map-api.functions.ts`)).text();
  const ids=[...source.matchAll(/createClientRpc\("([^"]+)"\)/g)].map(m=>m[1]);
  assert.equal(ids.length,4);
  async function call(index,data) {
    const response=await fetch(`${base}/_serverFn/${ids[index]}`,{
      method:data ? "POST" : "GET",headers:{origin:base,"sec-fetch-site":"same-origin","x-tsr-serverFn":"true","content-type":"application/json",accept:"application/json"},
      ...(data ? {body:JSON.stringify(toJSON({data}))} : {})});
    assert.equal(response.status,200);
    const decoded=fromCrossJSON(await response.json(), {refs:new Map()});
    if (decoded.error) throw decoded.error;
    return decoded.result;
  }
  const catalog=await call(0);
  assert.ok(catalog.start<=2018 && catalog.end>=2019);
  for(const period of [{startYear:2018,endYear:2018},{startYear:2019,endYear:2019},{startYear:2010,endYear:2020}]) {
    const graph=await call(1,period);
    assert.equal(graph.meta.period_start,period.startYear);assert.equal(graph.meta.period_end,period.endYear);
    assert.ok(graph.nodes.length>0);
    const articles=await call(2,{...period,meshIds:graph.nodes.slice(0,5).map(n=>n.id)});
    assert.ok(articles.items.length>0);
    assert.ok(articles.items.every(a=>a.year>=period.startYear && a.year<=period.endYear));
  }
  let result;
  for(let i=0;i<90;i++) {
    result=await call(3,{startYear:2018,endYear:2018,operation:"explore"});
    if(result.status==="complete" || result.status==="error") break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(result.status,"complete");assert.equal(result.available,true);assert.ok(result.items.length>0);
});
