// 十二年國教練習的共用資料層。
//
// 只處理第 1–9 階：每階 10 課，句子較短，適合跟唸與翻譯。
// 分片格式見 data/twelve/README.md；本模組不碰錄音或 UI。

export const LEVELS = [
  { level: 1, label: "第一階", group: "初級" },
  { level: 2, label: "第二階", group: "初級" },
  { level: 3, label: "第三階", group: "初級" },
  { level: 4, label: "第四階", group: "中級" },
  { level: 5, label: "第五階", group: "中級" },
  { level: 6, label: "第六階", group: "中級" },
  { level: 7, label: "第七階", group: "中高級" },
  { level: 8, label: "第八階", group: "中高級" },
  { level: 9, label: "第九階", group: "中高級" }
];

export const LEVEL_BY_NUMBER = new Map(LEVELS.map((item) => [item.level, item]));
export const ROUND_SIZE = 8;
export const TRANSLATE_ANSWER_MODES = ["typing", "speech"];

export const ACTIVITIES = {
  retell: {
    label: "跟唸",
    track: "基礎學習",
    mission: "05",
    lead: "聽一段短句，再用族語跟唸一次。"
  },
  translate: {
    label: "翻譯",
    track: "課堂測驗",
    mission: "06",
    lead: "看中文，用錄音或打字翻成族語。"
  }
};

export function levelInfo(level) {
  const info = LEVEL_BY_NUMBER.get(Number(level));
  if (!info) throw new Error(`沒有第 ${level} 階`);
  return info;
}

export function levelOptions() {
  return LEVELS.map((item) => ({
    ...item,
    text: `${item.label}（${item.group}）`
  }));
}

export async function loadShard(dialectId, fetchImpl = fetch) {
  const response = await fetchImpl(`/data/twelve/dialects/${Number(dialectId)}.json`);
  if (!response.ok) throw new Error("教材載入失敗");
  return response.json();
}

export function levelEntry(shard, level) {
  const entry = shard?.levels?.find((item) => Number(item.level) === Number(level));
  if (!entry) throw new Error(`教材沒有第 ${level} 階`);
  return entry;
}

export function lessonsForLevel(shard, level) {
  return [...levelEntry(shard, level).lessons].sort((a, b) => a.lesson - b.lesson);
}

export function sentencePool(shard, level, { key = "id", requireAudio = false } = {}) {
  const sentences = lessonsForLevel(shard, level).flatMap((lesson) =>
    lesson.sentences
      .filter((sentence) => !requireAudio || Boolean(sentence.audioUrl))
      .map((sentence) => ({
        ...sentence,
        level: Number(level),
        lesson: lesson.lesson,
        lessonTitle: lesson.title,
        lessonTitleCh: lesson.titleCh
      }))
  );
  const seen = new Set();
  return sentences.filter((sentence) => {
    const value = key === "id"
      ? sentence.id
      : key === "chinese"
        ? normalizeText(sentence.chineseText)
        : key === "indigenous"
          ? normalizeText(sentence.indigenousText)
          : String(sentence[key] ?? "");
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function draw(list, size, random = Math.random) {
  return shuffle(list, random).slice(0, Math.max(0, size));
}

function uniqueKeyFor(activity) {
  if (activity === "translate") return "chinese";
  return "indigenous";
}

/**
 * 建立一輪題目。
 *
 * @param {object} input
 * @param {object} input.shard 方言分片
 * @param {number} input.level 1–9
 * @param {"retell"|"translate"} input.activity
 * @param {"typing"|"speech"} [input.answerMode] 翻譯限定
 * @param {number} [input.size]
 * @param {() => number} [input.random]
 */
export function buildRound({
  shard,
  level,
  activity,
  answerMode = "typing",
  size = ROUND_SIZE,
  random = Math.random
}) {
  if (!Object.hasOwn(ACTIVITIES, activity)) throw new Error(`未知的練習類型：${activity}`);
  if (activity === "translate" && !TRANSLATE_ANSWER_MODES.includes(answerMode)) {
    throw new Error(`未知的作答方式：${answerMode}`);
  }
  const pool = sentencePool(shard, level, {
    key: uniqueKeyFor(activity),
    requireAudio: activity !== "translate"
  });
  if (!pool.length) return [];

  const chosen = draw(pool, Math.min(size, pool.length), random);
  return chosen.map((sentence) => {
    const inputMode = activity === "translate" ? answerMode : "speech";
    return {
      ...sentence,
      roundId: `${activity}:${sentence.id}`,
      activity,
      inputMode
    };
  });
}
