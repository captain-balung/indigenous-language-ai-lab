/**
 * LLM 語意評分＋規則粗判備援。
 * complete／proxy 失敗時改走 heuristic，並標記 fallback。
 */

import { complete as defaultComplete, DEFAULT_LLM_MODEL, isLlmTransportFailure } from "./llm-complete.mjs";

/**
 * @param {object} options
 * @param {(opts: { complete: Function, model?: string }) => object} options.createLlm
 * @param {() => object} options.createHeuristic
 * @param {(args: { system: string, user: string }) => Promise<string>} [options.complete]
 * @param {string} [options.model]
 */
export function createResilientSemanticJudge({
  createLlm,
  createHeuristic,
  complete = defaultComplete,
  model = DEFAULT_LLM_MODEL,
} = {}) {
  if (typeof createLlm !== "function" || typeof createHeuristic !== "function") {
    throw new Error("createResilientSemanticJudge 需要 createLlm 與 createHeuristic");
  }

  const heuristic = createHeuristic();
  const llm = createLlm({ complete, model });

  async function withFallback(runLlm, runHeuristic) {
    const result = await runLlm();
    if (result?.fallback === "heuristic") return result;
    if (isLlmTransportFailure(result?.rationale)) {
      const fallback = await runHeuristic();
      const note = "改用規則粗判";
      return {
        ...fallback,
        fallback: "heuristic",
        rationale: fallback?.rationale ? `${fallback.rationale}（${note}）` : note,
      };
    }
    return result;
  }

  return {
    id: llm.id,
    async judgeShortAnswer(input) {
      return withFallback(
        () => llm.judgeShortAnswer(input),
        () => heuristic.judgeShortAnswer(input),
      );
    },
    async scorePictureTalk(input) {
      return withFallback(
        () => llm.scorePictureTalk(input),
        () => heuristic.scorePictureTalk(input),
      );
    },
  };
}
