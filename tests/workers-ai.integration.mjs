// Opt-in operator test; never enabled by the normal unit suite.
// AI_TEST_ACCOUNT_ID and AI_TEST_TOKEN are Cloudflare operator credentials,
// not frontend settings or application requirements.
import test from "node:test";
import assert from "node:assert/strict";
import { generateAgentResponse } from "../src/lib/agent-provider.server.ts";

test("configured Workers AI model returns validated JSON", {
  skip: !(process.env.AI_TEST_ACCOUNT_ID && process.env.AI_TEST_TOKEN), timeout:60000,
}, async()=>{
  const binding={run:async(model,input)=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.AI_TEST_ACCOUNT_ID}/ai/run/${model}`,{
      method:"POST",headers:{Authorization:`Bearer ${process.env.AI_TEST_TOKEN}`,"Content-Type":"application/json"},
      body:JSON.stringify({...input,max_tokens:64}),signal:AbortSignal.timeout(45000)});
    assert.equal(response.ok,true);
    const data=await response.json();assert.equal(data.success,true);return data.result;
  }};
  const result=await generateAgentResponse('Return only JSON: {"ok":true}',"Verify JSON formatting only. No scientific claims.",binding);
  assert.equal(result.data.ok,true);
});
