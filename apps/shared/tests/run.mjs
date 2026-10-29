import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { complete, DEFAULT_LLM_MODEL, isLlmTransportFailure, LLM_COMPLETE_PATH } from "../llm-complete.mjs";
import { createResilientSemanticJudge } from "../resilient-semantic-judge.mjs";
import { wireInputMode } from "../input-mode.mjs";
import {
  createHeuristicSemanticJudge,
  createLlmSemanticJudge,
} from "../../certification-mock/beginner-mock-exam/semantic-judge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
assert.ok(fs.existsSync(path.join(root, "apps/shared/input-mode.mjs")));
assert.ok(fs.existsSync(path.join(root, "api/llm-complete.mjs")));
assert.ok(fs.existsSync(path.join(root, ".env.example")));
assert.equal(DEFAULT_LLM_MODEL, "google/gemma-4-26B-A4B-it");
assert.equal(LLM_COMPLETE_PATH, "/api/llm-complete");

assert.ok(isLlmTransportFailure("未設定 LLM_BASE_URL"));
assert.ok(isLlmTransportFailure("LLM proxy 逾時"));
assert.ok(isLlmTransportFailure("LLM 請求失敗：HTTP 502"));
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
  complete: async () => { throw new Error("未設定 LLM_BASE_URL"); },
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

{
  const toggle = {
    dataset: {},
    setAttribute() {},
    innerHTML: "",
    addEventListener(_type, fn) { this._click = fn; }
  };
  const typePanel = { hidden: false };
  const voicePanel = { hidden: true };
  const host = { dataset: {} };
  let changed = null;
  const api = wireInputMode({
    root: host,
    toggle,
    typePanel,
    voicePanel,
    onModeChange(mode) { changed = mode; }
  });
  assert.equal(api.mode(), "voice");
  assert.equal(typePanel.hidden, true);
  assert.equal(voicePanel.hidden, false);
  assert.equal(host.dataset.inputMode, "voice");
  assert.equal(toggle.dataset.mode, "voice");
  assert.equal((toggle.innerHTML.match(/<svg/g) || []).length, 2);
  assert.ok(!toggle.innerHTML.includes("錄音") && !toggle.innerHTML.includes("打字"));
  assert.match(toggle.innerHTML, /input-mode-toggle__thumb/);
  toggle._click();
  assert.equal(api.mode(), "type");
  assert.equal(changed, "type");
  assert.equal(toggle.dataset.mode, "type");
  assert.equal(typePanel.hidden, false);
  assert.equal(voicePanel.hidden, true);
  assert.match(toggle.innerHTML, /svg/i);
}

await import("./twelve-data.test.mjs");

console.log("PASS: shared llm-complete + resilient semantic judge + input-mode + twelve data");
