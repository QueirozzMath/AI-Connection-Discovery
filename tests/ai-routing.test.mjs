import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const settings = require("../src/lib/ai-settings.ts");
function load(fetcher, env = {}) {
  const m = { exports: {} };
  const logs = [];
  const js = ts.transpileModule(
    readFileSync(new URL("../src/lib/ai.server.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(js, {
    exports: m.exports,
    module: m,
    require: (id) => (id === "./ai-settings" ? settings : require(id)),
    process: { env },
    fetch: fetcher,
    URL,
    Response,
    TextDecoder,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { warn: (...v) => logs.push(v) },
  });
  return { ...m.exports, logs };
}
const chat = (model = "actual-model", text = '{"ok":true}', finish = "stop") =>
  Response.json({ model, choices: [{ finish_reason: finish, message: { content: text } }] });
const personal = (provider) => ({
  mode: "personal",
  provider,
  model: "selected-model",
  baseUrl: "",
});
test("anonymous default works without credentials and ignores personal settings", async () => {
  const app = load(async (url, init) => {
    assert.match(url, /ovh/);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(JSON.parse(init.body).model, "Meta-Llama-3_3-70B-Instruct");
    return chat();
  });
  const r = await app.askAiJson(
    "instructions",
    "full dossier",
    { ...personal("openai"), mode: "free" },
    "personal-secret",
  );
  assert.equal(r.data.ok, true);
  assert.equal(r.provenance.provider, "ovhcloud");
  assert.equal(r.provenance.model, "actual-model");
});
test("free router enforces zero price and fallback never leaks platform or personal credentials", async () => {
  const seen = [];
  const app = load(
    async (url, init) => {
      seen.push({ url, init });
      if (seen.length === 1) {
        const b = JSON.parse(init.body);
        assert.equal(b.model, "openrouter/free");
        assert.equal(b.provider.max_price.prompt, 0);
        assert.equal(b.provider.max_price.completion, 0);
        return new Response("secret provider error", { status: 503 });
      }
      assert.equal(init.headers.Authorization, undefined);
      return chat();
    },
    { OPENROUTER_API_KEY: "platform-secret" },
  );
  const r = await app.askAiJson("S", "unchanged dossier", undefined, "personal-secret");
  assert.equal(seen.length, 2);
  assert.equal(
    JSON.parse(seen[0].init.body).messages[1].content,
    JSON.parse(seen[1].init.body).messages[1].content,
  );
  assert.equal(r.provenance.attempts.length, 2);
  assert.ok(!JSON.stringify(app.logs).includes("secret"));
});
for (const provider of ["openai", "openrouter", "anthropic", "gemini"])
  test(`${provider}: correct protocol, key isolation and actual provenance`, async () => {
    let calls = 0;
    const app = load(
      async (url, init) => {
        calls++;
        const b = JSON.parse(init.body);
        assert.equal(init.redirect, "error");
        if (provider === "gemini") {
          assert.match(url, /generativelanguage/);
          assert.equal(init.headers["x-goog-api-key"], "visitor-secret");
          assert.equal(b.contents[0].parts[0].text, "evidence");
          return Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [{ thought: true, text: "hidden reasoning" }, { text: '{"ok":true}' }],
                },
              },
            ],
          });
        }
        if (provider === "anthropic") {
          assert.match(url, /api.anthropic.com/);
          assert.equal(init.headers["x-api-key"], "visitor-secret");
          assert.equal(b.system, "S");
          return Response.json({
            model: "claude-actual",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"ok":true}' }],
          });
        }
        assert.equal(init.headers.Authorization, "Bearer visitor-secret");
        assert.equal(b.model, "selected-model");
        if (provider === "openai") assert.equal(b.max_completion_tokens, 8192);
        return chat();
      },
      { OPENROUTER_API_KEY: "platform-secret" },
    );
    const r = await app.askAiJson("S", "evidence", personal(provider), "visitor-secret");
    assert.equal(r.data.ok, true);
    assert.equal(r.provenance.provider, provider);
    assert.equal(calls, 1);
  });
test("personal provider errors never trigger a free fallback or disclose response bodies", async () => {
  let calls = 0;
  const app = load(
    async () => {
      calls++;
      return new Response("visitor-secret", { status: 401 });
    },
    { OPENROUTER_API_KEY: "platform-secret" },
  );
  await assert.rejects(app.askAiJson("S", "P", personal("gemini"), "visitor-secret"), /recusou/);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(app.logs).includes("secret"));
});
for (const [status, message] of [
  [429, /limite/],
  [402, /créditos/],
  [404, /modelo/],
  [400, /formato JSON/],
])
  test(`actionable HTTP ${status}, no unnecessary retries`, async () => {
    let calls = 0;
    const app = load(async () => {
      calls++;
      return new Response("unsafe body", { status });
    });
    await assert.rejects(app.askAiJson("S", "P", personal("openrouter"), "key"), message);
    assert.equal(calls, 1);
  });
test("transient personal failure retries same provider with identical dossier", async () => {
  const calls = [];
  const app = load(async (url, init) => {
    calls.push([url, init.body]);
    return calls.length === 1 ? new Response("", { status: 503 }) : chat();
  });
  const r = await app.askAiJson("S", "complete evidence", personal("openrouter"), "key");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(r.provenance.attempts.length, 2);
});
test("timeout is distinguished from network failure and not retried for personal APIs", async () => {
  let calls = 0;
  const app = load(async () => {
    calls++;
    const e = new Error("secret transport detail");
    e.name = "AbortError";
    throw e;
  });
  await assert.rejects(app.askAiJson("S", "P", personal("gemini"), "key"), /tempo de resposta/);
  assert.equal(calls, 1);
  const net = load(async () => {
    throw new Error("secret transport detail");
  });
  await assert.rejects(net.askAiJson("S", "P"), /conectar ao provedor/);
});
for (const [text, finish] of [
  ["not JSON", "stop"],
  ['{"ok":true}', "length"],
  ['{"ok":true}', "content_filter"],
])
  test(`rejects malformed or incomplete completion ${finish}/${text}`, async () => {
    const app = load(async () => chat("model", text, finish));
    await assert.rejects(app.askAiJson("S", "P", personal("openai"), "key"));
  });
test("custom endpoints require exact owner allowlist, HTTPS and no redirect or credential URL", async () => {
  let calls = 0;
  const app = load(
    async (url, init) => {
      calls++;
      assert.equal(url, "https://inference.example.org/v1/chat/completions");
      assert.equal(init.headers.Authorization, undefined);
      return chat("institution-model");
    },
    { AI_CUSTOM_ENDPOINTS: "https://inference.example.org/v1" },
  );
  for (const baseUrl of [
    "http://localhost:4000/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://169.254.169.254/v1",
    "https://evil.example.org/v1",
    "https://key@inference.example.org/v1",
    "https://inference.example.org/v1?redirect=x",
    "https://inference.example.org/v1/other",
  ]) {
    await assert.rejects(
      app.askAiJson("S", "P", { ...personal("openai"), mode: "custom", baseUrl }),
    );
  }
  assert.equal(calls, 0);
  const result = await app.askAiJson("S", "P", {
    ...personal("openai"),
    mode: "custom",
    baseUrl: "https://inference.example.org/v1/",
  });
  assert.equal(result.provenance.model, "institution-model");
  assert.equal(calls, 1);
});
test("configuration never exposes server secrets", () => {
  const app = load(() => {}, { OPENROUTER_API_KEY: "private-server-secret" });
  assert.ok(!JSON.stringify(app.aiConfiguration()).includes("secret"));
});
