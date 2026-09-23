import { semanticMatch } from "../body-parts-practice/core.mjs";
import { dialogueQuestions } from "../qa-practice/core.mjs";

export const ROUND_SIZE = 8;

export const MODES = {
  compose: {
    title: "意思造句",
    mission: "01",
    lead: "只看中文意思，自己寫族語。每題都翻譯，並顯示系統懂成。"
  },
  oral: {
    title: "看圖口說小考",
    mission: "02",
    lead: "看圖念出完整句。每題只錄一次，由語音辨識與翻譯計分。"
  },
  retell: {
    title: "聽後轉述",
    mission: "03",
    lead: "只聽短句，用族語再講一次。系統顯示它聽到的話，以及懂成的中文。"
  },
  reply: {
    title: "接話小考",
    mission: "04",
    lead: "聽問句，用族語回答一次。系統先辨識，再判斷有沒有答到。"
  }
};

export function modeFromSearch(search) {
  const mode = new URLSearchParams(search).get("mode");
  return Object.hasOwn(MODES, mode) ? mode : "compose";
}

export function needsAsr(mode) {
  return mode === "oral" || mode === "retell" || mode === "reply";
}

export function needsAudio(mode) {
  return mode === "retell" || mode === "reply";
}

function mapRecognize(item) {
  return {
    id: item.id,
    indigenousText: item.indigenousText,
    chineseText: item.chineseText,
    audioUrl: item.audioUrl || "",
    imageSrc: item.imagePath ? `/data/klokah-junior/${item.imagePath}` : ""
  };
}

function recognizeRecords(shard) {
  return (shard?.recognize ?? [])
    .filter((item) => item?.indigenousText && item?.chineseText)
    .map(mapRecognize);
}

export function composePool(shard) {
  return recognizeRecords(shard);
}

export function oralPool(shard) {
  return recognizeRecords(shard).filter((item) => item.imageSrc);
}

export function retellPool(shard) {
  return recognizeRecords(shard).filter((item) => item.audioUrl);
}

export function replyPool(shard) {
  return dialogueQuestions(shard).map((item) => ({
    id: item.id,
    indigenousText: item.indigenousText,
    chineseText: item.chineseText,
    audioUrl: item.audioUrl,
    imageSrc: ""
  }));
}

export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function draw(pool, size, random = Math.random) {
  return shuffle(pool, random).slice(0, size);
}

function poolFor(shard, mode) {
  if (mode === "oral") return oralPool(shard);
  if (mode === "retell") return retellPool(shard);
  if (mode === "reply") return replyPool(shard);
  return composePool(shard);
}

export function buildRound(shard, mode, random = Math.random) {
  return draw(poolFor(shard, mode), ROUND_SIZE, random).map((item) => ({
    ...item,
    mode,
    roundId: `${mode}:${item.id}`
  }));
}

export function verdictFromTranslation({ exact, translation, chineseText }) {
  if (semanticMatch(translation, chineseText)) return "semantic";
  if (exact) return "exact";
  return "retry";
}

export function replyVerdict(judged) {
  if (judged?.verdict === "reasonable") return "semantic";
  if (judged?.verdict === "unreasonable") return "retry";
  return "unavailable";
}

export function tally(results) {
  const list = Array.isArray(results) ? results : [];
  const skipped = list.filter((item) => item?.type === "unavailable").length;
  const passed = list.filter((item) => item?.type === "exact" || item?.type === "semantic").length;
  return { passed, scored: list.length - skipped, skipped, total: list.length };
}

export function scoreLabel(summary) {
  const skip = summary.skipped ? `，${summary.skipped} 題不計分` : "";
  return `本堂 ${summary.passed} / ${summary.scored}${skip}`;
}

export function reportDetail(result) {
  const parts = [];
  if (result?.heard) parts.push(`系統聽到：${result.heard}`);
  if (result?.translation) parts.push(`系統懂成：${result.translation}`);
  if (result?.type === "exact") parts.push("與教材字面一致");
  if (result?.mode === "reply" && result?.type === "semantic") parts.push("有答到問句");
  if (result?.mode === "reply" && result?.type === "retry") parts.push("沒有答到問句");
  if (!parts.length && result?.type === "retry") parts.push("與教材不同");
  if (result?.type === "unavailable") parts.push("這題沒有完成判定");
  return parts.join("。");
}
