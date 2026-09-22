import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateAgentResponse, DEFAULT_AI_MODEL, validateCitations } from "../src/lib/agent-provider.server.ts";
import { temporalSplit, Period } from "../src/lib/temporal.ts";

test("agent uses its server binding and centrally configured model", async()=>{
  let call;
  const binding={run:async(model,input)=>{call={model,input};return {response:'{"title":"fixture"}'};}};
  const result=await generateAgentResponse("scientific system","bounded evidence",binding,"test-model");
  assert.equal(call.model,"test-model");assert.equal(result.model,"test-model");
  assert.equal(call.input.messages[1].content,"bounded evidence");
  assert.ok(DEFAULT_AI_MODEL.startsWith("@cf/"));
  const config=readFileSync(new URL("../vite.config.ts",import.meta.url),"utf8");
  assert.match(config,/binding:\s*"AI"/);
  const frontend=readFileSync(new URL("../src/routes/hypotheses.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(frontend,/API_KEY|agent-provider|cloudflare:workers/);
});
test("agent rejects unsupported citation IDs and malformed output",async()=>{
  assert.throws(()=>validateCitations({text:"PMID 999"},new Set(["123"])),/PMID/);
  validateCitations({text:"PMID 123"},new Set(["123"]));
  await assert.rejects(generateAgentResponse("s","p",{run:async()=>({response:"not JSON"})}),/JSON/);
});
test("one period produces observation and disjoint training/holdout",()=>{
  for (const period of [{startYear:2018,endYear:2018},{startYear:2010,endYear:2020}]) {
    const split=temporalSplit(Period.parse(period),1985,2025);
    assert.deepEqual(split.explorationPeriod,period);
    assert.equal(split.training.endYear+1,split.holdout.startYear);
  }
  assert.equal(Period.safeParse({startYear:2020,endYear:2010}).success,false);
});

test("legacy provider dependencies and credentials are absent from versioned sources",()=>{
  const forbidden=new RegExp(["lova","ble"].join(""),"i");
  const files=execFileSync("git",["ls-files","--cached","--others","--exclude-standard"],{encoding:"utf8"}).trim().split(/\r?\n/);
  for(const file of new Set(files)) {
    if(!/\.(ts|tsx|json|md|toml)$/.test(file)) continue;
    let content;
    try {content=readFileSync(file,"utf8");} catch {continue;}
    assert.equal(forbidden.test(content),false,`legacy reference in ${file}`);
  }
});
