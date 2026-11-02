import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/alphabet-pronunciation/index.html");
const app = read("apps/classroom-quiz/alphabet-pronunciation/app.mjs");
const home = read("app.js");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes('<h1 id="page-title">字母篇</h1>'));
assert.ok(page.includes("<title>字母篇｜族語e樂園 AI 實驗室</title>"));
assert.ok(!page.includes('id="level"'), "字母篇沒有階級");
assert.ok(page.includes('id="question-image"'), "發音練習要顯示例詞圖");
assert.ok(page.indexOf('id="question-subtext"') < page.indexOf('id="question-text"'), "字母要顯示在單詞上面");
assert.ok(!page.includes('id="hint-toggle"') && !page.includes('id="hint-panel"'), "課堂發音練習不得有看提示");
assert.ok(!page.includes("看提示"));
assert.ok(!page.includes('id="input-mode-toggle"'), "發音練習只提供錄音，不提供打字切換");
assert.ok(page.includes('id="panel-audio" class="audio-card" hidden'));
assert.ok(page.indexOf('id="result"') < page.indexOf('id="panel-audio"'));
assert.ok(page.includes("播放範例") && page.includes("作答後可播放範例"));
assert.ok(page.includes("IP 位址"));
assert.ok(!page.includes("不適用 CC BY-NC-SA 4.0"));
assert.ok(!page.includes("/apps/classroom-quiz/twelve/"), "字母篇發音練習不經過十二年國教選單");
assert.ok(app.includes('boot("pronounce", engineOptions("pronounce"))'));
assert.ok(home.includes('["字母篇", "看字母篇的圖片和族語文字，錄音念出來。"'));
assert.ok(home.includes("apps/classroom-quiz/alphabet-pronunciation/"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(page + app));

console.log("PASS: alphabet pronunciation is titled 字母篇 and has no hint");
