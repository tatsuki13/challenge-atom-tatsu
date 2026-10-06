import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveEmotionState } from "../lib/emotionState.ts";

// Transpile just the server module for Node's native runner; use the real SDK with a mocked HTTP transport.
const source = readFileSync(new URL("../lib/ai/emotionInference.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace('from "openai"', `from ${JSON.stringify(import.meta.resolve("openai"))}`)
  .replace('from "../emotionState"', `from ${JSON.stringify(new URL("../lib/emotionState.ts", import.meta.url).href)}`);
const { inferEmotionState } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const empty = { loneliness: null, anxiety: null, positive_affect: null, interest: null };
const previous = resolveEmotionState({ ...empty, anxiety: 0.6 }, null, null, "openai", "test");

async function withTransport(callback) {
  const saved = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, emotionModel: process.env.OPENAI_EMOTION_MODEL };
  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.OPENAI_MODEL = "test-model";
  delete process.env.OPENAI_EMOTION_MODEL;
  try { await callback(); }
  finally {
    globalThis.fetch = saved.fetch;
    for (const [key, value] of [["OPENAI_API_KEY", saved.key], ["OPENAI_MODEL", saved.model], ["OPENAI_EMOTION_MODEL", saved.emotionModel]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
const input = { message: "不安は変わりません", recentMessages: [{ role: "assistant", content: "今の不安はいかがですか" }], previous, previousMessageId: "previous-message" };

test("SDK sends contextual input and strict schema, then saves equal estimates as estimated", async () => {
  await withTransport(async () => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.properties.anxiety.anyOf[0].maximum, 1);
      assert.equal(JSON.parse(body.input[1].content).latestMessage, input.message);
      assert.equal(JSON.parse(body.input[1].content).recentMessages[0].role, "assistant");
      return new Response(JSON.stringify({ id: "resp_test", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ ...empty, anxiety: 0.6 }), annotations: [] }] }] }), { headers: { "Content-Type": "application/json" } });
    };
    const result = await inferEmotionState(input);
    assert.equal(result.anxiety, 0.6);
    assert.equal(result._analysis.axes.anxiety.status, "estimated");
    assert.equal(result._analysis.axes.loneliness.status, "unestimated");
  });
});

test("malformed output, refusals and incomplete responses preserve prior values as API errors", async () => {
  await withTransport(async () => {
    for (const [status, content] of [["completed", [{ type: "output_text", text: '{"anxiety":2}' }]], ["completed", [{ type: "refusal", refusal: "test" }]], ["incomplete", []]]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ status, output: [{ type: "message", role: "assistant", content }] }), { headers: { "Content-Type": "application/json" } });
      const result = await inferEmotionState(input);
      assert.equal(result.anxiety, 0.6);
      assert.equal(result._analysis.axes.anxiety.status, "held");
      assert.equal(result._analysis.axes.anxiety.reason, "api_error");
    }
  });
});

test("missing configuration does not call the API or invent a new estimate", async () => {
  await withTransport(async () => {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = async () => assert.fail("API must not be called");
    const result = await inferEmotionState(input);
    assert.equal(result.anxiety, 0.6);
    assert.equal(result._analysis.axes.anxiety.reason, "api_unavailable");
  });
});
