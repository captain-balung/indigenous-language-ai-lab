import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/twelve-translation/index.html");
const app = read("apps/classroom-quiz/twelve-translation/app.mjs");
const engine = read("apps/shared/twelve-engine.mjs");
const data = read("apps/shared/twelve-data.mjs");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes('<h1 id="page-title">十二年國教</h1>'));
assert.ok(page.includes("<title>十二年國教｜族語e樂園 AI 實驗室</title>"));
assert.ok(!page.includes("翻譯（十二年國教）"));
assert.ok(page.includes("課堂測驗 · MISSION 06"));
assert.ok(!page.includes('id="answer-mode-wrap"') && !page.includes('id="answer-mode"'));
assert.ok(page.includes('id="input-mode-toggle"'));
assert.ok(page.includes('id="panel-compose"') && page.includes('id="panel-speech"'));
assert.ok(page.includes('id="answer"') && page.includes('id="submit"'));
assert.ok(page.includes("/apps/shared/twelve.css"));
assert.ok(page.includes("/apps/classroom-quiz/twelve-translation/app.mjs"));
assert.ok(page.includes('href="/apps/classroom-quiz/twelve/"'));
assert.ok(page.includes("回十二年國教選單"));
assert.ok(page.includes("用錄音或打字翻成族語"));
assert.ok(page.includes("作答時可切換錄音或打字"));
assert.ok(page.includes("不適用 CC BY-NC-SA 4.0"));
assert.ok(page.includes("教育部"));

assert.ok(app.includes('boot("translate")'));
assert.ok(engine.includes("wireInputMode"));
assert.ok(engine.includes("applyTranslationMode"));
assert.ok(engine.includes("gradeTyping"));
assert.ok(engine.includes("gradeSpeech"));
assert.ok(engine.includes("judgeAnswer"));
assert.ok(engine.includes("作答前不載入答案音檔"));
assert.ok(engine.includes("pendingAudioUrl"));
assert.ok(engine.includes("打字會把句子送去翻譯"));
assert.ok(!engine.includes("混合（打字＋口說）"));
assert.ok(data.includes('TRANSLATE_ANSWER_MODES = ["typing", "speech"]'));
assert.ok(!page.includes("四選一"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(page + app + engine));

console.log("PASS: twelve translation page, in-page recording/typing toggle, license notice");
