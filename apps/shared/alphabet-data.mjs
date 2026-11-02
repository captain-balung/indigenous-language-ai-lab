// 字母篇例詞的載入與抽題。分片形狀與十二年國教相同，所以直接用既有的 buildRound。

import { buildRound as buildTwelveRound } from "./twelve-data.mjs";

const LEVEL = 1;

export async function loadShard(dialectId, fetchImpl = fetch) {
  const response = await fetchImpl(`/data/alphabet/dialects/${Number(dialectId)}.json`);
  if (!response.ok) throw new Error("教材載入失敗");
  return response.json();
}

export function letterImage(dialectId, alphabetId) {
  return `https://klokah.tw/extension/ab_data/image/${dialectId}/${dialectId}A${alphabetId}_1.png`;
}

export function buildRound(input) {
  const letter = Number(input.letter);
  if (!letter) return buildTwelveRound({ ...input, level: LEVEL });
  const level = input.shard?.levels?.[0];
  const lesson = level?.lessons?.find((item) => Number(item.lesson) === letter);
  return buildTwelveRound({
    ...input,
    shard: { ...input.shard, levels: [{ ...level, lessons: lesson ? [lesson] : [] }] },
    level: LEVEL
  });
}

const COPY = {
  retell: { mission: "基礎學習", lead: "聽一段例詞，再用族語跟唸一次。" },
  pronounce: { mission: "課堂測驗", lead: "看族語例詞，錄音念出來。" }
};

export function engineOptions(activity) {
  const copy = COPY[activity];
  return {
    pageTitle: "字母篇｜族語e樂園 AI 實驗室",
    heading: "字母篇",
    mission: copy.mission,
    lead: copy.lead,
    loadShard,
    buildRound,
    unitLabel: (question) => question.lessonTitleCh || `字母 ${question.lessonTitle}`,
    emptyRound: activity === "retell" ? "這個字母目前沒有可出的題。" : "這個方言目前沒有可出的題。",
    pickLetter: activity === "retell",
    letterImage: activity === "retell" ? letterImage : null,
    fixedLevel: activity === "retell" ? 0 : LEVEL
  };
}
