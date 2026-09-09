import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECTS } from "../../body-parts-practice/dialects.mjs";
import {
  SECTION_SPECS, sectionSpecById, createRng, seedToPaperId, paperIdToSeed,
  pickOne, shuffle, createPaper, flattenPaper,
} from "../paper.mjs";
import {
  OFFICIAL, SPEAKING_COVERAGE_NOTE, POINT_SCHEME, SENTENCE_READING_THRESHOLDS,
  judgeSentenceReading, judgeShortAnswerTranslation, scorePictureTalkTranslation, gradePaper,
} from "../scoring.mjs";
import { activeSemanticJudge, createHeuristicSemanticJudge, createLlmSemanticJudge } from "../semantic-judge.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, encodeWav, readAsrText, ASR_TARGET_SAMPLE_RATE } from "../../body-parts-speaking/asr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = path.join(root, "data/klokah-senior");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

const scoringSource = read("apps/intermediate-mock-exam/scoring.mjs");
const paperSource = read("apps/intermediate-mock-exam/paper.mjs");

// 註解裡會提到這些名字（「不呼叫 Math.random」之類），檢查程式碼時要先把註解拿掉。
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const paperCode = stripComments(paperSource);
const scoringCode = stripComments(scoringSource);

const page = read("apps/intermediate-mock-exam/index.html");
const appSource = read("apps/intermediate-mock-exam/app.mjs");
const appCode = stripComments(appSource);
const recorderSource = read("apps/intermediate-mock-exam/recorder.mjs");
const recorderCode = stripComments(recorderSource);

/* ══════════ 1. 資料契約 ══════════ */

const dataset = readJson("data/klokah-senior/dataset.json");
assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.dialectCount, 42);
assert.equal(dataset.recordLayout, "sharded");
assert.equal(dataset.shardPath, "dialects/{dialectId}.json");
assert.equal(dataset.audioBase, "https://klokah.tw/extension/sp_senior/sound");
assert.equal(dataset.audioPolicy, "hotlinked-at-runtime");
assert.equal(dataset.source.license, "CC BY-NC-SA 4.0");
assert.equal(dataset.classes.length, 23, "四大聽力題型 + 唸唸看 + 簡短對話 + 看圖說話共 23 個類別");
assert.equal(dataset.choiceThreeImagePolicy, "not-collected", "選擇題(三) 的圖片刻意不入庫");

// dataset 的方言別必須與 dialects.mjs 完全一致（同一組 id、同一組族名）。
assert.deepEqual(dataset.dialects.map((d) => d.id), DIALECTS.map((d) => d.id));
for (const entry of dataset.dialects) {
  const dialect = DIALECTS.find((d) => d.id === entry.id);
  assert.equal(entry.name, dialect.name, `方言 ${entry.id} 的名稱與 dialects.mjs 不符`);
  assert.equal(entry.ethnicity, dialect.ethnicity, `方言 ${entry.id} 的族別與 dialects.mjs 不符`);
}

// 每個類別的預期題數；exceptions 是來源本身的差異，必須明列而非放寬。
const expectedItems = (spec, dialectId) => spec.exceptions?.[String(dialectId)] ?? spec.exceptions?.[dialectId] ?? spec.itemsPerDialect;
for (const classId of [22, 23]) {
  const spec = dataset.classes.find((c) => c.family === "recognize" && c.classId === classId);
  assert.equal(spec.itemsPerDialect, 15);
  assert.equal(expectedItems(spec, 14), 14, `邵語的 recognize/${classId} 只有 14 筆，必須明列為例外`);
  assert.equal(expectedItems(spec, 1), 15);
}

const AUDIO_DIRS = "3recognize|4choiceOne|5choiceTwo|7choiceThree|8oralReading|9dialogue|10pictureTalk";
const audioUrlPattern = new RegExp(`^https://klokah\\.tw/extension/sp_senior/sound/\\d+/(${AUDIO_DIRS})/[\\w-]+\\.mp3$`);
const imageExists = (imagePath) => fs.existsSync(path.join(dataRoot, imagePath));

const FAMILIES = ["recognize", "choiceOne", "choiceTwo", "choiceThree", "oralReading", "dialogue", "pictureTalk"];
const shards = new Map();
for (const dialect of DIALECTS) {
  const shard = readJson(`data/klokah-senior/dialects/${dialect.id}.json`);
  shards.set(dialect.id, shard);

  assert.equal(shard.dialectId, dialect.id);
  assert.equal(shard.dialectName, dialect.name);
  assert.equal(shard.ethnicity, dialect.ethnicity);

  // 逐家族比對 dataset.classes 算出來的預期數。
  for (const family of FAMILIES) {
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
  for (const item of shard.choiceOne) {
    // 高中版每題只有一張圖與一段錄音，內容是 2–3 輪對話。
    assert.ok(item.turns.length >= 2 && item.turns.length <= 3, `${item.id} 的對話輪數應為 2–3`);
    assert.equal(item.options, undefined, "高中版 choiceOne 沒有選項結構");
    assert.match(item.audioUrl, audioUrlPattern);
    assert.ok(imageExists(item.imagePath), `找不到圖片 ${item.imagePath}`);
    for (const turn of item.turns) checkText(turn, `${dialect.name} choiceOne ${item.id}${turn.letter}`);
  }
  for (const item of shard.choiceTwo) {
    assert.equal(item.options.length, 3);
    for (const option of item.options) {
      checkText(option, `${dialect.name} choiceTwo ${item.id}${option.letter}`);
      assert.match(option.audioUrl, audioUrlPattern);
      assert.equal(option.imagePath, undefined, "選擇題(二) 不該有圖片");
    }
  }
  for (const record of shard.choiceThree) {
    checkText(record, `${dialect.name} choiceThree ${record.id}`);
    assert.match(record.audioUrl, audioUrlPattern);
    assert.equal(record.imagePath, undefined, "選擇題(三) 的選項是拼寫文字，不得帶圖片");
  }
  // 同類別內的族語句必須互異——三個拼寫選項就是從同類別抽的。
  for (const classNo of new Set(shard.choiceThree.map((r) => r.classNo))) {
    const inClass = shard.choiceThree.filter((r) => r.classNo === classNo);
    assert.equal(new Set(inClass.map((r) => r.indigenousText)).size, inClass.length,
      `${dialect.name} choiceThree 類別 ${classNo} 有重複的族語句`);
  }
  for (const item of shard.oralReading) {
    assert.equal(item.sentences.length, 5);
    for (const sentence of item.sentences) {
      checkText(sentence, `${dialect.name} oralReading ${item.id}${sentence.letter}`);
      assert.match(sentence.audioUrl, audioUrlPattern);
    }
  }
  for (const item of shard.dialogue) {
    assert.equal(item.questions.length, 5);
    for (const question of item.questions) {
      checkText(question, `${dialect.name} dialogue ${item.id}${question.letter}`);
      assert.match(question.audioUrl, audioUrlPattern);
    }
  }
  assert.equal(shard.pictureTalk.length, 2, "高中版每方言有兩題看圖表達");
  for (const item of shard.pictureTalk) {
    assert.ok(item.tip && item.tip.trim(), `${dialect.name} pictureTalk 缺少 tip`);
    assert.ok(item.chineseText && item.chineseText.trim(), `${dialect.name} pictureTalk 缺少中文參考答案`);
    assert.equal(item.imageUrls, undefined, "高中版每題只有一張圖，欄位是 imageUrl");
    assert.equal(item.imagePath, undefined, "看圖表達圖片不得入庫");
    assert.match(item.audioUrl, audioUrlPattern);
    assert.match(item.imageUrl, /^https:\/\/klokah\.tw\/extension\/sp_senior\/graphics_100x100\/pictureTalk\/\d+\.png$/);
  }
}

// 圖片目錄的張數，以及「音檔一律不入庫」。
const countPng = (dir) => fs.readdirSync(path.join(dataRoot, "images", dir)).filter((f) => f.endsWith(".png")).length;
assert.equal(countPng("recognize"), 75);
assert.equal(countPng("choiceOne"), 79);
assert.equal(fs.existsSync(path.join(dataRoot, "images", "pictureTalk")), false, "看圖表達圖片不得入庫");
assert.equal(fs.existsSync(path.join(dataRoot, "images", "choiceThree")), false, "選擇題(三) 圖片不得入庫");

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const audioExtensions = /\.(mp3|wav|ogg|flac|m4a|webm)$/i;
assert.equal(walk(dataRoot).filter((file) => audioExtensions.test(file)).length, 0, "語料目錄不得收錄任何音檔");

const gitignore = read(".gitignore");
for (const extension of ["*.mp3", "*.wav", "*.ogg", "*.flac", "*.m4a", "*.webm"]) {
  assert.ok(gitignore.includes(extension), `.gitignore 仍必須擋 ${extension}`);
}

/* ══════════ 2. 出卷器 ══════════ */

assert.equal(SECTION_SPECS.length, 7);
assert.deepEqual(SECTION_SPECS.map((s) => s.id),
  ["trueFalse", "choiceOne", "choiceTwo", "choiceThree", "sentenceReading", "shortAnswer", "pictureTalk"]);

// 四段聽力說明必須與 Lokahsu 官方「考試題型／中級」頁面的原文逐字相符。
assert.equal(sectionSpecById("trueFalse").instruction,
  "試卷上每題都有一個圖片，請聽電腦播出一個族語句子，若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("choiceOne").instruction,
  "試卷上每題有三個圖片，請聽電腦播出一個族語句子後，選一個與所聽到語意最相符的圖片，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("choiceTwo").instruction,
  "請聽電腦播出一個中文句子及三句族語句子後，選出與中文句子語意最接近的族語句子，並在答案卡上作答。每題播出兩遍。");
assert.equal(sectionSpecById("choiceThree").instruction,
  "請聽電腦播出一個族語句子後，從選項中選出該句子正確的拼寫文字，並在答案卡上作答。每題播出兩遍。");
// 官方頁面寫的是「第四部份」（份），不是「第四部分」。
assert.equal(sectionSpecById("choiceThree").title, "第四部份：選擇題(三)");

// 聽力說明是官方原文，口說說明是本站措辭——兩者必須分得出來。
for (const spec of SECTION_SPECS) {
  assert.ok(["official", "site"].includes(spec.instructionSource), `${spec.id} 缺少 instructionSource`);
  assert.equal(spec.instructionSource, spec.part === "listening" ? "official" : "site",
    `${spec.id} 的說明來源標記不對：聽力才有官方原文`);
  assert.ok(spec.adaptationNote.trim(), `${spec.id} 缺少改編說明`);
}
for (const id of ["sentenceReading", "shortAnswer", "pictureTalk"]) {
  assert.ok(sectionSpecById(id).adaptationNote.includes("本站措辭"),
    `${id} 必須說明作答說明是本站措辭而非官方原文`);
}
assert.ok(sectionSpecById("choiceThree").adaptationNote.includes("不是洩題"),
  "選擇題(三) 必須說明族語選項先顯示是題型使然");

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
  const args = { shard: shards.get(1), dialect: dialectOf(1), seed: 20260824 };
  assert.deepEqual(createPaper(args), createPaper({ ...args }));
  assert.notDeepEqual(createPaper(args), createPaper({ ...args, seed: 20260825 }));
}

// 分片與方言別不一致必須擋下來。
assert.throws(() => createPaper({ shard: shards.get(1), dialect: dialectOf(2), seed: 1 }), /方言/);
assert.throws(() => createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed: -1 }), /seed/);

// 200 個 seed × 3 個方言（含少兩題的邵語 14），逐條檢查不變量。
const sampledDialects = [1, 14, 43];
const answerKeysSeen = { trueFalse: new Set(), choiceOne: new Set(), choiceTwo: new Set(), choiceThree: new Set() };

for (const dialectId of sampledDialects) {
  const shard = shards.get(dialectId);
  const dialect = dialectOf(dialectId);

  for (let seed = 1; seed <= 200; seed += 1) {
    const paper = createPaper({ shard, dialect, seed });
    assert.equal(paper.totalQuestions, 31);
    assert.equal(paper.listening.length, 4);
    assert.equal(paper.speaking.length, 3);
    assert.equal(flattenPaper(paper).length, 31);
    const flatParts = flattenPaper(paper).map((entry) => entry.section.part);
    assert.deepEqual([...new Set(flatParts)], ["speaking", "listening"], "作答順序必須是口說先、聽力後");
    assert.equal(flatParts[0], "speaking");
    assert.equal(flatParts[10], "speaking");
    assert.equal(flatParts[11], "listening");
    assert.equal(flatParts[30], "listening");
    assert.equal(paper.dialect.id, dialectId);
    for (const section of paper.listening) assert.equal(section.questions.length, 5);
    assert.equal(paper.speaking[0].questions.length, 5);
    assert.equal(paper.speaking[1].questions.length, 5);
    assert.equal(paper.speaking[2].questions.length, 1);

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

    // ── 選擇題(一)：三張圖，兩張干擾圖抽自同類別
    const choiceOne = paper.listening[1];
    assert.equal(choiceOne.id, "choiceOne");
    assert.equal(new Set(choiceOne.questions.map((q) => `${q.source.classNo}-${q.source.order}`)).size, 5,
      "選擇題(一) 五題必須來自不同題目");
    for (const question of choiceOne.questions) {
      answerKeysSeen.choiceOne.add(question.answerKey);
      assert.equal(question.options.length, 3);
      assert.deepEqual(question.options.map((o) => o.key), ["1", "2", "3"]);
      assert.equal(new Set(question.options.map((o) => o.imagePath)).size, 3, "三張圖必須相異");
      const correct = question.options.find((o) => o.key === question.answerKey);
      assert.equal(correct.order, question.source.order, "正解必須是被播出的那一題");
      assert.equal(question.prompt.indigenousText, correct.indigenousText);
      for (const option of question.options) {
        const item = shard.choiceOne.find((i) => i.imagePath === option.imagePath);
        assert.ok(item, "每個選項圖片都必須來自 choiceOne 題庫");
        assert.equal(item.classNo, question.source.classNo, "干擾圖必須來自同一個類別");
      }
      assert.ok(question.prompt.audioUrl.includes("/4choiceOne/"));
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

    // ── 選擇題(三)：三個拼寫文字，兩個干擾句抽自同類別
    const choiceThree = paper.listening[3];
    assert.equal(choiceThree.id, "choiceThree");
    assert.equal(new Set(choiceThree.questions.map((q) => `${q.source.classNo}-${q.source.order}`)).size, 5,
      "選擇題(三) 五題必須來自不同題目");
    for (const question of choiceThree.questions) {
      answerKeysSeen.choiceThree.add(question.answerKey);
      assert.equal(question.options.length, 3);
      assert.deepEqual(question.options.map((o) => o.key), ["1", "2", "3"]);
      assert.equal(new Set(question.options.map((o) => o.indigenousText)).size, 3, "三個拼寫必須互異");
      assert.ok(question.options.every((o) => !o.imagePath), "選擇題(三) 的選項不得有圖片");
      const correct = question.options.find((o) => o.key === question.answerKey);
      assert.equal(correct.order, question.source.order, "正解必須是被播出的那一題");
      assert.equal(question.prompt.indigenousText, correct.indigenousText);
      for (const option of question.options) {
        const record = shard.choiceThree.find((r) => r.indigenousText === option.indigenousText);
        assert.ok(record, "每個拼寫選項都必須來自 choiceThree 題庫");
        assert.equal(record.classNo, question.source.classNo, "干擾句必須來自同一個類別");
      }
      // 這一節不得走「音檔失敗就揭露族語文字」的降級——文字就是答案。
      assert.equal(question.revealOnAudioFailure, false);
      assert.ok(question.prompt.audioUrl.includes("/7choiceThree/"));
    }
    for (const section of [trueFalse, choiceOne, choiceTwo]) {
      for (const question of section.questions) {
        assert.notEqual(question.revealOnAudioFailure, false,
          `${section.id} 仍應保留音檔失敗時揭露文字的降級`);
      }
    }

    // ── 單句朗讀
    const sentenceReading = paper.speaking[0];
    assert.equal(sentenceReading.id, "sentenceReading");
    assert.equal(new Set(sentenceReading.questions.map((q) => q.expected)).size, 5, "單句朗讀五題必須相異");
    for (const question of sentenceReading.questions) {
      assert.equal(question.scorable, true);
      assert.equal(question.expected, question.prompt.indigenousText);
      assert.ok(question.prompt.referenceAudioUrl.includes("/8oralReading/"), "教材錄音要留著，但只在作答後提供");
      assert.equal(question.options, undefined, "朗讀題沒有選項");
      assert.ok(!("answerKey" in question), "朗讀題以逐字稿比對，不用 answerKey");
      // 刻意不要求「必須含空白」：布農、邵等語言把「天黑了！」說成單一個多式綜合詞，
      // 那仍然是一整句，不是初級那種單詞題。題材來自哪一個題型由 referenceAudioUrl 把關。
    }

    // ── 問答題
    const shortAnswer = paper.speaking[1];
    assert.equal(shortAnswer.id, "shortAnswer");
    assert.equal(shortAnswer.scorable, true);
    assert.equal(new Set(shortAnswer.questions.map((q) => q.prompt.indigenousText)).size, 5, "問答題五題的問句必須相異");
    for (const question of shortAnswer.questions) {
      assert.equal(question.scorable, true);
      assert.ok(!("answerKey" in question), "開放式題目不得有標準答案欄位");
      assert.ok(!("expected" in question), "開放式題目不得有標準答案欄位");
      assert.ok(question.prompt.audioUrl, "問答題要播出族語問句");
      assert.ok(question.prompt.chineseText.trim(), "問答題要有中文問句供語意粗判");
    }

    // ── 看圖表達
    const pictureTalk = paper.speaking[2];
    assert.equal(pictureTalk.id, "pictureTalk");
    assert.equal(pictureTalk.scorable, true);
    assert.equal(pictureTalk.questions.length, 1);
    {
      const question = pictureTalk.questions[0];
      assert.equal(question.scorable, true);
      assert.ok(question.prompt.tip.trim());
      assert.equal(question.prompt.imageUrls.length, 1, "高中版每題只有一張圖");
      for (const imageUrl of question.prompt.imageUrls) {
        assert.match(imageUrl, /^https:\/\/klokah\.tw\/extension\/sp_senior\/graphics_100x100\/pictureTalk\//);
      }
      assert.ok(question.reference.chineseText.trim());
      assert.ok(question.reference.audioUrl);
      assert.ok(!("answerKey" in question));
      assert.ok(!("expected" in question));
    }
  }
}

// 正解不能永遠落在同一個位置。
assert.deepEqual([...answerKeysSeen.trueFalse].sort(), ["O", "X"]);
assert.deepEqual([...answerKeysSeen.choiceOne].sort(), ["1", "2", "3"]);
assert.deepEqual([...answerKeysSeen.choiceTwo].sort(), ["1", "2", "3"]);
assert.deepEqual([...answerKeysSeen.choiceThree].sort(), ["1", "2", "3"]);

// 兩題看圖表達都要抽得到，不能永遠只出同一題。
{
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    seen.add(createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed }).speaking[2].questions[0].source.order);
  }
  assert.deepEqual([...seen].sort(), [1, 2], "兩題看圖表達都必須抽得到");
}

/* ══════════ 3. 計分 ══════════ */

assert.equal(OFFICIAL.listeningThreshold, 45);
assert.equal(OFFICIAL.speakingThreshold, 15);
assert.equal(OFFICIAL.quote,
  "初級與中級測驗採分項合格制度，考生須同時通過聽力與口說兩項測驗，其中聽力成績須達45分以上，口說成績須達15分以上，始核發該級別之合格證書");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("看圖表達"), "必須說明看圖表達已涵蓋");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("0–10"), "必須說明看圖表達滿分 10 分");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("每題 3 分"), "必須說明問答題每題 3 分");
assert.ok(SPEAKING_COVERAGE_NOTE.includes("詞語重疊程度"), "必須說明單句朗讀依重疊程度給分");
assert.equal(POINT_SCHEME.sentenceReading.max, 15);
assert.equal(POINT_SCHEME.shortAnswer.max, 15);
assert.equal(POINT_SCHEME.pictureTalk.max, 10);
assert.equal(POINT_SCHEME.listening.max, 60);
assert.equal(POINT_SCHEME.speakingMax, 40);
assert.equal(POINT_SCHEME.totalMax, 100);

// 「合格」二字只能出現在官方原文引用裡（該句原文本身有「合格制度」與「合格證書」兩處）。
assert.equal((scoringCode.match(/合格/g) ?? []).length, 2, "scoring.mjs 的程式碼只能在 OFFICIAL.quote 內出現「合格」");
assert.ok(scoringCode.indexOf("合格") > scoringCode.indexOf("export const OFFICIAL"));
assert.ok(scoringCode.lastIndexOf("合格") < scoringCode.indexOf("SPEAKING_COVERAGE_NOTE"));
// 計分模組不得偷偷宣告通過與否；converted 必須維持 null（練習得分放在 practice，不叫正式換算）。
for (const forbidden of ["passed", "isPass", "estimatedScore", "predictedScore"]) {
  assert.ok(!scoringCode.includes(forbidden), `scoring.mjs 不得出現 ${forbidden}`);
}

const samplePaper = createPaper({ shard: shards.get(1), dialect: dialectOf(1), seed: 4242 });
const listeningQuestions = samplePaper.listening.flatMap((section) => section.questions);
const sentenceQuestions = samplePaper.speaking[0].questions;
const shortQuestions = samplePaper.speaking[1].questions;
const pictureQuestions = samplePaper.speaking[2].questions;

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
  assert.equal(report.listening.pointsSum, 60);
  assert.equal(report.listening.maxPointsSum, 60);
  assert.equal(report.practice.listening, 60);
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

// ⑤ judgeSentenceReading：整句以詞語重疊率分段給分
{
  assert.deepEqual(SENTENCE_READING_THRESHOLDS.map((b) => b.points), [3, 2, 1]);

  const sentence = "Ira ku wacu nu maku.";
  assert.equal(judgeSentenceReading(sentence, sentence).status, "matched");
  assert.equal(judgeSentenceReading(sentence, sentence).points, 3);
  assert.equal(judgeSentenceReading(sentence, sentence).ratio, 1);
  assert.equal(judgeSentenceReading("  Ira ku wacu nu maku  ", sentence).points, 3, "前後空白與句末標點不影響");
  assert.equal(judgeSentenceReading("ira KU wacu nu maku", sentence).points, 3, "大小寫不影響");
  assert.equal(judgeSentenceReading("Ira ku luma’ nu maku.", "Ira ku luma' nu maku.").points, 3,
    "撇號是族語正寫法的一部分，彎引號與直引號視為相同，不得當標點吃掉");

  // 少一個詞 → 部分重疊；只剩兩個詞 → 更低；完全無關 → 0 分但仍不說使用者念錯。
  assert.equal(judgeSentenceReading("Ira ku wacu nu", sentence).status, "partial");
  assert.equal(judgeSentenceReading("Ira ku", sentence).status, "partial");
  assert.equal(judgeSentenceReading("Tueman tu haw", sentence).status, "mismatched");
  assert.equal(judgeSentenceReading("Tueman tu haw", sentence).points, 0);

  // 辨識失敗一律 undetermined，不得判成念錯。
  for (const bad of [null, undefined, "", "   ", 42]) {
    assert.equal(judgeSentenceReading(bad, sentence).status, "undetermined", `${bad} 應是無法判定`);
    assert.equal(judgeSentenceReading(bad, sentence).points, null);
  }
  assert.equal(judgeSentenceReading(sentence, "").status, "undetermined");
  assert.equal(judgeSentenceReading(".", sentence).status, "undetermined", "只有標點等於沒有詞");

  // 門檻邊界。教材 8 個詞、辨識出其中 k 個且沒有多餘詞時，F1 = 2k/(k+8)：
  //   k=7 → 0.933（3 分）、k=6 → 0.857（2 分）、k=3 → 0.545（1 分）、k=2 → 0.400（0 分）。
  const eight = "a b c d e f g h";
  assert.equal(judgeSentenceReading("a b c d e f g", eight).points, 3);
  assert.equal(judgeSentenceReading("a b c d e f", eight).points, 2);
  assert.equal(judgeSentenceReading("a b c", eight).points, 1);
  assert.equal(judgeSentenceReading("a b", eight).points, 0);
  // 多念一堆不相干的詞會拉低精確率：教材 8 個詞全中、但總共念了 16 個詞，
  // P=0.5、R=1、F1=0.667，只拿 1 分——不能只靠念滿關鍵詞就拿滿分。
  assert.equal(judgeSentenceReading("a b c d e f g h x y z w v u t s", eight).points, 1);
  // 重複詞用多重集合計數，不能靠重複同一個詞刷分。
  assert.equal(judgeSentenceReading("a a a a a a a a", eight).points, 0);
}

// ⑤b 問答題合理與否（合理 3 分）
{
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "很好").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "很好").points, 3);
  assert.equal(judgeShortAnswerTranslation("你是阿美族嗎？", "是").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你幾歲了？", "十二歲").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你現在在哪裡？", "我在學校").verdict, "reasonable");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "你好嗎").verdict, "unreasonable", "複誦問句不算回答");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "你好嗎").points, 0);
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "").verdict, "undetermined");
  assert.equal(judgeShortAnswerTranslation("你好嗎？", "").points, null);
}

// ⑤c 看圖表達給分（參考答案取自本卷教材，不寫死例句）
{
  const reference = pictureQuestions[0].reference.chineseText;
  assert.ok(reference.trim(), "試卷必須帶入教材中文參考答案");
  assert.equal(scorePictureTalkTranslation(reference, reference).points, 10);

  const contentChars = [...reference.replace(/[^一-鿿]/g, "")];
  const partial = contentChars.slice(0, Math.max(8, Math.floor(contentChars.length / 4))).join("");
  assert.ok(scorePictureTalkTranslation(partial, reference).points >= 1, "截取參考答案的片段應能拿到分數");

  const distractor = samplePaper.listening[2].questions
    .map((q) => q.prompt.chineseText)
    .find((zh) => scorePictureTalkTranslation(zh, reference).points === 0);
  assert.ok(distractor, "同卷應能找到與看圖表達參考答案無關的中文");
  assert.equal(scorePictureTalkTranslation(distractor, reference).points, 0);

  assert.equal(scorePictureTalkTranslation("", reference).status, "undetermined");
  assert.equal(scorePictureTalkTranslation(reference, "").status, "undetermined");
}

// ⑤d 語意評分介面（預設 heuristic；LLM 可替換）
{
  assert.equal(activeSemanticJudge.id, "heuristic");
  assert.equal(typeof activeSemanticJudge.judgeShortAnswer, "function");
  assert.equal(typeof activeSemanticJudge.scorePictureTalk, "function");
  assert.equal(
    (await activeSemanticJudge.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "很好", transcript: "x" })).points,
    3,
  );
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
  // LLM 給超過滿分也要夾回 3 分。
  const generous = createLlmSemanticJudge({ model: "mock", complete: async () => '{"verdict":"reasonable","points":9}' });
  assert.equal((await generous.judgeShortAnswer({ questionChinese: "你好嗎？", translation: "很好" })).points, 3);
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
    ...Object.fromEntries(sentenceQuestions.map((q, index) => [q.id, index === 0
      ? { attempted: true, transcript: q.expected }
      : index === 1
        // 刻意用完全不相干的詞：句長因方言而異，砍掉一個詞未必掉出 matched 區間。
        ? { attempted: true, transcript: "zzzq wwwx yyyv" }
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
  const sentence = report.speaking.sentenceReading;
  assert.equal(sentence.total, 5);
  assert.equal(sentence.matched, 1);
  assert.equal(sentence.mismatched, 1);
  assert.equal(sentence.partial, 0);
  assert.equal(sentence.undetermined, 1, "辨識失敗歸入無法判定");
  assert.equal(sentence.skipped, 2);
  assert.equal(sentence.scored, true);
  assert.equal(sentence.maxPointsSum, 15);
  assert.equal(sentence.pointsSum, 3, "只有完全重疊的那題拿到 3 分");
  assert.equal(sentence.review[0].points, 3);
  assert.equal(sentence.review[1].points, 0, "重疊很少記 0 分，但狀態不是「念錯」");
  assert.equal(sentence.review[2].points, null, "無法判定不得記成 0 分");
  assert.equal(sentence.review[2].asrError, "辨識服務逾時");
  assert.equal(sentence.review[0].ratio, 1);

  const short = report.speaking.shortAnswer;
  assert.equal(short.scored, true, "問答題會粗判是否合理");
  assert.equal(short.reasonable, 2);
  assert.equal(short.undetermined, 1);
  assert.equal(short.skipped, 2);
  assert.equal(short.pointsSum, 6, "合理 2 題 × 3 分");
  assert.equal(short.maxPointsSum, 15);
  assert.ok("reasonable" in short && "unreasonable" in short);

  const picture = report.speaking.pictureTalk;
  assert.equal(picture.scored, true);
  assert.equal(picture.total, 1);
  assert.equal(picture.scoredCount, 1);
  assert.equal(picture.pointsSum, 10);
  assert.equal(picture.maxPointsSum, 10);
  assert.equal(report.speaking.coverageNote, SPEAKING_COVERAGE_NOTE);
  assert.equal(report.speaking.maxPointsSum, 40, "口說滿分 40");
  assert.equal(report.speaking.pointsSum, 3 + 6 + 10);
  assert.equal(report.practice.speaking, 19);
  assert.equal(report.practice.total, 19, "口說 19 + 聽力 0");
  assert.equal(report.practice.totalMax, 100);

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
assert.ok(page.includes('href="/apps/intermediate-mock-exam/styles.css"'));
assert.ok(page.includes('src="/apps/intermediate-mock-exam/app.mjs"'));
assert.ok(page.includes('href="/apps/body-parts-practice/styles.css"'), "沿用共用的視覺系統");
assert.ok(page.indexOf('href="/apps/body-parts-practice/styles.css"') < page.indexOf('href="/apps/intermediate-mock-exam/styles.css"'),
  "必須先連共用樣式表，本頁的樣式才是 delta");
assert.ok(!page.includes('href="styles.css"'));
assert.ok(!page.includes('src="app.mjs"'));
assert.ok(page.includes('href="/"'), "必須有返回 AI 實驗室的連結");
assert.ok(page.includes("認證模擬 · MISSION 02"), "hero 標籤是分類內的卡片序號");

// klokah 不送 CORS 標頭：加 crossorigin 會讓音檔完全播不出來。
assert.ok(!/crossorigin/.test(page), "音檔元素不得加 crossorigin");
assert.ok(page.includes('id="player"') && page.includes('preload="none"'), "不得預先載入音檔");

// 共用樣式表的 figure{display:grid} 會蓋掉 [hidden]，本頁靠 hidden 切換題型，
// 必須自己把 [hidden] 補回來，否則上一題的圖片會殘留在下一題。
const styles = read("apps/intermediate-mock-exam/styles.css");
assert.ok(/\[hidden\]\{display:none ?!important\}/.test(styles),
  "樣式表必須補上 [hidden]{display:none !important}");
// 固定在底部的導覽列會蓋住選項圖片。
assert.ok(!/\.quiz-actions\{[^}]*position:sticky/.test(styles), "導覽列不得 sticky，會蓋住選項圖片");

// 整張選項卡片都要可點。
assert.ok(/\.option label::after\{[^}]*position:absolute[^}]*inset:0/.test(styles),
  "label 必須用 ::after 把命中範圍撐滿整張卡片");
assert.ok(/\.option\{[^}]*position:relative/.test(styles), "卡片必須是定位祖先，覆蓋層才會對齊卡片");
assert.ok(/\.option--audio \.option-play\{[^}]*position:relative[^}]*z-index:1/.test(styles),
  "播放鈕必須浮在 label 覆蓋層之上");
// 選擇題(三) 是中級才有的版面。
assert.ok(/\.options-grid\[data-layout=text\]/.test(styles), "必須有選擇題(三) 的文字選項版面");
assert.ok(/\.option--text \.option-ab\{/.test(styles), "族語拼寫要有自己的字級，才看得出拼寫差異");
assert.ok(appCode.includes('layout === "text"'), "app.mjs 必須渲染文字選項");
// 單句朗讀的部分重疊狀態要有自己的視覺。
assert.ok(/data-status=partial/.test(styles), "partial 狀態必須有樣式");

// 三個步驟的初始可見性。
assert.ok(/<section id="quiz"[^>]*\shidden/.test(page), "作答區初始必須隱藏");
assert.ok(/<section id="report"[^>]*\shidden/.test(page), "成績單初始必須隱藏");

// 練習導向：每題確定後即時回饋，不得再有交卷。
assert.ok(page.includes('id="confirm"'), "必須有確定按鈕");
assert.ok(page.includes('id="feedback"'), "必須有即時回饋區");
assert.ok(page.includes('id="end-practice"'), "必須有結束練習按鈕");
assert.ok(!page.includes('id="finish"'), "不得有交卷按鈕");
assert.ok(!page.includes(">交卷<"), "文案不得出現交卷");
assert.ok(page.includes("立刻告訴你對錯") || page.includes("立刻顯示對錯"), "必須說明確定後立刻給回饋");
assert.ok(appSource.includes("activeSemanticJudge"), "問答題／看圖表達必須走語意評分介面");
assert.ok(appSource.includes("confirmed"), "確定後必須標記 confirmed");
assert.ok(appSource.includes("showListeningFeedback") || appSource.includes("答對了"), "聽力確定後必須顯示對錯");

// 揭露都必須在作答區之前。
const quizAt = page.indexOf('id="quiz"');
for (const [label, needle] of [
  ["範圍", "notice--scope"],
  ["改編說明", "notice--adaptation"],
  ["外部服務（音檔外連＋錄音隱私）", "notice--privacy"],
  ["辨識限制與無障礙", "notice--a11y"],
]) {
  const at = page.indexOf(needle);
  assert.ok(at > -1, `頁面缺少${label}揭露`);
  assert.ok(at < quizAt, `${label}揭露必須出現在作答區之前`);
}
// 中級特有的兩項揭露。
for (const [label, needle] of [
  ["選擇題(三) 的族語選項先顯示", "選擇題(三) 的族語拼寫作答前就看得到"],
  ["口說說明是本站措辭", "口說三段是本站措辭"],
]) {
  const at = page.indexOf(needle);
  assert.ok(at > -1, `頁面缺少「${label}」的揭露`);
  assert.ok(at < quizAt, `「${label}」必須出現在作答區之前`);
}
assert.ok(page.match(/class="notice /g).length <= 4, "作答前的揭露最多四塊——太多就會整段被略過");
assert.ok(page.includes("klokah.tw"), "必須揭露音檔由 klokah.tw 播放");
assert.ok(page.includes("IP 位址"), "必須揭露 IP 位址會被對方看到");
assert.ok(page.includes("ai3.iformosa.com.tw"), "必須揭露錄音送往何處");
assert.ok(page.includes("請不要錄入個人資料"), "必須提醒不要錄入個資");
assert.ok(page.includes("CC BY-NC-SA 4.0"), "頁尾必須有教材授權標示");
assert.ok(page.includes("web.klokah.tw/extension/sp_senior/"), "頁尾必須標示高中版的原著作網址");
assert.ok(page.includes(OFFICIAL.quote), "成績單必須引用中級的官方及格標準原文");

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
// 選擇題(三) 的降級不得揭露族語文字——文字就是答案。
assert.ok(/revealOnAudioFailure === false/.test(appCode), "選擇題(三) 必須走不揭露文字的降級分支");
assert.ok(appSource.includes("這一節必須用聽的才能作答"), "不揭露文字時必須說明原因");
// klokah 沒有 CORS，用 fetch 取音檔一定失敗。
assert.ok(!/fetch\([^)]*klokah/.test(appCode), "不得用 fetch 取 klokah 音檔");
assert.ok(!/fetch\([^)]*klokah/.test(recorderCode));

/* ══════════ 6. 口說紅線（沿用既有應用的規則） ══════════ */

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
const withoutNegations = (text) => text
  .replaceAll("這不代表你念錯", "")
  .replaceAll("不代表你念錯", "")
  .replaceAll("不是你念錯", "");
for (const forbidden of ["你念錯", "發音錯誤", "發音不正確", "念錯了", "唸錯"]) {
  assert.ok(!withoutNegations(appSource).includes(forbidden), `不得出現「${forbidden}」這種斷言發音的措辭`);
  assert.ok(!withoutNegations(page).includes(forbidden), `不得出現「${forbidden}」這種斷言發音的措辭`);
  assert.ok(!withoutNegations(scoringSource).includes(forbidden), `不得出現「${forbidden}」這種斷言發音的措辭`);
}
assert.ok(appSource.includes("這不代表你念錯"), "重疊低時必須說明這不代表念錯");
assert.ok(appSource.includes("系統聽到的"), "必須顯示系統聽到的內容");
assert.ok(appSource.includes("尚未被判錯"), "辨識失敗時必須說明尚未被判錯");
assert.ok(page.includes("不代表你念錯"), "揭露區必須說明族級模型的偏差不代表念錯");
// 單句朗讀的措辭只描述重疊程度，不描述對錯。
assert.ok(appSource.includes("詞語重疊程度"), "單句朗讀必須以「詞語重疊程度」描述結果");
for (const forbidden of ["念得正確", "朗讀正確", "朗讀錯誤"]) {
  assert.ok(!appSource.includes(forbidden), `不得出現「${forbidden}」`);
}

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
                        "apps/body-parts-practice/core.mjs", "apps/body-parts-speaking/asr.mjs",
                        "apps/beginner-mock-exam/app.mjs", "apps/beginner-mock-exam/paper.mjs",
                        "apps/beginner-mock-exam/scoring.mjs", "apps/beginner-mock-exam/index.html"]) {
  assert.ok(!read(relative).includes("intermediate-mock-exam"), `${relative} 不得被本次改動`);
  assert.ok(!read(relative).includes("klokah-senior"), `${relative} 不得改用高中版語料`);
}
// 初級仍然吃國中版語料。
assert.ok(read("apps/beginner-mock-exam/app.mjs").includes("/data/klokah-junior"), "初級的語料路徑不得被動到");

console.log("PASS: 42 shards / 154 images / no audio in repo, 4+3 sections, 200 seeds × 3 dialects invariants, honest scoring, page contract, audio degradation, ASR red lines");
