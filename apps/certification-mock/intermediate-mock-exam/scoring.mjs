/**
 * 中級模擬站 · 計分（純邏輯，可在 Node 測試）
 *
 * 這個模組刻意做不到三件事，而且每一件都有對應的測試把關：
 *
 *   1. **不把練習分數當成正式證書成績。** report.converted 永遠是 null；
 *      雖依公開配分顯示練習得分，但不預測是否通過。
 *   2. **不宣告通過或不通過。** report 裡沒有 pass／passed／合格 這類欄位；
 *      「合格」二字只出現在 OFFICIAL.quote 的官方原文引用裡。
 *   3. **不因為機器聽錯就判使用者念錯。** 辨識失敗、逾時、沒回文字 → undetermined，
 *      不是 mismatched。音檔載不出來 → notScored，不是答錯。
 */

import { normalizeAnswer } from "../../basic-learning/body-parts-practice/core.mjs";

/** 官方及格標準原文，僅供對照，本站不據此推測結果。 */
export const OFFICIAL = {
  listeningThreshold: 45,
  speakingThreshold: 15,
  quote: "初級與中級測驗採分項合格制度，考生須同時通過聽力與口說兩項測驗，其中聽力成績須達45分以上，口說成績須達15分以上，始核發該級別之合格證書",
  sourceUrl: "https://lokahsu.ilrdf.org.tw/",
  disclaimer: "下面的練習得分依公開配分加總，僅供本次模擬參考；不代表正式測驗成績，也不預測你是否會通過。",
};

/**
 * 練習配分（與公開中級口說／聽力配分一致）。
 * 口說 40 + 聽力 60 = 100。
 */
export const POINT_SCHEME = {
  sentenceReading: { perQuestion: 3, questions: 5, max: 15 },
  shortAnswer: { perQuestion: 3, questions: 5, max: 15 },
  pictureTalk: { perQuestion: 10, questions: 1, max: 10 },
  listening: { perQuestion: 3, questions: 5, sectionMax: 15, max: 60 },
  speakingMax: 40,
  listeningMax: 60,
  totalMax: 100,
};

export const SPEAKING_COVERAGE_NOTE =
  "本站的口說涵蓋 單句朗讀（每題 0–3 分，依詞語重疊程度）、問答題（每題 3 分）與 看圖表達（0–10 分）。問答題與看圖表達為語音辨識→中文翻譯後的機器粗判，非正式測驗評分。";

/** 看圖表達給分上限（0–10）。 */
export const PICTURE_TALK_MAX_POINTS = POINT_SCHEME.pictureTalk.max;

/** 問答題每題滿分。 */
export const SHORT_ANSWER_MAX_POINTS = POINT_SCHEME.shortAnswer.perQuestion;

/** 單句朗讀每題滿分。 */
export const SENTENCE_READING_MAX_POINTS = POINT_SCHEME.sentenceReading.perQuestion;

/** 聽力每題滿分。 */
export const LISTENING_MAX_POINTS = POINT_SCHEME.listening.perQuestion;

/**
 * 單句朗讀的重疊率門檻。整句的字面完全相符幾乎不可能達成——
 * 族級辨識模型對方言的偏差會讓每一句都落在「不相符」，那等於用模型的限制
 * 去判使用者念錯。因此改用詞語重疊率分段給分。
 */
export const SENTENCE_READING_THRESHOLDS = [
  { minRatio: 0.9, points: 3, status: "matched" },
  { minRatio: 0.7, points: 2, status: "partial" },
  { minRatio: 0.5, points: 1, status: "partial" },
];

/**
 * 切成可比對的詞。
 *
 * normalizeAnswer 已經統一撇號與空白——撇號在族語正寫法裡是字母的一部分
 * （例如 luma’），**不能**當成標點吃掉。這裡只再拿掉句末標點與全形標點，
 * 並轉小寫。
 */
function readingTokens(text) {
  return normalizeAnswer(text)
    .toLowerCase()
    .replace(/[.,!?;:"「」『』（）()]/g, " ")
    .replace(/[。，、！？；：]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function multisetCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * 單句朗讀的判定：ASR 文字與教材整句的**詞語重疊程度**（多重集合 F1）。
 *
 * 回傳的 status 只描述重疊程度，不描述發音對錯：
 *   matched      重疊 ≥ 0.9
 *   partial      重疊 ≥ 0.5
 *   mismatched   重疊 < 0.5
 *   undetermined 沒有辨識結果（不是使用者的錯，也不算念錯）
 *
 * @returns {{ status: string, points: number|null, ratio: number|null, maxPoints: number }}
 */
export function judgeSentenceReading(transcript, expected) {
  const maxPoints = SENTENCE_READING_MAX_POINTS;
  if (typeof transcript !== "string" || !transcript.trim()) {
    return { status: "undetermined", points: null, ratio: null, maxPoints };
  }
  if (typeof expected !== "string" || !expected.trim()) {
    return { status: "undetermined", points: null, ratio: null, maxPoints };
  }

  const heard = readingTokens(transcript);
  const target = readingTokens(expected);
  if (heard.length === 0 || target.length === 0) {
    return { status: "undetermined", points: null, ratio: null, maxPoints };
  }

  const heardCounts = multisetCounts(heard);
  const targetCounts = multisetCounts(target);
  let overlap = 0;
  for (const [token, count] of heardCounts) {
    overlap += Math.min(count, targetCounts.get(token) ?? 0);
  }

  const precision = overlap / heard.length;
  const recall = overlap / target.length;
  const ratio = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  for (const band of SENTENCE_READING_THRESHOLDS) {
    if (ratio >= band.minRatio) return { status: band.status, points: band.points, ratio, maxPoints };
  }
  return { status: "mismatched", points: 0, ratio, maxPoints };
}

function chineseOnly(text) {
  return String(text ?? "").normalize("NFC").replace(/[^一-鿿]/g, "");
}

/**
 * 問答題：以「翻譯後的中文」對照問句，粗判回答是否合理，並對應每題 0／3 分。
 * 教材沒有標準答案；此為練習用機器規則，非正式測驗的委員評分。
 *
 * @returns {{ verdict: "reasonable"|"unreasonable"|"undetermined", points: number|null, maxPoints: number }}
 */
export function judgeShortAnswerTranslation(questionChinese, translation) {
  const maxPoints = SHORT_ANSWER_MAX_POINTS;
  if (typeof translation !== "string" || !translation.trim()) {
    return { verdict: "undetermined", points: null, maxPoints };
  }
  if (typeof questionChinese !== "string" || !questionChinese.trim()) {
    return { verdict: "undetermined", points: null, maxPoints };
  }

  const question = chineseOnly(questionChinese);
  const answer = chineseOnly(translation);
  if (!answer) return { verdict: "undetermined", points: null, maxPoints };

  // 幾乎整句複誦問句，不算作答。
  if (answer === question) return { verdict: "unreasonable", points: 0, maxPoints };
  if (question.includes(answer) && answer.length >= Math.max(4, Math.floor(question.length * 0.55))) {
    return { verdict: "unreasonable", points: 0, maxPoints };
  }

  const isYesNo = /嗎$/.test(question) || /好$/.test(question) && /同學/.test(question);
  let verdict = "unreasonable";

  if (/哪裡|哪裡來|從哪/.test(question)) {
    if (/在|來|家|學校|這裡|那裡|山上|部落|市|鄉|村|從|附近|宿舍|教室/.test(answer)) {
      verdict = "reasonable";
    } else {
      verdict = answer.length >= 2 ? "reasonable" : "unreasonable";
    }
  } else if (/幾歲|多少|幾個|幾台|多少人/.test(question)) {
    verdict = (/\d/.test(translation) || /[一二三四五六七八九十百兩半零多]/.test(answer) || /歲|個|人|台|位/.test(answer))
      ? "reasonable"
      : "unreasonable";
  } else if (/名字/.test(question)) {
    if (/什麼|甚麼|叫甚|叫什/.test(answer) && answer.length <= 6) verdict = "unreasonable";
    else verdict = answer.length >= 1 ? "reasonable" : "unreasonable";
  } else if (/同學好|你好/.test(question) && !/嗎/.test(question)) {
    verdict = /好|同學|您好|哈囉|你好|早安|午安/.test(answer) ? "reasonable" : "unreasonable";
  } else if (isYesNo || /嗎/.test(questionChinese)) {
    if (/(是的|不是|對啊|不對|會說|不會|喜歡|不喜歡|有啊|沒有|很好|不好|還好|可以|不行|要啊|不要|常常|不常|天天|很少|是|會|有|好|嗯)/.test(answer)
      || /族|語/.test(question) && /族|語|會|是/.test(answer)) {
      verdict = "reasonable";
    } else if (answer.length <= 4 && /[好會是有對嗯]/.test(answer)) {
      verdict = "reasonable";
    } else {
      verdict = "unreasonable";
    }
  } else {
    verdict = answer.length >= 2 ? "reasonable" : "unreasonable";
  }

  return {
    verdict,
    points: verdict === "reasonable" ? maxPoints : 0,
    maxPoints,
  };
}

/**
 * 看圖表達：以「翻譯後的中文」對照教材中文參考答案，回傳 0–10 的分數。
 * 這是練習用的機器粗評，不是正式測驗的委員評分。
 *
 * 作法：取雙方中文字的 bigram 重疊率（F1），再按比例換成 0–10 分。
 */
export function scorePictureTalkTranslation(translation, referenceChinese) {
  if (typeof translation !== "string" || !translation.trim()) {
    return { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
  }
  if (typeof referenceChinese !== "string" || !referenceChinese.trim()) {
    return { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
  }

  const left = chineseBigrams(translation);
  const right = chineseBigrams(referenceChinese);
  if (left.size === 0 || right.size === 0) {
    return { points: 0, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: 0, status: "scored" };
  }

  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap += 1;
  const precision = overlap / left.size;
  const recall = overlap / right.size;
  const ratio = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const points = Math.min(
    PICTURE_TALK_MAX_POINTS,
    Math.max(0, Math.round(ratio * PICTURE_TALK_MAX_POINTS)),
  );

  return { points, maxPoints: PICTURE_TALK_MAX_POINTS, ratio, status: "scored" };
}

function chineseBigrams(text) {
  const chars = [...String(text).normalize("NFC").replace(/[^一-鿿]/g, "")];
  const grams = new Set();
  if (chars.length === 1) grams.add(chars[0]);
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.add(`${chars[index]}${chars[index + 1]}`);
  }
  return grams;
}

function emptyListeningTally() {
  return { total: 0, correct: 0, wrong: 0, unanswered: 0, notScored: 0, pointsSum: 0, maxPointsSum: 0 };
}

function gradeListeningSection(section, responses) {
  const tally = emptyListeningTally();
  const review = [];
  const per = LISTENING_MAX_POINTS;

  for (const question of section.questions) {
    tally.total += 1;
    tally.maxPointsSum += per;
    const response = responses[question.id] ?? {};
    const chosen = response.choice ?? null;

    let status;
    let points = 0;
    if (response.audioFailed === true) {
      // 音檔載不出來不是使用者的錯，也不代表答錯——不進分母；本題得 0 分。
      status = "notScored";
      tally.notScored += 1;
    } else if (chosen === null) {
      status = "unanswered";
      tally.unanswered += 1;
    } else if (chosen === question.answerKey) {
      status = "correct";
      points = per;
      tally.correct += 1;
      tally.pointsSum += points;
    } else {
      status = "wrong";
      tally.wrong += 1;
    }

    review.push({
      questionId: question.id,
      sectionId: section.id,
      no: question.no,
      status,
      points,
      maxPoints: per,
      yourKey: chosen,
      answerKey: question.answerKey,
      prompt: question.prompt,
      options: question.options,
    });
  }

  return { id: section.id, title: section.title, ...tally, review };
}

function gradeSentenceReading(section, responses) {
  const tally = { total: 0, matched: 0, partial: 0, mismatched: 0, undetermined: 0, skipped: 0, pointsSum: 0, maxPointsSum: 0 };
  const review = [];
  const per = SENTENCE_READING_MAX_POINTS;

  for (const question of section.questions) {
    tally.total += 1;
    tally.maxPointsSum += per;
    const response = responses[question.id] ?? {};

    let status;
    let points = 0;
    let ratio = null;
    if (response.attempted !== true) {
      status = "skipped";
      tally.skipped += 1;
    } else {
      const judged = judgeSentenceReading(response.transcript, question.expected);
      status = judged.status;
      ratio = judged.ratio;
      tally[status] += 1;
      if (judged.points != null) {
        points = judged.points;
        tally.pointsSum += points;
      }
    }

    review.push({
      questionId: question.id,
      no: question.no,
      status,
      points: status === "skipped" || status === "undetermined" ? null : points,
      maxPoints: per,
      ratio,
      expected: question.expected,
      chineseText: question.prompt.chineseText,
      transcript: response.transcript ?? null,
      asrError: response.asrError ?? null,
      referenceAudioUrl: question.prompt.referenceAudioUrl,
    });
  }

  return { ...tally, scored: true, review };
}

function gradeShortAnswer(section, responses) {
  const tally = {
    total: 0,
    reasonable: 0,
    unreasonable: 0,
    undetermined: 0,
    skipped: 0,
    pointsSum: 0,
    maxPointsSum: 0,
  };
  const review = [];
  const per = SHORT_ANSWER_MAX_POINTS;

  for (const question of section.questions) {
    tally.total += 1;
    tally.maxPointsSum += per;
    const response = responses[question.id] ?? {};

    let status;
    let points = 0;
    if (response.attempted !== true) {
      status = "skipped";
      tally.skipped += 1;
    } else if (response.shortVerdict === "reasonable") {
      status = "reasonable";
      points = Number.isFinite(response.shortPoints) ? response.shortPoints : per;
      points = Math.min(per, Math.max(0, Math.round(points)));
      tally.reasonable += 1;
      tally.pointsSum += points;
    } else if (response.shortVerdict === "unreasonable") {
      status = "unreasonable";
      points = Number.isFinite(response.shortPoints) ? Math.min(per, Math.max(0, Math.round(response.shortPoints))) : 0;
      tally.unreasonable += 1;
      tally.pointsSum += points;
    } else {
      status = "undetermined";
      tally.undetermined += 1;
    }

    review.push({
      questionId: question.id,
      no: question.no,
      status,
      points: status === "undetermined" || status === "skipped" ? null : points,
      maxPoints: per,
      question: question.prompt.indigenousText,
      chineseText: question.prompt.chineseText,
      audioUrl: question.prompt.audioUrl,
      transcript: response.transcript ?? null,
      translation: response.translation ?? null,
      asrError: response.asrError ?? null,
      translateError: response.translateError ?? null,
    });
  }

  return { ...tally, scored: true, review };
}

function gradePictureTalk(section, responses) {
  const tally = {
    total: 0,
    pointsSum: 0,
    maxPointsSum: 0,
    scoredCount: 0,
    undetermined: 0,
    skipped: 0,
  };
  const review = [];

  for (const question of section.questions) {
    tally.total += 1;
    tally.maxPointsSum += PICTURE_TALK_MAX_POINTS;
    const response = responses[question.id] ?? {};

    let status;
    let points = null;
    let ratio = null;
    if (response.attempted !== true) {
      status = "skipped";
      tally.skipped += 1;
    } else if (response.pictureScore == null || response.pictureScore.status === "undetermined") {
      status = "undetermined";
      tally.undetermined += 1;
    } else {
      status = "scored";
      points = response.pictureScore.points;
      ratio = response.pictureScore.ratio;
      tally.pointsSum += points ?? 0;
      tally.scoredCount += 1;
    }

    review.push({
      questionId: question.id,
      no: question.no,
      status,
      points,
      maxPoints: PICTURE_TALK_MAX_POINTS,
      ratio,
      tip: question.prompt.tip,
      referenceChinese: question.reference.chineseText,
      referenceAudioUrl: question.reference.audioUrl,
      imageUrls: question.prompt.imageUrls,
      transcript: response.transcript ?? null,
      translation: response.translation ?? null,
      asrError: response.asrError ?? null,
      translateError: response.translateError ?? null,
    });
  }

  return { ...tally, scored: true, review };
}

/**
 * @param {object} paper     createPaper 的產出
 * @param {object} responses 以 question.id 為鍵：
 *   聽力     { choice: string|null, audioFailed?: boolean }
 *   單句朗讀 { attempted: boolean, transcript?: string|null, asrError?: string|null }
 *   問答題   { attempted: boolean, transcript?, translation?, shortVerdict?, asrError?, translateError? }
 *   看圖表達 { attempted: boolean, transcript?, translation?, pictureScore?, asrError?, translateError? }
 */
export function gradePaper(paper, responses = {}) {
  const bySection = paper.listening.map((section) => gradeListeningSection(section, responses));
  const listeningTotals = bySection.reduce(
    (totals, section) => ({
      total: totals.total + section.total,
      correct: totals.correct + section.correct,
      wrong: totals.wrong + section.wrong,
      unanswered: totals.unanswered + section.unanswered,
      notScored: totals.notScored + section.notScored,
      pointsSum: totals.pointsSum + section.pointsSum,
      maxPointsSum: totals.maxPointsSum + section.maxPointsSum,
    }),
    emptyListeningTally(),
  );

  const scoredDenominator = listeningTotals.correct + listeningTotals.wrong;
  const accuracy = scoredDenominator > 0 ? listeningTotals.correct / scoredDenominator : null;

  const sentenceSection = paper.speaking.find((section) => section.id === "sentenceReading");
  const shortSection = paper.speaking.find((section) => section.id === "shortAnswer");
  const pictureSection = paper.speaking.find((section) => section.id === "pictureTalk");

  const sentenceReading = sentenceSection ? gradeSentenceReading(sentenceSection, responses) : null;
  const shortAnswer = shortSection ? gradeShortAnswer(shortSection, responses) : null;
  const pictureTalk = pictureSection ? gradePictureTalk(pictureSection, responses) : null;

  const speakingPoints =
    (sentenceReading?.pointsSum ?? 0) + (shortAnswer?.pointsSum ?? 0) + (pictureTalk?.pointsSum ?? 0);
  const speakingMax =
    (sentenceReading?.maxPointsSum ?? 0) + (shortAnswer?.maxPointsSum ?? 0) + (pictureTalk?.maxPointsSum ?? 0);

  return {
    paperId: paper.paperId,
    dialect: paper.dialect,
    listening: {
      ...listeningTotals,
      scoredDenominator,
      accuracy,
      bySection,
    },
    speaking: {
      sentenceReading,
      shortAnswer,
      pictureTalk,
      coverageNote: SPEAKING_COVERAGE_NOTE,
      pointsSum: speakingPoints,
      maxPointsSum: speakingMax,
    },
    practice: {
      scheme: POINT_SCHEME,
      speaking: speakingPoints,
      speakingMax,
      listening: listeningTotals.pointsSum,
      listeningMax: listeningTotals.maxPointsSum,
      total: speakingPoints + listeningTotals.pointsSum,
      totalMax: speakingMax + listeningTotals.maxPointsSum,
    },
    official: OFFICIAL,
    // 永遠是 null：不把練習得分包裝成「正式換算成績」。
    converted: null,
  };
}
