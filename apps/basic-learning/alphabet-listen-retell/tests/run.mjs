import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/basic-learning/alphabet-listen-retell/index.html");
const app = read("apps/basic-learning/alphabet-listen-retell/app.mjs");
const home = read("app.js");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes('<h1 id="page-title">字母篇</h1>'));
assert.ok(page.includes("<title>字母篇｜族語e樂園 AI 實驗室</title>"));
assert.ok(!page.includes("跟唸（字母篇）"));
assert.ok(!page.includes('id="level"'), "字母篇沒有階級");
assert.ok(page.includes('id="letter-cards"'), "要用字母圖卡選字母");
assert.ok(!page.includes('<select id="letter"'), "字母不得用下拉選單");
assert.ok(page.includes('id="hint-toggle"') && page.includes('id="hint-panel"'));
assert.ok(page.includes("看提示"));
assert.ok(page.includes("CC BY-NC-SA 4.0") || page.includes("創用CC 姓名標示－非商業性－相同方式分享 4.0"));
assert.ok(page.includes("IP 位址"));
assert.ok(!page.includes("不適用 CC BY-NC-SA 4.0"));
assert.ok(app.includes('boot("retell", engineOptions("retell"))'));
assert.ok(home.includes('["字母篇", "聽字母篇的例詞，再用族語跟唸一次。"'));
assert.ok(home.includes("apps/basic-learning/alphabet-listen-retell/"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(page + app));

console.log("PASS: alphabet listen-retell is titled 字母篇 and follows the retell page");
