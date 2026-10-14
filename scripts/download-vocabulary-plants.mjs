#!/usr/bin/env node
// 自族語 E 樂園學習詞表「08植物」下載各方言詞條，寫入 data/market-helper/。
// API：https://web.klokah.tw/vocabulary/php/getWords.php?did=&cate=08植物
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECTS } from "../apps/basic-learning/body-parts-practice/dialects.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data/market-helper");
const outDialects = path.join(outDir, "dialects");
const CATE = "08植物";
const WORDS_URL = (did) =>
  `https://web.klokah.tw/vocabulary/php/getWords.php?did=${did}&cate=${encodeURIComponent(CATE)}`;

/** 適合攤位販售的菜／水果（排除樹、草、種子等非賣物）。 */
export const MARKETABLE_CHINESE = [
  "香蕉", "芋頭", "甘蔗", "甘藷", "柑橘", "南瓜", "玉米", "檳榔", "竹筍", "香菇",
  "鳳梨", "桃子", "李子", "木耳", "蕃茄", "胡瓜", "山蘇", "胡蘿蔔", "空心菜", "長豆",
  "綠豆", "蔥", "豆芽", "百香果", "山藥", "野草莓", "梅子", "過貓", "樹豆", "柚子",
  "辣椒(通稱)", "地瓜", "番石榴"
];

const MARKETABLE = new Set(MARKETABLE_CHINESE);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

function mapItem(row, dialectId) {
  const chineseText = String(row?.ch ?? "").trim();
  const indigenousText = String(row?.ab ?? "").trim();
  const code = String(row?.n ?? "").trim();
  if (!chineseText || !indigenousText || !code) return null;
  if (!MARKETABLE.has(chineseText)) return null;
  const fileStem = code.replace(/-/g, "_");
  return {
    code,
    chineseText,
    indigenousText,
    englishText: String(row?.en ?? "").trim() || null,
    level: String(row?.lv ?? "").trim() || null,
    audioUrl: row?.snda
      ? `https://web.klokah.tw/vocabulary/audio/word/${dialectId}/${code}.wav`
      : null,
    imagePath: `competition/vocabulary/picture/${fileStem}.jpg`,
    imageUrl: `https://klokah.tw/competition/vocabulary/picture/${fileStem}.jpg`
  };
}

async function mapPool(concurrency, values, worker) {
  const queue = [...values];
  const results = [];
  async function run() {
    while (queue.length) {
      const value = queue.shift();
      results.push(await worker(value));
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return results;
}

async function main() {
  fs.mkdirSync(outDialects, { recursive: true });
  const notes = [];
  const dialects = [];
  let complete = 0;

  const rows = await mapPool(3, DIALECTS, async (dialect) => {
    try {
      const raw = await fetchJson(WORDS_URL(dialect.id));
      if (!Array.isArray(raw)) throw new Error("回應不是陣列");
      const items = raw.map((row) => mapItem(row, dialect.id)).filter(Boolean);
      // 甘藷／地瓜同義時只留一個，避免隨機抽到重複概念。
      const seen = new Set();
      const deduped = [];
      for (const item of items) {
        const key = item.chineseText === "甘藷" ? "地瓜" : item.chineseText;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      if (deduped.length < 3) {
        notes.push(`方言 ${dialect.id}（${dialect.name}）可賣詞不足 3 個（${deduped.length}）`);
        return null;
      }
      const payload = {
        schemaVersion: 2,
        dialectId: dialect.id,
        dialectName: dialect.name,
        ethnicity: dialect.ethnicity,
        source: "https://web.klokah.tw/vocabulary/",
        category: CATE,
        items: deduped
      };
      fs.writeFileSync(path.join(outDialects, `${dialect.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
      return { id: dialect.id, name: dialect.name, ethnicity: dialect.ethnicity, itemCount: deduped.length };
    } catch (error) {
      notes.push(`方言 ${dialect.id}（${dialect.name}）下載失敗：${error.message}`);
      return null;
    }
  });

  for (const row of rows.filter(Boolean).sort((a, b) => a.id - b.id)) {
    dialects.push(row);
    complete += 1;
  }

  const license = `# 素材授權與標示

資料來源－[原住民族語E樂園／學習詞表](https://web.klokah.tw/vocabulary/)，由財團法人原住民族語言研究發展基金會製作，以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](https://web.klokah.tw/creativeCommons/)釋出。

## 使用限制

- 必須標示網站全稱及原著作網址。
- 不得作商業用途；商業使用須另向權利人申請授權。
- 改作或衍生作品必須以相同授權條款散布。

## 音檔與圖片

本目錄不收錄音檔與圖片。執行時：

- 音檔：\`https://web.klokah.tw/vocabulary/audio/word/{方言}/{詞碼}.wav\`
- 圖片：\`https://klokah.tw/competition/vocabulary/picture/{詞碼}.jpg\`

播放或載入時該網站會看到使用者的 IP 位址。
`;
  fs.writeFileSync(path.join(outDir, "LICENSE.md"), license);

  const dataset = {
    schemaVersion: 2,
    name: "market-helper",
    description: "市場小幫手貨品詞：自族語 E 樂園學習詞表「08植物」抽出可販售的菜／水果詞，每局隨機抽幾種。音檔與圖片熱連結。",
    source: {
      website: "https://web.klokah.tw/vocabulary/",
      category: CATE,
      api: "php/getWords.php"
    },
    marketableChinese: MARKETABLE_CHINESE,
    dialectCount: complete,
    dialects,
    notes,
    builtAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outDir, "dataset.json"), `${JSON.stringify(dataset, null, 2)}\n`);

  const readme = `# 市場小幫手貨品詞

自「族語 E 樂園」[學習詞表](https://web.klokah.tw/vocabulary/) 的「08植物」抽出可賣菜／水果詞。

- \`dataset.json\`：索引與可賣中文清單。
- \`dialects/{dialectId}.json\`：各方言詞條（族語、中文、音檔／圖片 URL）。
- \`LICENSE.md\`：CC BY-NC-SA 4.0。

重新下載：

\`\`\`
node scripts/download-vocabulary-plants.mjs
\`\`\`
`;
  fs.writeFileSync(path.join(outDir, "README.md"), readme);

  console.log(`market-helper plants: ${complete} dialects` + (notes.length ? `；${notes.length} 則備註` : ""));
  notes.forEach((line) => console.warn(`  - ${line}`));
  if (complete < 40) {
    console.error("too few complete dialects");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
