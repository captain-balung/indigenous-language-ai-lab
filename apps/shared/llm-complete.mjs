/**
 * 前端呼叫本站 LLM proxy：Formosan 譯文評分用，不送錄音。
 * POST /api/llm-complete → { text }
 */

export const DEFAULT_LLM_MODEL = "google/gemma-4-26B-A4B-it";
export const LLM_COMPLETE_PATH = "/api/llm-complete";
export const LLM_COMPLETE_TIMEOUT_MS = 35000;

/**
 * @param {object} args
 * @param {string} args.system
 * @param {string} args.user
 * @param {string} [args.model]
 * @param {string} [args.url]
 * @returns {Promise<string>}
 */
export async function complete({ system, user, model = DEFAULT_LLM_MODEL, url = LLM_COMPLETE_PATH } = {}) {
  if (typeof system !== "string" || !system.trim()) throw new Error("complete 需要 system");
  if (typeof user !== "string" || !user.trim()) throw new Error("complete 需要 user");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_COMPLETE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, user, model }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("LLM proxy 逾時");
    throw new Error(error?.message || "無法連線 LLM proxy");
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `LLM proxy HTTP ${response.status}`);
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("LLM proxy 沒有回傳文字");
  }
  return payload.text.trim();
}

/** 判斷語意評分是否因傳輸／proxy 失敗而 undetermined（應退回規則粗判）。 */
export function isLlmTransportFailure(rationale) {
  const msg = String(rationale ?? "");
  return /fetch|HTTP|proxy|逾時|timeout|Failed|OPENAI|LLM|金鑰|API key|無法連線|未設定|沒有回傳|AbortError|NetworkError/i.test(msg);
}
