import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pictureTalkRecords } from "../../../basic-learning/describe-practice/core.mjs";
import { ROUND_SIZE, draw } from "../../meaning-sentence/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("apps/classroom-quiz/picture-quiz/index.html");
const app = read("apps/classroom-quiz/picture-quiz/app.mjs");

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("看圖測驗"));
assert.ok(page.includes("課堂測驗 · MISSION 04"));
assert.ok(page.includes("用自己的話描述這些圖"));
assert.ok(page.includes('id="picture-grid"'));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(page.includes('src="/apps/classroom-quiz/picture-quiz/app.mjs"'));
assert.ok(app.includes("pictureTalkRecords"));
assert.ok(app.includes("scorePictureTalk"));
assert.ok(app.includes("draw(pool, ROUND_SIZE)"));
assert.ok(app.includes("question.imageUrls.map"));
assert.ok(!app.includes("singleImageTurns"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(app));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + app));

const junior = JSON.parse(read("data/klokah-junior/dialects/1.json"));
const pool = pictureTalkRecords(junior, {}).beginner.filter((item) => item.imageUrls.length > 1);
const round = draw(pool, ROUND_SIZE, () => 0.2);
assert.equal(pool.length, 1);
assert.equal(round.length, 1);
assert.equal(round[0].imageUrls.length, 4);

console.log("PASS: picture quiz shows the full beginner set, round follows the pool");
