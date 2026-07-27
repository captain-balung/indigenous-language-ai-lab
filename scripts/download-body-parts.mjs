import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "body-parts");
const rawRoot = path.join(outputRoot, "raw");
const imageRoot = path.join(outputRoot, "images");

const dialects = [
  [1, "南勢阿美語"], [2, "秀姑巒阿美語"], [3, "海岸阿美語"], [4, "馬蘭阿美語"], [5, "恆春阿美語"],
  [6, "賽考利克泰雅語"], [7, "澤敖利泰雅語"], [8, "汶水泰雅語"], [9, "萬大泰雅語"], [10, "四季泰雅語"],
  [11, "宜蘭澤敖利泰雅語"], [13, "賽夏語"], [14, "邵語"], [15, "都達賽德克語"], [16, "德固達雅賽德克語"],
  [17, "德鹿谷賽德克語"], [18, "卓群布農語"], [19, "卡群布農語"], [20, "丹群布農語"], [21, "巒群布農語"],
  [22, "郡群布農語"], [23, "東排灣語"], [24, "北排灣語"], [25, "中排灣語"], [26, "南排灣語"],
  [27, "東魯凱語"], [28, "霧台魯凱語"], [29, "大武魯凱語"], [30, "多納魯凱語"], [31, "茂林魯凱語"],
  [32, "萬山魯凱語"], [33, "太魯閣語"], [34, "噶瑪蘭語"], [35, "鄒語"], [38, "南王卑南語"],
  [39, "知本卑南語"], [40, "西群卑南語"], [41, "建和卑南語"], [42, "雅美語"], [43, "撒奇萊雅語"],
  [36, "卡那卡那富語"], [37, "拉阿魯哇語"],
];

const xmlBase = "https://web.klokah.tw/extension/sp_data/junior";
const imageBase = "https://klokah.tw/extension/sp_junior/graphics_100x100/recognize";
const sourcePage = "https://web.klokah.tw/extension/sp_junior/practice.php";
const licensePage = "https://web.klokah.tw/creativeCommons/";

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

function parseItems(xml, dialectId, dialectName) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((match) => match[1])
    .filter((item) => field(item, "typeId") === "3" && field(item, "classId") === "20")
    .map((item) => {
      const classNo = Number(field(item, "classNo"));
      const order = Number(field(item, "recognizeOrder"));
      return {
        id: `${dialectId}-body-${order}`,
        dialectId,
        dialectName,
        autoId: Number(field(item, "autoId")),
        categoryId: 20,
        categoryName: "身體部位",
        order,
        indigenousText: field(item, "recognizeAb"),
        chineseText: field(item, "recognizeCh"),
        imagePath: `images/${classNo}_${order}.png`,
        sourceUrl: `${sourcePage}?d=${dialectId}&c=20`,
      };
    })
    .sort((a, b) => a.order - b.order);
}

async function download(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Iris-01-web educational dataset downloader" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

await mkdir(rawRoot, { recursive: true });
await mkdir(imageRoot, { recursive: true });

const records = [];
const sources = [];

for (const [dialectId, dialectName] of dialects) {
  const url = `${xmlBase}/${dialectId}/20.xml`;
  const bytes = await download(url);
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const items = parseItems(xml, dialectId, dialectName);
  if (items.length !== 10) throw new Error(`${dialectName}（${dialectId}）預期 10 筆，實得 ${items.length} 筆`);
  const rawPath = path.join(rawRoot, `${dialectId}.xml`);
  await writeFile(rawPath, bytes);
  records.push(...items);
  sources.push({ dialectId, dialectName, url, path: `raw/${dialectId}.xml`, bytes: bytes.length, sha256: sha256(bytes) });
}

for (let order = 1; order <= 10; order += 1) {
  const url = `${imageBase}/1_${order}.png`;
  const bytes = await download(url);
  if (!bytes.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error(`不是有效 PNG：${url}`);
  await writeFile(path.join(imageRoot, `1_${order}.png`), bytes);
  sources.push({ url, path: `images/1_${order}.png`, bytes: bytes.length, sha256: sha256(bytes) });
}

const dataset = {
  schemaVersion: 1,
  title: "句型篇國中版／看圖識字／身體部位",
  description: "族語 E 樂園 42 個方言別的身體部位看圖識字資料。",
  source: {
    publisher: "財團法人原住民族語言研究發展基金會",
    website: "原住民族語E樂園",
    unitUrl: sourcePage,
    license: "CC BY-NC-SA 4.0",
    licenseUrl: licensePage,
    attribution: "資料來源－原住民族語E樂園，由財團法人原住民族語言研究發展基金會製作，以創用CC 姓名標示－非商業性－相同方式分享 4.0國際授權條款釋出。",
    retrievedAt: new Date().toISOString(),
  },
  dialectCount: dialects.length,
  itemsPerDialect: 10,
  recordCount: records.length,
  dialects: dialects.map(([id, name]) => ({ id, name })),
  records,
};

const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(outputRoot, "dataset.json"), datasetText, "utf8");

const datasetBytes = await readFile(path.join(outputRoot, "dataset.json"));
const manifest = {
  generatedAt: new Date().toISOString(),
  recordCount: records.length,
  expectedRecordCount: 420,
  sourceFileCount: sources.length,
  dataset: { path: "dataset.json", bytes: datasetBytes.length, sha256: sha256(datasetBytes) },
  files: sources,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readme = `# 看圖識字：身體部位資料集\n\n` +
  `本目錄保存「族語 E 樂園」句型篇國中版／看圖識字／身體部位的 42 個方言別資料，共 420 筆文字紀錄及 10 張共用圖片。\n\n` +
  `- \`dataset.json\`：應用程式使用的正規化資料。\n` +
  `- \`raw/*.xml\`：官方來源 XML，共 42 份。\n` +
  `- \`images/*.png\`：官方共用圖片，共 10 張。\n` +
  `- \`manifest.json\`：來源 URL、檔案大小及 SHA-256。\n` +
  `- \`LICENSE.md\`：授權、標示與使用限制。\n\n` +
  `重新下載：\`node scripts/download-body-parts.mjs\`。下載程式會要求每個方言恰有 10 筆，否則停止。\n`;
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");

const license = `# 素材授權與標示\n\n` +
  `資料來源－[原住民族語E樂園](${sourcePage})，由財團法人原住民族語言研究發展基金會製作，以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](${licensePage})釋出。\n\n` +
  `## 使用限制\n\n` +
  `- 必須標示網站全稱及原著作網址。\n` +
  `- 不得作商業用途；商業使用須另向權利人申請授權。\n` +
  `- 改作或衍生作品必須以相同授權條款散布。\n` +
  `- 本資料僅涵蓋本單元文字與圖片，不代表授權原始網站程式碼、商標或其他未收錄內容。\n`;
await writeFile(path.join(outputRoot, "LICENSE.md"), license, "utf8");

console.log(`完成：${dialects.length} 個方言、${records.length} 筆文字、10 張圖片`);
