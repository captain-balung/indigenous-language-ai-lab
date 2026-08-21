// 把 typeId 10「看圖說話」併入既有的 klokah-junior 語料（不重抓其他題型）。
// 國中版官方練習只使用 order 1；圖片與音檔一律熱連結，不入庫。
//
// 用法：node scripts/augment-picture-talk.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "klokah-junior");
const xmlBase = "https://web.klokah.tw/extension/sp_data/junior";
const imageBase = "https://klokah.tw/extension/sp_junior/graphics_100x100";
const audioBase = "https://klokah.tw/extension/sp_junior/sound";
const userAgent = "Iris-01-web educational dataset downloader";

const CLASS = {
  family: "pictureTalk",
  typeId: 10,
  typeEn: "pictureTalk",
  classId: 218,
  classNo: 1,
  name: "看圖說話",
  // 國中版官方練習只露出 order 1；order 2 常缺參考答案，且 100x100 圖不存在。
  itemsPerDialect: 1,
};

const dialects = JSON.parse(await readFile(path.join(outputRoot, "dataset.json"), "utf8")).dialects;
if (!Array.isArray(dialects) || dialects.length !== 42) throw new Error("dataset.json 方言數不是 42");

function field(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchValidated(url, kind) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 64) throw new Error(`回應太短（${bytes.length} bytes）`);
      if (kind === "xml" && !bytes.toString("utf8").includes("<item>")) throw new Error("不像 XML");
      return { bytes, text: kind === "xml" ? bytes.toString("utf8") : undefined };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`下載失敗：${url}\n  ${lastError?.message ?? lastError}`);
}

function parsePictureTalk(xml, dialectId) {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const items = blocks.map((block) => {
    const order = Number(field(block, "pictureTalkOrder"));
    if (!Number.isInteger(order) || order < 1) throw new Error(`dialect ${dialectId} 的 pictureTalkOrder 無效`);
    const tip = field(block, "pictureTalkTip");
    const indigenousText = field(block, "pictureTalkAb");
    const chineseText = field(block, "pictureTalkCh");
    return {
      id: `${dialectId}-pictureTalk-${CLASS.classNo}-${order}`,
      classId: CLASS.classId,
      classNo: CLASS.classNo,
      className: CLASS.name,
      order,
      tip: tip || null,
      indigenousText: indigenousText || null,
      chineseText: chineseText || null,
      imageUrls: [1, 2, 3, 4].map((n) => `${imageBase}/pictureTalk/${order}_${n}.png`),
      audioUrl: `${audioBase}/${dialectId}/${CLASS.typeId}${CLASS.typeEn}/${CLASS.classNo}_${order}.mp3`,
    };
  }).filter((item) => item.order === 1)
    .sort((a, b) => a.order - b.order);

  if (items.length !== CLASS.itemsPerDialect) {
    throw new Error(`方言 ${dialectId} 預期 ${CLASS.itemsPerDialect} 題（order 1），實得 ${items.length}`);
  }
  const usable = items[0];
  if (!usable.tip || !usable.chineseText) {
    throw new Error(`方言 ${dialectId} order 1 缺少 tip 或中文參考答案`);
  }
  return items;
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

console.log(`抓取 ${dialects.length} 份 pictureTalk XML（圖片不入庫）…`);
const fetched = await mapLimit(dialects, 3, async (dialect) => {
  const url = `${xmlBase}/${dialect.id}/${CLASS.classId}.xml`;
  const { bytes, text } = await fetchValidated(url, "xml");
  const items = parsePictureTalk(text, dialect.id);
  return { dialect, url, bytes, items };
});

for (const entry of fetched) {
  // pictureTalk 的 XML 不入庫：文字已寫進方言分片，圖片／音檔熱連結。
  const shardPath = path.join(outputRoot, "dialects", `${entry.dialect.id}.json`);
  const shard = JSON.parse(await readFile(shardPath, "utf8"));
  shard.pictureTalk = entry.items;
  shard.counts = { ...shard.counts, pictureTalk: entry.items.length };
  await writeFile(shardPath, `${JSON.stringify(shard, null, 2)}\n`, "utf8");
}

const datasetPath = path.join(outputRoot, "dataset.json");
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
if (!dataset.classes.some((entry) => entry.family === "pictureTalk")) {
  dataset.classes.push({
    family: CLASS.family,
    classId: CLASS.classId,
    classNo: CLASS.classNo,
    name: CLASS.name,
    itemsPerDialect: CLASS.itemsPerDialect,
  });
}
dataset.description = "族語 E 樂園句型篇國中版 42 個方言別的看圖識字、選擇題（一）（二）、配合題、基本詞彙、簡短對話與看圖說話語料，用於重建初級認證測驗題型。";
dataset.totals.perDialect = { ...dataset.totals.perDialect, pictureTalk: CLASS.itemsPerDialect };
dataset.pictureTalkImagePolicy = "hotlinked-at-runtime";
dataset.pictureTalkImageNote = "看圖說話圖片不入庫，執行時由 klokah.tw 載入；該網站會看到使用者的 IP。";
dataset.source.retrievedPictureTalkAt = new Date().toISOString();
await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.log(`完成：${fetched.length} 方言、每方言 ${CLASS.itemsPerDialect} 題（圖片熱連結）`);
console.log("sample:", JSON.stringify(fetched[0].items[0], null, 2));
