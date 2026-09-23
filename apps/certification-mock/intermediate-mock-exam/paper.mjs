/**
 * 中級模擬站 · 出卷器（純邏輯，可在 Node 測試）
 *
 * 這裡沒有 DOM、沒有 fetch、沒有 Date。createPaper 內不呼叫 Math.random——
 * 亂數一律來自傳入的 seed，同一個 seed 必定產生同一份試卷。
 *
 * 四段聽力的作答說明採用 Lokahsu 官方「考試題型／中級」頁面的原文
 * （instructionSource: "official"）；三段口說官方沒有公開原文，是本站措辭
 * （instructionSource: "site"）。頁面必須把這個差別連同 adaptationNote 一起顯示。
 *
 * 題材來源（klokah 句型篇高中版）：
 *   口說 · 單句朗讀   → shard.oralReading （typeId 8 唸唸看；每題 5 句）
 *   口說 · 問答題     → shard.dialogue    （typeId 9 簡短對話；每題 5 問句）
 *   口說 · 看圖表達   → shard.pictureTalk （typeId 10；每方言 2 題，各 1 張圖）
 *   聽力 · 是非題     → shard.recognize   （typeId 3 看圖識字）
 *   聽力 · 選擇題(一) → shard.choiceOne   （typeId 4；每題 1 圖 1 音）
 *   聽力 · 選擇題(二) → shard.choiceTwo   （typeId 5；每題 3 段族語錄音）
 *   聽力 · 選擇題(三) → shard.choiceThree （typeId 7；純文字 + 音檔）
 */

import { createQuestionDeck } from "../../basic-learning/body-parts-practice/core.mjs";

const LETTERS_ABC = ["A", "B", "C"];
const QUESTIONS_PER_SECTION = 5;
const OPTIONS_PER_IMAGE_QUESTION = 3;
const OPTIONS_PER_TEXT_QUESTION = 3;

/** 官方作答說明原文（聽力）、本站措辭（口說），以及本站的改編說明。 */
export const SECTION_SPECS = [
  {
    id: "trueFalse",
    part: "listening",
    no: 1,
    title: "第一部分：是非題",
    instruction: "試卷上每題都有一個圖片，請聽電腦播出一個族語句子，若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」，並在答案卡上作答。每題播出兩遍。",
    instructionSource: "official",
    adaptationNote: "本站沒有答案卡，直接在畫面上選。按「確定」後立刻告訴你對錯。你可以重複播放，正式測驗只播兩遍。",
    scorable: true,
  },
  {
    id: "choiceOne",
    part: "listening",
    no: 2,
    title: "第二部分：選擇題(一)",
    instruction: "試卷上每題有三個圖片，請聽電腦播出一個族語句子後，選一個與所聽到語意最相符的圖片，並在答案卡上作答。每題播出兩遍。",
    instructionSource: "official",
    adaptationNote: "本站的三張圖片抽自同一個類別的三題教材；正式測驗的干擾圖由命題委員挑選。按「確定」後立刻告訴你對錯。",
    scorable: true,
  },
  {
    id: "choiceTwo",
    part: "listening",
    no: 3,
    title: "第三部分：選擇題(二)",
    instruction: "請聽電腦播出一個中文句子及三句族語句子後，選出與中文句子語意最接近的族語句子，並在答案卡上作答。每題播出兩遍。",
    instructionSource: "official",
    adaptationNote: "正式測驗會播出中文句子；本站因教材沒有中文錄音，改以文字呈現。三句族語仍然只能用聽的。按「確定」後立刻告訴你對錯。",
    scorable: true,
  },
  {
    // 官方頁面寫的是「第四部份」（份，不是分），逐字引用不改。
    id: "choiceThree",
    part: "listening",
    no: 4,
    title: "第四部份：選擇題(三)",
    instruction: "請聽電腦播出一個族語句子後，從選項中選出該句子正確的拼寫文字，並在答案卡上作答。每題播出兩遍。",
    instructionSource: "official",
    adaptationNote: "這一節的三個族語拼寫在作答前就會顯示——題型本身就是要你比對拼寫，不是洩題。三個選項抽自同一個類別的三題教材。音檔載不出來時本題無法作答，會標成不計分。",
    scorable: true,
  },
  {
    id: "sentenceReading",
    part: "speaking",
    no: 1,
    title: "口說第一部分：單句朗讀",
    instruction: "請看著螢幕上的族語句子念出來。",
    instructionSource: "site",
    adaptationNote: "官方沒有公開這一節的作答說明原文，上面這句是本站措辭。按「確定」後用語音辨識比對你念的內容與教材拼寫，依詞語重疊程度給 0–3 分。辨識結果只是參考，不代表正式測驗的評分。",
    scorable: true,
  },
  {
    id: "shortAnswer",
    part: "speaking",
    no: 2,
    title: "口說第二部分：問答題",
    instruction: "請聽電腦播出一個族語問句，然後用族語回答。",
    instructionSource: "site",
    adaptationNote: "官方沒有公開這一節的作答說明原文，上面這句是本站措辭。按「確定」後：語音辨識→翻成中文→粗判是否合理（合理得 3 分）。這是練習用的機器判斷，不是正式測驗評分。",
    scorable: true,
  },
  {
    id: "pictureTalk",
    part: "speaking",
    no: 3,
    title: "口說第三部分：看圖表達",
    instruction: "請根據螢幕上的圖片及中文提示，以族語簡短地說說你的想法。",
    instructionSource: "site",
    adaptationNote: "官方沒有公開這一節的作答說明原文，上面這句是本站措辭。按「確定」後：語音辨識→翻成中文→對照教材參考答案給 0–10 分。這是練習用的機器粗評，不是正式測驗評分。",
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
    instructionSource: spec.instructionSource,
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

/** 從同一個 classNo 抽 count 個干擾項；differs 決定「不一樣」的判準。 */
function drawDistractors(pool, target, count, rng, differs) {
  const sameClass = pool.filter((record) => record.classNo === target.classNo && differs(record, target));
  if (sameClass.length < count) {
    throw new Error(`類別 ${target.classNo} 只有 ${sameClass.length} 個可用干擾項，抽不出 ${count} 個`);
  }
  const deck = createQuestionDeck(sameClass, rng);
  return Array.from({ length: count }, () => deck.next());
}

// ── 第二部分：選擇題(一) ──────────────────────────────────
// 來源：shard.choiceOne（typeId 4）
// 高中版每題只有一張圖與一段對話錄音，所以另外兩張圖抽自同類別的別題。
function buildChoiceOne(shard, rng) {
  const spec = sectionSpecById("choiceOne");
  const targets = drawDistinct(shard.choiceOne, QUESTIONS_PER_SECTION, rng);

  const questions = targets.map((target, index) => {
    const distractors = drawDistractors(
      shard.choiceOne,
      target,
      OPTIONS_PER_IMAGE_QUESTION - 1,
      rng,
      (record, subject) => record.imagePath !== subject.imagePath,
    );
    const options = shuffle([target, ...distractors], rng).map((item, position) => ({
      key: String(position + 1),
      order: item.order,
      imagePath: item.imagePath,
      indigenousText: joinTurns(item, "indigenousText"),
      chineseText: joinTurns(item, "chineseText"),
    }));
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      prompt: {
        audioUrl: target.audioUrl,
        indigenousText: joinTurns(target, "indigenousText"),
        chineseText: joinTurns(target, "chineseText"),
      },
      options,
      answerKey: options.find((option) => option.order === target.order).key,
      source: { family: "choiceOne", classId: target.classId, classNo: target.classNo, order: target.order },
    };
  });

  return makeSection(spec, questions);
}

function joinTurns(item, key) {
  return item.turns.map((turn) => turn[key]).join(" ／ ");
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

// ── 第四部份：選擇題(三) ──────────────────────────────────
// 來源：shard.choiceThree（typeId 7）
// 播族語句的錄音，三個「拼寫文字」選項抽自同類別的別題。
// 這一節的族語文字在作答前就看得到——題型本身就是比對拼寫。
function buildChoiceThree(shard, rng) {
  const spec = sectionSpecById("choiceThree");
  const targets = drawDistinct(shard.choiceThree, QUESTIONS_PER_SECTION, rng);

  const questions = targets.map((target, index) => {
    const distractors = drawDistractors(
      shard.choiceThree,
      target,
      OPTIONS_PER_TEXT_QUESTION - 1,
      rng,
      (record, subject) => record.indigenousText !== subject.indigenousText,
    );
    const options = shuffle([target, ...distractors], rng).map((item, position) => ({
      key: String(position + 1),
      order: item.order,
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
    }));
    return {
      id: `${spec.id}-${index + 1}`,
      sectionId: spec.id,
      no: index + 1,
      scorable: true,
      // 這一節不做「音檔失敗就揭露族語文字」的降級——文字就是答案。
      revealOnAudioFailure: false,
      prompt: {
        audioUrl: target.audioUrl,
        indigenousText: target.indigenousText,
        chineseText: target.chineseText,
      },
      options,
      answerKey: options.find((option) => option.order === target.order).key,
      source: { family: "choiceThree", classId: target.classId, classNo: target.classNo, order: target.order },
    };
  });

  return makeSection(spec, questions);
}

// ── 口說第一部分：單句朗讀 ────────────────────────────────
// 來源：shard.oralReading（typeId 8 唸唸看）——每題 5 個獨立句子。
// 官方單句朗讀本來就是看著念，所以這裡顯示族語拼寫。
// 教材錄音只在作答後提供——作答前就播會變成跟讀，不是朗讀。
function buildSentenceReading(shard, rng) {
  const spec = sectionSpecById("sentenceReading");

  const seen = new Set();
  const pool = [];
  for (const item of shard.oralReading) {
    for (const sentence of item.sentences) {
      if (seen.has(sentence.indigenousText)) continue;
      seen.add(sentence.indigenousText);
      pool.push({ ...sentence, classId: item.classId, classNo: item.classNo, order: item.order });
    }
  }

  const picked = drawDistinct(pool, QUESTIONS_PER_SECTION, rng);
  const questions = picked.map((sentence, index) => ({
    id: `${spec.id}-${index + 1}`,
    sectionId: spec.id,
    no: index + 1,
    scorable: true,
    prompt: {
      indigenousText: sentence.indigenousText,
      chineseText: sentence.chineseText,
      referenceAudioUrl: sentence.audioUrl,
    },
    expected: sentence.indigenousText,
    source: { family: "oralReading", classId: sentence.classId, classNo: sentence.classNo, order: sentence.order, letter: sentence.letter },
  }));

  return makeSection(spec, questions);
}

// ── 口說第二部分：問答題 ──────────────────────────────────
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

// ── 口說第三部分：看圖表達 ────────────────────────────────
// 來源：shard.pictureTalk（typeId 10）；高中版每方言 2 題，各 1 張圖。
// 開放式口說，正式測驗由委員評分；本站以 ASR→翻譯→參考答案部分給分。
function buildPictureTalk(shard, rng) {
  const spec = sectionSpecById("pictureTalk");
  const pool = (shard.pictureTalk ?? []).filter((item) => item.tip && item.chineseText && item.imageUrl);
  if (pool.length < 1) throw new Error("這個方言別沒有可用的看圖表達題材");
  const item = pickOne(pool, rng);

  const questions = [{
    id: `${spec.id}-1`,
    sectionId: spec.id,
    no: 1,
    scorable: true,
    prompt: {
      tip: item.tip,
      // 高中版每題只有 1 張圖；仍用陣列，讓版面與初級的圖格共用同一種資料形狀。
      imageUrls: [item.imageUrl],
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
 * @param {object} args.shard   data/klokah-senior/dialects/{id}.json 的內容
 * @param {object} args.dialect { id, name, ethnicity, code }
 * @param {number} args.seed    32-bit 無號整數
 */
export function createPaper({ shard, dialect, seed }) {
  if (!shard || typeof shard !== "object") throw new Error("createPaper 需要方言分片資料");
  if (!dialect || typeof dialect !== "object") throw new Error("createPaper 需要方言別資訊");
  if (!Number.isInteger(seed) || seed < 0) throw new Error("createPaper 需要非負整數 seed");
  if (shard.dialectId !== dialect.id) throw new Error(`分片是方言 ${shard.dialectId}，但傳入的方言別是 ${dialect.id}`);

  const rng = createRng(seed);
  const listening = [buildTrueFalse(shard, rng), buildChoiceOne(shard, rng), buildChoiceTwo(shard, rng), buildChoiceThree(shard, rng)];
  const speaking = [buildSentenceReading(shard, rng), buildShortAnswer(shard, rng), buildPictureTalk(shard, rng)];

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
