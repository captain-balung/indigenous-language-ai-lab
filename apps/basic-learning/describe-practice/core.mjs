export const LEVELS = [
  { id: "beginner", name: "初級・看圖說話" },
  { id: "intermediate", name: "中級・看圖表達" }
];

export function pictureTalkRecords(juniorShard, seniorShard) {
  const beginner = (juniorShard?.pictureTalk ?? [])
    .filter((item) => item.tip && item.chineseText && Array.isArray(item.imageUrls) && item.imageUrls.length)
    .map((item) => ({
      id: item.id,
      level: "beginner",
      title: "看圖說話",
      tip: item.tip,
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
      imageUrls: [...item.imageUrls]
    }));
  const intermediate = (seniorShard?.pictureTalk ?? [])
    .filter((item) => item.tip && item.chineseText && item.imageUrl)
    .map((item) => ({
      id: item.id,
      level: "intermediate",
      title: "看圖表達",
      tip: item.tip,
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
      imageUrls: [item.imageUrl]
    }));
  return { beginner, intermediate };
}

/** 練習一次只出一張。多圖題拆成連續幾題，每題只帶該張圖。 */
export function singleImageTurns(records) {
  return (records ?? []).flatMap((item) => (item.imageUrls ?? []).map((imageUrl, index) => ({
    ...item,
    id: `${item.id}#${index + 1}`,
    imageUrls: [imageUrl]
  })));
}

export function describeCaption({ translation, matched, pictureScore } = {}) {
  const scored = pictureScore?.status === "scored" && Number.isFinite(pictureScore.points);
  const asides = [];
  if (scored) {
    asides.push(`練習評分 ${pictureScore.points} / ${pictureScore.maxPoints ?? 10}（非正式測驗）。`);
  }
  if (pictureScore?.rationale) asides.push(String(pictureScore.rationale));
  if (pictureScore?.fallback === "heuristic") asides.push("改用規則粗判。");
  if (matched && !scored) asides.push("意思接近教材參考說明。");
  return {
    headline: "系統懂成",
    translation: String(translation ?? "").trim(),
    aside: asides.filter(Boolean).join(" ")
  };
}
