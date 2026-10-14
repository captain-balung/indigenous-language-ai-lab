import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeShortAnswerTranslation } from "../../../certification-mock/beginner-mock-exam/scoring.mjs";
import { activeSemanticJudge, createLlmSemanticJudge, createHeuristicSemanticJudge } from "../../../certification-mock/beginner-mock-exam/semantic-judge.mjs";
import { createResilientSemanticJudge } from "../../../shared/resilient-semantic-judge.mjs";
import { isLlmTransportFailure } from "../../../shared/llm-complete.mjs";
import { dialogueQuestions, qaVerdictLabel } from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = read("apps/basic-learning/qa-practice/index.html");
const appSource = read("apps/basic-learning/qa-practice/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("問答練習"));
assert.ok(page.includes("播放問句"));
assert.ok(page.includes("顯示中文問句"));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'));
assert.ok(page.includes('href="/apps/basic-learning/qa-practice/styles.css"'));
assert.ok(page.includes('src="/apps/basic-learning/qa-practice/app.mjs"'));
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes("對方會看到你的 IP"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(appCode.includes("activeSemanticJudge"));
assert.ok(appCode.includes("judge-rationale") || appSource.includes("rationale"));
assert.ok(page.includes("OpenAI"));
assert.ok(appCode.includes("asr_transcribe") || appSource.includes("transcribe"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode), "不得寫入瀏覽器儲存");
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource), "介面不得使用 emoji");
assert.ok(appCode.includes("prefers-reduced-motion"));
assert.ok(!/\bpoints\b/.test(appCode), "介面不得顯示考試配分");

const junior1 = JSON.parse(read("data/klokah-junior/dialects/1.json"));
const questions = dialogueQuestions(junior1);
assert.ok(questions.length >= 40, `expected many dialogue questions, got ${questions.length}`);
assert.ok(questions.every((item) => item.audioUrl && item.chineseText && item.indigenousText));
assert.equal(dialogueQuestions({}).length, 0);
assert.equal(dialogueQuestions({ dialogue: [{ id: "x", questions: [{ letter: "A", indigenousText: "a", chineseText: "你好嗎？" }] }] }).length, 0);

const yes = judgeShortAnswerTranslation("你好嗎？", "很好");
assert.equal(yes.verdict, "reasonable");
assert.equal(qaVerdictLabel(yes.verdict), "有答到");
assert.equal(qaVerdictLabel("unreasonable"), "再想想");
assert.equal(qaVerdictLabel("undetermined"), "無法判定");

assert.ok(activeSemanticJudge.id.startsWith("llm:"));
assert.ok(isLlmTransportFailure("無法連線 LLM proxy"));
assert.ok(!isLlmTransportFailure("回答沒有對到問句"));

const resilient = createResilientSemanticJudge({
  createLlm: createLlmSemanticJudge,
  createHeuristic: createHeuristicSemanticJudge,
  model: "mock",
  complete: async () => { throw new Error("無法連線 LLM proxy"); },
});
const fallback = await resilient.judgeShortAnswer({
  questionChinese: "你好嗎？",
  translation: "很好",
  transcript: "x",
});
assert.equal(fallback.verdict, "reasonable");
assert.equal(fallback.fallback, "heuristic");
assert.match(String(fallback.rationale ?? ""), /規則粗判/);

const llmOk = createLlmSemanticJudge({
  model: "mock",
  complete: async () => '{"verdict":"reasonable","points":4,"rationale":"有答到"}',
});
assert.equal(
  (await llmOk.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "很好", transcript: "x" })).rationale,
  "有答到",
);

console.log("PASS: qa practice dialogue questions, LLM judge + heuristic fallback, no storage");
