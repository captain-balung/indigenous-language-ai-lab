/**
 * AI 意思判別（各練習共用）。
 *
 * 規則判定（族語鍵比對、翻譯樣板比對）沒過時，再問一次 LLM：
 * 「譯文」與「目標中文」是不是同一個意思。同一件事就算對上（reasonable）。
 * 任何失敗（proxy 逾時、回傳不是 JSON、verdict 不是 reasonable、沒有譯文）回 null，
 * 呼叫端維持本來的規則結果——評分不會比規則更嚴，這就是規則粗判的降級路線。
 *
 * 只送譯文與目標中文，不送參考族語句；錄音只送 Formosan，不送 LLM。
 */

import { complete, DEFAULT_LLM_MODEL } from "./llm-complete.mjs";

const MEANING_LLM_SYSTEM = `你是族語練習的評分助手。
比較「目標中文」與學習者所說／所寫內容的「中文譯文」，判斷兩者是不是同一個意思。
同一件事就算對上：說法、稱呼、開頭結尾與多講少講細節都放寬；不是同一件事才算不通過。
只回傳 JSON，不要 markdown：{"verdict":"reasonable"|"unreasonable"|"undetermined","rationale":"一句話"}
無法判斷時 verdict 用 undetermined。這是練習回饋，不是正式測驗評分。`;

function parseJudgeBody(text) {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM 回傳不是 JSON 物件");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * 用 LLM 判「譯文意思是否等於目標中文」。
 * @param {object} [input]
 * @param {string} [input.translation] 學習者輸入的中文譯文（translate_to_zh）
 * @param {string} [input.targetChinese] 目標中文（教材中文句）
 * @param {object} [options] 測試用：注入 `complete` 與 `model`
 * @returns {Promise<{ pass: true, reason: "reasonable", rationale?: string }
 *                  | { pass: false, reason: "empty"|"rejected", rationale?: string }
 *                  | { pass: false, reason: "failed", error?: string }>}
 *   pass=true 時呼叫端可升級 verdict；reason="failed" 是連不上／回傳格式錯（要在畫面說明，
 *   提示改以字面判定）；"rejected" 是 AI 認為意思不同（只算 AI 意見，仍視為規則 retry）；
 *   "empty" 是欠缺譯文或目標中文（不視為 AI 意見）。
 */
export async function judgeAiMeaning({ translation, targetChinese, complete: run = complete, model = DEFAULT_LLM_MODEL } = {}) {
  const heard = typeof translation === "string" ? translation.trim() : "";
  const target = typeof targetChinese === "string" ? targetChinese.trim() : "";
  if (!heard || !target) return { pass: false, reason: "empty" };
  const user = `目標中文：${target}\n中文譯文：${heard}`;
  try {
    const body = parseJudgeBody(await run({ system: MEANING_LLM_SYSTEM, user, model }));
    if (body?.verdict === "reasonable") {
      const rationale = typeof body.rationale === "string" && body.rationale.trim() ? body.rationale.trim() : "";
      return rationale ? { pass: true, reason: "reasonable", rationale } : { pass: true, reason: "reasonable" };
    }
    return { pass: false, reason: "rejected", rationale: typeof body?.rationale === "string" ? body.rationale : undefined };
  } catch (error) {
    return { pass: false, reason: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
