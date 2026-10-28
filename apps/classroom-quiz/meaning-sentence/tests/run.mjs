import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeAnswer, semanticMatch } from "../../../basic-learning/body-parts-practice/core.mjs";
import { judgeShortAnswerTranslation } from "../../../certification-mock/beginner-mock-exam/scoring.mjs";
import {
  MODES, ROUND_SIZE, buildRound, composePool, needsAsr, needsAudio,
  oralPool, replyPool, replyVerdict, reportDetail, retellPool, scoreLabel, tally, verdictFromTranslation
} from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const shard = (id) => JSON.parse(read(`data/klokah-junior/dialects/${id}.json`));

assert.equal(verdictFromTranslation({ exact: true, translation: "那是橡皮擦。", chineseText: "那是橡皮擦。" }), "semantic");
assert.equal(verdictFromTranslation({ exact: true, translation: "這是眼睛。", chineseText: "那是橡皮擦。" }), "exact");
assert.equal(verdictFromTranslation({ exact: false, translation: "這是眼睛。", chineseText: "那是橡皮擦。" }), "retry");
assert.equal(replyVerdict(judgeShortAnswerTranslation("你好嗎？", "很好")), "semantic");
assert.equal(replyVerdict(judgeShortAnswerTranslation("你好嗎？", "你好嗎？")), "retry");
assert.equal(replyVerdict({ verdict: "undetermined" }), "unavailable");
assert.equal(semanticMatch("這是眼睛。", "這是眼睛。"), true);

const summary = tally([{ type: "exact" }, { type: "semantic" }, { type: "retry" }, { type: "unavailable" }]);
assert.deepEqual(summary, { passed: 2, scored: 3, skipped: 1, total: 4 });
assert.equal(scoreLabel(summary), "本堂 2 / 3，1 題不計分");
assert.match(reportDetail({ mode: "retell", type: "semantic", heard: "mata", translation: "眼睛" }), /系統聽到：mata/);
assert.match(reportDetail({ mode: "compose", type: "semantic", translation: "眼睛" }), /系統懂成：眼睛/);
assert.match(reportDetail({ mode: "reply", type: "semantic", heard: "很好", translation: "很好" }), /有答到問句/);
assert.equal(reportDetail({ type: "unavailable" }), "這題沒有完成判定");

assert.equal(needsAsr("compose"), false);
assert.equal(needsAsr("reply"), true);
assert.equal(needsAudio("retell"), true);
assert.equal(needsAudio("oral"), false);

const exact = await judgeAnswer({
  answer: "U savuric kiraan.",
  question: { indigenousText: "U savuric kiraan.", chineseText: "那是橡皮擦。" },
  translate() { throw new Error("看圖口說字面一致不該翻譯"); }
});
assert.equal(exact.type, "exact");
assert.equal(exact.apiCalls, 0);

for (const id of fs.readdirSync(path.join(root, "data/klokah-junior/dialects")).filter((name) => name.endsWith(".json"))) {
  const data = shard(id.replace(".json", ""));
  assert.ok(composePool(data).length >= ROUND_SIZE, `${id} compose`);
  assert.ok(oralPool(data).length >= ROUND_SIZE, `${id} oral`);
  assert.ok(retellPool(data).length >= ROUND_SIZE, `${id} retell`);
  assert.ok(replyPool(data).length >= ROUND_SIZE, `${id} reply`);
  for (const mode of ["compose", "oral", "retell", "reply"]) {
    const round = buildRound(data, mode, () => 0.3);
    assert.equal(round.length, ROUND_SIZE, `${id} ${mode}`);
    assert.ok(round.every((item) => item.mode === mode && item.chineseText));
    if (mode === "retell" || mode === "reply") assert.ok(round.every((item) => item.audioUrl));
    if (mode === "oral") assert.ok(round.every((item) => item.imageSrc));
  }
}

const units = [
  ["compose", "meaning-sentence"],
  ["oral", "picture-speaking-quiz"],
  ["retell", "listen-retell"],
  ["reply", "question-reply"]
];
const pages = Object.fromEntries(units.map(([mode, folder]) => [mode, read(`apps/classroom-quiz/${folder}/index.html`)]));
const page = Object.values(pages).join("\n");
const app = read("apps/classroom-quiz/meaning-sentence/engine.mjs");
for (const [mode, folder] of units) {
  assert.ok(pages[mode].includes(`/apps/classroom-quiz/${folder}/app.mjs`), folder);
  assert.ok(pages[mode].includes(`/apps/classroom-quiz/${folder}/styles.css`), folder);
  assert.ok(read(`apps/classroom-quiz/${folder}/app.mjs`).includes(`boot("${mode}")`), folder);
}
assert.ok(pages.compose.includes("用族語寫出這個意思"));
assert.ok(pages.oral.includes('id="question-image"'));
assert.ok(!pages.retell.includes("播放短句"));
assert.ok(pages.retell.includes(">播放<") && pages.reply.includes(">播放問句<"));
assert.ok(page.includes('lang="zh-Hant"') && page.includes("CC BY-NC-SA 4.0"));
assert.ok(Object.values(pages).every((html) => html.includes('class="task-brief"') && html.includes("怎麼玩")), "四個課堂頁都要有怎麼玩");
assert.ok(!page.includes("聽寫快問快答") && !page.includes("句子排列所") && !page.includes("本堂挑戰卷"));
assert.ok(!page.includes("?mode="));
assert.ok(app.includes("verdictFromTranslation"));
assert.ok(app.includes("replyVerdict"));
assert.ok(app.includes("judgeAnswer"));
assert.ok(app.includes("activeSemanticJudge"));
assert.ok(app.includes("prefers-reduced-motion"));
assert.ok(app.includes("<dt>辨識</dt>"), "口說結果區必須併入辨識文字");
assert.ok(!app.includes("系統聽到的是"), "不得再使用獨立系統聽到區");
assert.ok(!page.includes('id="heard"'), "三個口說頁面不得再有獨立 #heard");
assert.ok(!app.includes("scrambleDecision"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(app));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + app));
assert.ok(Object.values(MODES).every((item) => item.title && item.mission && item.track));
assert.deepEqual(Object.keys(MODES), ["compose", "oral", "retell", "reply"]);
assert.equal(MODES.oral.title, "發音練習");
assert.equal(MODES.oral.mission, "01");
assert.equal(MODES.compose.mission, "02");
assert.equal(MODES.reply.title, "問答測驗");
assert.equal(MODES.reply.mission, "03");
assert.equal(MODES.retell.title, "跟唸");
assert.equal(MODES.retell.track, "基礎學習");
assert.equal(MODES.retell.mission, "01");
assert.ok(app.includes("${modeInfo.track}"));
assert.ok(pages.oral.includes("發音練習") && pages.oral.includes("MISSION 01"));
assert.ok(pages.compose.includes("MISSION 02"));
assert.ok(pages.reply.includes("問答測驗") && pages.reply.includes("MISSION 03"));
assert.ok(pages.retell.includes("跟唸") && pages.retell.includes("基礎學習 · MISSION 01"));

console.log("PASS: classroom quiz compose, retell, reply, oral round size, no storage");


/* ───── AI 意思判別（semantic-meaning.mjs，compose／retell／oral 共用）──── */

{
  const { judgeAiMeaning } = await import("../../../shared/semantic-meaning.mjs");
  const engineSource = read("apps/classroom-quiz/meaning-sentence/engine.mjs").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // reasonable → 過；unreasonable／undetermined／失敗 → null（呼叫端維持 retry）。
  assert.deepEqual(
    await judgeAiMeaning({ translation: "那是我的眼睛", targetChinese: "這是我的眼睛。", complete: async () => '{"verdict":"reasonable","rationale":"同一件事"}' }),
    { pass: true, reason: "reasonable", rationale: "同一件事" },
  );
  assert.equal(
    (await judgeAiMeaning({ translation: "那是我的鼻子", targetChinese: "這是我的眼睛。", complete: async () => '{"verdict":"unreasonable","rationale":"x"}' })).reason,
    "rejected",
  );
  assert.equal(
    (await judgeAiMeaning({ translation: "那是我的眼睛", targetChinese: "這是我的眼睛。", complete: async () => { throw new Error("LLM proxy 逾時"); } })).reason,
    "failed",
  );

  // engine：三個模式都接上 AI 補判，且只在 retry 時、失敗維持 retry。
  assert.ok(engineSource.includes('import { judgeAiMeaning }'), "engine 要 import judgeAiMeaning");
  assert.ok(engineSource.includes("judgeAiMeaning({ translation"), "compose／retell 要在 retry 時問 AI");
  assert.ok(engineSource.includes('aiJudge: judgeAiMeaning'), "oral 模式要把 AI 判別帶進 judgeAnswer");
  assert.ok(engineSource.includes("AI 判別中"), "AI 判別期間要有狀態提示");
  console.log("PASS: classroom quiz AI meaning layer (retry-only upgrade, failure keeps rule result)");
}
