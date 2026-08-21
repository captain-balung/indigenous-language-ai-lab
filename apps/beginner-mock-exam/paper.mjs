/**
 * 初級模擬站 · 出卷器（純邏輯，可在 Node 測試）
 *
 * 這裡沒有 DOM、沒有 fetch、沒有 Date。createPaper 內不呼叫 Math.random——
 * 亂數一律來自傳入的 seed，同一個 seed 必定產生同一份試卷。
 *
 * 各節的作答說明採用 Lokahsu 官方「考試題型」頁面的原文；本站與正式測驗
 * 不同的地方寫在 adaptationNote，頁面必須一併顯示。
 *
 * 題材來源（klokah 句型篇國中版）：
 *   口說 · 單詞朗讀  → shard.word         （typeId 1 基本詞彙）
 *   口說 · 簡答題    → shard.dialogue     （typeId 9 簡短對話）
 *   口說 · 看圖說話  → shard.pictureTalk  （typeId 10；每方言 1 題）
 *   聽力 · 是非題    → shard.recognize    （typeId 3 看圖識字）
 *   聽力 · 選擇題(一) → shard.choiceOne    （typeId 4）
 *   聽力 · 選擇題(二) → shard.choiceTwo    （typeId 5）
 *   聽力 · 配合題    → shard.match        （typeId 6）
 */

import { createQuestionDeck } from "../body-parts-practice/core.mjs";

const LETTERS_ABC = ["A", "B", "C"];
const LETTERS_ABCDE = ["A", "B", "C", "D", "E"];
const QUESTIONS_PER_SECTION = 5;

/** 官方作答說明原文，以及本站的改編說明。 */
export const SECTION_SPECS = [
  {
    id: "trueFalse",
    part: "listening",
    no: 1,
    title: "第一部分：是非題",
    instruction: "試卷上每題都有一個圖片，請聽電腦播出一個族語句子，若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」，並在答案卡上作答。每題播出兩遍。",
    adaptationNote: "本站沒有答案卡，直接在畫面上選。按「確定」後立刻告訴你對錯。你可以重複播放，正式測驗只播兩遍。",
    scorable: true,
  },
  {
    id: "choiceOne",
    part: "listening",
    no: 2,
    title: "第二部分：選擇題(一)",
    instruction: "試卷上每題有三個圖片，請聽電腦播出一個族語句子後，選一個與所聽到語意最相符的圖片，並在答案卡上作答。每題播出兩遍。",
    adaptationNote: "本站沒有答案卡，直接在畫面上選。按「確定」後立刻告訴你對錯。你可以重複播放，正式測驗只播兩遍。",
    scorable: true,
  },
  {
    id: "choiceTwo",
    part: "listening",
    no: 3,
    title: "第三部分：選擇題(二)",
    instruction: "請聽電腦播出一個中文句子及三句族語句子後，選出與中文句子語意最接近的族語句子，並在答案卡上作答。每題播出兩遍。",
    adaptationNote: "正式測驗會播出中文句子；本站因教材沒有中文錄音，改以文字呈現。三句族語仍然只能用聽的。按「確定」後立刻告訴你對錯。",
    scorable: true,
  },
  {
    id: "match",
    part: "listening",
    no: 4,
    title: "第四部分：配合題",
    instruction: "請聽電腦播出一個族語簡短對話後，在五個圖片中，選出相關的圖片來，並在答案卡上作答。每題播出兩遍。",
    adaptationNote: "本站每題的五張圖片來自同一組對話；正式測驗是五題共用一組圖片。按「確定」後立刻告訴你對錯。",
    scorable: true,
  },
  {
    id: "wordReading",
    part: "speaking",
    no: 1,
    title: "口說第一部分：單詞朗讀",
    instruction: "請看著螢幕上的族語詞彙念出來。",
    adaptationNote: "按「確定」後用語音辨識比對你念的內容與教材拼寫（相符得 2 分）。辨識結果只是參考，不代表正式測驗的評分。",
    scorable: true,
  },
  {
    id: "shortAnswer",
    part: "speaking",
    no: 2,
    title: "口說第二部分：簡答題",
    instruction: "請聽電腦播出一個族語問句，然後用族語回答。",
    adaptationNote: "按「確定」後：語音辨識→翻成中文→粗判是否合理（合理得 4 分）。這是練習用的機器判斷，不是正式測驗評分。",
    scorable: true,
  },
  {
    id: "pictureTalk",
    part: "speaking",
    no: 3,
    title: "口說第三部分：看圖說話",
    instruction: "請根據下面四個圖片及中文提示，選擇一個、兩個、三個或全部的圖片，以族語簡短地說說你的想法。作答時間約2 分鐘。",
    adaptationNote: "按「確定」後：語音辨識→翻成中文→對照教材參考答案給 0–10 分。這是練習用的機器粗評，不是正式測驗評分。",
    scorable: true,
  },
];

export const sectionSpecById = (id) => SECTION_SPECS.find((spec) => spec.id === id);

/** mulberry32：小、快、夠均勻，且完全可重現。 */
export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 這是本模組唯一不純的匯出，createPaper 不會用到它。 */
export function randomSeed() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] >>> 0;
}

export function seedToPaperId(seed) {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

export function paperIdToSeed(paperId) {
  const value = Number.parseInt(String(paperId ?? "").trim(), 36);
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value >>> 0 : null;
}

export function pickOne(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/** Fisher–Yates，不改動原陣列。 */
export function shuffle(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawDistinct(pool, count, rng) {
  if (pool.length < count) throw new Error(`題庫只有 ${pool.length} 題，抽不出 ${count} 題`);
  const deck = createQuestionDeck(pool, rng);
  return Array.from({ length: count }, () => deck.next());
}

function makeSection(spec, questions) {
  return {
    id: spec.id,
    part: spec.part,
    no: spec.no,
    title: spec.title,
    instruction: spec.instruction,
    adaptationNote: spec.adaptationNote,
    scorable: spec.scorable,
    questions,
  };
}

// ── 第一部分：是非題 ──────────────────────────────────────
// 來源：shard.recognize（typeId 3 看圖識字）
// 播目標句的錄音，但顯示的圖片有時候是同類別的別題——那時候答案就是 X。
function buildTrueFalse(shard, rng) {
  const spec = sectionSpecById("trueFalse");
  const targets = drawDistinct(shard.recognize, QUESTIONS_PER_SECTION, rng);

  // 5 個 bit 決定每題的真假；排除全 O 與全 X，免得整節可以用同一個答案通吃。
  const truthBits = 1 + Math.floor(rng() * 30);

  const questions = targets.map((target, index) => {
    const isTrue = ((truthBits >> index) & 1) === 1;
    let shown = target;
    if (!isTrue) {
      const sameClass = shard.recognize.filter(
        (record) => record.classNo === target.classNo && record.imagePath !== target.imagePath,
      );
      shown = pickOne(sameClass, rng);
    }
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: {
        audioUrl: target.audioUrl,
        imagePath: shown.imagePath,
        // 作答階段不得渲染；只有音檔載入失敗或成績單才揭露。
        indigenousText: target.indigenousText,
        chineseText: target.chineseText,
      },
      options: [
        { key: "O", label: "O（符合）" },
        { key: "X", label: "X（不符合）" },
      ],
      answerKey: isTrue ? "O" : "X",
      source: { family: "recognize", classId: target.classId, classNo: target.classNo, order: target.order },
    };
  });

  return makeSection(spec, questions);
}

// ── 第二部分：選擇題(一) ──────────────────────────────────
// 來源：shard.choiceOne（typeId 4）
// 播其中一個選項的錄音，三張圖片打散後讓使用者挑。
function buildChoiceOne(shard, rng) {
  const spec = sectionSpecById("choiceOne");
  const items = drawDistinct(shard.choiceOne, QUESTIONS_PER_SECTION, rng);

  const questions = items.map((item, index) => {
    const letter = pickOne(LETTERS_ABC, rng);
    const spoken = item.options.find((option) => option.letter === letter);
    const options = shuffle(item.options, rng).map((option, position) => ({
      key: String(position + 1),
      letter: option.letter,
      imagePath: option.imagePath,
      indigenousText: option.indigenousText,
      chineseText: option.chineseText,
    }));
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: {
        audioUrl: spoken.audioUrl,
        indigenousText: spoken.indigenousText,
        chineseText: spoken.chineseText,
      },
      options,
      answerKey: options.find((option) => option.letter === letter).key,
      source: { family: "choiceOne", classId: item.classId, classNo: item.classNo, order: item.order, letter },
    };
  });

  return makeSection(spec, questions);
}

// ── 第三部分：選擇題(二) ──────────────────────────────────
// 來源：shard.choiceTwo（typeId 5）
// 中文以文字呈現（教材沒有中文錄音），三句族語各自有錄音。
// 這是唯一完全不需要視覺的一節。
function buildChoiceTwo(shard, rng) {
  const spec = sectionSpecById("choiceTwo");
  const items = drawDistinct(shard.choiceTwo, QUESTIONS_PER_SECTION, rng);

  const questions = items.map((item, index) => {
    const letter = pickOne(LETTERS_ABC, rng);
    const target = item.options.find((option) => option.letter === letter);
    const options = shuffle(item.options, rng).map((option, position) => ({
      key: String(position + 1),
      letter: option.letter,
      audioUrl: option.audioUrl,
      indigenousText: option.indigenousText,
      chineseText: option.chineseText,
    }));
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: { chineseText: target.chineseText },
      options,
      answerKey: options.find((option) => option.letter === letter).key,
      source: { family: "choiceTwo", classId: item.classId, classNo: item.classNo, order: item.order, letter },
    };
  });

  return makeSection(spec, questions);
}

// ── 第四部分：配合題 ──────────────────────────────────────
// 來源：shard.match（typeId 6）
// 播同一組五段對話裡的其中一段，五張圖片打散後讓使用者挑。
function buildMatch(shard, rng) {
  const spec = sectionSpecById("match");
  const items = drawDistinct(shard.match, QUESTIONS_PER_SECTION, rng);

  const questions = items.map((item, index) => {
    const letter = pickOne(LETTERS_ABCDE, rng);
    const spoken = item.dialogues.find((dialogue) => dialogue.letter === letter);
    const options = shuffle(item.dialogues, rng).map((dialogue, position) => ({
      key: String(position + 1),
      letter: dialogue.letter,
      imageIndex: dialogue.imageIndex,
      imagePath: dialogue.imagePath,
      indigenousText: `${dialogue.question.indigenousText} ／ ${dialogue.answer.indigenousText}`,
      chineseText: `${dialogue.question.chineseText} ／ ${dialogue.answer.chineseText}`,
    }));
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: {
        audioUrl: spoken.audioUrl,
        indigenousText: `${spoken.question.indigenousText} ／ ${spoken.answer.indigenousText}`,
        chineseText: `${spoken.question.chineseText} ／ ${spoken.answer.chineseText}`,
      },
      options,
      answerKey: options.find((option) => option.letter === letter).key,
      source: { family: "match", classId: item.classId, classNo: item.classNo, order: item.order, letter },
    };
  });

  return makeSection(spec, questions);
}

// ── 口說第一部分：單詞朗讀 ────────────────────────────────
// 來源：shard.word（typeId 1 基本詞彙）——六節裡唯一下基本詞彙的。
// 官方單詞朗讀本來就是看著念，所以這裡顯示族語拼寫。
// 教材錄音只在作答後提供——作答前就播會變成跟讀，不是朗讀。
function buildWordReading(shard, rng) {
  const spec = sectionSpecById("wordReading");
  const words = drawDistinct(shard.word, QUESTIONS_PER_SECTION, rng);

  const questions = words.map((word, index) => ({
    id: `${spec.id}-${index + 1}`,
    sectionId: spec.id,
    no: index + 1,
    scorable: true,
    prompt: {
      indigenousText: word.indigenousText,
      chineseText: word.chineseText,
      referenceAudioUrl: word.audioUrl,
    },
    expected: word.indigenousText,
    source: { family: "word", classId: word.classId, classNo: word.classNo, order: word.order },
  }));

  return makeSection(spec, questions);
}

// ── 口說第二部分：簡答題 ──────────────────────────────────
// 來源：shard.dialogue（typeId 9 簡短對話）
// 開放式回答沒有標準答案；本站以 ASR→翻譯→問句語意粗判是否合理。
function buildShortAnswer(shard, rng) {
  const spec = sectionSpecById("shortAnswer");

  // 教材在不同 order 之間有重複的問句（例如「你好嗎？」），先去重再抽。
  const seen = new Set();
  const pool = [];
  for (const item of shard.dialogue) {
    for (const question of item.questions) {
      if (seen.has(question.indigenousText)) continue;
      seen.add(question.indigenousText);
      pool.push({ ...question, classId: item.classId, classNo: item.classNo, order: item.order });
    }
  }

  const picked = drawDistinct(pool, QUESTIONS_PER_SECTION, rng);
  const questions = picked.map((question, index) => ({
    id: `${spec.id}-${index + 1}`,
    sectionId: spec.id,
    no: index + 1,
    scorable: true,
    prompt: {
      audioUrl: question.audioUrl,
      indigenousText: question.indigenousText,
      chineseText: question.chineseText,
    },
    source: { family: "dialogue", classId: question.classId, classNo: question.classNo, order: question.order, letter: question.letter },
  }));

  return makeSection(spec, questions);
}

// ── 口說第三部分：看圖說話 ────────────────────────────────
// 來源：shard.pictureTalk（typeId 10）；國中版每方言 1 題（order 1）。
// 開放式口說，正式測驗由委員評分；本站以 ASR→翻譯→參考答案部分給分。
function buildPictureTalk(shard, rng) {
  const spec = sectionSpecById("pictureTalk");
  const pool = (shard.pictureTalk ?? []).filter((item) => item.tip && item.chineseText && item.imageUrls?.length === 4);
  if (pool.length < 1) throw new Error("這個方言別沒有可用的看圖說話題材");
  const item = pickOne(pool, rng);

  const questions = [{
    id: `${spec.id}-1`,
    sectionId: spec.id,
    no: 1,
    scorable: true,
    prompt: {
      tip: item.tip,
      imageUrls: [...item.imageUrls],
    },
    reference: {
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
      audioUrl: item.audioUrl,
    },
    source: { family: "pictureTalk", classId: item.classId, classNo: item.classNo, order: item.order },
  }];

  return makeSection(spec, questions);
}

/**
 * 產生一份完整試卷。
 *
 * @param {object} args
 * @param {object} args.shard   data/klokah-junior/dialects/{id}.json 的內容
 * @param {object} args.dialect { id, name, ethnicity, code }
 * @param {number} args.seed    32-bit 無號整數
 */
export function createPaper({ shard, dialect, seed }) {
  if (!shard || typeof shard !== "object") throw new Error("createPaper 需要方言分片資料");
  if (!dialect || typeof dialect !== "object") throw new Error("createPaper 需要方言別資訊");
  if (!Number.isInteger(seed) || seed < 0) throw new Error("createPaper 需要非負整數 seed");
  if (shard.dialectId !== dialect.id) throw new Error(`分片是方言 ${shard.dialectId}，但傳入的方言別是 ${dialect.id}`);

  const rng = createRng(seed);
  const listening = [buildTrueFalse(shard, rng), buildChoiceOne(shard, rng), buildChoiceTwo(shard, rng), buildMatch(shard, rng)];
  const speaking = [buildWordReading(shard, rng), buildShortAnswer(shard, rng), buildPictureTalk(shard, rng)];

  return {
    paperId: seedToPaperId(seed),
    seed,
    dialect: { id: dialect.id, name: dialect.name, ethnicity: dialect.ethnicity, code: dialect.code },
    listening,
    speaking,
    totalQuestions: [...speaking, ...listening].reduce((sum, section) => sum + section.questions.length, 0),
  };
}

/** 依作答順序攤平成一維題目清單，供頁面逐題導覽（口說先、聽力後）。 */
export function flattenPaper(paper) {
  return [...paper.speaking, ...paper.listening].flatMap((section) =>
    section.questions.map((question) => ({ section, question })),
  );
}
