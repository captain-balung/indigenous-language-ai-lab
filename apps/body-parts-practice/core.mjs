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

export function exactMatch(answer, expected) {
  return normalizeAnswer(answer) === normalizeAnswer(expected);
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

export async function judgeAnswer({ answer, question, translate }) {
  if (exactMatch(answer, question.indigenousText)) {
    return { type: "exact", apiCalls: 0 };
  }
  try {
    const translation = await translate(answer);
    return {
      type: semanticMatch(translation, question.chineseText) ? "semantic" : "retry",
      translation,
      apiCalls: 1
    };
  } catch (error) {
    return { type: "unavailable", error: error instanceof Error ? error.message : String(error), apiCalls: 1 };
  }
}
