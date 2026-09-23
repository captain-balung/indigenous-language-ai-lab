import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeAnswer, semanticMatch } from "../../body-parts-practice/core.mjs";
import { judgeShortAnswerTranslation } from "../../beginner-mock-exam/scoring.mjs";
import {
  MODES, ROUND_SIZE, buildRound, composePool, modeFromSearch, needsAsr, needsAudio,
  oralPool, replyPool, replyVerdict, reportDetail, retellPool, scoreLabel, tally, verdictFromTranslation
} from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
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

assert.equal(modeFromSearch("?mode=retell"), "retell");
assert.equal(modeFromSearch("?mode=dictation"), "compose");
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

const page = read("apps/classroom-quiz/index.html");
const app = read("apps/classroom-quiz/app.mjs");
assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("用族語寫出這個意思"));
assert.ok(page.includes("播放"));
assert.ok(page.includes("對方會看到你的 IP 位址"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(!page.includes("聽寫快問快答") && !page.includes("句子排列所") && !page.includes("本堂挑戰卷"));
assert.ok(app.includes("verdictFromTranslation"));
assert.ok(app.includes("replyVerdict"));
assert.ok(app.includes("judgeAnswer"));
assert.ok(app.includes("judgeShortAnswerTranslation"));
assert.ok(app.includes("prefers-reduced-motion"));
assert.ok(!app.includes("scrambleDecision"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(app));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + app));
assert.ok(Object.values(MODES).every((item) => item.title && item.mission));
assert.deepEqual(Object.keys(MODES), ["compose", "oral", "retell", "reply"]);

console.log("PASS: classroom quiz compose, retell, reply, oral round size, no storage");
