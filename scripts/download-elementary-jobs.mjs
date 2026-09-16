// 族語 E 樂園「教學模組／初級／職業」下載器。
// JSON 在 web.klokah.tw/mode/json/{兩位數方言編號}/elementary/feature.json
// 圖入庫、音檔熱連結。全部驗證通過才寫檔。

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJobRecords, parseFeatureJson } from "./elementary-jobs-parse.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "elementary-jobs");

const jsonBase = "https://web.klokah.tw/mode/json";
const imageBase = "https://web.klokah.tw/mode/img";
const sourcePage = "https://web.klokah.tw/mode/elementary/index.php";
const licensePage = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";

const dialects = [
  [1, "阿美", "南勢阿美語"], [2, "阿美", "秀姑巒阿美語"], [3, "阿美", "海岸阿美語"],
  [4, "阿美", "馬蘭阿美語"], [5, "阿美", "恆春阿美語"],
  [6, "泰雅", "賽考利克泰雅語"], [7, "泰雅", "澤敖利泰雅語"], [8, "泰雅", "汶水泰雅語"],
  [9, "泰雅", "萬大泰雅語"], [10, "泰雅", "四季泰雅語"], [11, "泰雅", "宜蘭澤敖利泰雅語"],
  [13, "賽夏", "賽夏語"], [14, "邵", "邵語"],
  [15, "賽德克", "都達賽德克語"], [16, "賽德克", "德固達雅賽德克語"], [17, "賽德克", "德鹿谷賽德克語"],
  [18, "布農", "卓群布農語"], [19, "布農", "卡群布農語"], [20, "布農", "丹群布農語"],
  [21, "布農", "巒群布農語"], [22, "布農", "郡群布農語"],
  [23, "排灣", "東排灣語"], [24, "排灣", "北排灣語"], [25, "排灣", "中排灣語"], [26, "排灣", "南排灣語"],
  [27, "魯凱", "東魯凱語"], [28, "魯凱", "霧台魯凱語"], [29, "魯凱", "大武魯凱語"],
  [30, "魯凱", "多納魯凱語"], [31, "魯凱", "茂林魯凱語"], [32, "魯凱", "萬山魯凱語"],
  [33, "太魯閣", "太魯閣語"], [34, "噶瑪蘭", "噶瑪蘭語"], [35, "鄒", "鄒語"],
  [36, "卡那卡那富", "卡那卡那富語"], [37, "拉阿魯哇", "拉阿魯哇語"],
  [38, "卑南", "南王卑南語"], [39, "卑南", "知本卑南語"], [40, "卑南", "西群卑南語"],
  [41, "卑南", "建和卑南語"], [42, "雅美", "雅美語"], [43, "撒奇萊雅", "撒奇萊雅語"],
];

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
const selectedDialects = onlyDialects ? dialects.filter(([id]) => onlyDialects.has(id)) : dialects;
if (selectedDialects.length === 0) throw new Error("--dialects 沒有對應到任何方言別");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const paddedId = (id) => String(id).padStart(2, "0");

async function fetchValidated(url, kind) {
  const backoff = [500, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("回應為空（klokah 在併發過高時會這樣）");
      if (kind === "json") {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        parseFeatureJson(text);
        return { bytes, text };
      }
      if (kind === "jpeg") {
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("不是有效 JPEG");
        return { bytes };
      }
      throw new Error(`未知 kind：${kind}`);
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

console.log(`開始下載職業 JSON：${selectedDialects.length} 個方言`);
let done = 0;
const fetched = await mapLimit(selectedDialects, 3, async ([dialectId, ethnicity, dialectName]) => {
  const url = `${jsonBase}/${paddedId(dialectId)}/elementary/feature.json`;
  const { bytes, text } = await fetchValidated(url, "json");
  const { json, sanitized } = parseFeatureJson(text);
  const records = extractJobRecords(json, dialectId);
  done += 1;
  if (done % 10 === 0) console.log(`  JSON ${done}/${selectedDialects.length}`);
  return { dialectId, ethnicity, dialectName, url, bytes, text, sanitized, records };
});

const yami = fetched.find((entry) => entry.dialectId === 42);
if (yami && !yami.records.some((record) => record.chineseText === "警察")) {
  throw new Error("雅美語職業第三張應為「警察」，來源可能已改");
}
const bunun20 = fetched.find((entry) => entry.dialectId === 20);
if (bunun20 && bunun20.records.length !== 6) {
  throw new Error("丹群布農語職業應有 6 筆；官方 JSON 若夾 HTML，sanitize 後仍須可解析");
}

const imageNames = [...new Set(fetched.flatMap((entry) => entry.records.map((record) => path.basename(record.imagePath))))];
console.log(`開始下載 ${imageNames.length} 張共用職業圖`);
const images = await mapLimit(imageNames, 3, async (name) => {
  const url = `${imageBase}/${name}`;
  const { bytes } = await fetchValidated(url, "jpeg");
  return { name, url, path: `images/${name}`, bytes };
});

const imagePaths = new Set(images.map((image) => image.path));
for (const entry of fetched) {
  for (const record of entry.records) {
    if (!imagePaths.has(record.imagePath)) throw new Error(`方言 ${entry.dialectId} 引用了未下載的圖片：${record.imagePath}`);
  }
}

if (verifyAudio !== "none") {
  const urls = [...new Set(fetched.flatMap((entry) => entry.records.map((record) => record.audioUrl)))];
  const targets = verifyAudio === "all" ? urls : fetched.map((entry) => entry.records[0].audioUrl);
  console.log(`開始驗證 ${targets.length} 個音檔`);
  const failures = [];
  await mapLimit(targets, 3, async (url) => {
    try {
      const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) failures.push({ url, status: response.status });
    } catch (error) {
      failures.push({ url, status: String(error?.message ?? error) });
    }
  });
  if (failures.length > 0) throw new Error(`有 ${failures.length} 個音檔無法取得，第一個是 ${failures[0].url}`);
}

if (dryRun) {
  const first = fetched[0];
  console.log("\n--dry-run：不寫檔。第一個方言的摘要：");
  console.log(JSON.stringify({ dialectId: first.dialectId, sanitized: first.sanitized, records: first.records }, null, 2));
  console.log(`圖片 ${images.length} 張、JSON ${fetched.length} 份，所有數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== dialects.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "dialects"), { recursive: true });
await mkdir(path.join(outputRoot, "images"), { recursive: true });
await mkdir(path.join(outputRoot, "raw"), { recursive: true });

const files = [];
for (const entry of fetched) {
  const relative = `raw/${entry.dialectId}.json`;
  await writeFile(path.join(outputRoot, relative), entry.bytes);
  files.push({ dialectId: entry.dialectId, url: entry.url, path: relative, bytes: entry.bytes.length, sha256: sha256(entry.bytes), sanitized: entry.sanitized });
}
for (const image of images) {
  await writeFile(path.join(outputRoot, image.path), image.bytes);
  files.push({ url: image.url, path: image.path, bytes: image.bytes.length, sha256: sha256(image.bytes) });
}

const shards = [];
for (const entry of fetched) {
  const shard = {
    schemaVersion: 1,
    dialectId: entry.dialectId,
    dialectName: entry.dialectName,
    ethnicity: entry.ethnicity,
    sanitized: entry.sanitized,
    records: entry.records,
  };
  const relative = `dialects/${entry.dialectId}.json`;
  const text = `${JSON.stringify(shard, null, 2)}\n`;
  await writeFile(path.join(outputRoot, relative), text, "utf8");
  files.push({ dialectId: entry.dialectId, path: relative, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text, "utf8")) });
  shards.push(shard);
}

const dataset = {
  schemaVersion: 1,
  title: "教學模組初級／職業",
  description: "族語 E 樂園教學模組初級直接教學法的職業主題，供看圖練習、口說練習與聽音練習使用。每方言 6 筆，圖入庫、音檔熱連結。",
  source: {
    publisher: "財團法人原住民族語言研究發展基金會",
    website: "原住民族語E樂園",
    unitUrl: sourcePage,
    license: "CC BY-NC-SA 4.0",
    licenseUrl: licensePage,
    attribution: "資料來源－原住民族語E樂園，由財團法人原住民族語言研究發展基金會製作，以創用CC 姓名標示－非商業性－相同方式分享 4.0國際授權條款釋出。",
    retrievedAt: new Date().toISOString(),
  },
  recordLayout: "sharded",
  shardPath: "dialects/{dialectId}.json",
  audioBase: "https://web.klokah.tw/text/sound",
  audioPolicy: "hotlinked-at-runtime",
  audioNote: "音檔不入庫，執行時直接由 web.klokah.tw 播放；播放時該網站會看到使用者的 IP 位址。",
  dialectCount: dialects.length,
  itemsPerDialect: 6,
  recordCount: dialects.length * 6,
  imageCount: images.length,
  dialects: dialects.map(([id, ethnicity, name]) => ({ id, ethnicity, name })),
  notes: {
    yamiPolice: "雅美語（42）第三張中文為警察，不是護士。",
    bununHtml: "丹群布農語（20）官方 JSON 夾了 HTML，下載時清掉後才能解析。",
  },
};
const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(outputRoot, "dataset.json"), datasetText, "utf8");
files.push({ path: "dataset.json", bytes: Buffer.byteLength(datasetText), sha256: sha256(Buffer.from(datasetText, "utf8")) });

const manifest = {
  generatedAt: dataset.source.retrievedAt,
  recordCount: dataset.recordCount,
  imageCount: images.length,
  files,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const license = `# 素材授權與標示

資料來源－[原住民族語E樂園](${sourcePage})，由財團法人原住民族語言研究發展基金會製作，以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](${licensePage})釋出。

## 使用限制

- 必須標示網站全稱及原著作網址。
- 不得作商業用途；商業使用須另向權利人申請授權。
- 改作或衍生作品必須以相同授權條款散布。
- 本資料僅涵蓋本單元文字與圖片，不代表授權原始網站程式碼、商標或其他未收錄內容。

## 音檔

本目錄不收錄任何音檔。應用程式執行時直接連往 \`https://web.klokah.tw/text/sound\` 播放官方錄音，
不重製、不轉存、不代為散布。同樣的姓名標示與非商業限制適用於這些錄音。
`;
await writeFile(path.join(outputRoot, "LICENSE.md"), license, "utf8");

const readme = `# 教學模組初級：職業

本目錄保存「族語 E 樂園」[教學模組／初級／職業](${sourcePage}) 42 個方言別資料，供看圖練習、口說練習與聽音練習使用。

- \`dataset.json\`：索引、來源與完整性數字。**不含題目本身。**
- \`dialects/{dialectId}.json\`：每方言 6 筆族語答句、中文職業名、圖片路徑與音檔 URL。
- \`raw/{dialectId}.json\`：官方 \`feature.json\` 原文。
- \`images/\`：共用職業圖。
- \`LICENSE.md\`：授權、標示與使用限制。

雅美語第三張是「警察」不是「護士」。丹群布農語官方 JSON 夾了 HTML，分片的 \`sanitized: true\` 代表下載時有清過。

**音檔不入庫。** 每筆帶 \`audioUrl\`，執行時由 \`web.klokah.tw\` 直接播放。

重新下載：

\`\`\`
node scripts/download-elementary-jobs.mjs
\`\`\`

其他參數：\`--dry-run --dialects=1,20,42\`、\`--verify-audio\`、\`--verify-audio=all\`。
`;
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");

console.log(`完成：${shards.length} 個方言、${dataset.recordCount} 筆、${images.length} 張圖。`);
