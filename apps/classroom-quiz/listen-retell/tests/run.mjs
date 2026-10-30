import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/listen-retell/index.html");
const app = read("apps/classroom-quiz/listen-retell/app.mjs");
const engine = read("apps/classroom-quiz/meaning-sentence/engine.mjs");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("跟唸"));
assert.ok(page.includes("基礎學習 · MISSION 01"));
assert.ok(page.includes('id="panel-audio"') && page.includes('id="panel-speech"'));
assert.ok(page.includes('class="hint-toggle"') && page.includes('aria-expanded="false"') && page.includes('aria-controls="hint-panel"'), "跟唸需有預設收合的看提示");
assert.ok(page.includes('id="hint-panel" class="sentence-hint" hidden'));
assert.ok(page.includes('data-hint="chinese"') && page.includes('data-hint="indigenous"'), "提示需提供中文與族語");
assert.ok(page.includes("/apps/shared/hint.css"));
assert.ok(page.includes('id="replay"') && page.indexOf('id="replay"') < page.indexOf('id="hint-panel"'), "題目播放鈕留在提示區外");
assert.ok(app.includes('boot("retell")'));
assert.ok(engine.includes("createHintPanel") && engine.includes("hint.render") && engine.includes("hint.close"));

console.log("PASS: listen-retell page adds a collapsed Chinese/indigenous hint");
