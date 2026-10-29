import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVITIES, LEVELS, ROUND_SIZE, buildRound, draw, levelInfo, levelOptions,
  loadShard, normalizeText, sentencePool, shuffle
} from "../twelve-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const shardDir = path.join(root, "data/twelve/dialects");
const shardFiles = fs.readdirSync(shardDir).filter((name) => name.endsWith(".json")).sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
const shards = shardFiles.map((name) => JSON.parse(fs.readFileSync(path.join(shardDir, name), "utf8")));

assert.equal(LEVELS.length, 9, "只收第 1–9 階");
assert.deepEqual(LEVELS.map((item) => item.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.equal(ROUND_SIZE, 8);
assert.equal(levelOptions().length, 9);
assert.ok(Object.values(ACTIVITIES).every((item) => item.label && item.track && item.mission));
assert.deepEqual(Object.keys(ACTIVITIES).sort(), ["retell", "translate"], "只保留跟唸與翻譯");
assert.equal(ACTIVITIES.retell.track, "基礎學習");
assert.equal(ACTIVITIES.translate.track, "課堂測驗");

assert.equal(normalizeText("  ’inava   u  ziya? "), "'inava u ziya?");
assert.deepEqual(shuffle([1, 2, 3], () => 0.5).sort(), [1, 2, 3]);
const picked = draw([1, 2, 3, 4], 2, () => 0);
assert.equal(picked.length, 2);
assert.equal(new Set(picked).size, 2);
assert.ok(picked.every((value) => [1, 2, 3, 4].includes(value)));
assert.equal(draw([1, 2], 8).length, 2);
assert.equal(levelInfo(1).group, "初級");
assert.equal(levelInfo(9).group, "中高級");
assert.throws(() => levelInfo(10), /沒有第 10 階/);
assert.throws(() => buildRound({ shard: null, level: 1, activity: "unknown" }), /未知的練習類型/);
assert.throws(() => buildRound({ shard: null, level: 1, activity: "translate", answerMode: "four-choice" }), /未知的作答方式/);
assert.throws(() => buildRound({ shard: null, level: 1, activity: "translate", answerMode: "mixed" }), /未知的作答方式/);

assert.equal(shards.length, 42, `預期 42 個方言分片，實得 ${shards.length}`);

for (const shard of shards) {
  assert.equal(shard.levels.length, 9, `${shard.dialectName} 階級數`);
  for (const level of shard.levels) {
    assert.equal(level.lessons.length, 10, `${shard.dialectName} 第 ${level.level} 階課數`);
    assert.ok(level.lessons.every((lesson) => lesson.title && lesson.titleCh), `${shard.dialectName} 第 ${level.level} 階課名`);
    const all = level.lessons.flatMap((lesson) => lesson.sentences);
    assert.ok(all.length >= 8, `${shard.dialectName} 第 ${level.level} 階句數`);
    assert.ok(all.every((sentence) => sentence.id && sentence.indigenousText && sentence.chineseText), `${shard.dialectName} 第 ${level.level} 階欄位`);
    assert.equal(new Set(all.map((sentence) => sentence.id)).size, all.length, `${shard.dialectName} 第 ${level.level} 階重複 id`);

    const audioPool = sentencePool(shard, level.level, { requireAudio: true, key: "indigenous" });
    assert.ok(audioPool.length >= ROUND_SIZE, `${shard.dialectName} 第 ${level.level} 階可出跟唸/發音的句子不足`);
    const translatePool = sentencePool(shard, level.level, { key: "chinese" });
    assert.ok(translatePool.length >= ROUND_SIZE, `${shard.dialectName} 第 ${level.level} 階可出翻譯的句子不足`);

    for (const activity of ["retell"]) {
      const round = buildRound({ shard, level: level.level, activity, size: ROUND_SIZE, random: () => 0.37 });
      assert.equal(round.length, ROUND_SIZE, `${shard.dialectName} 第 ${level.level} 階 ${activity} 題數`);
      assert.equal(new Set(round.map((item) => item.roundId)).size, ROUND_SIZE);
      assert.ok(round.every((item) => item.audioUrl && item.inputMode === "speech"));
    }

    for (const answerMode of ["typing", "speech"]) {
      const round = buildRound({ shard, level: level.level, activity: "translate", answerMode, size: ROUND_SIZE, random: () => 0.37 });
      assert.equal(round.length, ROUND_SIZE, `${shard.dialectName} 第 ${level.level} 階翻譯 ${answerMode} 題數`);
      assert.equal(new Set(round.map((item) => item.chineseText)).size, ROUND_SIZE, "翻譯題目不應重複中文");
      assert.ok(round.every((item) => item.inputMode === answerMode));
    }
  }
}

const dataset = JSON.parse(fs.readFileSync(path.join(root, "data/twelve/dataset.json"), "utf8"));
assert.equal(dataset.dialectCount, 42);
assert.equal(dataset.lessonsPerLevel, 10);
assert.equal(dataset.levels.length, 9);
assert.equal(dataset.recordLayout, "sharded");
assert.equal(dataset.audioPolicy, "hotlinked-at-runtime");
assert.match(dataset.source.license, /非 CC BY-NC-SA/);
assert.ok(dataset.sentenceCount > 18000, `句子總數 ${dataset.sentenceCount}`);

const license = fs.readFileSync(path.join(root, "data/twelve/LICENSE.md"), "utf8");
assert.match(license, /不適用.*CC BY-NC-SA 4\.0/s);
assert.match(license, /教育部/);

const missingAudio = shards.flatMap((shard) => shard.levels.flatMap((level) =>
  level.lessons.flatMap((lesson) => lesson.sentences.filter((sentence) => !sentence.audioUrl))
));
assert.equal(missingAudio.length, dataset.missingAudioCount);
const shard10 = shards.find((shard) => shard.dialectId === 10);
assert.ok(shard10);
assert.ok(!sentencePool(shard10, 4, { requireAudio: true }).some((sentence) => sentence.id === "10-4-1-4"));
assert.ok(sentencePool(shard10, 4).some((sentence) => sentence.id === "10-4-1-4"));

const fakeFetch = async (url) => ({
  ok: url === "/data/twelve/dialects/1.json",
  json: async () => ({ dialectId: 1 })
});
assert.deepEqual(await loadShard(1, fakeFetch), { dialectId: 1 });

console.log(`PASS: twelve data ${shards.length} shards, ${dataset.sentenceCount} sentences, 2 activities × 9 levels`);
