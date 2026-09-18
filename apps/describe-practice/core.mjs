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

export function describeCaption({ translation, matched }) {
  return {
    headline: "系統懂成",
    translation: String(translation ?? "").trim(),
    aside: matched ? "意思接近教材參考說明。" : ""
  };
}
