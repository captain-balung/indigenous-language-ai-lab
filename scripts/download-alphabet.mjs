// 族語 E 樂園「補充教材－字母篇」例詞下載器。
//
// 只收例詞（族語、中文、音檔網址）。字母音與圖片不入庫。
// XML：https://web.klokah.tw/extension/ab_data/xml/{方言}/alphabet.xml
// 音檔：https://klokah.tw/extension/ab_data/sound/{方言}/{方言}A{alphabetId}_{序號}.mp3
//       _1 是字母音，例詞從 _2 起。
//
// 授權是 CC BY-NC-SA 4.0（不在十二年國教那條例外裡）。
//
// 用法：
//   node scripts/download-alphabet.mjs --dry-run
//   node scripts/download-alphabet.mjs
//   node scripts/download-alphabet.mjs --verify-audio
//   node scripts/download-alphabet.mjs --dry-run --dialects=1,24,33

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIALECTS } from "../apps/basic-learning/body-parts-practice/dialects.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "alphabet");
const tempRoot = path.join(projectRoot, "data", ".alphabet.tmp");

const XML_BASE = "https://web.klokah.tw/extension/ab_data/xml";
const AUDIO_BASE = "https://klokah.tw/extension/ab_data/sound";
const SOURCE_PAGE = "https://web.klokah.tw/extension/ab_practice/";
const LICENSE_PAGE = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";
const MIN_UNIQUE_PLAYABLE = 8;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
const flagValue = (name) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : "";
};

const dryRun = hasFlag("dry-run");
const verifyAudio = hasFlag("verify-audio") ? (flagValue("verify-audio") === "all" ? "all" : "sample") : "none";
const onlyDialects = flagValue("dialects")
  ? new Set(flagValue("dialects").split(",").map((value) => Number(value.trim())))
  : null;
const selectedDialects = onlyDialects ? DIALECTS.filter((item) => onlyDialects.has(item.id)) : DIALECTS;
if (selectedDialects.length === 0) throw new Error("--dialects 沒有對應到任何方言別");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return clean(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function field(block, name) {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : "";
}

async function fetchText(url) {
  const backoff = [500, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("回應為空（klokah 在併發過高時會這樣）");
      return text;
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
      await sleep(80);
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseAlphabet(xml, dialectId) {
  const blocks = [...xml.matchAll(/<alphabet>([\s\S]*?)<\/alphabet>/g)].map((match) => match[1]);
  if (!blocks.length) throw new Error(`方言 ${dialectId} 的字母篇 XML 沒有 alphabet`);

  const seenIds = new Set();
  const lessons = [];
  for (const block of blocks) {
    const symbol = field(block, "alphabetSymbol");
    const alphabetId = Number(field(block, "alphabetId"));
    if (!symbol) throw new Error(`方言 ${dialectId} 有字母缺少符號`);
    if (!Number.isInteger(alphabetId) || alphabetId < 1) {
      throw new Error(`方言 ${dialectId} 字母「${symbol}」的 alphabetId 不是正整數`);
    }
    if (seenIds.has(alphabetId)) throw new Error(`方言 ${dialectId} 字母編號 ${alphabetId} 重複`);
    seenIds.add(alphabetId);

    const sentences = [];
    for (let order = 1; ; order += 1) {
      const hasWord = block.includes(`<word${order}>`);
      const hasMeaning = block.includes(`<meaning${order}>`);
      if (!hasWord && !hasMeaning) break;
      const indigenousText = field(block, `word${order}`);
      const chineseText = field(block, `meaning${order}`);
      if (!indigenousText && !chineseText) break;
      if (!indigenousText || !chineseText) {
        throw new Error(`方言 ${dialectId} 字母「${symbol}」第 ${order} 個例詞缺少族語或中文`);
      }
      sentences.push({
        id: `${dialectId}-${alphabetId}-${order}`,
        order,
        indigenousText,
        chineseText,
        audioUrl: `${AUDIO_BASE}/${dialectId}/${dialectId}A${alphabetId}_${order + 1}.mp3`
      });
    }
    if (!sentences.length) continue;
    lessons.push({
      lesson: alphabetId,
      title: symbol,
      titleCh: `字母 ${symbol}`,
      sentences
    });
  }

  lessons.sort((a, b) => a.lesson - b.lesson);
  return lessons;
}

function assertShard(shard) {
  const words = shard.levels[0].lessons.flatMap((lesson) => lesson.sentences);
  const playable = new Set(
    words.filter((word) => word.audioUrl).map((word) => word.indigenousText)
  );
  if (playable.size < MIN_UNIQUE_PLAYABLE) {
    throw new Error(`${shard.dialectName}（${shard.dialectId}）只有 ${playable.size} 個不重複例詞，不足 ${MIN_UNIQUE_PLAYABLE} 個`);
  }
}

console.log(`開始下載：${selectedDialects.length} 個方言的字母篇例詞`);
const shards = await mapLimit(selectedDialects, 3, async (dialect) => {
  const url = `${XML_BASE}/${dialect.id}/alphabet.xml`;
  const xml = await fetchText(url);
  const lessons = parseAlphabet(xml, dialect.id);
  const shard = {
    schemaVersion: 1,
    dialectId: dialect.id,
    ethnicity: dialect.ethnicity,
    dialectName: dialect.name,
    code: dialect.code,
    levels: [{ level: 1, label: "全部例詞", group: "字母篇", lessons }]
  };
  assertShard(shard);
  return shard;
});

const wordCount = shards.reduce(
  (sum, shard) => sum + shard.levels[0].lessons.reduce((inner, lesson) => inner + lesson.sentences.length, 0),
  0
);

let audioSpotCheck = null;
if (verifyAudio !== "none") {
  const targets = [];
  for (const shard of shards) {
    const words = shard.levels[0].lessons.flatMap((lesson) => lesson.sentences);
    if (verifyAudio === "all") targets.push(...words.map((word) => word.audioUrl));
    else {
      if (words[0]) targets.push(words[0].audioUrl);
      if (words.at(-1)) targets.push(words.at(-1).audioUrl);
    }
  }
  const unique = [...new Set(targets)];
  console.log(`開始驗證 ${unique.length} 個音檔（${verifyAudio === "all" ? "全部" : "每個方言首尾"}）`);
  const failures = [];
  await mapLimit(unique, 4, async (url) => {
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
    sampleRule: verifyAudio === "all" ? "全部音檔" : "每個方言首尾",
    failures: failures.slice(0, 20)
  };
  if (failures.length) throw new Error(`有 ${failures.length} 個音檔無法取得，第一個是 ${failures[0].url}`);
}

if (dryRun) {
  const shard = shards[0];
  console.log("\n--dry-run：不寫檔。第一個方言的摘要：");
  console.log(JSON.stringify({
    dialectId: shard.dialectId,
    dialectName: shard.dialectName,
    letters: shard.levels[0].lessons.length,
    words: shard.levels[0].lessons.reduce((sum, lesson) => sum + lesson.sentences.length, 0),
    first: shard.levels[0].lessons[0].sentences[0]
  }, null, 2));
  console.log(`\n全部 ${shards.length} 個方言、${wordCount} 個例詞，數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== DIALECTS.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

await rm(tempRoot, { recursive: true, force: true });
await mkdir(path.join(tempRoot, "dialects"), { recursive: true });

const files = [];
for (const shard of shards) {
  const relative = `dialects/${shard.dialectId}.json`;
  const text = `${JSON.stringify(shard, null, 2)}\n`;
  await writeFile(path.join(tempRoot, relative), text, "utf8");
  const bytes = Buffer.from(text, "utf8");
  files.push({ dialectId: shard.dialectId, path: relative, bytes: bytes.length, sha256: sha256(bytes) });
}

const dataset = {
  schemaVersion: 1,
  title: "字母篇例詞",
  description: "族語 E 樂園補充教材字母篇的例詞，42 個方言別，供跟唸與發音練習使用。",
  source: {
    publisher: "財團法人原住民族語言研究發展基金會",
    website: "原住民族語E樂園",
    unitUrl: SOURCE_PAGE,
    license: "CC BY-NC-SA 4.0",
    licenseUrl: LICENSE_PAGE,
    attribution: "資料來源－原住民族語E樂園／補充教材－字母篇，由財團法人原住民族語言研究發展基金會製作，以創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款釋出。",
    retrievedAt: new Date().toISOString()
  },
  recordLayout: "sharded",
  shardPath: "dialects/{dialectId}.json",
  dialectCount: shards.length,
  wordCount,
  audioPolicy: "hotlinked-at-runtime",
  audioNote: "音檔不入庫，執行時直接由 klokah.tw 播放；播放時該站會看到使用者的 IP 位址。字母音與圖片不入庫。",
  dialects: selectedDialects.map(({ id, ethnicity, name, code }) => ({ id, ethnicity, name, code }))
};

const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(tempRoot, "dataset.json"), datasetText, "utf8");
const datasetBytes = Buffer.from(datasetText, "utf8");

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceXml: `${XML_BASE}/{dialectId}/alphabet.xml`,
  audioBase: AUDIO_BASE,
  recordCount: wordCount,
  dialectCount: shards.length,
  audioSpotCheck,
  dataset: { path: "dataset.json", bytes: datasetBytes.length, sha256: sha256(datasetBytes) },
  files
};
await writeFile(path.join(tempRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readme = `# 字母篇例詞\n\n` +
  `本目錄保存「族語 E 樂園」補充教材字母篇的例詞，供「跟唸」與「發音練習」使用。\n\n` +
  `- 42 個方言別，共 ${wordCount} 個例詞。\n` +
  `- 每個字母是一課，例詞是該課的句子。題面用課名「字母 a」標出所屬字母。\n` +
  `- \`dialects/{dialectId}.json\`：每個方言一個分片，頁面只載入使用者選的那一個。\n` +
  `- \`dataset.json\`：索引、來源與完整性數字。**不含題目本身。**\n` +
  `- \`manifest.json\`：來源 URL、檔案大小與 SHA-256。\n` +
  `- \`LICENSE.md\`：授權、標示與使用限制。\n\n` +
  `字母本身的發音與圖片不在這個練習裡。\n\n` +
  `## 音檔\n\n` +
  `**音檔不入庫。** 例詞帶有 \`audioUrl\`，執行時由 klokah.tw 直接播放。\n` +
  `這代表使用者播放時，該站會看到使用者的 IP 位址；應用頁面必須揭露這件事。\n\n` +
  `## 重新下載\n\n` +
  `\`\`\`\nnode scripts/download-alphabet.mjs\n\`\`\`\n\n` +
  `下載器會要求 42 個方言、每個方言至少 8 個不重複例詞，全部驗證通過才寫檔。失敗時本目錄保持原狀。\n\n` +
  `其他參數：\`--dry-run\`（不寫檔的抽驗）、\`--dialects=1,24,33\`（只抓部分方言，需搭配 \`--dry-run\`）、\n` +
  `\`--verify-audio\`（每方言首尾 HEAD 抽驗）、\`--verify-audio=all\`（完整掃描）。\n`;
await writeFile(path.join(tempRoot, "README.md"), readme, "utf8");

const license = `# 素材授權與標示\n\n` +
  `資料來源－[原住民族語E樂園／補充教材－字母篇](${SOURCE_PAGE})，由財團法人原住民族語言研究發展基金會製作，` +
  `以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](${LICENSE_PAGE})釋出。\n\n` +
  `## 使用限制\n\n` +
  `- 必須標示網站全稱及原著作網址。\n` +
  `- 不得作商業用途；商業使用須另向權利人申請授權。\n` +
  `- 改作或衍生作品必須以相同授權條款散布。\n` +
  `- 本資料僅涵蓋本單元例詞文字與音檔網址，不代表授權原始網站程式碼、商標或其他未收錄內容。\n\n` +
  `## 音檔\n\n` +
  `本目錄不收錄任何音檔。應用程式執行時直接連往 klokah.tw 播放，不重製、不轉存、不代為散布。\n`;
await writeFile(path.join(tempRoot, "LICENSE.md"), license, "utf8");

await rm(outputRoot, { recursive: true, force: true });
await rename(tempRoot, outputRoot);

console.log(`完成：${shards.length} 個方言、${wordCount} 個例詞`);
console.log(`已寫入 ${path.relative(projectRoot, outputRoot)}`);
