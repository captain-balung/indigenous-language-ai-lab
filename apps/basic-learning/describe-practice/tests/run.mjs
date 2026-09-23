import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanticMatch } from "../../body-parts-practice/core.mjs";
import { LEVELS, describeCaption, pictureTalkRecords } from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = read("apps/basic-learning/describe-practice/index.html");
const appSource = read("apps/basic-learning/describe-practice/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("看圖描述"));
assert.ok(page.includes("用自己的話描述這些圖"));
assert.ok(page.includes('id="picture-grid"'));
assert.ok(page.includes("初級看圖說話") || page.includes("看圖說話"));
assert.ok(page.includes("看圖表達"));
assert.ok(page.includes('id="answer"'));
assert.ok(!page.includes('id="question-image"'));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'));
assert.ok(page.includes('href="/apps/basic-learning/describe-practice/styles.css"'));
assert.ok(page.includes('src="/apps/basic-learning/describe-practice/app.mjs"'));
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes("對方會看到你的 IP"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(appCode.includes("semanticMatch"));
assert.ok(appCode.includes("pictureTalkRecords"));
assert.ok(appCode.includes("transcribe"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode), "不得寫入瀏覽器儲存");
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource), "介面不得使用 emoji");
assert.ok(appCode.includes("prefers-reduced-motion"));

assert.equal(LEVELS.length, 2);
const junior1 = JSON.parse(read("data/klokah-junior/dialects/1.json"));
const senior1 = JSON.parse(read("data/klokah-senior/dialects/1.json"));
const pools = pictureTalkRecords(junior1, senior1);
assert.equal(pools.beginner.length, 1);
assert.equal(pools.beginner[0].imageUrls.length, 4);
assert.ok(pools.beginner[0].imageUrls.every((url) => url.includes("/pictureTalk/")));
assert.equal(pools.intermediate.length, 2);
assert.equal(pools.intermediate[0].imageUrls.length, 1);
assert.ok(pools.intermediate[0].imageUrls[0].includes("/sp_senior/"));
assert.equal(pictureTalkRecords({}, {}).beginner.length, 0);

const caption = describeCaption({ translation: "我喜歡去學校。", matched: semanticMatch("我喜歡去學校。", "我喜歡去學校。") });
assert.equal(caption.headline, "系統懂成");
assert.equal(caption.translation, "我喜歡去學校。");
assert.ok(caption.aside.includes("教材參考說明"));

console.log("PASS: describe practice uses certification picture-talk items");
