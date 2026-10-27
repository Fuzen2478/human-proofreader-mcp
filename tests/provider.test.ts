import assert from "node:assert/strict";
import { test } from "node:test";
import { chat, ProviderError, resolveProvider } from "../lib/provider";
import { withRequestContext } from "../lib/context";

test("OpenAI-compatible configuration and wire contract", async (t) => {
  const keys = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT",
    "UPSTAGE_API_KEY", "OPENROUTER_API_KEY"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  for (const key of keys) delete process.env[key];
  assert.throws(resolveProvider, (err) => err instanceof ProviderError && err.code === "no_key");

  process.env.OPENAI_MODEL = "example-model";
  assert.throws(resolveProvider, /OPENAI_API_KEY/);
  process.env.OPENAI_API_KEY = "test-key";
  assert.throws(resolveProvider, /OPENAI_BASE_URL/);
  process.env.OPENAI_BASE_URL = "https://provider.example/v1///";
  delete process.env.OPENAI_MODEL;
  assert.throws(resolveProvider, /OPENAI_MODEL/);
  process.env.OPENAI_MODEL = "example-model";
  process.env.OPENAI_REASONING_EFFORT = "invalid";
  assert.throws(resolveProvider, /OPENAI_REASONING_EFFORT/);
  process.env.OPENAI_REASONING_EFFORT = "max";
  process.env.UPSTAGE_API_KEY = "solar-key";
  const provider = resolveProvider();
  assert.equal(provider.model, "example-model");
  assert.equal(provider.baseUrl, "https://provider.example/v1");
  assert.equal(provider.reasoningEffort, "max");

  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return Response.json({ choices: [{ message: { content: "교정 결과" } }], usage: { total_tokens: 12 } });
  });
  const result = await chat(provider, [{ role: "user", content: "원고" }], { maxTokens: 100, retries: 0 });
  assert.equal(result.text, "교정 결과");
  assert.equal(result.usage?.total_tokens, 12);
  assert.equal(requests[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(requests[0].headers.get("Authorization"), "Bearer test-key");
  assert.equal(requests[0].body.model, "example-model");
  assert.equal(requests[0].body.reasoning_effort, "max");
  assert.equal(requests[0].body.max_completion_tokens, 100);
  assert(!("temperature" in requests[0].body));
  assert(!("max_tokens" in requests[0].body));

  delete process.env.OPENAI_REASONING_EFFORT;
  await chat(resolveProvider(), [{ role: "user", content: "원고" }], { retries: 0 });
  assert.equal(requests[1].body.temperature, 0.4);
  assert.equal(requests[1].body.max_tokens, 16000);
  assert(!("reasoning_effort" in requests[1].body));

  const byok = withRequestContext({
    headers: new Headers({ "x-upstage-api-key": "user-key" }), clientKey: "test",
  }, resolveProvider);
  assert.equal(byok.mode, "byok-upstage");
  assert.equal(byok.apiKey, "user-key");
  assert.equal(byok.reasoningEffort, undefined);
});
