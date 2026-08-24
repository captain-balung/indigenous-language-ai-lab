// 族語 E 樂園「句型篇高中版」語料下載器。
//
// 這批教材與 Lokahsu 中級認證測驗的聽力／口說題型同名同構
// （3recognize / 4choiceOne / 5choiceTwo / 7choiceThree / 8oralReading / 9dialogue / 10pictureTalk），
// 而 klokah 版本以 CC BY-NC-SA 4.0 釋出，因此可用來重建中級模擬試卷。
//
// 與 download-klokah-junior.mjs 同一套骨架（表驅動、全部驗證通過才寫檔、併發上限 3），
// 差別在高中版的四個結構差異：
// - choiceOne 是「一張圖 + 一段對話錄音」，不是國中版的三選項各自有圖有音。
// - choiceThree 是高中版才有的題型（國中版對應位置是 match 配合題），純文字 + 音檔。
// - pictureTalk 每題只有 1 張圖，而且 order 1、2 都有效（國中版只取 order 1）。
// - oralReading 每題 5 個獨立句子（A–E），各自有音檔。
//
// 只抓中級考卷需要的七個題型；typeId 1 基本詞彙與 typeId 2 生活百句不入庫。

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "klokah-senior");

const xmlBase = "https://web.klokah.tw/extension/sp_data/senior";
const imageBase = "https://klokah.tw/extension/sp_senior/graphics_100x100";
const audioBase = "https://klokah.tw/extension/sp_senior/sound";
const sourcePage = "https://web.klokah.tw/extension/sp_senior/practice.php";
const licensePage = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";

// 方言別與 apps/body-parts-practice/dialects.mjs 一致（1–11、13–43，沒有 12）。
// 高中版的方言別覆蓋率與國中版相同，已逐一驗證。
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
// listKey 決定分片裡那個陣列叫什麼名字（沿用各題型在頁面上的說法）。
const FAMILIES = {
  recognize: { typeId: 3, typeEn: "recognize", order: "recognizeOrder", flat: { indigenousText: "recognizeAb", chineseText: "recognizeCh" } },
  choiceOne: { typeId: 4, typeEn: "choiceOne", order: "choiceOneOrder", turns: "ABC" },
  choiceTwo: { typeId: 5, typeEn: "choiceTwo", order: "choiceTwoOrder", letters: "ABC", listKey: "options", per: { indigenousText: "choiceTwo{L}Ab", chineseText: "choiceTwo{L}Ch" } },
  choiceThree: { typeId: 7, typeEn: "choiceThree", order: "choiceThreeOrder", flat: { indigenousText: "choiceThreeAb", chineseText: "choiceThreeCh" } },
  oralReading: { typeId: 8, typeEn: "oralReading", order: "oralReadingOrder", letters: "ABCDE", listKey: "sentences", per: { indigenousText: "oralReading{L}Ab", chineseText: "oralReading{L}Ch" } },
  dialogue: { typeId: 9, typeEn: "dialogue", order: "dialogueOrder", letters: "ABCDE", listKey: "questions", per: { indigenousText: "dialogue{L}Ab", chineseText: "dialogue{L}Ch" } },
  pictureTalk: { typeId: 10, typeEn: "pictureTalk", order: "pictureTalkOrder", pictureTalk: true },
};

// classId → classNo 與每方言預期題數。全部 42 × 23 個組合都清點過：
// 只有邵語（14）的看圖識字第 3、4 類各少一題（來源缺 order 3），其餘完全一致。
// 這是來源本身的差異，保留成明列的例外，而不是把檢查放寬成「至少幾題」——
// 放寬就再也偵測不到上游變動。
const CLASSES = [
  { family: "recognize", classId: 20, classNo: 1, name: "擁有句", itemsPerDialect: 15 },
  { family: "recognize", classId: 21, classNo: 2, name: "訊息問句[問地方]", itemsPerDialect: 15 },
  { family: "recognize", classId: 22, classNo: 3, name: "進行式(男錄音)", itemsPerDialect: 15, exceptions: { 14: 14 } },
  { family: "recognize", classId: 23, classNo: 4, name: "連動結構(女錄音)", itemsPerDialect: 15, exceptions: { 14: 14 } },
  { family: "recognize", classId: 24, classNo: 5, name: "單一動詞[氣象景觀]", itemsPerDialect: 15 },
  { family: "choiceOne", classId: 26, classNo: 1, name: "訊息問句(問關係、動植物、物品)", itemsPerDialect: 15 },
  { family: "choiceOne", classId: 27, classNo: 2, name: "訊息問句(問數量)", itemsPerDialect: 16 },
  { family: "choiceOne", classId: 28, classNo: 3, name: "訊息問句(問地方)", itemsPerDialect: 16 },
  { family: "choiceOne", classId: 29, classNo: 4, name: "是非問句(問職業、關係、數量、物品、健康、外貌、動作、天氣)", itemsPerDialect: 16 },
  { family: "choiceOne", classId: 30, classNo: 5, name: "是非問句(問動作進行、能力、喜好--連動結構)", itemsPerDialect: 16 },
  { family: "choiceTwo", classId: 31, classNo: 1, name: "訊息問句(問姓名、關係、數量、地方)", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 32, classNo: 2, name: "是非問句(肯定/否定；問職業、關係、動物、植物、物品)", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 33, classNo: 3, name: "敘述句(單一動詞；肯定/否定)", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 34, classNo: 4, name: "祈使句(肯定/否定)", itemsPerDialect: 5 },
  { family: "choiceTwo", classId: 35, classNo: 5, name: "複雜結構(連動結構、條件結構)", itemsPerDialect: 5 },
  { family: "choiceThree", classId: 37, classNo: 1, name: "身體部位", itemsPerDialect: 10 },
  { family: "choiceThree", classId: 38, classNo: 2, name: "動物", itemsPerDialect: 10 },
  { family: "choiceThree", classId: 39, classNo: 3, name: "植(食)物/水果", itemsPerDialect: 10 },
  { family: "choiceThree", classId: 40, classNo: 4, name: "物品", itemsPerDialect: 10 },
  { family: "choiceThree", classId: 41, classNo: 5, name: "山川建築/自然景觀", itemsPerDialect: 10 },
  { family: "oralReading", classId: 42, classNo: 1, name: "唸唸看", itemsPerDialect: 10, lettersPerItem: 5 },
  { family: "dialogue", classId: 43, classNo: 1, name: "簡短對話", itemsPerDialect: 10, lettersPerItem: 5 },
  // 高中版兩個 order 都有參考答案與 200px 圖，兩個都收（國中版只有 order 1 可用）。
  { family: "pictureTalk", classId: 44, classNo: 1, name: "看圖說話", itemsPerDialect: 2 },
];

// 某個方言、某個類別的預期題數。exceptions 是來源本身的差異，逐筆明列。
function expectedItems(spec, dialectId) {
  return spec.exceptions?.[dialectId] ?? spec.itemsPerDialect;
}

// 各家族的正規總數（未套用例外）。
const FAMILY_TOTALS = CLASSES.reduce((totals, spec) => {
  totals[spec.family] = (totals[spec.family] ?? 0) + spec.itemsPerDialect;
  return totals;
}, {});

function familyTotalsFor(dialectId) {
  return CLASSES.reduce((totals, spec) => {
    totals[spec.family] = (totals[spec.family] ?? 0) + expectedItems(spec, dialectId);
    return totals;
  }, {});
}

const RAW_CLASSES = CLASSES.filter((spec) => spec.family !== "pictureTalk");
const EXPECTED_RAW_COUNT = dialects.length * RAW_CLASSES.length;
const EXPECTED_RECORD_COUNT = dialects.reduce(
  (sum, [id]) => sum + Object.values(familyTotalsFor(id)).reduce((a, b) => a + b, 0),
  0,
);

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

function imagePathFor(spec, order) {
  if (spec.family === "recognize") return `images/recognize/${spec.classNo}_${order}.png`;
  if (spec.family === "choiceOne") return `images/choiceOne/${spec.classNo}_${order}.png`;
  return undefined;
}

// 看圖說話圖片不入庫：高中版每個 order 只有一張，執行時熱連結 klokah.tw。
function pictureTalkImageUrl(order) {
  return `${imageBase}/pictureTalk/${order}.png`;
}

function parseClass(xml, spec, dialectId) {
  const family = FAMILIES[spec.family];
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const items = [];

  for (const block of blocks) {
    const order = Number(field(block, family.order));
    if (!Number.isInteger(order) || order < 1) throw new Error(`${spec.family}/${spec.classId} 的 ${family.order} 不是正整數`);
    const base = { id: `${dialectId}-${spec.family}-${spec.classNo}-${order}`, classId: spec.classId, classNo: spec.classNo, className: spec.name, order };

    if (family.pictureTalk) {
      const indigenousText = clean(field(block, "pictureTalkAb"));
      // 官方練習頁自己就會跳過沒有族語參考答案的項目；跟著跳過。
      if (!indigenousText) continue;
      items.push({
        ...base,
        tip: clean(field(block, "pictureTalkTip")) || null,
        indigenousText,
        chineseText: clean(field(block, "pictureTalkCh")) || null,
        imageUrl: pictureTalkImageUrl(order),
        audioUrl: audioUrlFor(spec, dialectId, order),
      });
      continue;
    }

    if (family.flat) {
      const record = { ...base };
      for (const [key, source] of Object.entries(family.flat)) record[key] = clean(field(block, source));
      const imagePath = imagePathFor(spec, order);
      if (imagePath) record.imagePath = imagePath;
      record.audioUrl = audioUrlFor(spec, dialectId, order);
      items.push(record);
      continue;
    }

    if (family.turns) {
      // 高中版 choiceOne：一張圖、一段錄音，內容是 2–3 輪對話。
      const turns = [];
      for (const letter of [...family.turns]) {
        const indigenousText = clean(field(block, `choiceOne${letter}Ab`));
        const chineseText = clean(field(block, `choiceOne${letter}Ch`));
        if (!indigenousText && !chineseText) continue;
        turns.push({ letter, indigenousText, chineseText });
      }
      items.push({ ...base, turns, imagePath: imagePathFor(spec, order), audioUrl: audioUrlFor(spec, dialectId, order) });
      continue;
    }

    const list = [...family.letters].map((letter) => {
      const entry = { letter };
      for (const [key, template] of Object.entries(family.per)) entry[key] = clean(field(block, template.replace("{L}", letter)));
      entry.audioUrl = audioUrlFor(spec, dialectId, order, letter);
      return entry;
    });
    items.push({ ...base, [family.listKey]: list });
  }

  return items.sort((a, b) => a.order - b.order);
}

// 硬性檢查：任何一項不符就中止，不寫任何檔案。
function assertClass(items, spec, dialectId, dialectName) {
  const where = `${dialectName}／${spec.family}(${spec.classId})`;
  const expected = expectedItems(spec, dialectId);
  if (items.length !== expected) {
    throw new Error(`${where} 預期 ${expected} 題，實得 ${items.length} 題`);
  }
  const orders = new Set(items.map((item) => item.order));
  if (orders.size !== items.length) throw new Error(`${where} 有重複的 order`);

  const family = FAMILIES[spec.family];

  for (const item of items) {
    if (family.pictureTalk) {
      if (!item.tip || !item.chineseText) throw new Error(`${where} order ${item.order} 缺少 tip 或中文參考答案`);
      if (!item.imageUrl) throw new Error(`${where} order ${item.order} 缺少圖片熱連結`);
      continue;
    }

    if (family.turns) {
      if (item.turns.length < 2) throw new Error(`${where} order ${item.order} 不足 2 輪對話`);
      for (const turn of item.turns) {
        if (!turn.indigenousText || !turn.chineseText) throw new Error(`${where} order ${item.order}${turn.letter} 有空欄位`);
      }
      if (!item.imagePath) throw new Error(`${where} order ${item.order} 缺少圖片`);
      continue;
    }

    if (family.letters) {
      const list = item[family.listKey];
      const want = [...family.letters].length;
      if (list.length !== want) throw new Error(`${where} order ${item.order} 不是 ${want} 個項目`);
      for (const entry of list) {
        if (!entry.indigenousText || !entry.chineseText) throw new Error(`${where} order ${item.order}${entry.letter} 有空欄位`);
      }
      continue;
    }

    if (!item.indigenousText || !item.chineseText) throw new Error(`${where} order ${item.order} 有空欄位`);
  }

  // 選擇題(三) 的三個拼寫選項由同類別的其他題充當，所以同類別內的族語句必須互異。
  if (spec.family === "choiceThree") {
    const texts = new Set(items.map((item) => item.indigenousText));
    if (texts.size !== items.length) throw new Error(`${where} 同類別內有重複的族語句，無法當作互斥的拼寫選項`);
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
  assertClass(items, job.spec, job.dialectId, job.dialectName);
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
  for (const [family, expected] of Object.entries(familyTotalsFor(dialectId))) {
    if (shard[family].length !== expected) {
      throw new Error(`方言 ${dialectId} 的 ${family} 預期 ${expected} 筆，實得 ${shard[family].length} 筆`);
    }
    shard.counts[family] = shard[family].length;
  }
}

// 圖片（各方言共用，只抓一次）。選擇題(三) 不抓圖：官方中級該題型的選項是
// 拼寫文字，顯示圖片等於給正式測驗沒有的提示。
const imageJobs = [];
for (const spec of CLASSES) {
  if (spec.family !== "recognize" && spec.family !== "choiceOne") continue;
  for (let order = 1; order <= spec.itemsPerDialect; order += 1) {
    imageJobs.push({
      url: `${imageBase}/${spec.family}/${spec.classNo}_${order}.png`,
      path: imagePathFor(spec, order),
    });
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
  for (const item of shard.choiceOne) referenced.add(item.imagePath);
  for (const imagePath of referenced) {
    if (!imagePaths.has(imagePath)) throw new Error(`方言 ${dialectId} 引用了未下載的圖片：${imagePath}`);
  }
}

// 音檔驗證（HEAD，不下載內容）。
let audioSpotCheck = null;
if (verifyAudio !== "none") {
  const urls = new Set();
  for (const shard of shards.values()) {
    for (const record of shard.recognize) urls.add(record.audioUrl);
    for (const record of shard.choiceThree) urls.add(record.audioUrl);
    for (const item of shard.choiceOne) urls.add(item.audioUrl);
    for (const item of shard.choiceTwo) for (const option of item.options) urls.add(option.audioUrl);
    for (const item of shard.oralReading) for (const sentence of item.sentences) urls.add(sentence.audioUrl);
    for (const item of shard.dialogue) for (const question of item.questions) urls.add(question.audioUrl);
    for (const item of shard.pictureTalk) urls.add(item.audioUrl);
  }
  const all = [...urls];
  const sampleRule = verifyAudio === "all" ? "全部音檔" : "每個方言每個類別的第一題";
  const targets = verifyAudio === "all" ? all : all.filter((url) => /\/\d+_1(_A)?\.mp3$/.test(url));
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
  console.log("choiceThree[0]:", JSON.stringify(shard.choiceThree[0], null, 2));
  console.log("oralReading[0].sentences[0]:", JSON.stringify(shard.oralReading[0].sentences[0], null, 2));
  console.log("pictureTalk[0]:", JSON.stringify(shard.pictureTalk[0], null, 2));
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
for (const [dialectId] of dialects) await mkdir(path.join(outputRoot, "raw", String(dialectId)), { recursive: true });

const files = [];

for (const entry of fetched) {
  // 看圖說話 XML 不入庫（文字進分片、圖／音熱連結）；其餘題型仍保留 raw。
  if (entry.spec.family === "pictureTalk") continue;
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
  title: "句型篇高中版／中級認證題型語料",
  description: "族語 E 樂園句型篇高中版 42 個方言別的看圖識字、選擇題（一）（二）（三）、唸唸看、簡短對話與看圖說話語料，用於重建中級認證測驗題型。",
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
  pictureTalkImagePolicy: "hotlinked-at-runtime",
  pictureTalkImageNote: "看圖說話圖片不入庫，執行時由 klokah.tw 載入；該網站會看到使用者的 IP。",
  choiceThreeImagePolicy: "not-collected",
  choiceThreeImageNote: "選擇題(三) 的選項是拼寫文字，顯示教材圖片等於給正式測驗沒有的提示，因此不收錄該題型的圖片。",
  dialectCount: dialects.length,
  classes: CLASSES,
  totals: {
    perDialect: FAMILY_TOTALS,
    perDialectExceptions: Object.fromEntries(
      dialects
        .map(([id]) => [id, familyTotalsFor(id)])
        .filter(([, totals]) => Object.entries(totals).some(([family, count]) => count !== FAMILY_TOTALS[family]))
        .map(([id, totals]) => [id, totals]),
    ),
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
  expectedItemsPerClass: CLASSES.map(({ family, classId, itemsPerDialect, exceptions }) => ({ family, classId, itemsPerDialect, ...(exceptions ? { exceptions } : {}) })),
  audioPolicy: "hotlinked-at-runtime",
  audioSpotCheck,
  sourceFileCount: files.length,
  dataset: { path: "dataset.json", bytes: datasetBytes.length, sha256: sha256(datasetBytes) },
  files,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readme = `# 句型篇高中版：中級認證題型語料\n\n` +
  `本目錄保存「族語 E 樂園」句型篇高中版 42 個方言別的七種題型語料，供「中級模擬站」出卷使用。\n\n` +
  `- \`dataset.json\`：索引、來源、類別表與完整性數字。**不含題目本身。**\n` +
  `- \`dialects/{dialectId}.json\`：42 個方言分片，頁面只載入使用者選的那一個。\n` +
  `- \`raw/{dialectId}/{classId}.xml\`：官方來源 XML，共 ${EXPECTED_RAW_COUNT} 份（不含看圖說話）。\n` +
  `- \`images/\`：官方共用圖片，共 ${EXPECTED_IMAGE_COUNT} 張（recognize／choiceOne）。\n` +
  `- \`manifest.json\`：來源 URL、檔案大小及 SHA-256。\n` +
  `- \`LICENSE.md\`：授權、標示與使用限制。\n\n` +
  `## 收錄範圍\n\n` +
  `只收中級考卷用得到的七個題型：\`recognize\`（是非題）、\`choiceOne\`（選擇題一）、\n` +
  `\`choiceTwo\`（選擇題二）、\`choiceThree\`（選擇題三）、\`oralReading\`（單句朗讀）、\n` +
  `\`dialogue\`（問答題）、\`pictureTalk\`（看圖表達）。\n` +
  `高中版另有 typeId 1 基本詞彙與 typeId 2 生活百句，中級考卷用不到，因此不入庫。\n\n` +
  `## 與國中版（初級）的結構差異\n\n` +
  `- \`choiceOne\` 是「一張圖 + 一段對話錄音」，不是國中版的三選項各自有圖有音。\n` +
  `- \`choiceThree\` 是高中版才有的題型（國中版對應位置是配合題），純文字 + 音檔。\n` +
  `- \`pictureTalk\` 每題只有 1 張圖，且 order 1、2 都有效（國中版只有 order 1）。\n` +
  `- \`oralReading\` 每題有 5 個獨立句子（A–E），各自有音檔。\n\n` +
  `## 為什麼分片\n\n` +
  `全部 ${EXPECTED_RECORD_COUNT} 筆若內嵌在 \`dataset.json\` 會讓每次開頁都得下載整包。\n` +
  `因此改用 \`recordLayout: "sharded"\`，\`dataset.json\` 只留索引與完整性表。\n\n` +
  `## 音檔\n\n` +
  `**音檔不入庫。** 每筆資料帶有 \`audioUrl\`，執行時由 \`klokah.tw\` 直接播放。\n` +
  `這代表使用者播放時，該網站會看到使用者的 IP 位址；應用頁面必須揭露這件事。\n` +
  `klokah 不送 CORS 標頭，所以只能用 \`<audio src>\` 播放，不能 \`fetch()\`、不能加 \`crossorigin\`。\n\n` +
  `## 圖片政策\n\n` +
  `- \`recognize\`／\`choiceOne\` 的圖入庫（是非題與選擇題(一) 一定要看圖作答）。\n` +
  `- \`pictureTalk\` 的圖熱連結，不入庫。\n` +
  `- \`choiceThree\` **不收圖**：官方中級該題型的選項是拼寫文字，顯示圖片等於給正式測驗沒有的提示。\n\n` +
  `## 重新下載\n\n` +
  `\`\`\`\nnode scripts/download-klokah-senior.mjs\n\`\`\`\n\n` +
  `下載程式會要求每個方言的每個類別題數與 \`dataset.json\` 的 \`classes\` 完全相符，否則中止。\n` +
  `**全部驗證通過才會寫檔**，失敗時本目錄保持原狀。\n\n` +
  `klokah 在併發過高時會回傳 HTTP 200 但空的 body，所以下載程式併發上限為 3，\n` +
  `且以位元組長度與檔案 magic 驗證每一次回應，而不是只看狀態碼。\n\n` +
  `其他參數：\`--dry-run --dialects=1,5,42\`（不寫檔的抽驗）、\`--verify-audio\`（HEAD 抽驗音檔）、\n` +
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
