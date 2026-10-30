// 族語 E 樂園「十二年國教課程原住民族語文教材」語料下載器。
//
// 只收第 1–9 階：這九年是短句（每課約 3–7 句），適合跟唸、發音與翻譯練習。
// 第 10–12 階是長段落，本版不收。
//
// 來源是族語 E 樂園公開的舊站 API：
//   https://web.klokah.tw/twelve/php/getTextNewFaelohay.php?d={方言}&l={階}&c={課}
//
// ⚠️ 授權：族語 E 樂園〈創用CC授權說明〉第 9 條第 3 款明確把
// 「十二年國教課程原住民族語文教材」排除在 CC BY-NC-SA 4.0 之外，
// 利用前應取得教育部同意。本下載器要求 --acknowledge-license 才寫檔，
// 且產出的 LICENSE.md 會如實標示，不把這批資料標成 CC 教材。
//
// 用法：
//   node scripts/download-twelve.mjs --dry-run
//   node scripts/download-twelve.mjs --acknowledge-license
//   node scripts/download-twelve.mjs --acknowledge-license --verify-audio
//   node scripts/download-twelve.mjs --dry-run --dialects=1,24,33

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIALECTS } from "../apps/basic-learning/body-parts-practice/dialects.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "twelve");
const tempRoot = path.join(projectRoot, "data", ".twelve.tmp");

const API_BASE = "https://web.klokah.tw/twelve/php/getTextNewFaelohay.php";
const SOURCE_PAGE = "https://web.klokah.tw/twelve/learn2.php";
const EBOOK_PAGE = "https://ebook.alcd.center/";
const LICENSE_PAGE = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";

const LEVELS = [
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
const LESSONS_PER_LEVEL = 10;
const MIN_SENTENCES_PER_LEVEL = 8;
const MIN_PLAYABLE_PER_LEVEL = 8;
const MIN_TRANSLATION_PROMPTS_PER_LEVEL = 8;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
const flagValue = (name) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : "";
};

const dryRun = hasFlag("dry-run");
const acknowledged = hasFlag("acknowledge-license");
const verifyAudio = hasFlag("verify-audio") ? (flagValue("verify-audio") === "all" ? "all" : "sample") : "none";
const onlyDialects = flagValue("dialects")
  ? new Set(flagValue("dialects").split(",").map((value) => Number(value.trim())))
  : null;
const selectedDialects = onlyDialects ? DIALECTS.filter((item) => onlyDialects.has(item.id)) : DIALECTS;
if (selectedDialects.length === 0) throw new Error("--dialects 沒有對應到任何方言別");
if (!dryRun && !acknowledged) {
  console.error("這批教材不在 CC BY-NC-SA 4.0 的範圍內，利用前應取得教育部同意。");
  console.error("若已確認要寫入 data/twelve，請加上 --acknowledge-license。");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sourceUrl(dialectId, level, lesson) {
  return `${API_BASE}?d=${dialectId}&l=${level}&c=${lesson}`;
}

async function fetchJson(url) {
  const backoff = [500, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("回應為空（klokah 在併發過高時會這樣）");
      const json = JSON.parse(text);
      if (json?.msg === "fail") throw new Error("API 回傳失敗");
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(backoff[attempt]);
    }
  }
  throw new Error(`下載失敗（已重試 3 次）：${url}\n  ${lastError?.message ?? lastError}`);
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await sleep(120);
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseLesson(json, { dialectId, level, lesson }) {
  const title = clean(json?.title);
  const titleCh = clean(json?.titleCh);
  if (!title || !titleCh) throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課缺少課名`);

  const rawSentences = Array.isArray(json?.sentence) ? json.sentence : [];
  if (rawSentences.length === 0) {
    throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課沒有句子`);
  }

  const seenOrders = new Set();
  const sentences = rawSentences.map((raw, index) => {
    const order = Number(raw?.order);
    if (!Number.isInteger(order) || order < 1) {
      throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課第 ${index + 1} 句的 order 不是正整數`);
    }
    if (seenOrders.has(order)) {
      throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課有重複 order ${order}`);
    }
    seenOrders.add(order);

    const indigenousText = clean(raw?.ab);
    const chineseText = clean(raw?.chinese);
    const audioUrl = clean(raw?.sound) || null;
    if (!indigenousText) throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課 order ${order} 缺少族語`);
    if (!chineseText) throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課 order ${order} 缺少中文`);
    if (audioUrl && !/^https?:\/\//i.test(audioUrl)) {
      throw new Error(`方言 ${dialectId} 第 ${level} 階第 ${lesson} 課 order ${order} 的音檔 URL 格式不正確`);
    }

    return {
      id: `${dialectId}-${level}-${lesson}-${order}`,
      order,
      indigenousText,
      chineseText,
      audioUrl
    };
  }).sort((a, b) => a.order - b.order);

  return { lesson, title, titleCh, sentences };
}

function assertShard(shard) {
  const where = `${shard.dialectName}（${shard.dialectId}）`;
  if (shard.levels.length !== LEVELS.length) {
    throw new Error(`${where} 預期 ${LEVELS.length} 階，實得 ${shard.levels.length} 階`);
  }
  for (const level of shard.levels) {
    if (level.lessons.length !== LESSONS_PER_LEVEL) {
      throw new Error(`${where} 第 ${level.level} 階預期 ${LESSONS_PER_LEVEL} 課，實得 ${level.lessons.length} 課`);
    }
    const sentenceCount = level.lessons.reduce((sum, lesson) => sum + lesson.sentences.length, 0);
    if (sentenceCount < MIN_SENTENCES_PER_LEVEL) {
      throw new Error(`${where} 第 ${level.level} 階只有 ${sentenceCount} 句，不足 ${MIN_SENTENCES_PER_LEVEL} 句`);
    }
    const playableCount = level.lessons.reduce(
      (sum, lesson) => sum + lesson.sentences.filter((sentence) => sentence.audioUrl).length,
      0
    );
    if (playableCount < MIN_PLAYABLE_PER_LEVEL) {
      throw new Error(`${where} 第 ${level.level} 階只有 ${playableCount} 句有音檔，不足 ${MIN_PLAYABLE_PER_LEVEL} 句`);
    }
    const translationPrompts = new Set(
      level.lessons.flatMap((lesson) => lesson.sentences.map((sentence) => sentence.chineseText))
    );
    if (translationPrompts.size < MIN_TRANSLATION_PROMPTS_PER_LEVEL) {
      throw new Error(`${where} 第 ${level.level} 階只有 ${translationPrompts.size} 個不重複中文，不足 ${MIN_TRANSLATION_PROMPTS_PER_LEVEL} 個`);
    }
    const orders = new Set(level.lessons.map((lesson) => lesson.lesson));
    if (orders.size !== LESSONS_PER_LEVEL) throw new Error(`${where} 第 ${level.level} 階有重複課別`);
  }
}

function duplicateReport(shard) {
  const notes = [];
  for (const level of shard.levels) {
    const sentences = level.lessons.flatMap((lesson) => lesson.sentences);
    const byChinese = new Map();
    for (const sentence of sentences) {
      const key = sentence.chineseText;
      if (!byChinese.has(key)) byChinese.set(key, []);
      byChinese.get(key).push(sentence);
    }
    const conflicts = [...byChinese.entries()].filter(([, list]) => {
      return new Set(list.map((sentence) => sentence.indigenousText)).size > 1;
    });
    if (conflicts.length) {
      notes.push({
        level: level.level,
        count: conflicts.length,
        examples: conflicts.slice(0, 3).map(([chinese, list]) => ({
          chinese,
          indigenous: list.map((sentence) => sentence.indigenousText)
        }))
      });
    }
  }
  return notes;
}

// ── 抓取 ────────────────────────────────────────────────
const jobs = [];
for (const dialect of selectedDialects) {
  for (const { level } of LEVELS) {
    for (let lesson = 1; lesson <= LESSONS_PER_LEVEL; lesson += 1) {
      jobs.push({ dialectId: dialect.id, level, lesson });
    }
  }
}

console.log(`開始下載：${selectedDialects.length} 個方言 × ${LEVELS.length} 階 × ${LESSONS_PER_LEVEL} 課 = ${jobs.length} 課`);
console.log("來源：族語 E 樂園十二年國教公開 API（音檔熱連結，不入庫）");

let done = 0;
const fetched = await mapLimit(jobs, 3, async (job) => {
  const url = sourceUrl(job.dialectId, job.level, job.lesson);
  const json = await fetchJson(url);
  const parsed = parseLesson(json, job);
  done += 1;
  if (done % 100 === 0) console.log(`  課程 ${done}/${jobs.length}`);
  return { ...job, url, ...parsed };
});

// ── 組裝分片 ────────────────────────────────────────────
const shards = new Map();
for (const dialect of selectedDialects) {
  shards.set(dialect.id, {
    schemaVersion: 1,
    dialectId: dialect.id,
    ethnicity: dialect.ethnicity,
    dialectName: dialect.name,
    code: dialect.code,
    levels: LEVELS.map(({ level, label, group }) => ({ level, label, group, lessons: [] }))
  });
}

for (const entry of fetched) {
  const shard = shards.get(entry.dialectId);
  const level = shard.levels.find((item) => item.level === entry.level);
  level.lessons.push({
    lesson: entry.lesson,
    title: entry.title,
    titleCh: entry.titleCh,
    sentences: entry.sentences
  });
}

for (const shard of shards.values()) {
  for (const level of shard.levels) level.lessons.sort((a, b) => a.lesson - b.lesson);
  assertShard(shard);
}

const duplicateNotes = [...shards.values()].flatMap((shard) =>
  duplicateReport(shard).map((note) => ({ dialectId: shard.dialectId, dialectName: shard.dialectName, ...note }))
);
if (duplicateNotes.length) {
  console.warn(`注意：有 ${duplicateNotes.length} 個「同中文、不同族語」的階級，App 會以第一句為代表。`);
  console.warn(JSON.stringify(duplicateNotes.slice(0, 5), null, 2));
}

// ── 音檔驗證（HEAD，不下載內容）────────────────────────
let audioSpotCheck = null;
if (verifyAudio !== "none") {
  const targets = [];
  for (const shard of shards.values()) {
    for (const level of shard.levels) {
      if (verifyAudio === "all") {
        for (const lesson of level.lessons) {
          for (const sentence of lesson.sentences) if (sentence.audioUrl) targets.push(sentence.audioUrl);
        }
      } else {
        const withAudio = level.lessons.flatMap((lesson) => lesson.sentences).filter((sentence) => sentence.audioUrl);
        if (withAudio[0]) targets.push(withAudio[0].audioUrl);
        if (withAudio[withAudio.length - 1]) targets.push(withAudio[withAudio.length - 1].audioUrl);
      }
    }
  }
  const unique = [...new Set(targets)];
  console.log(`開始驗證 ${unique.length} 個音檔（${verifyAudio === "all" ? "全部" : "每個方言每階首尾"}）`);
  const failures = [];
  await mapLimit(unique, 3, async (url) => {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) failures.push({ url, status: response.status });
    } catch (error) {
      failures.push({ url, status: String(error?.message ?? error) });
    }
  });
  audioSpotCheck = {
    checked: unique.length,
    ok: unique.length - failures.length,
    sampleRule: verifyAudio === "all" ? "全部音檔" : "每個方言每階首尾",
    failures: failures.slice(0, 20)
  };
  if (failures.length) throw new Error(`有 ${failures.length} 個音檔無法取得，第一個是 ${failures[0].url}`);
}

const missingAudioCount = [...shards.values()].reduce(
  (sum, shard) => sum + shard.levels.reduce(
    (levelSum, level) => levelSum + level.lessons.reduce(
      (lessonSum, lesson) => lessonSum + lesson.sentences.filter((sentence) => !sentence.audioUrl).length,
      0
    ),
    0
  ),
  0
);
const sentenceCount = [...shards.values()].reduce(
  (sum, shard) => sum + shard.levels.reduce(
    (levelSum, level) => levelSum + level.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.sentences.length, 0),
    0
  ),
  0
);
if (missingAudioCount) console.warn(`注意：有 ${missingAudioCount} 句沒有音檔；跟唸與發音練習會跳過這些句子。`);

if (dryRun) {
  const firstId = selectedDialects[0].id;
  const shard = shards.get(firstId);
  console.log("\n--dry-run：不寫檔。第一個方言的摘要：");
  console.log(JSON.stringify({
    dialectId: shard.dialectId,
    dialectName: shard.dialectName,
    counts: shard.levels.map((level) => ({
      level: level.level,
      lessons: level.lessons.length,
      sentences: level.lessons.reduce((sum, lesson) => sum + lesson.sentences.length, 0)
    }))
  }, null, 2));
  console.log("\n第一句：", JSON.stringify(shard.levels[0].lessons[0].sentences[0], null, 2));
  console.log(`\n全部 ${shards.size} 個方言、${sentenceCount} 句，所有數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== DIALECTS.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

// ── 寫出（全部驗證通過後才動硬碟）────────────────────────
await rm(tempRoot, { recursive: true, force: true });
await mkdir(path.join(tempRoot, "dialects"), { recursive: true });

const files = [];
for (const [dialectId, shard] of shards) {
  const relative = `dialects/${dialectId}.json`;
  const text = `${JSON.stringify(shard, null, 2)}\n`;
  await writeFile(path.join(tempRoot, relative), text, "utf8");
  const bytes = Buffer.from(text, "utf8");
  files.push({ dialectId, path: relative, bytes: bytes.length, sha256: sha256(bytes) });
}

const dataset = {
  schemaVersion: 1,
  title: "十二年國教課程原住民族語文教材：第 1–9 階語料",
  description: "族語 E 樂園十二年國教課程原住民族語文教材的第 1–9 階，42 個方言別、每方言 90 課，供跟唸、發音與翻譯練習使用。",
  source: {
    publisher: "教育部國民及學前教育署、原住民族委員會",
    editor: "國立政治大學原住民族研究中心",
    website: "原住民族語E樂園",
    unitUrl: SOURCE_PAGE,
    ebookUrl: EBOOK_PAGE,
    license: "非 CC BY-NC-SA 4.0；需教育部同意",
    licenseUrl: LICENSE_PAGE,
    attribution: "教材來源－十二年國教課程原住民族語文教材，發行單位為教育部、原住民族委員會，編輯單位為國立政治大學原住民族研究中心，教材內容出處為 ebook.alcd.center。",
    retrievedAt: new Date().toISOString()
  },
  recordLayout: "sharded",
  shardPath: "dialects/{dialectId}.json",
  levels: LEVELS,
  lessonsPerLevel: LESSONS_PER_LEVEL,
  dialectCount: selectedDialects.length,
  lessonCountPerDialect: LEVELS.length * LESSONS_PER_LEVEL,
  sentenceCount,
  missingAudioCount,
  audioPolicy: "hotlinked-at-runtime",
  audioNote: "音檔不入庫，執行時直接由 CloudFront 播放；播放時該站會看到使用者的 IP 位址。",
  duplicateChineseNotes: duplicateNotes,
  dialects: selectedDialects.map(({ id, ethnicity, name, code }) => ({ id, ethnicity, name, code }))
};

const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(tempRoot, "dataset.json"), datasetText, "utf8");
const datasetBytes = Buffer.from(datasetText, "utf8");

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceApi: API_BASE,
  recordCount: sentenceCount,
  lessonCount: selectedDialects.length * LEVELS.length * LESSONS_PER_LEVEL,
  dialectCount: selectedDialects.length,
  audioSpotCheck,
  dataset: { path: "dataset.json", bytes: datasetBytes.length, sha256: sha256(datasetBytes) },
  files
};
await writeFile(path.join(tempRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readme = `# 十二年國教課程原住民族語文教材：第 1–9 階\n\n` +
  `本目錄保存「族語 E 樂園」十二年國教課程原住民族語文教材的第 1–9 階，供「跟唸」「發音練習」「翻譯」三個練習使用。\n\n` +
  `- 42 個方言別，每方言 9 階 × 10 課 = 90 課，共 ${sentenceCount} 句。\n` +
  `- 其中 ${missingAudioCount} 句沒有官方音檔；跟唸與發音練習會跳過這些句子，翻譯仍可使用文字。\n` +
  `- \`dialects/{dialectId}.json\`：每個方言一個分片，頁面只載入使用者選的那一個。\n` +
  `- \`dataset.json\`：索引、來源、階級表與完整性數字。**不含題目本身。**\n` +
  `- \`manifest.json\`：來源 URL、檔案大小與 SHA-256。\n` +
  `- \`LICENSE.md\`：授權、標示與使用限制。\n\n` +
  `第 10–12 階是長段落，本版不收；舊站測驗也只到第 9 階。\n\n` +
  `## 音檔\n\n` +
  `**音檔不入庫。** 有音檔的資料帶有 \`audioUrl\`，執行時由 CloudFront 直接播放；${missingAudioCount} 句沒有官方音檔。\n` +
  `這代表使用者播放時，該站會看到使用者的 IP 位址；應用頁面必須揭露這件事。\n\n` +
  `## 重新下載\n\n` +
  `\`\`\`\nnode scripts/download-twelve.mjs --acknowledge-license\n\`\`\`\n\n` +
  `下載器會要求 42 個方言、9 階 × 10 課，每階至少 8 句、8 句有音檔、8 個不重複中文，全部驗證通過才寫檔。\n` +
  `失敗時本目錄保持原狀。\n\n` +
  `其他參數：\`--dry-run\`（不寫檔的抽驗）、\`--dialects=1,24,33\`（只抓部分方言，需搭配 \`--dry-run\`）、\n` +
  `\`--verify-audio\`（每方言每階首尾 HEAD 抽驗）、\`--verify-audio=all\`（完整掃描，很慢）。\n`;
await writeFile(path.join(tempRoot, "README.md"), readme, "utf8");

const license = `# 素材授權與標示\n\n` +
  `資料來源－[原住民族語E樂園](${SOURCE_PAGE}) 的「十二年國教課程原住民族語文教材」。\n` +
  `發行單位：教育部、原住民族委員會；編輯單位：國立政治大學原住民族研究中心；\n` +
  `教材內容出處：[ebook.alcd.center](${EBOOK_PAGE})。\n\n` +
  `## ⚠️ 不適用 CC BY-NC-SA 4.0\n\n` +
  `依族語 E 樂園[〈創用CC授權說明〉](${LICENSE_PAGE})第 9 條第 3 款，\n` +
  `「十二年國教課程原住民族語文教材」**不適用**該站其餘內容的 CC BY-NC-SA 4.0 授權，\n` +
  `利用前應取得專責單位教育部的同意。\n\n` +
  `本目錄依網站擁有者指示，整理公開 API 取得的文字與音檔網址，僅供本專案的族語練習使用；\n` +
  `不重新授權、不主張著作權，也不得作為商業用途。若需再散布或改作，請自行向權利人取得同意。\n\n` +
  `## 音檔\n\n` +
  `本目錄不收錄任何音檔。應用程式執行時直接連往官方 CloudFront 播放，\n` +
  `不重製、不轉存、不代為散布。\n`;
await writeFile(path.join(tempRoot, "LICENSE.md"), license, "utf8");

await rm(outputRoot, { recursive: true, force: true });
await rename(tempRoot, outputRoot);

console.log(`完成：${selectedDialects.length} 個方言、${sentenceCount} 句、${selectedDialects.length * LEVELS.length * LESSONS_PER_LEVEL} 課`);
console.log(`已寫入 ${path.relative(projectRoot, outputRoot)}`);
