/**
 * 初級模擬站 · 計分（純邏輯，可在 Node 測試）
 *
 * 這個模組刻意做不到三件事，而且每一件都有對應的測試把關：
 *
 *   1. **不換算成官方分數。** report.converted 永遠是 null。
 *      我們不知道官方聽力／口說的滿分，就算知道也不該假裝本站的模擬等於正式成績。
 *   2. **不宣告通過或不通過。** report 裡沒有 pass／passed／合格 這類欄位；
 *      「合格」二字只出現在 OFFICIAL.quote 的官方原文引用裡。
 *   3. **不因為機器聽錯就判使用者念錯。** 辨識失敗、逾時、沒回文字 → undetermined，
 *      不是 mismatched。音檔載不出來 → notScored，不是答錯。
 */

import { exactMatch } from "../body-parts-practice/core.mjs";

/** 官方及格標準原文，僅供對照，本站不據此推測結果。 */
export const OFFICIAL = {
  listeningThreshold: 45,
  speakingThreshold: 15,
  quote: "聽力成績須達45分以上，口說成績須達15分以上，始核發該級別之合格證書",
  sourceUrl: "https://lokahsu.ilrdf.org.tw/",
  disclaimer: "本站不換算成正式分數，也不預測你是否會通過。上面的數字只是本次模擬答對的題數。",
};

export const SPEAKING_COVERAGE_NOTE =
  "本站的口說模擬只涵蓋 單詞朗讀 與 簡答題；正式測驗還有 看圖說話。";

/**
 * 單詞朗讀的判定。
 *
 * 只做字面比對，不呼叫翻譯 API：單一詞彙的中文註解（例如「老人；長輩」）
 * 沒辦法可靠地跟機器翻譯比對，而錯誤的「不相符」正是產品原則要避免的事。
 *
 * @returns {"matched"|"mismatched"|"undetermined"}
 */
export function judgeWordReading(transcript, expected) {
  if (typeof transcript !== "string" || !transcript.trim()) return "undetermined";
  if (typeof expected !== "string" || !expected.trim()) return "undetermined";
  return exactMatch(transcript, expected) ? "matched" : "mismatched";
}

function emptyListeningTally() {
  return { total: 0, correct: 0, wrong: 0, unanswered: 0, notScored: 0 };
}

function gradeListeningSection(section, responses) {
  const tally = emptyListeningTally();
  const review = [];

  for (const question of section.questions) {
    tally.total += 1;
    const response = responses[question.id] ?? {};
    const chosen = response.choice ?? null;

    let status;
    if (response.audioFailed === true) {
      // 音檔載不出來不是使用者的錯，也不代表答錯——不進分母。
      status = "notScored";
      tally.notScored += 1;
    } else if (chosen === null) {
      status = "unanswered";
      tally.unanswered += 1;
    } else if (chosen === question.answerKey) {
      status = "correct";
      tally.correct += 1;
    } else {
      status = "wrong";
      tally.wrong += 1;
    }

    review.push({
      questionId: question.id,
      sectionId: section.id,
      no: question.no,
      status,
      yourKey: chosen,
      answerKey: question.answerKey,
      prompt: question.prompt,
      options: question.options,
    });
  }

  return { id: section.id, title: section.title, ...tally, review };
}

function gradeWordReading(section, responses) {
  const tally = { total: 0, matched: 0, mismatched: 0, undetermined: 0, skipped: 0 };
  const review = [];

  for (const question of section.questions) {
    tally.total += 1;
    const response = responses[question.id] ?? {};

    let status;
    if (response.attempted !== true) {
      status = "skipped";
      tally.skipped += 1;
    } else {
      status = judgeWordReading(response.transcript, question.expected);
      tally[status] += 1;
    }

    review.push({
      questionId: question.id,
      no: question.no,
      status,
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
  const tally = { total: 0, transcribed: 0, undetermined: 0, skipped: 0 };
  const review = [];

  for (const question of section.questions) {
    tally.total += 1;
    const response = responses[question.id] ?? {};

    let status;
    if (response.attempted !== true) {
      status = "skipped";
      tally.skipped += 1;
    } else if (typeof response.transcript === "string" && response.transcript.trim()) {
      status = "transcribed";
      tally.transcribed += 1;
    } else {
      status = "undetermined";
      tally.undetermined += 1;
    }

    review.push({
      questionId: question.id,
      no: question.no,
      status,
      question: question.prompt.indigenousText,
      chineseText: question.prompt.chineseText,
      audioUrl: question.prompt.audioUrl,
      transcript: response.transcript ?? null,
      asrError: response.asrError ?? null,
    });
  }

  // scored: false —— 這一節完全不貢獻對錯，正式測驗由委員評分。
  return { ...tally, scored: false, review };
}

/**
 * @param {object} paper     createPaper 的產出
 * @param {object} responses 以 question.id 為鍵：
 *   聽力   { choice: string|null, audioFailed?: boolean }
 *   單詞朗讀 { attempted: boolean, transcript?: string|null, asrError?: string|null }
 *   簡答題  { attempted: boolean, transcript?: string|null, asrError?: string|null }
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
    }),
    emptyListeningTally(),
  );

  const scoredDenominator = listeningTotals.correct + listeningTotals.wrong;
  const accuracy = scoredDenominator > 0 ? listeningTotals.correct / scoredDenominator : null;

  const wordSection = paper.speaking.find((section) => section.id === "wordReading");
  const shortSection = paper.speaking.find((section) => section.id === "shortAnswer");

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
      wordReading: wordSection ? gradeWordReading(wordSection, responses) : null,
      shortAnswer: shortSection ? gradeShortAnswer(shortSection, responses) : null,
      coverageNote: SPEAKING_COVERAGE_NOTE,
    },
    official: OFFICIAL,
    // 永遠是 null：本站不換算成官方分數。
    converted: null,
  };
}
