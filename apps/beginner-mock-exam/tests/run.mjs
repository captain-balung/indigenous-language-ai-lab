import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECTS } from "../../body-parts-practice/dialects.mjs";
import {
  SECTION_SPECS, sectionSpecById, createRng, seedToPaperId, paperIdToSeed,
  pickOne, shuffle, createPaper, flattenPaper,
} from "../paper.mjs";
import { OFFICIAL, SPEAKING_COVERAGE_NOTE, judgeWordReading, gradePaper } from "../scoring.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, encodeWav, readAsrText, ASR_TARGET_SAMPLE_RATE } from "../../body-parts-speaking/asr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = path.join(root, "data/klokah-junior");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

const scoringSource = read("apps/beginner-mock-exam/scoring.mjs");
const paperSource = read("apps/beginner-mock-exam/paper.mjs");

// 註解裡會提到這些名字（「不呼叫 Math.random」之類），檢查程式碼時要先把註解拿掉。
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const paperCode = stripComments(paperSource);
const scoringCode = stripComments(scoringSource);

const page = read("apps/beginner-mock-exam/index.html");
const appSource = read("apps/beginner-mock-exam/app.mjs");
const appCode = stripComments(appSource);
const recorderSource = read("apps/beginner-mock-exam/recorder.mjs");
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
assert.equal(dataset.classes.length, 24, "四大聽力題型 + 單詞 + 簡短對話共 24 個類別");

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

const audioUrlPattern = /^https:\/\/klokah\.tw\/extension\/sp_junior\/sound\/\d+\/(1word|3recognize|4choiceOne|5choiceTwo|6match|9dialogue)\/[\w-]+\.mp3$/;
const imageExists = (imagePath) => fs.existsSync(path.join(dataRoot, imagePath));

const shards = new Map();
for (const dialect of DIALECTS) {
  const shard = readJson(`data/klokah-junior/dialects/${dialect.id}.json`);
  shards.set(dialect.id, shard);

  assert.equal(shard.dialectId, dialect.id);
  assert.equal(shard.dialectName, dialect.name);
  assert.equal(shard.ethnicity, dialect.ethnicity);

  // 逐家族比對 dataset.classes 算出來的預期數。
  for (const family of ["recognize", "choiceOne", "choiceTwo", "match", "word", "dialogue"]) {
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
}

// 圖片目錄的張數，以及「音檔一律不入庫」。
const countPng = (dir) => fs.readdirSync(path.join(dataRoot, "images", dir)).filter((f) => f.endsWith(".png")).length;
assert.equal(countPng("recognize"), 55);
assert.equal(countPng("choiceOne"), 75);
assert.equal(countPng("match"), 50);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const audioExtensions = /\.(mp3|wav|ogg|flac|m4a|webm)$/i;
assert.equal(walk(dataRoot).filter((file) => audioExtensions.test(file)).length, 0, "語料目錄不得收錄任何音檔");

const gitignore = read(".gitignore");
for (const extension of ["*.mp3", "*.wav", "*.ogg", "*.flac", "*.m4a", "*.webm"]) {
  assert.ok(gitignore.includes(extension), `.gitignore 仍必須擋 ${extension}`);
}

/* ══════════ 2. 出卷器 ══════════ */

assert.equal(SECTION_SPECS.length, 6);
assert.deepEqual(SECTION_SPECS.map((s) => s.id), ["trueFalse", "choiceOne", "choiceTwo", "match", "wordReading", "shortAnswer"]);

// 四段聽力說明必須與 Lokahsu 官方「考試題型」頁面的原文逐字相符。
assert.equal(sectionSpecById("trueFalse").instruction,
  "試卷上每題都有一個圖片，請聽電腦播出一個族語句子，若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("choiceOne").instruction,
  "試卷上每題有三個圖片，請聽電腦播出一個族語句子後，選一個與所聽到語意最相符的圖片，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("choiceTwo").instruction,
  "請聽電腦播出一個中文句子及三句族語句子後，選出與中文句子語意最接近的族語句子，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("match").instruction,
  "請聽電腦播出一個族語簡短對話後，在五個圖片中，選出相關的圖片來，並在答案卡上作答。每題播出兩遍。");
for (const spec of SECTION_SPECS) assert.ok(spec.adaptationNote.trim(), `${spec.id} 缺少改編說明`);
assert.equal(sectionSpecById("shortAnswer").scorable, false, "簡答題不計分");

// 出卷器不得偷用全域亂數或時間。
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
const answerKeysSeen = { trueFalse: new Set(), choiceOne: new Set(), choiceTwo: new Set(), match: new Set() };

for (const dialectId of sampledDialects) {
  const shard = shards.get(dialectId);
  const dialect = dialectOf(dialectId);

  for (let seed = 1; seed <= 200; seed += 1) {
    const paper = createPaper({ shard, dialect, seed });
    assert.equal(paper.totalQuestions, 30);
    assert.equal(paper.listening.length, 4);
    assert.equal(paper.speaking.length, 2);
    assert.equal(flattenPaper(paper).length, 30);
    assert.equal(paper.dialect.id, dialectId);
    for (const section of [...paper.listening, ...paper.speaking]) assert.equal(section.questions.length, 5);

    // ── 是非題
    const trueFalse = paper.listening[0];
    assert.equal(trueFalse.id, "trueFalse");
    const trueFalseKeys = trueFalse.questions.map((q) => q.answerKey);
    assert.ok(trueFalseKeys.includes("O") && trueFalseKeys.includes("X"), "是非題不得整節同一個答案");
    assert.equal(new Set(trueFalse.questions.map((q) => q.prompt.audioUrl)).size, 5, "是非題的五題音檔必須相異");
    for (const question of trueFalse.questions) {
      answerKeysSeen.trueFalse.add(question.answerKey);
      assert.ok(["O", "X"].includes(question.answerKey));
      assert.deepEqual(question.options.map((o) => o.key), ["O", "X"]);
      const target = shard.recognize.find((r) => r.audioUrl === question.prompt.audioUrl);
      assert.ok(target, "是非題的音檔必須來自 recognize 題庫");
      if (question.answerKey === "O") {
        assert.equal(question.prompt.imagePath, target.imagePath, "答 O 時必須顯示自己的圖片");
      } else {
        assert.notEqual(question.prompt.imagePath, target.imagePath, "答 X 時圖片必須不同");
        const shown = shard.recognize.find((r) => r.imagePath === question.prompt.imagePath);
        assert.equal(shown.classNo, target.classNo, "干擾圖必須來自同一個類別");
      }
    }

    // ── 選擇題(一)
    const choiceOne = paper.listening[1];
    assert.equal(choiceOne.id, "choiceOne");
    assert.equal(new Set(choiceOne.questions.map((q) => q.source.order + "-" + q.source.classNo)).size, 5, "選擇題(一) 五題必須來自不同題目");
    for (const question of choiceOne.questions) {
      answerKeysSeen.choiceOne.add(question.answerKey);
      assert.equal(question.options.length, 3);
      assert.deepEqual(question.options.map((o) => o.key), ["1", "2", "3"]);
      assert.equal(new Set(question.options.map((o) => o.imagePath)).size, 3);
      const correct = question.options.find((o) => o.key === question.answerKey);
      assert.equal(correct.letter, question.source.letter, "正解必須是被播出的那個選項");
      assert.equal(question.prompt.indigenousText, correct.indigenousText);
      assert.ok(question.prompt.audioUrl.endsWith(`_${question.source.letter}.mp3`));
    }

    // ── 選擇題(二)
    const choiceTwo = paper.listening[2];
    assert.equal(choiceTwo.id, "choiceTwo");
    for (const question of choiceTwo.questions) {
      answerKeysSeen.choiceTwo.add(question.answerKey);
      assert.equal(question.prompt.audioUrl, undefined, "選擇題(二) 的中文是文字，沒有音檔");
      assert.ok(question.prompt.chineseText.trim(), "選擇題(二) 必須有中文題幹");
      assert.equal(question.options.length, 3);
      for (const option of question.options) {
        assert.ok(option.audioUrl, "選擇題(二) 的每個族語選項都要有音檔");
        assert.equal(option.imagePath, undefined, "選擇題(二) 不該有圖片");
      }
      const correct = question.options.find((o) => o.key === question.answerKey);
      assert.equal(correct.chineseText, question.prompt.chineseText, "正解的中文必須就是題幹");
    }

    // ── 配合題
    const match = paper.listening[3];
    assert.equal(match.id, "match");
    assert.equal(new Set(match.questions.map((q) => q.source.order)).size, 5, "配合題五題必須來自不同組對話");
    for (const question of match.questions) {
      answerKeysSeen.match.add(question.answerKey);
      assert.equal(question.options.length, 5);
      assert.deepEqual(question.options.map((o) => o.key), ["1", "2", "3", "4", "5"]);
      assert.equal(new Set(question.options.map((o) => o.imagePath)).size, 5);
      const correct = question.options.find((o) => o.key === question.answerKey);
      assert.equal(correct.letter, question.source.letter);
      assert.equal(correct.imageIndex, "ABCDE".indexOf(question.source.letter) + 1,
        "配合題的字母與圖片序號必須對得上（A→1 … E→5）");
      assert.ok(question.prompt.audioUrl.endsWith(`/6match/1_${question.source.order}_${question.source.letter}.mp3`));
    }

    // ── 單詞朗讀
    const wordReading = paper.speaking[0];
    assert.equal(wordReading.id, "wordReading");
    assert.equal(new Set(wordReading.questions.map((q) => q.expected)).size, 5, "單詞朗讀五題必須相異");
    for (const question of wordReading.questions) {
      assert.equal(question.scorable, true);
      assert.equal(question.expected, question.prompt.indigenousText);
      assert.ok(question.prompt.referenceAudioUrl, "教材錄音要留著，但只在作答後提供");
      assert.equal(question.options, undefined, "朗讀題沒有選項");
      assert.ok(!("answerKey" in question), "朗讀題以逐字稿比對，不用 answerKey");
    }

    // ── 簡答題
    const shortAnswer = paper.speaking[1];
    assert.equal(shortAnswer.id, "shortAnswer");
    assert.equal(shortAnswer.scorable, false);
    assert.equal(new Set(shortAnswer.questions.map((q) => q.prompt.indigenousText)).size, 5, "簡答題五題的問句必須相異");
    for (const question of shortAnswer.questions) {
      assert.equal(question.scorable, false);
      assert.ok(!("answerKey" in question), "開放式題目不得有標準答案欄位");
      assert.ok(!("expected" in question), "開放式題目不得有標準答案欄位");
      assert.ok(question.prompt.audioUrl, "簡答題要播出族語問句");
    }
  }
}

// 正解不能永遠落在同一個位置。
assert.deepEqual([...answerKeysSeen.trueFalse].sort(), ["O", "X"]);
assert.deepEqual([...answerKeysSeen.choiceOne].sort(), ["1", "2", "3"]);
assert.deepEqual([...answerKeysSeen.choiceTwo].sort(), ["1", "2", "3"]);
assert.deepEqual([...answerKeysSeen.match].sort(), ["1", "2", "3", "4", "5"]);

/* ══════════ 3. 計分 ══════════ */

assert.equal(OFFICIAL.listeningThreshold, 45);
assert.equal(OFFICIAL.speakingThreshold, 15);
assert.equal(OFFICIAL.quote, "聽力成績須達45分以上，口說成績須達15分以上，始核發該級別之合格證書");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("看圖說話"), "必須說明看圖說話尚未提供");

// 「合格」二字只能出現在官方原文引用裡。
assert.equal((scoringCode.match(/合格/g) ?? []).length, 1, "scoring.mjs 的程式碼只能有一處「合格」，且必須在 OFFICIAL.quote 內");
assert.ok(scoringCode.indexOf("合格") > scoringCode.indexOf("export const OFFICIAL"));
assert.ok(scoringCode.indexOf("合格") < scoringCode.indexOf("SPEAKING_COVERAGE_NOTE"));
// 計分模組不得偷偷宣告通過與否，也不得換算分數。
// （只檢查識別字：OFFICIAL.disclaimer 本來就會寫「不換算成正式分數」。）
for (const forbidden of ["passed", "isPass", "estimatedScore", "predictedScore"]) {
  assert.ok(!scoringCode.includes(forbidden), `scoring.mjs 不得出現 ${forbidden}`);
}

const samplePaper = createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed: 4242 });
const listeningQuestions = samplePaper.listening.flatMap((section) => section.questions);
const wordQuestions = samplePaper.speaking[0].questions;
const shortQuestions = samplePaper.speaking[1].questions;

// ① 全對
{
  const responses = Object.fromEntries(listeningQuestions.map((q) => [q.id, { choice: q.answerKey }]));
  const report = gradePaper(samplePaper, responses);
  assert.equal(report.listening.total, 20);
  assert.equal(report.listening.correct, 20);
  assert.equal(report.listening.wrong, 0);
  assert.equal(report.listening.scoredDenominator, 20);
  assert.equal(report.listening.accuracy, 1);
  assert.equal(report.listening.bySection.length, 4);
  for (const section of report.listening.bySection) assert.equal(section.correct, 5);
}

// ② 未作答 → unanswered，不是 wrong
{
  const report = gradePaper(samplePaper, {});
  assert.equal(report.listening.unanswered, 20);
  assert.equal(report.listening.wrong, 0);
  assert.equal(report.listening.correct, 0);
  assert.equal(report.listening.scoredDenominator, 0);
  assert.equal(report.listening.accuracy, null, "沒有可計分的題目時不得硬算正確率");
}

// ③ 音檔載入失敗 → notScored，不進分母、不算錯
{
  const responses = Object.fromEntries(listeningQuestions.map((q, index) => [
    q.id,
    index < 2 ? { choice: null, audioFailed: true } : { choice: q.answerKey },
  ]));
  const report = gradePaper(samplePaper, responses);
  assert.equal(report.listening.notScored, 2);
  assert.equal(report.listening.wrong, 0);
  assert.equal(report.listening.unanswered, 0);
  assert.equal(report.listening.correct, 18);
  assert.equal(report.listening.scoredDenominator, 18, "載入失敗的題目不得進分母");
  assert.equal(report.listening.accuracy, 1);
  // 就算選了答案，只要音檔失敗就一律不計分。
  const stillWrong = gradePaper(samplePaper, {
    ...responses,
    [listeningQuestions[0].id]: { choice: "1", audioFailed: true },
  });
  assert.equal(stillWrong.listening.wrong, 0);
  assert.equal(stillWrong.listening.notScored, 2);
}

// ④ 答錯就是答錯
{
  const wrongKey = (question) => question.options.find((o) => o.key !== question.answerKey).key;
  const responses = Object.fromEntries(listeningQuestions.map((q) => [q.id, { choice: wrongKey(q) }]));
  const report = gradePaper(samplePaper, responses);
  assert.equal(report.listening.wrong, 20);
  assert.equal(report.listening.correct, 0);
  assert.equal(report.listening.accuracy, 0);
}

// ⑤ judgeWordReading 的三種結果
assert.equal(judgeWordReading("wacu", "wacu"), "matched");
assert.equal(judgeWordReading("  wacu  ", "wacu"), "matched", "前後空白不影響");
assert.equal(judgeWordReading("luma’", "luma'"), "matched", "彎引號與直引號視為相同");
assert.equal(judgeWordReading("ayam", "wacu"), "mismatched");
assert.equal(judgeWordReading(null, "wacu"), "undetermined", "辨識失敗不得判成念錯");
assert.equal(judgeWordReading("", "wacu"), "undetermined");
assert.equal(judgeWordReading("   ", "wacu"), "undetermined");
assert.equal(judgeWordReading("wacu", ""), "undetermined");

// ⑥ 口說計分
{
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
      ? { attempted: true, transcript: "kapah kaku" }
      : index === 2
        ? { attempted: true, transcript: null, asrError: "辨識服務 HTTP 500" }
        : {}]),
    ),
  };
  const report = gradePaper(samplePaper, responses);
  const word = report.speaking.wordReading;
  assert.equal(word.total, 5);
  assert.equal(word.matched, 1);
  assert.equal(word.mismatched, 1);
  assert.equal(word.undetermined, 1, "辨識失敗歸入無法判定");
  assert.equal(word.skipped, 2);
  assert.equal(word.scored, true);
  assert.equal(word.review[2].asrError, "辨識服務逾時");

  const short = report.speaking.shortAnswer;
  assert.equal(short.scored, false, "簡答題不計分");
  assert.equal(short.transcribed, 2);
  assert.equal(short.undetermined, 1);
  assert.equal(short.skipped, 2);
  assert.ok(!("matched" in short) && !("mismatched" in short), "簡答題沒有對錯的概念");
  assert.equal(report.speaking.coverageNote, SPEAKING_COVERAGE_NOTE);

  // 口說完全不影響聽力的數字。
  assert.equal(report.listening.correct, 0);
  assert.equal(report.listening.unanswered, 20);
}

// ⑦ 誠實性：不換算、不宣告通過
{
  const report = gradePaper(samplePaper, Object.fromEntries(listeningQuestions.map((q) => [q.id, { choice: q.answerKey }])));
  assert.equal(report.converted, null, "永遠不換算成官方分數");
  const serialized = JSON.stringify(report);
  for (const forbidden of ['"pass"', '"passed"', '"result"', '"score"', '"grade"']) {
    assert.ok(!serialized.includes(forbidden), `成績單不得有 ${forbidden} 欄位`);
  }
  assert.equal(report.official.quote, OFFICIAL.quote);
  assert.ok(report.official.disclaimer.includes("不預測你是否會通過"));
}


/* ══════════ 4. 頁面契約 ══════════ */

// 資源一律根絕對路徑（沿用 de3ab32 建立的規則）。
assert.ok(page.includes('href="/apps/beginner-mock-exam/styles.css"'));
assert.ok(page.includes('src="/apps/beginner-mock-exam/app.mjs"'));
assert.ok(page.includes('href="/apps/body-parts-practice/styles.css"'), "沿用 MISSION 01 的視覺系統");
assert.ok(page.indexOf('href="/apps/body-parts-practice/styles.css"') < page.indexOf('href="/apps/beginner-mock-exam/styles.css"'),
  "必須先連 MISSION 01 的樣式表，本頁的樣式才是 delta");
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes('src="app.mjs"'));
assert.ok(page.includes('href="/"'), "必須有返回 AI 實驗室的連結");
assert.ok(page.includes("認證模擬 · MISSION 01"), "hero 標籤是分類內的卡片序號");

// klokah 不送 CORS 標頭：加 crossorigin 會讓音檔完全播不出來。
assert.ok(!/crossorigin/.test(page), "音檔元素不得加 crossorigin");
assert.ok(page.includes('id="player"') && page.includes('preload="none"'), "30 題最多 5 個音檔，不得預先載入");

// MISSION 01 的 figure{display:grid} 會蓋掉 [hidden]，本頁靠 hidden 切換題型，
// 必須自己把 [hidden] 補回來，否則上一題的圖片會殘留在下一題。
const styles = read("apps/beginner-mock-exam/styles.css");
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

// 七項揭露都必須在作答區之前。
const quizAt = page.indexOf('id="quiz"');
for (const [label, needle] of [
  ["範圍", "notice--scope"],
  ["改編說明", "notice--adaptation"],
  ["音檔外連", "notice--audio"],
  ["族級模型", "notice--model"],
  ["錄音隱私", "notice--privacy"],
  ["無障礙限制", "notice--a11y"],
]) {
  const at = page.indexOf(needle);
  assert.ok(at > -1, `頁面缺少${label}揭露`);
  assert.ok(at < quizAt, `${label}揭露必須出現在作答區之前`);
}
assert.ok(page.includes("klokah.tw"), "必須揭露音檔由 klokah.tw 播放");
assert.ok(page.includes("IP 位址"), "必須揭露 IP 位址會被對方看到");
assert.ok(page.includes("ai3.iformosa.com.tw"), "必須揭露錄音送往何處");
assert.ok(page.includes("請不要錄入個人資料"), "必須提醒不要錄入個資");
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
assert.ok(/轉檔失敗[\s\S]{0,400}?return;/.test(appCode), "轉檔失敗的分支必須直接 return，不得繼續送出");

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
assert.ok(appSource.includes("系統聽到的"), "必須顯示系統聽到的內容");
assert.ok(appSource.includes("尚未被判錯"), "辨識失敗時必須說明尚未被判錯");
assert.ok(page.includes("不代表你念錯"), "揭露區必須說明族級模型的偏差不代表念錯");

// 無帳號、無追蹤、無 cookie。
for (const source of [appCode, recorderCode]) {
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source), "本站不得使用任何瀏覽器儲存");
}
assert.ok(recorderCode.includes("URL.revokeObjectURL"), "必須釋放錄音的 object URL");

// 聽力半場不依賴 ASR：任何服務狀態都不得停用「開始」。
assert.ok(!/audit[\s\S]{0,200}start\.disabled = true/.test(appCode), "ASR 稽核結果不得停用開始按鈕");
assert.ok(appSource.includes("聽力不受影響") || appSource.includes("聽力四部分仍可正常作答"),
  "服務不可用時必須說明聽力仍可作答");

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

for (const relative of ["apps/body-parts-practice/app.mjs", "apps/body-parts-speaking/app.mjs",
                        "apps/body-parts-practice/core.mjs", "apps/body-parts-speaking/asr.mjs"]) {
  assert.ok(!read(relative).includes("beginner-mock-exam"), `${relative} 不得被本次改動`);
}

console.log("PASS: 42 shards / 180 images / no audio in repo, 4+2 sections, 200 seeds × 3 dialects invariants, honest scoring, page contract, audio degradation, ASR red lines");
