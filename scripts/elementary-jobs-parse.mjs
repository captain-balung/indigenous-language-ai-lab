// 教學模組初級「職業」JSON：官方檔名是 feature，不是 career。
// 丹群布農語（20）的 phase5 音檔欄位會夾入 <button data-value="…">，整份無法 JSON.parse。

export function sanitizeFeatureJson(text) {
  const cleaned = String(text ?? "").replace(
    /<button\b[^>]*data-value="(\d+)"[^>]*>\s*<\/button>/gi,
    "$1",
  );
  if (/<button\b/i.test(cleaned)) throw new Error("職業 JSON 仍含未處理的 HTML button");
  return cleaned;
}

export function parseFeatureJson(text) {
  try {
    return { json: JSON.parse(text), sanitized: false };
  } catch {
    return { json: JSON.parse(sanitizeFeatureJson(text)), sanitized: true };
  }
}

export function extractJobRecords(json, dialectId) {
  if (json?.theme !== "職業") throw new Error(`方言 ${dialectId} 的 theme 不是「職業」`);
  const answers = (json.data?.phase2 ?? []).filter((item) => item?.name && item.name !== "提問");
  if (answers.length !== 6) {
    throw new Error(`方言 ${dialectId} 的職業答句預期 6 筆，實得 ${answers.length} 筆`);
  }
  return answers.map((item, index) => {
    if (!item.text || !item.image || !item.sound || typeof item.sound !== "string") {
      throw new Error(`方言 ${dialectId} 職業第 ${index + 1} 筆缺少族語、圖片或音檔`);
    }
    if (!/^[a-z0-9._-]+\.(jpg|jpeg|png)$/i.test(item.image)) {
      throw new Error(`方言 ${dialectId} 職業圖片檔名不合法：${item.image}`);
    }
    return {
      id: `${dialectId}-jobs-${index + 1}`,
      order: index + 1,
      chineseText: String(item.name).trim(),
      indigenousText: String(item.text).replace(/\s+/g, " ").trim(),
      imagePath: `images/${item.image}`,
      audioUrl: `https://web.klokah.tw/${item.sound.replace(/^\.\.\//, "")}.mp3`,
    };
  });
}
