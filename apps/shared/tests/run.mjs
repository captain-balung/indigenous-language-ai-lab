import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { complete, DEFAULT_LLM_MODEL, isLlmTransportFailure, LLM_COMPLETE_PATH } from "../llm-complete.mjs";
import { createResilientSemanticJudge } from "../resilient-semantic-judge.mjs";
import {
  createHeuristicSemanticJudge,
  createLlmSemanticJudge,
} from "../../certification-mock/beginner-mock-exam/semantic-judge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
assert.ok(fs.existsSync(path.join(root, "api/llm-complete.mjs")));
assert.ok(fs.existsSync(path.join(root, "api/llm-complete.php")));
assert.ok(fs.existsSync(path.join(root, ".env.example")));
assert.equal(DEFAULT_LLM_MODEL, "gpt-4o-mini");
assert.equal(LLM_COMPLETE_PATH, "/api/llm-complete");

assert.ok(isLlmTransportFailure("未設定 OPENAI_API_KEY"));
assert.ok(isLlmTransportFailure("LLM proxy 逾時"));
assert.ok(isLlmTransportFailure("OpenAI 請求失敗：HTTP 502"));
assert.ok(!isLlmTransportFailure("回答與問句無關"));
assert.ok(!isLlmTransportFailure("沒有譯文"));

await assert.rejects(
  () => complete({ system: "", user: "hi" }),
  /system/,
);

const resilient = createResilientSemanticJudge({
  createLlm: createLlmSemanticJudge,
  createHeuristic: createHeuristicSemanticJudge,
  model: "mock",
  complete: async () => { throw new Error("未設定 OPENAI_API_KEY"); },
});
const short = await resilient.judgeShortAnswer({
  questionChinese: "你好嗎？",
  translation: "很好",
  transcript: "x",
});
assert.equal(short.verdict, "reasonable");
assert.equal(short.fallback, "heuristic");

const llm = createLlmSemanticJudge({
  model: "mock",
  complete: async ({ system, user }) => {
    assert.ok(system.includes("簡答題"));
    assert.ok(user.includes("中文譯文"));
    return '{"verdict":"unreasonable","points":0,"rationale":"複誦問句"}';
  },
});
assert.equal(
  (await llm.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "你好嗎", transcript: "x" })).verdict,
  "unreasonable",
);

console.log("PASS: shared llm-complete + resilient semantic judge");
