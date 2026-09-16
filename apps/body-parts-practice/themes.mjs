export const THEMES = [
  { id: "body", name: "身體部位", source: "recognize", className: "身體部位" },
  { id: "animals", name: "動物", source: "recognize", className: "動物" },
  { id: "plants", name: "植物／水果", source: "recognize", className: "植(食)物/水果" },
  { id: "things", name: "物品", source: "recognize", className: "物品" },
  { id: "places", name: "地點／景觀", source: "recognize", className: "山川建築/自然景觀" },
  { id: "people", name: "人物", source: "recognize", className: "人物" },
  { id: "jobs", name: "職業", source: "jobs" },
];

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) ?? null;
}

const shardCache = new Map();

export function loadThemeShards(dialectId) {
  const key = String(dialectId);
  if (!shardCache.has(key)) {
    shardCache.set(key, Promise.all([
      fetch(`/data/klokah-junior/dialects/${key}.json`).then((response) => {
        if (!response.ok) throw new Error("看圖教材載入失敗");
        return response.json();
      }),
      fetch(`/data/elementary-jobs/dialects/${key}.json`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]).then(([junior, jobs]) => ({ junior, jobs })));
  }
  return shardCache.get(key);
}

export function recordsForTheme(theme, juniorShard, jobsShard) {
  if (!theme) return [];
  if (theme.source === "jobs") {
    return (jobsShard?.records ?? []).filter((item) => item.indigenousText && item.imagePath).map((item) => ({
      id: item.id,
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
      audioUrl: item.audioUrl ?? "",
      imageSrc: `/data/elementary-jobs/${item.imagePath}`,
    }));
  }
  return (juniorShard?.recognize ?? [])
    .filter((item) => item.className === theme.className && item.indigenousText && item.imagePath)
    .map((item) => ({
      id: item.id,
      indigenousText: item.indigenousText,
      chineseText: item.chineseText,
      audioUrl: item.audioUrl ?? "",
      imageSrc: `/data/klokah-junior/${item.imagePath}`,
    }));
}
