import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/twelve-pronunciation/index.html");
const app = read("apps/classroom-quiz/twelve-pronunciation/app.mjs");
const engine = read("apps/shared/twelve-engine.mjs");
const data = read("apps/shared/twelve-data.mjs");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes('<h1 id="page-title">十二年國教</h1>'));
assert.ok(page.includes("<title>十二年國教｜族語e樂園 AI 實驗室</title>"));
assert.ok(page.includes("課堂測驗 · MISSION 05"));
assert.ok(page.includes('<p id="question-text"></p>'));
assert.ok(page.includes('<p id="question-subtext" hidden></p>'));
assert.ok(!page.includes('id="hint-toggle"') && !page.includes('id="hint-panel"'), "課堂發音練習不得有看提示");
assert.ok(!page.includes("看提示"));
assert.ok(page.includes('id="panel-audio" class="audio-card" hidden'), "作答前不得顯示教材範例");
assert.ok(page.indexOf('id="result"') < page.indexOf('id="panel-audio"'), "教材範例必須放在作答結果之後");
assert.ok(page.includes('id="panel-audio"') && page.includes('id="panel-speech"'));
assert.ok(page.includes("播放範例") && page.includes("作答後可播放範例"));
assert.ok(page.includes("直接錄音"));
assert.ok(!page.includes('id="input-mode-toggle"'), "發音練習只提供錄音，不提供打字切換");
assert.ok(page.includes('id="panel-compose" hidden'));
assert.ok(page.includes("/apps/shared/twelve.css"));
assert.ok(page.includes("/apps/classroom-quiz/twelve-pronunciation/app.mjs"));
assert.ok(page.includes('href="/apps/classroom-quiz/twelve/"'));
assert.ok(page.includes("不適用 CC BY-NC-SA 4.0"));
assert.ok(page.includes("教育部"));
assert.ok(page.includes("IP 位址"));

assert.ok(app.includes('boot("pronounce")'));
assert.ok(engine.includes('pronounce: ["發音", "看族語文字，錄音念出來"]'));
assert.ok(engine.includes('const deferAudio = activity === "translate" || activity === "pronounce"'));
assert.ok(engine.includes('if (activity === "translate" || activity === "pronounce")'));
assert.ok(engine.includes('pronounce: "作答後可播放範例"'));
assert.ok(engine.includes('activity === "pronounce" ? "可播放教材範例"'));
assert.ok(!engine.includes('pronounce: "想聽範例再按"'));
assert.ok(!engine.includes("音檔無法播放，可直接看句子錄音"));
assert.ok(data.includes('label: "發音練習"'));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(page + app + engine));

console.log("PASS: twelve pronunciation has no hint; example audio appears only after grading");
