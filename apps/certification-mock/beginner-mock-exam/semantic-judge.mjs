/**
 * 語意評分介面（簡答題／看圖說話）
 *
 * 目前預設為規則粗判（heuristic）。後續接 LLM 時：
 *   1. 實作 `complete({ system, user }) => Promise<string>`（回傳模型文字）
 *   2. `createLlmSemanticJudge({ complete, model })`
 *   3. 把下方 `activeSemanticJudge` 改成該實例（或由 app 注入）
 *
 * 輸入一律已含 ASR 原文與 translate_to_zh 譯文；評分端不再重跑 ASR。
 */

import {
  judgeShortAnswerTranslation,
  scorePictureTalkTranslation,
  PICTURE_TALK_MAX_POINTS,
  SHORT_ANSWER_MAX_POINTS,
} from "./scoring.mjs";

/**
 * @typedef {object} ShortAnswerJudgeInput
 * @property {string} questionChinese
 * @property {string} [questionIndigenous]
 * @property {string} transcript
 * @property {string} translation
 * @property {string} [dialectCode]
 */

/**
 * @typedef {object} PictureTalkJudgeInput
 * @property {string} tip
 * @property {string} referenceChinese
 * @property {string} [referenceIndigenous]
 * @property {string} transcript
 * @property {string} translation
 * @property {string[]} [imageUrls]
 * @property {string} [dialectCode]
 */

/**
 * @typedef {object} ShortAnswerJudgeResult
 * @property {"reasonable"|"unreasonable"|"undetermined"} verdict
 * @property {number|null} [points]
 * @property {number} [maxPoints]
 * @property {string} [rationale]
 */

/**
 * @typedef {object} PictureTalkJudgeResult
 * @property {number|null} points
 * @property {number} maxPoints
 * @property {number|null} [ratio]
 * @property {"scored"|"undetermined"} status
 * @property {string} [rationale]
 */

/**
 * @typedef {object} SemanticJudge
 * @property {string} id
 * @property {(input: ShortAnswerJudgeInput) => Promise<ShortAnswerJudgeResult>} judgeShortAnswer
 * @property {(input: PictureTalkJudgeInput) => Promise<PictureTalkJudgeResult>} scorePictureTalk
 */

/** 規則粗判（現況預設）。 */
export function createHeuristicSemanticJudge() {
  return {
    id: "heuristic",
    async judgeShortAnswer({ questionChinese, translation }) {
      return judgeShortAnswerTranslation(questionChinese, translation);
    },
    async scorePictureTalk({ translation, referenceChinese }) {
      return scorePictureTalkTranslation(translation, referenceChinese);
    },
  };
}

const SHORT_ANSWER_LLM_SYSTEM = `你是族語初級認證「簡答題」的練習評分助手。
根據「中文問句」與學習者回答的「中文譯文」，判斷回答是否合理，並給 0 到 4 的整數分（合理通常給 4，不太合理給 0，可斟酌部分分）。
只回傳 JSON，不要 markdown：{"verdict":"reasonable"|"unreasonable"|"undetermined","points":0到4的整數或null,"rationale":"一句話"}
無法判斷時用 undetermined 且 points 為 null。這不是正式測驗評分。`;

const PICTURE_TALK_LLM_SYSTEM = `你是族語初級認證「看圖說話」的練習評分助手。
根據中文提示、教材中文參考答案、學習者回答的中文譯文，給 0 到 ${PICTURE_TALK_MAX_POINTS} 的整數分。
只回傳 JSON，不要 markdown：{"points":0到${PICTURE_TALK_MAX_POINTS}的整數,"rationale":"一句話"}
無法判斷時回 {"points":null,"rationale":"..."}。這不是正式測驗評分。`;

function parseJsonObject(text) {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM 回傳不是 JSON 物件");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * LLM 語意評分。呼叫端需提供 `complete`：
 *   async complete({ system, user }) => string（模型回覆全文）
 *
 * @param {object} options
 * @param {(args: { system: string, user: string }) => Promise<string>} options.complete
 * @param {string} [options.model]
 * @returns {SemanticJudge}
 */
export function createLlmSemanticJudge({ complete, model = "custom" } = {}) {
  if (typeof complete !== "function") {
    throw new Error("createLlmSemanticJudge 需要 complete({ system, user }) => Promise<string>");
  }

  return {
    id: `llm:${model}`,

    async judgeShortAnswer(input) {
      const { questionChinese, translation, transcript, questionIndigenous } = input ?? {};
      if (typeof translation !== "string" || !translation.trim()) {
        return { verdict: "undetermined", points: null, maxPoints: SHORT_ANSWER_MAX_POINTS, rationale: "沒有譯文" };
      }
      try {
        const user = [
          `中文問句：${questionChinese ?? ""}`,
          questionIndigenous ? `族語問句：${questionIndigenous}` : null,
          `ASR 原文：${transcript ?? ""}`,
          `中文譯文：${translation}`,
        ].filter(Boolean).join("\n");
        const body = parseJsonObject(await complete({ system: SHORT_ANSWER_LLM_SYSTEM, user }));
        const verdict = body.verdict;
        if (verdict !== "reasonable" && verdict !== "unreasonable" && verdict !== "undetermined") {
          return { verdict: "undetermined", points: null, maxPoints: SHORT_ANSWER_MAX_POINTS, rationale: "LLM verdict 無效" };
        }
        let points = null;
        if (verdict === "undetermined") {
          points = null;
        } else if (body.points == null) {
          points = verdict === "reasonable" ? SHORT_ANSWER_MAX_POINTS : 0;
        } else {
          points = Math.min(SHORT_ANSWER_MAX_POINTS, Math.max(0, Math.round(Number(body.points))));
          if (!Number.isFinite(points)) points = null;
        }
        return {
          verdict,
          points,
          maxPoints: SHORT_ANSWER_MAX_POINTS,
          rationale: typeof body.rationale === "string" ? body.rationale : undefined,
        };
      } catch (error) {
        return {
          verdict: "undetermined",
          points: null,
          maxPoints: SHORT_ANSWER_MAX_POINTS,
          rationale: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async scorePictureTalk(input) {
      const { tip, referenceChinese, translation, transcript, referenceIndigenous } = input ?? {};
      if (typeof translation !== "string" || !translation.trim()) {
        return { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined" };
      }
      try {
        const user = [
          `中文提示：${tip ?? ""}`,
          `教材參考答案（中文）：${referenceChinese ?? ""}`,
          referenceIndigenous ? `教材參考答案（族語）：${referenceIndigenous}` : null,
          `ASR 原文：${transcript ?? ""}`,
          `中文譯文：${translation}`,
        ].filter(Boolean).join("\n");
        const body = parseJsonObject(await complete({ system: PICTURE_TALK_LLM_SYSTEM, user }));
        if (body.points == null) {
          return {
            points: null,
            maxPoints: PICTURE_TALK_MAX_POINTS,
            ratio: null,
            status: "undetermined",
            rationale: typeof body.rationale === "string" ? body.rationale : undefined,
          };
        }
        const points = Math.min(
          PICTURE_TALK_MAX_POINTS,
          Math.max(0, Math.round(Number(body.points))),
        );
        if (!Number.isFinite(points)) {
          return { points: null, maxPoints: PICTURE_TALK_MAX_POINTS, ratio: null, status: "undetermined", rationale: "LLM points 無效" };
        }
        return {
          points,
          maxPoints: PICTURE_TALK_MAX_POINTS,
          ratio: points / PICTURE_TALK_MAX_POINTS,
          status: "scored",
          rationale: typeof body.rationale === "string" ? body.rationale : undefined,
        };
      } catch (error) {
        return {
          points: null,
          maxPoints: PICTURE_TALK_MAX_POINTS,
          ratio: null,
          status: "undetermined",
          rationale: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 目前啟用的語意評分實作。
 * 接 LLM 時改為：
 *   export const activeSemanticJudge = createLlmSemanticJudge({ complete, model: "..." });
 */
export const activeSemanticJudge = createHeuristicSemanticJudge();
