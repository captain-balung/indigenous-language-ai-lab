export const BODY_SYNONYMS = {
  "眼睛": ["眼睛", "雙眼", "眼"], "耳朵": ["耳朵", "耳部", "耳"],
  "鼻子": ["鼻子", "鼻部", "鼻"], "嘴巴": ["嘴巴", "口部", "嘴", "口"],
  "牙齒": ["牙齒", "牙"], "頭": ["頭部", "腦袋", "頭"],
  "頭髮": ["頭髮", "毛髮", "髮"], "臉": ["臉部", "面部", "面孔", "臉"],
  "手": ["手部", "手"], "腳": ["腳部", "足部", "腳", "足"]
};

export function normalizeAnswer(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?。！？])/g, "$1")
    .trim();
}

/**
 * 大小寫在其正寫法裡「是字母的一部分」、不能用整句轉小寫折疊的方言：
 *   賽夏：大寫 S 是獨立字母（'aewhaeS、talka: Sil'i:），句首助詞也慣用大寫（Sa'ila、U mata）。
 *   噶瑪蘭：大寫 R 是獨立字母（biRi、qaRabi），句首助詞也慣用大寫（Rutung、Rabetin）。
 * 其餘方言的大小寫純屬慣例（ASR 也常在句首補大寫），比對時一律不分大小寫。
 */
export const CASE_MEANINGFUL_ETHNICITIES = ["賽夏", "噶瑪蘭"];

export function isCaseMeaningful(ethnicity) {
  return CASE_MEANINGFUL_ETHNICITIES.includes(ethnicity);
}

/** 只折疊第一個字母的大小寫：吸收 ASR 在句首補大寫的慣例，其餘位置嚴格保留。 */
function foldFirstLetter(value) {
  const text = String(value ?? "");
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * 族語字面比對。
 *
 *   一般方言 → 不分大小寫（容得下 ASR 的句首大寫慣例）
 *   賽夏／噶瑪蘭 → 大小寫敏感為主；不一致時再「只折疊第一個字母」重比一次
 *     （句首允許大小寫差異，其餘位置的 S/R 等大寫字母不能被吃掉）
 */
export function indigenousEquals(answer, expected, ethnicity) {
  const a = normalizeAnswer(answer);
  const e = normalizeAnswer(expected);
  if (!a || !e) return false;
  if (isCaseMeaningful(ethnicity)) {
    return a === e || foldFirstLetter(a) === foldFirstLetter(e);
  }
  return a.toLowerCase() === e.toLowerCase();
}

export function exactMatch(answer, expected, ethnicity) {
  return indigenousEquals(answer, expected, ethnicity);
}

export function glossKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/這是|那是|他是|她是|一隻|一個|一位|一名/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function conceptFromChinese(chineseText) {
  const value = String(chineseText ?? "").replace(/[\s，。！？、,.!?]/g, "");
  const candidates = Object.entries(BODY_SYNONYMS)
    .flatMap(([concept, terms]) => terms.map((term) => ({ concept, term })))
    .sort((a, b) => b.term.length - a.term.length);
  const hit = candidates.find(({ term }) => value.includes(term));
  if (!hit) return null;
  const leftover = value.replace(hit.term, "").replace(/這是|那是|他是|她是/g, "");
  return leftover ? null : hit.concept;
}

export function semanticMatch(translation, chineseText) {
  const expectedBody = conceptFromChinese(chineseText);
  if (expectedBody) return conceptFromChinese(translation) === expectedBody;
  const expected = glossKey(chineseText);
  const got = glossKey(translation);
  return Boolean(expected) && expected === got;
}

export function createQuestionDeck(records, random = Math.random) {
  const remaining = [];
  return {
    next() {
      if (!remaining.length) {
        remaining.push(...records);
        for (let i = remaining.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
      }
      return remaining.pop();
    },
    reset() { remaining.length = 0; }
  };
}

export function createSingleFlight(task) {
  let active = null;
  return (...args) => {
    if (active) return active;
    active = Promise.resolve().then(() => task(...args)).finally(() => { active = null; });
    return active;
  };
}

// 判定順序：族語與教材整句相同 → exact；樣板比對（含意義鍵）過 → semantic；
// 樣板沒過時若給了 aiJudge，用 AI 判「譯文與教材中文是不是同一個意思」，
// 判過也是 semantic（verdictBy: "ai"）；AI 拒判或失敗，維持 retry 規則結果。
export async function judgeAnswer({ answer, question, translate, ethnicity, aiJudge }) {
  if (exactMatch(answer, question.indigenousText, ethnicity)) {
    return { type: "exact", apiCalls: 0 };
  }
  try {
    const translation = await translate(answer);
    if (semanticMatch(translation, question.chineseText)) {
      return { type: "semantic", translation, apiCalls: 1 };
    }
    const ai = typeof aiJudge === "function"
      ? await aiJudge({ translation, targetChinese: question.chineseText })
      : null;
    if (ai?.pass) {
      return { type: "semantic", translation, verdictBy: "ai", rationale: ai.rationale ?? null, apiCalls: 1 };
    }
    return {
      type: "retry",
      translation,
      apiCalls: 1
    };
  } catch (error) {
    return { type: "unavailable", error: error instanceof Error ? error.message : String(error), apiCalls: 1 };
  }
}
