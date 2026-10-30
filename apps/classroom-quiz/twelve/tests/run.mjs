import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/twelve/index.html");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("<h1>十二年國教</h1>"));
assert.ok(page.includes("<title>十二年國教｜族語e樂園 AI 實驗室</title>"));
assert.ok(page.includes("發音練習"));
assert.ok(page.includes("翻譯"));
assert.ok(page.includes('href="/apps/classroom-quiz/twelve-pronunciation/"'));
assert.ok(page.includes('href="/apps/classroom-quiz/twelve-translation/"'));
assert.ok(page.includes("第 1–9 階"));
assert.ok(page.includes("每種一輪 8 題"));
assert.ok(page.includes("不適用 CC BY-NC-SA 4.0"));
assert.ok(page.includes("教育部"));
assert.ok(page.includes("IP 位址"));
assert.ok(fs.existsSync(path.join(root, "apps/classroom-quiz/twelve-pronunciation/index.html")));
assert.ok(fs.existsSync(path.join(root, "apps/classroom-quiz/twelve-translation/index.html")));

console.log("PASS: twelve classroom hub links to pronunciation and translation");
