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

export function wordImage(dialectId, alphabetId, order) {
  return `https://klokah.tw/extension/ab_data/image/${dialectId}/${dialectId}A${alphabetId}_${Number(order) + 1}.png`;
}

function withWordImages(shard, questions) {
  return questions.map((question) => ({
    ...question,
    imageUrl: wordImage(shard.dialectId, question.lesson, question.order)
  }));
}

export function buildRound(input) {
  const letter = Number(input.letter);
  const level = input.shard?.levels?.[0];
  const lesson = letter ? level?.lessons?.find((item) => Number(item.lesson) === letter) : null;
  const shard = letter
    ? { ...input.shard, levels: [{ ...level, lessons: lesson ? [lesson] : [] }] }
    : input.shard;
  return withWordImages(shard, buildTwelveRound({ ...input, shard, level: LEVEL }));
}

const COPY = {
  retell: {
    mission: "基礎學習",
    lead: "看圖片，聽一段例詞，再用族語跟唸一次。",
    titles: { retell: ["跟唸", "看圖片，聽完後用族語再講一次"] }
  },
  pronounce: {
    mission: "課堂測驗",
    lead: "看圖片和族語文字，錄音念出來。",
    titles: { pronounce: ["發音", "看圖片和族語文字，錄音念出來"] }
  }
};

export function engineOptions(activity) {
  const copy = COPY[activity];
  return {
    pageTitle: "字母篇｜族語e樂園 AI 實驗室",
    heading: "字母篇",
    mission: copy.mission,
    lead: copy.lead,
    titles: copy.titles,
    loadShard,
    buildRound,
    unitLabel: (question) => question.lessonTitleCh || `字母 ${question.lessonTitle}`,
    emptyRound: activity === "retell" ? "這個字母目前沒有可出的題。" : "這個方言目前沒有可出的題。",
    pickLetter: activity === "retell",
    letterImage: activity === "retell" ? letterImage : null,
    fixedLevel: activity === "retell" ? 0 : LEVEL
  };
}
