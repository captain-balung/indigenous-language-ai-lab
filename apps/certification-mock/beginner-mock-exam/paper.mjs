/**
 * 初級口說模擬站 · 出卷器（純邏輯，可在 Node 測試）
 *
 * 這裡沒有 DOM、沒有 fetch、沒有 Date。createPaper 內不呼叫 Math.random——
 * 亂數一律來自傳入的 seed，同一個 seed 必定產生同一份試卷。
 *
 * 各節的作答說明採用 Lokahsu 官方「考試題型」頁面的原文；本站與正式測驗
 * 不同的地方寫在 adaptationNote，頁面必須一併顯示。
 *
 * 題材來源（klokah 句型篇國中版）——本站只出初級口說三題型：
 *   口說 · 單詞朗讀  → shard.word         （typeId 1 基本詞彙）
 *   口說 · 簡答題    → shard.dialogue     （typeId 9 簡短對話）
 *   口說 · 看圖說話  → shard.pictureTalk  （typeId 10；每方言 1 題）
 */

import { createQuestionDeck } from "../../basic-learning/body-parts-practice/core.mjs";
import { preferFirstAlt } from "../../shared/prefer-first-alt.mjs";

const QUESTIONS_PER_SECTION = 5;

/** 官方作答說明原文，以及本站的改編說明。 */
export const SECTION_SPECS = [
  {
    id: "wordReading",
    part: "speaking",
    no: 1,
    title: "口說第一部分：單詞朗讀",
    instruction: "請看著螢幕上的族語詞彙念出來。",
    adaptationNote: "",
    scorable: true,
  },
  {
    id: "shortAnswer",
    part: "speaking",
    no: 2,
    title: "口說第二部分：簡答題",
    instruction: "請聽電腦播出一個族語問句，然後用族語回答。",
    adaptationNote: "",
    scorable: true,
  },
  {
    id: "pictureTalk",
    part: "speaking",
    no: 3,
    title: "口說第三部分：看圖說話",
    instruction: "請根據下面四個圖片及中文提示，選擇一個、兩個、三個或全部的圖片，以族語簡短地說說你的想法。作答時間約2 分鐘。",
    adaptationNote: "",
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

// ── 口說第一部分：單詞朗讀 ────────────────────────────────
// 來源：shard.word（typeId 1 基本詞彙）
// 官方單詞朗讀本來就是看著念，所以這裡顯示族語拼寫。
// 教材錄音只在成績單提供——作答前就播會變成跟讀，不是朗讀。
function buildWordReading(shard, rng) {
  const spec = sectionSpecById("wordReading");
  // 教材在不同類別之間可能有相同拼寫，先去重再抽，避免一節出現兩次同一詞。
  const seen = new Set();
  const pool = [];
  for (const word of shard.word) {
    if (seen.has(word.indigenousText)) continue;
    seen.add(word.indigenousText);
    pool.push(word);
  }
  const words = drawDistinct(pool, QUESTIONS_PER_SECTION, rng);

  const questions = words.map((word, index) => {
    const indigenousText = preferFirstAlt(word.indigenousText);
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: {
        indigenousText,
        chineseText: preferFirstAlt(word.chineseText),
        referenceAudioUrl: word.audioUrl,
      },
      expected: indigenousText,
      source: { family: "word", classId: word.classId, classNo: word.classNo, order: word.order },
    };
  });

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
      indigenousText: preferFirstAlt(question.indigenousText),
      chineseText: preferFirstAlt(question.chineseText),
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
      tip: preferFirstAlt(item.tip),
      imageUrls: [...item.imageUrls],
    },
    reference: {
      indigenousText: preferFirstAlt(item.indigenousText),
      chineseText: preferFirstAlt(item.chineseText),
      audioUrl: item.audioUrl,
    },
    source: { family: "pictureTalk", classId: item.classId, classNo: item.classNo, order: item.order },
  }];

  return makeSection(spec, questions);
}

/**
 * 產生一份口說練習卷（11 題）。
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
  const speaking = [buildWordReading(shard, rng), buildShortAnswer(shard, rng), buildPictureTalk(shard, rng)];
  const listening = [];

  return {
    paperId: seedToPaperId(seed),
    seed,
    dialect: { id: dialect.id, name: dialect.name, ethnicity: dialect.ethnicity, code: dialect.code },
    listening,
    speaking,
    totalQuestions: speaking.reduce((sum, section) => sum + section.questions.length, 0),
  };
}

/** 依作答順序攤平成一維題目清單，供頁面逐題導覽。 */
export function flattenPaper(paper) {
  return [...paper.speaking, ...paper.listening].flatMap((section) =>
    section.questions.map((question) => ({ section, question })),
  );
}
