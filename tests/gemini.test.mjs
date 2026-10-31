import test from "node:test";
import assert from "node:assert/strict";
import { askGeminiJson, resolveGeminiKey, geminiConfiguration } from "../src/lib/gemini.server.ts";

test("Gemini configuration exposes no key and supports session and server keys", () => {
  const previous = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.throws(() => resolveGeminiKey(), /Informe sua chave/);
    process.env.GEMINI_API_KEY = "server-secret";
    assert.deepEqual(geminiConfiguration(), { configured: true, model: "gemini-3.8-flash" });
    assert.equal(resolveGeminiKey(), "server-secret");
    assert.equal(resolveGeminiKey(" session-secret "), "session-secret");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("Gemini POST uses a header key, structured JSON, and excludes reasoning text", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(!url.includes("secret"));
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-goog-api-key"], "session-secret");
    const body = JSON.parse(options.body);
    assert.equal(body.systemInstruction.parts[0].text, "system");
    assert.equal(body.contents[0].parts[0].text, "prompt");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "internal" }, { text: '{"hypothesis":"example"}' },
    ] } }] });
  });
  assert.deepEqual(await askGeminiJson("system", "prompt", "session-secret"), { hypothesis: "example" });
});

for (const [status, expected] of [[403, /recusou/], [429, /cota/], [404, /modelo/], [503, /indisponível/]]) {
  test(`Gemini ${status} returns actionable errors without provider secrets`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "session-secret" } }, { status }));
    await assert.rejects(askGeminiJson("system", "prompt", "session-secret"), (error) => {
      assert.match(error.message, expected);
      assert.ok(!error.message.includes("session-secret"));
      return true;
    });
  });
}

test("invalid and incomplete Gemini output never becomes a hypothesis", async (t) => {
  for (const candidate of [
    { finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } },
    { finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [candidate] }));
    await assert.rejects(askGeminiJson("system", "prompt", "session-secret"));
    t.mock.restoreAll();
  }
});
