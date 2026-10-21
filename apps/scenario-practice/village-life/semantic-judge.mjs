/**
 * 部落大小事任務關卡的 AI 語意補判。
 *
 * 實作已共用化：規則判定（core.mjs 的族語鍵比對、翻譯完全相等）沒過（retry）時，
 * 由 `apps/shared/semantic-meaning.mjs` 的 LLM（經 /api/llm-complete → 自架 vLLM）
 * 判「譯文與教材中文是不是同一個意思」。任何失敗回 null，呼叫端維持規則結果
 * retry——分數不會退步。只送譯文與教材中文，不送參考族語句；錄音只送 Formosan。
 */

export { judgeAiMeaning } from "../../shared/semantic-meaning.mjs";
