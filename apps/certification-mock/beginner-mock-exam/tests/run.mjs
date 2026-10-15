import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECTS } from "../../../basic-learning/body-parts-practice/dialects.mjs";
import {
  SECTION_SPECS, sectionSpecById, createRng, seedToPaperId, paperIdToSeed,
  pickOne, shuffle, createPaper, flattenPaper,
} from "../paper.mjs";
import { preferFirstAlt } from "../../../shared/prefer-first-alt.mjs";
import { OFFICIAL, SPEAKING_COVERAGE_NOTE, POINT_SCHEME, judgeWordReading, judgeShortAnswerTranslation, scorePictureTalkTranslation, gradePaper } from "../scoring.mjs";
import { activeSemanticJudge, createHeuristicSemanticJudge, createLlmSemanticJudge } from "../semantic-judge.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, encodeWav, readAsrText, ASR_TARGET_SAMPLE_RATE } from "../../../basic-learning/body-parts-speaking/asr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataRoot = path.join(root, "data/klokah-junior");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

const scoringSource = read("apps/certification-mock/beginner-mock-exam/scoring.mjs");
const paperSource = read("apps/certification-mock/beginner-mock-exam/paper.mjs");

// 註解裡會提到這些名字（「不呼叫 Math.random」之類），檢查程式碼時要先把註解拿掉。
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const paperCode = stripComments(paperSource);
const scoringCode = stripComments(scoringSource);

const page = read("apps/certification-mock/beginner-mock-exam/index.html");
const appSource = read("apps/certification-mock/beginner-mock-exam/app.mjs");
const appCode = stripComments(appSource);
const recorderSource = read("apps/certification-mock/beginner-mock-exam/recorder.mjs");
const recorderCode = stripComments(recorderSource);

/* ══════════ 1. 資料契約 ══════════ */

const dataset = readJson("data/klokah-junior/dataset.json");
assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.dialectCount, 42);
assert.equal(dataset.recordLayout, "sharded");
assert.equal(dataset.shardPath, "dialects/{dialectId}.json");
assert.equal(dataset.audioBase, "https://klokah.tw/extension/sp_junior/sound");
assert.equal(dataset.audioPolicy, "hotlinked-at-runtime");
assert.equal(dataset.source.license, "CC BY-NC-SA 4.0");
assert.equal(dataset.classes.length, 25, "四大聽力題型 + 單詞 + 簡短對話 + 看圖說話共 25 個類別");

// dataset 的方言別必須與 dialects.mjs 完全一致（同一組 id、同一組族名）。
assert.deepEqual(dataset.dialects.map((d) => d.id), DIALECTS.map((d) => d.id));
for (const entry of dataset.dialects) {
  const dialect = DIALECTS.find((d) => d.id === entry.id);
  assert.equal(entry.name, dialect.name, `方言 ${entry.id} 的名稱與 dialects.mjs 不符`);
  assert.equal(entry.ethnicity, dialect.ethnicity, `方言 ${entry.id} 的族別與 dialects.mjs 不符`);
}

// 每個類別的預期題數；exceptions 是來源本身的差異，必須明列而非放寬。
const expectedItems = (spec, dialectId) => spec.exceptions?.[String(dialectId)] ?? spec.exceptions?.[dialectId] ?? spec.itemsPerDialect;
const wordClassFive = dataset.classes.find((c) => c.family === "word" && c.classId === 5);
assert.equal(wordClassFive.itemsPerDialect, 11);
assert.equal(expectedItems(wordClassFive, 5), 9, "恆春阿美語的 word/5 只有 9 筆，必須明列為例外");
assert.equal(expectedItems(wordClassFive, 1), 11);

const audioUrlPattern = /^https:\/\/klokah\.tw\/extension\/sp_junior\/sound\/\d+\/(1word|3recognize|4choiceOne|5choiceTwo|6match|9dialogue|10pictureTalk)\/[\w-]+\.mp3$/;
const imageExists = (imagePath) => fs.existsSync(path.join(dataRoot, imagePath));

const shards = new Map();
for (const dialect of DIALECTS) {
  const shard = readJson(`data/klokah-junior/dialects/${dialect.id}.json`);
  shards.set(dialect.id, shard);

  assert.equal(shard.dialectId, dialect.id);
  assert.equal(shard.dialectName, dialect.name);
  assert.equal(shard.ethnicity, dialect.ethnicity);

  // 逐家族比對 dataset.classes 算出來的預期數。
  for (const family of ["recognize", "choiceOne", "choiceTwo", "match", "word", "dialogue", "pictureTalk"]) {
    const expected = dataset.classes
      .filter((spec) => spec.family === family)
      .reduce((sum, spec) => sum + expectedItems(spec, dialect.id), 0);
    assert.equal(shard[family].length, expected, `${dialect.name} 的 ${family} 應有 ${expected} 筆`);
    assert.equal(shard.counts[family], expected, `${dialect.name} 的 counts.${family} 與實際筆數不符`);
  }

  const checkText = (entry, where) => {
    assert.ok(entry.indigenousText && entry.indigenousText.trim(), `${where} 的族語欄位是空的`);
    assert.ok(entry.chineseText && entry.chineseText.trim(), `${where} 的中文欄位是空的`);
  };

  for (const record of shard.recognize) {
    checkText(record, `${dialect.name} recognize ${record.id}`);
    assert.match(record.audioUrl, audioUrlPattern);
    assert.ok(record.audioUrl.includes(`/sound/${dialect.id}/`), "audioUrl 的方言別必須與分片一致");
    assert.ok(imageExists(record.imagePath), `找不到圖片 ${record.imagePath}`);
  }
  for (const record of shard.word) {
    checkText(record, `${dialect.name} word ${record.id}`);
    assert.match(record.audioUrl, audioUrlPattern);
    assert.equal(record.imagePath, undefined, "單詞朗讀不該有圖片");
  }
  for (const item of shard.choiceOne) {
    assert.equal(item.options.length, 3);
    assert.equal(new Set(item.options.map((o) => o.imagePath)).size, 3, `${item.id} 的三個選項圖片必須相異`);
    for (const option of item.options) {
      checkText(option, `${dialect.name} choiceOne ${item.id}${option.letter}`);
      assert.match(option.audioUrl, audioUrlPattern);
      assert.ok(imageExists(option.imagePath), `找不到圖片 ${option.imagePath}`);
    }
  }
  for (const item of shard.choiceTwo) {
    assert.equal(item.options.length, 3);
    for (const option of item.options) {
      checkText(option, `${dialect.name} choiceTwo ${item.id}${option.letter}`);
      assert.match(option.audioUrl, audioUrlPattern);
      assert.equal(option.imagePath, undefined, "選擇題(二) 不該有圖片");
    }
  }
  for (const item of shard.match) {
    assert.equal(item.dialogues.length, 5);
    assert.deepEqual(item.dialogues.map((d) => d.imageIndex), [1, 2, 3, 4, 5]);
    assert.equal(new Set(item.dialogues.map((d) => d.imagePath)).size, 5, `${item.id} 的五張圖片必須相異`);
    for (const dialogue of item.dialogues) {
      checkText(dialogue.question, `${dialect.name} match ${item.id}${dialogue.letter} 問句`);
      checkText(dialogue.answer, `${dialect.name} match ${item.id}${dialogue.letter} 答句`);
      assert.match(dialogue.audioUrl, audioUrlPattern);
      assert.ok(imageExists(dialogue.imagePath), `找不到圖片 ${dialogue.imagePath}`);
    }
  }
  for (const item of shard.dialogue) {
    assert.equal(item.questions.length, 5);
    for (const question of item.questions) {
      checkText(question, `${dialect.name} dialogue ${item.id}${question.letter}`);
      assert.match(question.audioUrl, audioUrlPattern);
    }
  }
  for (const item of shard.pictureTalk) {
    assert.equal(item.order, 1);
    assert.ok(item.tip && item.tip.trim(), `${dialect.name} pictureTalk 缺少 tip`);
    assert.ok(item.chineseText && item.chineseText.trim(), `${dialect.name} pictureTalk 缺少中文參考答案`);
    assert.equal(item.imageUrls.length, 4);
    assert.equal(item.imagePaths, undefined, "看圖說話圖片不得入庫成 imagePaths");
    assert.match(item.audioUrl, audioUrlPattern);
    for (const imageUrl of item.imageUrls) {
      assert.match(imageUrl, /^https:\/\/klokah\.tw\/extension\/sp_junior\/graphics_100x100\/pictureTalk\/\d+_\d+\.png$/);
    }
  }
}

// 圖片目錄的張數，以及「音檔一律不入庫」。
const countPng = (dir) => fs.readdirSync(path.join(dataRoot, "images", dir)).filter((f) => f.endsWith(".png")).length;
assert.equal(countPng("recognize"), 55);
assert.equal(countPng("choiceOne"), 75);
assert.equal(countPng("match"), 50);
assert.equal(fs.existsSync(path.join(dataRoot, "images", "pictureTalk")), false, "看圖說話圖片不得入庫");

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const audioExtensions = /\.(mp3|wav|ogg|flac|m4a|webm)$/i;
assert.equal(walk(dataRoot).filter((file) => audioExtensions.test(file)).length, 0, "語料目錄不得收錄任何音檔");

const gitignore = read(".gitignore");
for (const extension of ["*.mp3", "*.wav", "*.ogg", "*.flac", "*.m4a", "*.webm"]) {
  assert.ok(gitignore.includes(extension), `.gitignore 仍必須擋 ${extension}`);
}

/* ══════════ 2. 出卷器 ══════════ */

assert.equal(SECTION_SPECS.length, 3);
assert.deepEqual(SECTION_SPECS.map((s) => s.id), ["wordReading", "shortAnswer", "pictureTalk"]);
assert.ok(SECTION_SPECS.every((spec) => spec.part === "speaking"), "本站只出口說題型");

assert.ok(sectionSpecById("pictureTalk").instruction.includes("四個圖片"));
for (const spec of SECTION_SPECS) {
  assert.equal(spec.adaptationNote.trim(), "", `${spec.id} 口說不得再顯示改編／評分方式說明`);
}
assert.equal(sectionSpecById("shortAnswer").scorable, true, "簡答題會粗判是否合理");
assert.equal(sectionSpecById("pictureTalk").scorable, true, "看圖說話會給分");

// 出卷器不得偷用全域亂數或時間。
assert.ok(paperSource.includes("preferFirstAlt"), "題目顯示必須只留斜線前的第一寫法");
assert.equal(preferFirstAlt("egu / lala bi"), "egu bi");
assert.equal(preferFirstAlt("他/她的揹簍在哪裡？"), "他的揹簍在哪裡？");
assert.ok(!/Math\.random/.test(paperCode), "出卷器不得使用 Math.random");
assert.ok(!/new Date|Date\.now/.test(paperCode), "出卷器不得依賴時間");
assert.ok(!/\bfetch\s*\(/.test(paperCode), "出卷器不得發網路請求");
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(paperCode), "出卷器不得存取瀏覽器儲存");

// createRng 可重現且落在 [0,1)。
{
  const a = createRng(12345);
  const b = createRng(12345);
  const values = Array.from({ length: 500 }, () => a());
  assert.deepEqual(values, Array.from({ length: 500 }, () => b()));
  for (const value of values) assert.ok(value >= 0 && value < 1);
  assert.notDeepEqual(values, Array.from({ length: 500 }, createRng(12346)));
}

// 試卷編號與 seed 互轉。
for (const seed of [0, 1, 42, 999999, 0xffffffff]) {
  assert.equal(paperIdToSeed(seedToPaperId(seed)), seed);
}
assert.equal(paperIdToSeed("не-число"), null);
assert.equal(paperIdToSeed(""), null);

// shuffle 不改動原陣列且保留全部元素。
{
  const original = [1, 2, 3, 4, 5];
  const rotated = shuffle(original, createRng(7));
  assert.deepEqual(original, [1, 2, 3, 4, 5], "shuffle 不得改動原陣列");
  assert.deepEqual([...rotated].sort(), [1, 2, 3, 4, 5]);
  assert.ok([1, 2, 3].includes(pickOne([1, 2, 3], createRng(3))));
}

const dialectOf = (id) => DIALECTS.find((d) => d.id === id);

// 同一個 seed 必定產生同一份試卷。
{
  const args = { shard: shards.get(1), dialect: dialectOf(1), seed: 20260821 };
  assert.deepEqual(createPaper(args), createPaper({ ...args }));
  assert.notDeepEqual(createPaper(args), createPaper({ ...args, seed: 20260822 }));
}

// 分片與方言別不一致必須擋下來。
assert.throws(() => createPaper({ shard: shards.get(1), dialect: dialectOf(2), seed: 1 }), /方言/);
assert.throws(() => createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed: -1 }), /seed/);

// 200 個 seed × 3 個方言，逐條檢查不變量。
const sampledDialects = [1, 5, 43];

for (const dialectId of sampledDialects) {
  const shard = shards.get(dialectId);
  const dialect = dialectOf(dialectId);

  for (let seed = 1; seed <= 200; seed += 1) {
    const paper = createPaper({ shard, dialect, seed });
    assert.equal(paper.totalQuestions, 11);
    assert.equal(paper.listening.length, 0);
    assert.equal(paper.speaking.length, 3);
    assert.equal(flattenPaper(paper).length, 11);
    const flatParts = flattenPaper(paper).map((entry) => entry.section.part);
    assert.deepEqual([...new Set(flatParts)], ["speaking"], "本站只出口說題");
    assert.equal(paper.dialect.id, dialectId);
    assert.equal(paper.speaking[0].questions.length, 5);
    assert.equal(paper.speaking[1].questions.length, 5);
    assert.equal(paper.speaking[2].questions.length, 1);

    // ── 單詞朗讀
    const wordReading = paper.speaking[0];
    assert.equal(wordReading.id, "wordReading");
    assert.equal(new Set(wordReading.questions.map((q) => q.expected)).size, 5, "單詞朗讀五題必須相異");
    for (const question of wordReading.questions) {
      assert.equal(question.scorable, true);
      assert.equal(question.expected, question.prompt.indigenousText);
      assert.ok(!/[\/／]/.test(question.expected), "朗讀 expected 不得含斜線");
      assert.ok(!/[\/／]/.test(question.prompt.chineseText ?? ""), "朗讀中文不得含斜線");
      assert.ok(question.prompt.referenceAudioUrl, "教材錄音要留著，但只在結果頁提供");
      assert.equal(question.options, undefined, "朗讀題沒有選項");
      assert.ok(!("answerKey" in question), "朗讀題以逐字稿比對，不用 answerKey");
    }

    // ── 簡答題
    const shortAnswer = paper.speaking[1];
    assert.equal(shortAnswer.id, "shortAnswer");
    assert.equal(shortAnswer.scorable, true);
    assert.equal(new Set(shortAnswer.questions.map((q) => q.prompt.indigenousText)).size, 5, "簡答題五題的問句必須相異");
    for (const question of shortAnswer.questions) {
      assert.equal(question.scorable, true);
      assert.ok(!("answerKey" in question), "開放式題目不得有標準答案欄位");
      assert.ok(!("expected" in question), "開放式題目不得有標準答案欄位");
      assert.ok(question.prompt.audioUrl, "簡答題要播出族語問句");
      assert.ok(question.prompt.chineseText.trim(), "簡答題要有中文問句供語意粗判");
      assert.ok(!/[\/／]/.test(question.prompt.indigenousText), "簡答題族語不得含斜線");
      assert.ok(!/[\/／]/.test(question.prompt.chineseText), "簡答題中文不得含斜線");
    }

    // ── 看圖說話
    const pictureTalk = paper.speaking[2];
    assert.equal(pictureTalk.id, "pictureTalk");
    assert.equal(pictureTalk.scorable, true);
    assert.equal(pictureTalk.questions.length, 1);
    {
      const question = pictureTalk.questions[0];
      assert.equal(question.scorable, true);
      assert.ok(question.prompt.tip.trim());
      assert.ok(!/[\/／]/.test(question.prompt.tip), "看圖 tip 不得含斜線");
      assert.equal(question.prompt.imageUrls.length, 4);
      for (const imageUrl of question.prompt.imageUrls) {
        assert.match(imageUrl, /^https:\/\/klokah\.tw\/extension\/sp_junior\/graphics_100x100\/pictureTalk\//);
      }
      assert.ok(question.reference.chineseText.trim());
      assert.ok(!/[\/／]/.test(question.reference.indigenousText ?? ""), "看圖參考句族語不得含斜線");
      assert.ok(!/[\/／]/.test(question.reference.chineseText), "看圖參考句中文不得含斜線");
      assert.ok(question.reference.audioUrl);
      assert.ok(!("answerKey" in question));
      assert.ok(!("expected" in question));
    }
  }
}

/* ══════════ 3. 計分 ══════════ */

assert.equal(OFFICIAL.listeningThreshold, 45);
assert.equal(OFFICIAL.speakingThreshold, 15);
assert.equal(OFFICIAL.quote, "聽力成績須達45分以上，口說成績須達15分以上，始核發該級別之合格證書");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("看圖說話"), "必須說明看圖說話已涵蓋");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("0–10"), "必須說明看圖說話滿分 10 分");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("每題 4 分"), "必須說明簡答題每題 4 分");
assert.ok(!/LLM|規則粗判|機器粗判|機器評分|非正式測驗/.test(SPEAKING_COVERAGE_NOTE), "涵蓋說明不得提評分方式");
assert.equal(POINT_SCHEME.wordReading.max, 10);
assert.equal(POINT_SCHEME.shortAnswer.max, 20);
assert.equal(POINT_SCHEME.pictureTalk.max, 10);
assert.equal(POINT_SCHEME.listening.max, 0);
assert.equal(POINT_SCHEME.totalMax, 40);

// 「合格」二字只能出現在官方原文引用裡。
assert.equal((scoringCode.match(/合格/g) ?? []).length, 1, "scoring.mjs 的程式碼只能有一處「合格」，且必須在 OFFICIAL.quote 內");
assert.ok(scoringCode.indexOf("合格") > scoringCode.indexOf("export const OFFICIAL"));
assert.ok(scoringCode.indexOf("合格") < scoringCode.indexOf("SPEAKING_COVERAGE_NOTE"));
// 計分模組不得偷偷宣告通過與否；converted 必須維持 null（練習得分放在 practice，不叫正式換算）。
for (const forbidden of ["passed", "isPass", "estimatedScore", "predictedScore"]) {
  assert.ok(!scoringCode.includes(forbidden), `scoring.mjs 不得出現 ${forbidden}`);
}

const samplePaper = createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed: 4242 });
const wordQuestions = samplePaper.speaking[0].questions;
const shortQuestions = samplePaper.speaking[1].questions;
const pictureQuestions = samplePaper.speaking[2].questions;

// ① 空聽力卷：聽力摘要為零題
{
  const report = gradePaper(samplePaper, {});
  assert.equal(report.listening.total, 0);
  assert.equal(report.listening.bySection.length, 0);
  assert.equal(report.listening.pointsSum, 0);
  assert.equal(report.listening.maxPointsSum, 0);
  assert.equal(report.listening.accuracy, null);
  assert.equal(report.practice.listening, 0);
  assert.equal(report.practice.listeningMax, 0);
  assert.equal(report.practice.totalMax, 40);
}

// ⑤ judgeWordReading 的三種結果
assert.equal(judgeWordReading("wacu", "wacu"), "matched");
assert.equal(judgeWordReading("  wacu  ", "wacu"), "matched", "前後空白不影響");
assert.equal(judgeWordReading("luma’", "luma'"), "matched", "彎引號與直引號視為相同");
assert.equal(judgeWordReading("Wacu", "wacu"), "matched", "大小寫視為相同");
assert.equal(judgeWordReading("wacu", "Wacu"), "matched", "大小寫視為相同");
assert.equal(judgeWordReading("ayam", "wacu"), "mismatched");
assert.equal(judgeWordReading(null, "wacu"), "undetermined", "辨識失敗不得判成念錯");
assert.equal(judgeWordReading("", "wacu"), "undetermined");
assert.equal(judgeWordReading("   ", "wacu"), "undetermined");
assert.equal(judgeWordReading("wacu", ""), "undetermined");

// ⑤b 簡答題合理與否（合理 4 分）
{
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "很好").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "很好").points, 4);
  assert.equal(judgeShortAnswerTranslation("你是阿美族嗎？", "是").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你幾歲了？", "十二歲").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你現在在哪裡？", "我在學校").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "你好嗎").verdict, "unreasonable", "複誦問句不算回答");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "你好嗎").points, 0);
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "").verdict, "undetermined");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "").points, null);
}

// ⑤c 看圖說話給分（參考答案取自本卷教材，不寫死例句）
{
  const reference = pictureQuestions[0].reference.chineseText;
  assert.ok(reference.trim(), "試卷必須帶入教材中文參考答案");
  assert.equal(scorePictureTalkTranslation(reference, reference).points, 10);

  const contentChars = [...reference.replace(/[^\u4e00-\u9fff]/g, "")];
  const partial = contentChars.slice(0, Math.max(8, Math.floor(contentChars.length / 4))).join("");
  assert.ok(scorePictureTalkTranslation(partial, reference).points >= 1, "截取參考答案的片段應能拿到分數");

  const distractor = wordQuestions
    .map((q) => q.prompt.chineseText)
    .find((zh) => scorePictureTalkTranslation(zh, reference).points === 0);
  assert.ok(distractor, "同卷單詞題應能找到與看圖說話參考答案無關的中文");
  assert.equal(scorePictureTalkTranslation(distractor, reference).points, 0);

  assert.equal(scorePictureTalkTranslation("", reference).status, "undetermined");
  assert.equal(scorePictureTalkTranslation(reference, "").status, "undetermined");
}

// ⑤d 語意評分介面（預設 heuristic；LLM 可替換）
{
  assert.ok(activeSemanticJudge.id.startsWith("llm:"), "預設應走 LLM 語意評分（失敗時備援 heuristic）");
  assert.equal(typeof activeSemanticJudge.judgeShortAnswer, "function");
  assert.equal(typeof activeSemanticJudge.scorePictureTalk, "function");
  {
    const judged = await activeSemanticJudge.judgeShortAnswer({
      questionChinese: "你好嗎？",
      translation: "很好",
      transcript: "x",
    });
    assert.equal(judged.points, 4);
    // Node 測試環境無 proxy 時應退回規則粗判
    if (judged.fallback) assert.equal(judged.fallback, "heuristic");
  }
  assert.throws(() => createLlmSemanticJudge({}), /complete/);
  const llm = createLlmSemanticJudge({
    model: "mock",
    complete: async () => '{"verdict":"unreasonable","points":0,"rationale":"mock"}',
  });
  assert.equal(llm.id, "llm:mock");
  assert.equal(
    (await llm.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "很好", transcript: "x" })).verdict,
    "unreasonable",
  );
  assert.equal(
    (await llm.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "很好", transcript: "x" })).points,
    0,
  );
  const llmPicture = createLlmSemanticJudge({
    model: "mock",
    complete: async () => '{"points":7,"rationale":"mock"}',
  });
  const picture = await llmPicture.scorePictureTalk({
    tip: "提示",
    referenceChinese: "參考",
    translation: "譯文",
    transcript: "x",
  });
  assert.equal(picture.status, "scored");
  assert.equal(picture.points, 7);
  assert.equal(picture.maxPoints, 10);
  assert.equal(createHeuristicSemanticJudge().id, "heuristic");
}

// ⑥ 口說計分
{
  const pictureQ = pictureQuestions[0];
  const responses = {
    ...Object.fromEntries(wordQuestions.map((q, index) => [q.id, index === 0
      ? { attempted: true, transcript: q.expected }
      : index === 1
        ? { attempted: true, transcript: "完全不同的詞" }
        : index === 2
          ? { attempted: true, transcript: null, asrError: "辨識服務逾時" }
          : {}]),
    ),
    ...Object.fromEntries(shortQuestions.map((q, index) => [q.id, index < 2
      ? {
        attempted: true,
        transcript: "kapah kaku",
        translation: "很好",
        shortVerdict: "reasonable",
      }
      : index === 2
        ? { attempted: true, transcript: null, asrError: "辨識服務 HTTP 500", shortVerdict: "undetermined" }
        : {}]),
    ),
    [pictureQ.id]: {
      attempted: true,
      transcript: "sample ab",
      translation: pictureQ.reference.chineseText,
      pictureScore: scorePictureTalkTranslation(pictureQ.reference.chineseText, pictureQ.reference.chineseText),
    },
  };
  const report = gradePaper(samplePaper, responses);
  const word = report.speaking.wordReading;
  assert.equal(word.total, 5);
  assert.equal(word.matched, 1);
  assert.equal(word.mismatched, 1);
  assert.equal(word.undetermined, 1, "辨識失敗歸入無法判定");
  assert.equal(word.skipped, 2);
  assert.equal(word.scored, true);
  assert.equal(word.pointsSum, 2, "相符 1 題 × 2 分");
  assert.equal(word.maxPointsSum, 10);
  assert.equal(word.review[2].asrError, "辨識服務逾時");

  const short = report.speaking.shortAnswer;
  assert.equal(short.scored, true, "簡答題會粗判是否合理");
  assert.equal(short.reasonable, 2);
  assert.equal(short.undetermined, 1);
  assert.equal(short.skipped, 2);
  assert.equal(short.pointsSum, 8, "合理 2 題 × 4 分");
  assert.equal(short.maxPointsSum, 20);
  assert.ok("reasonable" in short && "unreasonable" in short);

  const picture = report.speaking.pictureTalk;
  assert.equal(picture.scored, true);
  assert.equal(picture.total, 1);
  assert.equal(picture.scoredCount, 1);
  assert.equal(picture.pointsSum, 10);
  assert.equal(picture.maxPointsSum, 10);
  assert.equal(report.speaking.coverageNote, SPEAKING_COVERAGE_NOTE);
  assert.equal(report.speaking.pointsSum, 2 + 8 + 10);
  assert.equal(report.practice.speaking, 20);
  assert.equal(report.practice.total, 20);
  assert.equal(report.practice.totalMax, 40);
  assert.equal(report.listening.total, 0);
}

// ⑦ 誠實性：不換算、不宣告通過
{
  const report = gradePaper(samplePaper, {});
  assert.equal(report.converted, null, "永遠不換算成官方分數");
  const serialized = JSON.stringify(report);
  for (const forbidden of ['"pass"', '"passed"', '"result"', '"score"', '"grade"']) {
    assert.ok(!serialized.includes(forbidden), `成績單不得有 ${forbidden} 欄位`);
  }
  assert.equal(report.official.quote, OFFICIAL.quote);
  assert.ok(report.official.disclaimer.includes("僅供本次模擬參考"));
}


/* ══════════ 4. 頁面契約 ══════════ */

// 資源一律根絕對路徑（沿用 de3ab32 建立的規則）。
assert.ok(page.includes('href="/apps/certification-mock/beginner-mock-exam/styles.css"'));
assert.ok(page.includes('src="/apps/certification-mock/beginner-mock-exam/app.mjs"'));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'), "沿用 MISSION 01 的視覺系統");
assert.ok(page.indexOf('href="/apps/basic-learning/body-parts-practice/styles.css"') < page.indexOf('href="/apps/certification-mock/beginner-mock-exam/styles.css"'),
  "必須先連 MISSION 01 的樣式表，本頁的樣式才是 delta");
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes('src="app.mjs"'));
assert.ok(page.includes('href="/"'), "必須有返回 AI 實驗室的連結");
assert.ok(page.includes("認證模擬 · MISSION 01"), "hero 標籤是分類內的卡片序號");
assert.ok(page.includes("初級口說模擬站"), "標題必須是初級口說模擬站");
assert.ok(page.includes('class="task-brief"') && page.includes("怎麼玩"), "setup 必須有遊玩說明");
assert.ok(page.includes("全部做完後一次看結果"), "setup 必須說明整卷後才看結果");

// klokah 不送 CORS 標頭：加 crossorigin 會讓音檔完全播不出來。
assert.ok(!/crossorigin/.test(page), "音檔元素不得加 crossorigin");
assert.ok(page.includes('id="player"') && page.includes('preload="none"'), "音檔不得預先載入");

// MISSION 01 的 figure{display:grid} 會蓋掉 [hidden]，本頁靠 hidden 切換題型，
// 必須自己把 [hidden] 補回來，否則上一題的圖片會殘留在下一題。
const styles = read("apps/certification-mock/beginner-mock-exam/styles.css");
assert.ok(/\[hidden\]\{display:none ?!important\}/.test(styles),
  "樣式表必須補上 [hidden]{display:none !important}");
// 固定在底部的導覽列會蓋住配合題的五張圖片，實測擋掉兩排。
assert.ok(!/\.quiz-actions\{[^}]*position:sticky/.test(styles), "導覽列不得 sticky，會蓋住選項圖片");

// 整張選項卡片都要可點。卡片有外框、陰影與選取底色，看起來就是一個目標，
// 但 label 只包住文字或圖片——修正前實測死區佔卡片面積：是非題 53%、選擇題(二) 72%。
assert.ok(/\.option label::after\{[^}]*position:absolute[^}]*inset:0/.test(styles),
  "label 必須用 ::after 把命中範圍撐滿整張卡片");
assert.ok(/\.option\{[^}]*position:relative/.test(styles), "卡片必須是定位祖先，覆蓋層才會對齊卡片");
// 覆蓋層會吃掉點擊，播放鈕必須浮在它之上，否則點播放會變成選取該選項。
assert.ok(/\.option--audio \.option-play\{[^}]*position:relative[^}]*z-index:1/.test(styles),
  "播放鈕必須浮在 label 覆蓋層之上");

// 三個步驟的初始可見性。
assert.ok(/<section id="quiz"[^>]*\shidden/.test(page), "作答區初始必須隱藏");
assert.ok(/<section id="report"[^>]*\shidden/.test(page), "成績單初始必須隱藏");

// 練習導向：確定後不即時顯示對錯，整卷結束才進結果頁。
assert.ok(page.includes('id="confirm"'), "必須有確定按鈕");
assert.ok(page.includes('id="review-list"'), "結果頁必須有答題紀錄區");
assert.ok(page.includes('id="end-practice"'), "必須有結束練習按鈕");
assert.ok(!page.includes('id="finish"'), "不得再有交卷按鈕");
assert.ok(!page.includes(">交卷<"), "文案不得出現交卷");
assert.ok(appSource.includes("confirmed"), "確定後必須標記 confirmed");
assert.ok(appSource.includes("advanceAfterConfirm"), "確定後必須自動前進或進結果頁");
assert.ok(appSource.includes("activeSemanticJudge"), "簡答／看圖說話必須走語意評分介面");
assert.ok(!appSource.includes("練習用機器評分"), "結果頁不得顯示機器評分免責");
assert.ok(!appSource.includes("規則粗判"), "結果頁不得提規則粗判");
assert.ok(!appSource.includes("機器粗判"), "結果頁不得提機器粗判");
assert.ok(!appSource.includes("showListeningFeedback"), "作答過程不得呼叫即時聽力回饋");
assert.ok(!appSource.includes("showSpeakingFeedback"), "作答過程不得呼叫即時口說回饋");
assert.ok(/state === "recorded"[\s\S]*?confirmCurrent\(\)/.test(appCode), "口說停錄後必須自動送出");
assert.ok(appSource.includes("停止錄音後會自動"), "口說文案必須說明停錄自動送出");
assert.ok(page.includes("CC BY-NC-SA 4.0"), "頁尾必須有教材授權標示");
assert.ok(page.includes("web.klokah.tw"), "頁尾必須標示原著作網址");

// 頁面不得引用任何 CDN 或第三方指令碼。
assert.ok(!/<script[^>]+src="https?:/.test(page), "不得載入遠端指令碼");
for (const source of [appSource, recorderSource, paperSource, scoringSource]) {
  assert.ok(!/from\s+["']https?:/.test(source), "模組不得從 CDN 匯入");
}

/* ══════════ 5. 音檔降級 ══════════ */

assert.ok(/player\.addEventListener\("error"/.test(appCode), "必須監聽音檔的 error 事件");
assert.ok(appCode.includes("AUDIO_STALL_MS"), "必須有 stall 看門狗——請求卡住時不會有任何事件");
assert.ok(appCode.includes("audioFailed = true"), "音檔失敗必須標記該題");
assert.ok(page.includes("音檔載入失敗") || appSource.includes("音檔載入失敗"), "必須告訴使用者音檔載入失敗");
assert.ok(appSource.includes("本題不計分"), "音檔失敗時必須說明該題不計分");
// klokah 沒有 CORS，用 fetch 取音檔一定失敗。
assert.ok(!/fetch\([^)]*klokah/.test(appCode), "不得用 fetch 取 klokah 音檔");
assert.ok(!/fetch\([^)]*klokah/.test(recorderCode));

/* ══════════ 6. 口說紅線（沿用 MISSION 02 的規則） ══════════ */

// 42 個方言別都對得到族級模型；限制是粒度，不是覆蓋率。
for (const dialect of DIALECTS) {
  assert.ok(asrModelFor(dialect.ethnicity), `${dialect.name} 對不到 ASR 模型`);
}
assert.equal(Object.keys(ASR_MODELS).length, 16);
// trv 前綴陷阱：賽德克與太魯閣的 NLLB 前綴相同，模型必須不同。
assert.equal(asrModelFor("賽德克"), "formosan_sdq");
assert.equal(asrModelFor("太魯閣"), "formosan_trv");
assert.notEqual(asrModelFor("賽德克"), asrModelFor("太魯閣"));
for (const source of [appCode, recorderCode]) {
  assert.ok(!/code\.(slice|startsWith|substring)/.test(source), "不得由 NLLB 代碼前綴推導 ASR 模型");
  assert.ok(!/replace\(.*formosan/.test(source), "不得由字串拼接推導 ASR 模型");
}
assert.ok(recorderCode.includes("asrModelFor(ethnicity)"), "模型一律查表");

// 送出的必須是轉檔後的 wav，絕不是原始錄音。
assert.ok(/form\.append\("audio", wav/.test(recorderCode), "必須送出轉檔後的 WAV");
assert.ok(!/form\.append\("audio",\s*(recordedBlob|blob)/.test(recorderCode), "絕不可送出原始錄音");
assert.ok(!/recordedBlob/.test(recorderCode), "recorder.mjs 不該碰到原始錄音變數");
// 轉檔失敗必須直接放棄，不得繼續走到 transcribe。
const convertCatch = appCode.slice(appCode.indexOf("await convertToAsrWav"), appCode.indexOf("setRecordState(\"transcribing\")"));
assert.ok(convertCatch.includes("轉檔失敗"), "轉檔失敗必須明說");
assert.ok(/轉檔失敗[\s\S]{0,700}?return;/.test(appCode), "轉檔失敗的分支必須直接 return，不得繼續送出");

// 措辭紅線：不因為機器聽錯就說使用者念錯。
// 「這不代表你念錯」是我們要求出現的否定句，掃描前先把否定形式拿掉，
// 剩下的才是真正在斷言發音的措辭。
const withoutNegations = (text) => text
  .replaceAll("這不代表你念錯", "")
  .replaceAll("不代表你念錯", "")
  .replaceAll("不是你念錯", "");
for (const forbidden of ["你念錯", "發音錯誤", "發音不正確", "念錯了", "唸錯"]) {
  assert.ok(!withoutNegations(appSource).includes(forbidden), `不得出現「${forbidden}」這種斷言發音的措辭`);
  assert.ok(!withoutNegations(page).includes(forbidden), `不得出現「${forbidden}」這種斷言發音的措辭`);
}
assert.ok(appSource.includes("這不代表你念錯"), "不相符時必須說明這不代表念錯");
assert.ok(appSource.includes("辨識："), "必須顯示辨識內容");
assert.ok(!appSource.includes("系統聽到"), "結果頁不得出現「系統聽到」");
assert.ok(appSource.includes("尚未被判錯"), "辨識失敗時必須說明尚未被判錯");

// 無帳號、無追蹤、無 cookie。
for (const source of [appCode, recorderCode]) {
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source), "本站不得使用任何瀏覽器儲存");
}
assert.ok(recorderCode.includes("URL.revokeObjectURL"), "必須釋放錄音的 object URL");

// 任何服務狀態都不得停用「開始」（辨識不可用時口說仍可練習，結果會是無法判定）。
assert.ok(!/audit[\s\S]{0,200}start\.disabled = true/.test(appCode), "ASR 稽核結果不得停用開始按鈕");
assert.ok(appSource.includes("無法判定"), "服務不可用時必須說明結果會是無法判定");

/* ══════════ 7. WAV 編碼格式 ══════════ */

{
  const wav = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), ASR_TARGET_SAMPLE_RATE));
  const text = (offset, length) => Array.from({ length }, (_, i) => String.fromCharCode(wav.getUint8(offset + i))).join("");
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(text(36, 4), "data");
  assert.equal(wav.getUint16(20, true), 1, "必須是 PCM");
  assert.equal(wav.getUint16(22, true), 1, "必須是單聲道");
  assert.equal(wav.getUint32(24, true), 16_000, "必須是 16 kHz");
  assert.equal(wav.getUint16(34, true), 16, "必須是 16-bit");
}

// readAsrText 的每一種異常都必須丟例外，交由呼叫端顯示「無法判定」。
assert.throws(() => readAsrText(null, 200));
assert.throws(() => readAsrText({ ok: true, data: { text: "x" } }, 500));
assert.throws(() => readAsrText({ ok: false, error: "拒絕" }, 200));
assert.throws(() => readAsrText({ ok: true, data: {} }, 200));
assert.equal(readAsrText({ ok: true, data: { text: " wacu " } }, 200), "wacu");

// 稽核的三條分支。
{
  assert.equal(auditAsrModels(ASR_MODELS, Object.values(ASR_MODELS)).consistent, true);
  const missing = auditAsrModels(ASR_MODELS, Object.values(ASR_MODELS).filter((m) => m !== "formosan_ami"));
  assert.equal(missing.unavailable.length, 1);
  assert.equal(missing.unavailable[0].ethnicity, "阿美");
  assert.equal(auditAsrModels(ASR_MODELS, [...Object.values(ASR_MODELS), "formosan_zzz"]).unknownFromApi.length, 1);
}

/* ══════════ 8. 沒有動到鄰居 ══════════ */

for (const relative of ["apps/basic-learning/body-parts-practice/app.mjs", "apps/basic-learning/body-parts-speaking/app.mjs",
                        "apps/basic-learning/body-parts-practice/core.mjs", "apps/basic-learning/body-parts-speaking/asr.mjs"]) {
  assert.ok(!read(relative).includes("beginner-mock-exam"), `${relative} 不得被本次改動`);
}

console.log("PASS: 42 shards / 180 images / no audio in repo, speaking-only 3 sections, 200 seeds × 3 dialects invariants, honest scoring, page contract, audio degradation, ASR red lines");
