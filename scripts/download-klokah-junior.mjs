// 族語 E 樂園「句型篇國中版」語料下載器。
//
// 這批教材與 Lokahsu 初級認證測驗的聽力／口說題型同名同構
// （3recognize / 4choiceOne / 5choiceTwo / 6match / 1word / 9dialogue），
// 而 klokah 版本以 CC BY-NC-SA 4.0 釋出，因此可用來重建初級模擬試卷。
//
// 與 download-body-parts.mjs 的差異：
// - 六個題型家族用一張 FAMILIES 表驅動欄位對映，不寫六份 parser。
// - 全部驗證通過才一次寫出，失敗時目錄保持原狀。
// - 音檔一律不入庫，只把 URL 烘進資料。
//
// 用法：
//   node scripts/download-klokah-junior.mjs
//   node scripts/download-klokah-junior.mjs --dry-run --dialects=1,20
//   node scripts/download-klokah-junior.mjs --verify-audio        # 抽驗音檔
//   node scripts/download-klokah-junior.mjs --verify-audio=all    # 完整掃描（很慢）

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "klokah-junior");

const xmlBase = "https://web.klokah.tw/extension/sp_data/junior";
const imageBase = "https://klokah.tw/extension/sp_junior/graphics_100x100";
const audioBase = "https://klokah.tw/extension/sp_junior/sound";
const sourcePage = "https://web.klokah.tw/extension/sp_junior/practice.php";
const licensePage = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";

// 方言別與 apps/body-parts-practice/dialects.mjs 一致（1–11、13–43，沒有 12）。
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

// 每個題型家族的 XML 欄位樣板。{L} 由字母取代。
const FAMILIES = {
  recognize: { typeId: 3, typeEn: "recognize", order: "recognizeOrder", flat: { indigenousText: "recognizeAb", chineseText: "recognizeCh" } },
  word: { typeId: 1, typeEn: "word", order: "wordOrder", flat: { indigenousText: "wordAb", chineseText: "wordCh" } },
  choiceOne: { typeId: 4, typeEn: "choiceOne", order: "choiceOneOrder", letters: "ABC", per: { indigenousText: "choiceOne{L}Ab", chineseText: "choiceOne{L}Ch" } },
  choiceTwo: { typeId: 5, typeEn: "choiceTwo", order: "choiceTwoOrder", letters: "ABC", per: { indigenousText: "choiceTwo{L}Ab", chineseText: "choiceTwo{L}Ch" } },
  dialogue: { typeId: 9, typeEn: "dialogue", order: "dialogueOrder", letters: "ABCDE", per: { indigenousText: "dialogue{L}Ab", chineseText: "dialogue{L}Ch" } },
  match: { typeId: 6, typeEn: "match", order: "matchOrder", letters: "ABCDE", per: { questionAb: "match{L}AbA", questionCh: "match{L}ChA", answerAb: "match{L}AbB", answerCh: "match{L}ChB" } },
};

// classId → classNo 與每方言預期題數。數量已在多個方言上抽驗，跨方言一致。
const CLASSES = [
  { family: "recognize", classId: 20, classNo: 1, name: "身體部位", itemsPerDialect: 10 },
  { family: "recognize", classId: 21, classNo: 2, name: "動物", itemsPerDialect: 10 },
  { family: "recognize", classId: 22, classNo: 3, name: "植(食)物/水果", itemsPerDialect: 10 },
  { family: "recognize", classId: 23, classNo: 4, name: "物品", itemsPerDialect: 10 },
  { family: "recognize", classId: 24, classNo: 5, name: "山川建築/自然景觀", itemsPerDialect: 8 },
  { family: "recognize", classId: 216, classNo: 6, name: "人物", itemsPerDialect: 7 },
  { family: "choiceOne", classId: 26, classNo: 1, name: "擁有句", itemsPerDialect: 5 },
  { family: "choiceOne", classId: 27, classNo: 2, name: "訊息問句[問地方]", itemsPerDialect: 5 },
  { family: "choiceOne", classId: 28, classNo: 3, name: "進行式(男錄音)", itemsPerDialect: 5 },
  { family: "choiceOne", classId: 29, classNo: 4, name: "連動結構(女錄音)", itemsPerDialect: 5 },
  { family: "choiceOne", classId: 30, classNo: 5, name: "單一動詞[氣象景觀]", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 31, classNo: 1, name: "訊息問句[問姓名或關係]", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 32, classNo: 2, name: "訊息問句[問數量]", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 33, classNo: 3, name: "訊息問句[問地方]", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 34, classNo: 4, name: "敘述句[單一動詞]", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 35, classNo: 5, name: "祈使句", itemsPerDialect: 5 },
  { family: "match", classId: 36, classNo: 1, name: "配合題", itemsPerDialect: 10, lettersPerItem: 5 },
  { family: "word", classId: 5, classNo: 5, name: "人物", itemsPerDialect: 11 },
  { family: "word", classId: 7, classNo: 7, name: "身體部位", itemsPerDialect: 10 },
  { family: "word", classId: 8, classNo: 8, name: "動物", itemsPerDialect: 10 },
  { family: "word", classId: 9, classNo: 9, name: "植(食)物/水果", itemsPerDialect: 10 },
  { family: "word", classId: 10, classNo: 10, name: "物品", itemsPerDialect: 10 },
  { family: "word", classId: 11, classNo: 11, name: "山川建築/自然景觀", itemsPerDialect: 9 },
  { family: "dialogue", classId: 217, classNo: 1, name: "簡短對話", itemsPerDialect: 10, lettersPerItem: 5 },
];

const FAMILY_TOTALS = CLASSES.reduce((totals, spec) => {
  totals[spec.family] = (totals[spec.family] ?? 0) + spec.itemsPerDialect;
  return totals;
}, {});

const EXPECTED_RAW_COUNT = dialects.length * CLASSES.length;
const EXPECTED_RECORD_COUNT = dialects.length * Object.values(FAMILY_TOTALS).reduce((a, b) => a + b, 0);

// ── 參數 ────────────────────────────────────────────────
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

// ── 工具 ────────────────────────────────────────────────
function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

function field(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : "";
}

// 來源有連續空白與行末空白；只折疊空白，不改標點、不修錯字。
function clean(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// klokah 在高併發下會回 HTTP 200 但空 body，因此狀態碼不足以驗證。
async function fetchValidated(url, kind) {
  const backoff = [500, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("回應為空（klokah 在併發過高時會這樣）");
      if (kind === "xml") {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!text.includes("<dataroot>")) throw new Error("回應不是 dataroot XML");
        if (!text.includes("<item>")) throw new Error("回應沒有任何 item");
        return { bytes, text };
      }
      if (!bytes.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error("不是有效 PNG");
      return { bytes };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(backoff[attempt]);
    }
  }
  throw new Error(`下載失敗（已重試 3 次）：${url}\n  ${lastError?.message ?? lastError}`);
}

// 併發上限 3，起跑間隔 120ms。再高就會踩到上面那個空 body 問題。
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

// ── 解析 ────────────────────────────────────────────────
function audioUrlFor(spec, dialectId, order, letter) {
  const family = FAMILIES[spec.family];
  const dir = `${family.typeId}${family.typeEn}`;
  const stem = family.letters ? `${spec.classNo}_${order}_${letter}` : `${spec.classNo}_${order}`;
  return `${audioBase}/${dialectId}/${dir}/${stem}.mp3`;
}

function imagePathFor(spec, order, letter, imageIndex) {
  if (spec.family === "recognize") return `images/recognize/${spec.classNo}_${order}.png`;
  if (spec.family === "choiceOne") return `images/choiceOne/${spec.classNo}_${order}${letter}.png`;
  if (spec.family === "match") return `images/match/${order}_${imageIndex}.png`;
  return undefined;
}

function parseClass(xml, spec, dialectId) {
  const family = FAMILIES[spec.family];
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const items = blocks.map((block) => {
    const order = Number(field(block, family.order));
    if (!Number.isInteger(order) || order < 1) throw new Error(`${spec.family}/${spec.classId} 的 ${family.order} 不是正整數`);
    const base = { id: `${dialectId}-${spec.family}-${spec.classNo}-${order}`, classId: spec.classId, classNo: spec.classNo, className: spec.name, order };

    if (family.flat) {
      const record = { ...base };
      for (const [key, source] of Object.entries(family.flat)) record[key] = clean(field(block, source));
      const imagePath = imagePathFor(spec, order);
      if (imagePath) record.imagePath = imagePath;
      record.audioUrl = audioUrlFor(spec, dialectId, order);
      return record;
    }

    const letters = [...family.letters];
    if (spec.family === "match") {
      const dialogueList = letters.map((letter, index) => {
        const read = (template) => clean(field(block, template.replace("{L}", letter)));
        return {
          letter,
          imageIndex: index + 1,
          imagePath: imagePathFor(spec, order, letter, index + 1),
          question: { indigenousText: read(family.per.questionAb), chineseText: read(family.per.questionCh) },
          answer: { indigenousText: read(family.per.answerAb), chineseText: read(family.per.answerCh) },
          audioUrl: audioUrlFor(spec, dialectId, order, letter),
        };
      });
      return { ...base, dialogues: dialogueList };
    }

    const options = letters.map((letter) => {
      const option = { letter };
      for (const [key, template] of Object.entries(family.per)) option[key] = clean(field(block, template.replace("{L}", letter)));
      const imagePath = imagePathFor(spec, order, letter);
      if (imagePath) option.imagePath = imagePath;
      option.audioUrl = audioUrlFor(spec, dialectId, order, letter);
      return option;
    });
    return { ...base, [spec.family === "dialogue" ? "questions" : "options"]: options };
  });

  return items.sort((a, b) => a.order - b.order);
}

// 硬性檢查：任何一項不符就中止，不寫任何檔案。
function assertClass(items, spec, dialectName) {
  const where = `${dialectName}／${spec.family}(${spec.classId})`;
  if (items.length !== spec.itemsPerDialect) {
    throw new Error(`${where} 預期 ${spec.itemsPerDialect} 題，實得 ${items.length} 題`);
  }
  const orders = new Set(items.map((item) => item.order));
  if (orders.size !== items.length) throw new Error(`${where} 有重複的 order`);

  for (const item of items) {
    if (spec.family === "match") {
      if (item.dialogues.length !== 5) throw new Error(`${where} order ${item.order} 不是 5 段對話`);
      const images = new Set(item.dialogues.map((dialogue) => dialogue.imagePath));
      if (images.size !== 5) throw new Error(`${where} order ${item.order} 的 5 張圖片不相異`);
      for (const dialogue of item.dialogues) {
        for (const turn of [dialogue.question, dialogue.answer]) {
          if (!turn.indigenousText || !turn.chineseText) throw new Error(`${where} order ${item.order}${dialogue.letter} 有空欄位`);
        }
      }
      continue;
    }

    const list = item.options ?? item.questions;
    if (list) {
      const expected = [...FAMILIES[spec.family].letters].length;
      if (list.length !== expected) throw new Error(`${where} order ${item.order} 不是 ${expected} 個選項`);
      for (const entry of list) {
        if (!entry.indigenousText || !entry.chineseText) throw new Error(`${where} order ${item.order}${entry.letter} 有空欄位`);
      }
      if (spec.family === "choiceOne") {
        const images = new Set(list.map((entry) => entry.imagePath));
        if (images.size !== list.length) throw new Error(`${where} order ${item.order} 的選項圖片重複`);
      }
      continue;
    }

    if (!item.indigenousText || !item.chineseText) throw new Error(`${where} order ${item.order} 有空欄位`);
  }
}

// ── 抓取 ────────────────────────────────────────────────
const jobs = [];
for (const [dialectId, ethnicity, dialectName] of selectedDialects) {
  for (const spec of CLASSES) jobs.push({ dialectId, ethnicity, dialectName, spec });
}

console.log(`開始下載：${selectedDialects.length} 個方言 × ${CLASSES.length} 個類別 = ${jobs.length} 份 XML`);

let done = 0;
const fetched = await mapLimit(jobs, 3, async (job) => {
  const url = `${xmlBase}/${job.dialectId}/${job.spec.classId}.xml`;
  const { bytes, text } = await fetchValidated(url, "xml");
  const items = parseClass(text, job.spec, job.dialectId);
  assertClass(items, job.spec, job.dialectName);
  done += 1;
  if (done % 50 === 0) console.log(`  XML ${done}/${jobs.length}`);
  return { ...job, url, bytes, items };
});

// 組裝分片。
const shards = new Map();
for (const [dialectId, ethnicity, dialectName] of selectedDialects) {
  const shard = { schemaVersion: 1, dialectId, dialectName, ethnicity, counts: {} };
  for (const family of Object.keys(FAMILY_TOTALS)) shard[family] = [];
  shards.set(dialectId, shard);
}
for (const entry of fetched) {
  shards.get(entry.dialectId)[entry.spec.family].push(...entry.items);
}
for (const [dialectId, shard] of shards) {
  for (const [family, expected] of Object.entries(FAMILY_TOTALS)) {
    if (shard[family].length !== expected) {
      throw new Error(`方言 ${dialectId} 的 ${family} 預期 ${expected} 筆，實得 ${shard[family].length} 筆`);
    }
    shard.counts[family] = shard[family].length;
  }
}

// 圖片（各方言共用，只抓一次）。
const imageJobs = [];
for (const spec of CLASSES) {
  if (spec.family === "recognize") {
    for (let order = 1; order <= spec.itemsPerDialect; order += 1) {
      imageJobs.push({ url: `${imageBase}/recognize/${spec.classNo}_${order}.png`, path: `images/recognize/${spec.classNo}_${order}.png` });
    }
  } else if (spec.family === "choiceOne") {
    for (let order = 1; order <= spec.itemsPerDialect; order += 1) {
      for (const letter of "ABC") {
        imageJobs.push({ url: `${imageBase}/choiceOne/${spec.classNo}_${order}${letter}.png`, path: `images/choiceOne/${spec.classNo}_${order}${letter}.png` });
      }
    }
  } else if (spec.family === "match") {
    for (let order = 1; order <= spec.itemsPerDialect; order += 1) {
      for (let index = 1; index <= spec.lettersPerItem; index += 1) {
        imageJobs.push({ url: `${imageBase}/match/${order}_${index}.png`, path: `images/match/${order}_${index}.png` });
      }
    }
  }
}
const EXPECTED_IMAGE_COUNT = imageJobs.length;

console.log(`開始下載 ${EXPECTED_IMAGE_COUNT} 張圖片`);
const images = await mapLimit(imageJobs, 3, async (job) => {
  const { bytes } = await fetchValidated(job.url, "png");
  return { ...job, bytes };
});
if (images.length !== EXPECTED_IMAGE_COUNT) throw new Error(`圖片預期 ${EXPECTED_IMAGE_COUNT} 張，實得 ${images.length} 張`);

// 每個分片引用到的 imagePath 都必須真的抓到了。
const imagePaths = new Set(images.map((image) => image.path));
for (const [dialectId, shard] of shards) {
  const referenced = new Set();
  for (const record of shard.recognize) referenced.add(record.imagePath);
  for (const item of shard.choiceOne) for (const option of item.options) referenced.add(option.imagePath);
  for (const item of shard.match) for (const dialogue of item.dialogues) referenced.add(dialogue.imagePath);
  for (const imagePath of referenced) {
    if (!imagePaths.has(imagePath)) throw new Error(`方言 ${dialectId} 引用了未下載的圖片：${imagePath}`);
  }
}

// 音檔驗證（HEAD，不下載內容）。
let audioSpotCheck = null;
if (verifyAudio !== "none") {
  const urls = new Set();
  for (const shard of shards.values()) {
    const collect = (url) => urls.add(url);
    for (const record of shard.recognize) collect(record.audioUrl);
    for (const record of shard.word) collect(record.audioUrl);
    for (const item of shard.choiceOne) for (const option of item.options) collect(option.audioUrl);
    for (const item of shard.choiceTwo) for (const option of item.options) collect(option.audioUrl);
    for (const item of shard.dialogue) for (const question of item.questions) collect(question.audioUrl);
    for (const item of shard.match) for (const dialogue of item.dialogues) collect(dialogue.audioUrl);
  }
  const all = [...urls];
  const sampleRule = verifyAudio === "all" ? "全部音檔" : "每個方言每個類別的首尾 order";
  const targets = verifyAudio === "all"
    ? all
    : all.filter((url) => /_(1|1_A)\.mp3$|\/\d+_1\.mp3$/.test(url));
  console.log(`開始驗證 ${targets.length} 個音檔（${sampleRule}）`);
  const failures = [];
  await mapLimit(targets, 3, async (url) => {
    try {
      const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) failures.push({ url, status: response.status });
    } catch (error) {
      failures.push({ url, status: String(error?.message ?? error) });
    }
  });
  audioSpotCheck = { checked: targets.length, ok: targets.length - failures.length, sampleRule, failures: failures.slice(0, 20) };
  if (failures.length > 0) throw new Error(`有 ${failures.length} 個音檔無法取得，第一個是 ${failures[0].url}`);
}

if (dryRun) {
  const [firstId] = selectedDialects[0];
  const shard = shards.get(firstId);
  console.log("\n--dry-run：不寫檔。第一個方言的摘要：");
  console.log(JSON.stringify({ dialectId: shard.dialectId, dialectName: shard.dialectName, counts: shard.counts }, null, 2));
  console.log("\nrecognize[0]:", JSON.stringify(shard.recognize[0], null, 2));
  console.log("choiceOne[0]:", JSON.stringify(shard.choiceOne[0], null, 2));
  console.log("match[0].dialogues[0]:", JSON.stringify(shard.match[0].dialogues[0], null, 2));
  console.log(`\n圖片 ${images.length} 張、XML ${fetched.length} 份，所有數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== dialects.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

// ── 寫出（全部驗證通過後才動硬碟）────────────────────────
await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "dialects"), { recursive: true });
await mkdir(path.join(outputRoot, "images", "recognize"), { recursive: true });
await mkdir(path.join(outputRoot, "images", "choiceOne"), { recursive: true });
await mkdir(path.join(outputRoot, "images", "match"), { recursive: true });
for (const [dialectId] of dialects) await mkdir(path.join(outputRoot, "raw", String(dialectId)), { recursive: true });

const files = [];

for (const entry of fetched) {
  const relative = `raw/${entry.dialectId}/${entry.spec.classId}.xml`;
  await writeFile(path.join(outputRoot, relative), entry.bytes);
  files.push({ dialectId: entry.dialectId, dialectName: entry.dialectName, classId: entry.spec.classId, url: entry.url, path: relative, bytes: entry.bytes.length, sha256: sha256(entry.bytes) });
}

for (const image of images) {
  await writeFile(path.join(outputRoot, image.path), image.bytes);
  files.push({ url: image.url, path: image.path, bytes: image.bytes.length, sha256: sha256(image.bytes) });
}

for (const [dialectId, shard] of shards) {
  const relative = `dialects/${dialectId}.json`;
  const text = `${JSON.stringify(shard, null, 2)}\n`;
  await writeFile(path.join(outputRoot, relative), text, "utf8");
  const bytes = Buffer.from(text, "utf8");
  files.push({ dialectId, path: relative, bytes: bytes.length, sha256: sha256(bytes) });
}

const dataset = {
  schemaVersion: 1,
  title: "句型篇國中版／初級認證題型語料",
  description: "族語 E 樂園句型篇國中版 42 個方言別的看圖識字、選擇題（一）（二）、配合題、基本詞彙與簡短對話語料，用於重建初級認證測驗題型。",
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
  audioBase,
  audioPolicy: "hotlinked-at-runtime",
  audioNote: "音檔不入庫，執行時直接由 klokah.tw 播放；播放時該網站會看到使用者的 IP 位址。",
  dialectCount: dialects.length,
  classes: CLASSES,
  totals: {
    perDialect: FAMILY_TOTALS,
    recordCount: EXPECTED_RECORD_COUNT,
    rawFileCount: EXPECTED_RAW_COUNT,
    imageCount: EXPECTED_IMAGE_COUNT,
  },
  dialects: dialects.map(([id, ethnicity, name]) => ({ id, ethnicity, name })),
};

const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(outputRoot, "dataset.json"), datasetText, "utf8");
const datasetBytes = await readFile(path.join(outputRoot, "dataset.json"));

const manifest = {
  generatedAt: new Date().toISOString(),
  recordCount: EXPECTED_RECORD_COUNT,
  expectedRecordCount: EXPECTED_RECORD_COUNT,
  expectedRawCount: EXPECTED_RAW_COUNT,
  expectedImageCount: EXPECTED_IMAGE_COUNT,
  expectedItemsPerClass: CLASSES.map(({ family, classId, itemsPerDialect }) => ({ family, classId, itemsPerDialect })),
  audioPolicy: "hotlinked-at-runtime",
  audioSpotCheck,
  sourceFileCount: files.length,
  dataset: { path: "dataset.json", bytes: datasetBytes.length, sha256: sha256(datasetBytes) },
  files,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readme = `# 句型篇國中版：初級認證題型語料\n\n` +
  `本目錄保存「族語 E 樂園」句型篇國中版 42 個方言別的六種題型語料，供「初級模擬站」出卷使用。\n\n` +
  `- \`dataset.json\`：索引、來源、類別表與完整性數字。**不含題目本身。**\n` +
  `- \`dialects/{dialectId}.json\`：42 個方言分片，頁面只載入使用者選的那一個。\n` +
  `- \`raw/{dialectId}/{classId}.xml\`：官方來源 XML，共 ${EXPECTED_RAW_COUNT} 份。\n` +
  `- \`images/\`：官方共用圖片，共 ${EXPECTED_IMAGE_COUNT} 張（recognize／choiceOne／match）。\n` +
  `- \`manifest.json\`：來源 URL、檔案大小及 SHA-256。\n` +
  `- \`LICENSE.md\`：授權、標示與使用限制。\n\n` +
  `## 為什麼分片\n\n` +
  `全部 ${EXPECTED_RECORD_COUNT} 筆若內嵌在 \`dataset.json\` 約 4 MB，等於每次開頁都要下載 4 MB。\n` +
  `因此改用 \`recordLayout: "sharded"\`，\`dataset.json\` 只留索引與完整性表。\n\n` +
  `## 音檔\n\n` +
  `**音檔不入庫。** 每筆資料帶有 \`audioUrl\`，執行時由 \`klokah.tw\` 直接播放。\n` +
  `這代表使用者播放時，該網站會看到使用者的 IP 位址；應用頁面必須揭露這件事。\n` +
  `klokah 不送 CORS 標頭，所以只能用 \`<audio src>\` 播放，不能 \`fetch()\`、不能加 \`crossorigin\`。\n\n` +
  `## 重新下載\n\n` +
  `\`\`\`\nnode scripts/download-klokah-junior.mjs\n\`\`\`\n\n` +
  `下載程式會要求每個方言的每個類別題數與 \`dataset.json\` 的 \`classes\` 完全相符，否則中止。\n` +
  `**全部驗證通過才會寫檔**，失敗時本目錄保持原狀。\n\n` +
  `klokah 在併發過高時會回傳 HTTP 200 但空的 body，所以下載程式併發上限為 3，\n` +
  `且以位元組長度與檔案 magic 驗證每一次回應，而不是只看狀態碼。\n\n` +
  `其他參數：\`--dry-run --dialects=1,20\`（不寫檔的抽驗）、\`--verify-audio\`（HEAD 抽驗音檔）、\n` +
  `\`--verify-audio=all\`（完整掃描，很慢）。\n`;
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");

const license = `# 素材授權與標示\n\n` +
  `資料來源－[原住民族語E樂園](${sourcePage})，由財團法人原住民族語言研究發展基金會製作，以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](${licensePage})釋出。\n\n` +
  `## 使用限制\n\n` +
  `- 必須標示網站全稱及原著作網址。\n` +
  `- 不得作商業用途；商業使用須另向權利人申請授權。\n` +
  `- 改作或衍生作品必須以相同授權條款散布。\n` +
  `- 本資料僅涵蓋本單元文字與圖片，不代表授權原始網站程式碼、商標或其他未收錄內容。\n\n` +
  `## 音檔\n\n` +
  `本目錄不收錄任何音檔。應用程式執行時直接連往 \`${audioBase}\` 播放官方錄音，\n` +
  `不重製、不轉存、不代為散布。同樣的姓名標示與非商業限制適用於這些錄音。\n`;
await writeFile(path.join(outputRoot, "LICENSE.md"), license, "utf8");

console.log(`完成：${dialects.length} 個方言、${EXPECTED_RECORD_COUNT} 筆語料、${EXPECTED_IMAGE_COUNT} 張圖片、${EXPECTED_RAW_COUNT} 份原始 XML`);
