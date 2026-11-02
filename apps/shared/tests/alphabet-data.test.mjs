import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRound, engineOptions } from "../alphabet-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const shardDir = path.join(root, "data/alphabet/dialects");
const names = fs.readdirSync(shardDir).filter((name) => name.endsWith(".json"));
assert.equal(names.length, 42);

const shard = JSON.parse(fs.readFileSync(path.join(shardDir, "1.json"), "utf8"));
const round = buildRound({ shard, activity: "retell", random: () => 0 });
assert.equal(round.length, 8);
assert.ok(round.every((item) => item.indigenousText && item.chineseText && item.audioUrl && item.lessonTitleCh.startsWith("字母 ")));
assert.equal(new Set(round.map((item) => item.indigenousText)).size, 8);

const letter = shard.levels[0].lessons[0];
const focused = buildRound({ shard, activity: "retell", letter: letter.lesson, random: () => 0 });
assert.ok(focused.length > 0 && focused.length <= letter.sentences.length);
assert.ok(focused.every((item) => item.lesson === letter.lesson && item.lessonTitle === letter.title));

const retell = engineOptions("retell");
const pronounce = engineOptions("pronounce");
assert.equal(retell.heading, "字母篇");
assert.equal(pronounce.heading, "字母篇");
assert.equal(retell.pickLetter, true);
assert.equal(retell.fixedLevel, 0);
assert.equal(pronounce.pickLetter, false);
assert.equal(pronounce.fixedLevel, 1);
assert.equal(retell.letterImage(1, letter.lesson), `https://klokah.tw/extension/ab_data/image/1/1A${letter.lesson}_1.png`);
assert.equal(retell.unitLabel(round[0]), round[0].lessonTitleCh);

console.log("PASS: alphabet shards draw an 8-word round, or one letter when chosen");
