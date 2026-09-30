// 族語 E 樂園「互動模組／中級：溝通式教學法／上課用語」下載器。
// JSON 在 web.klokah.tw/interact/hordequest/json/{兩位數方言編號}/lesson.json
// 圖與音檔熱連結。全部驗證通過才寫檔。
//
// 這個來源是本專案少數「情境對話」教材：官方把一句日常對話逐輪排好
// （text 族語 / textCh 中文 / sound 錄音 / image 說話者 / background 場景），
// 情境應用的角色扮演就是拿這些輪次當骨架。

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "hordequest");

const jsonBase = "https://web.klokah.tw/interact/hordequest/json";
const imageBase = "https://web.klokah.tw/interact/hordequest/img";
const audioBase = "https://web.klokah.tw";
const sourcePage = "https://web.klokah.tw/interact/hordequest/";
const licensePage = "https://web.klokah.tw/creativeCommons/";
const userAgent = "Iris-01-web educational dataset downloader";

// 三個主題，每個都是「1 筆開場白 + N 輪交替發話」。
// turnCount、背景圖副檔名與開場白關鍵字都是官方固定值，逐項驗證，不放寬成「至少幾句」——
// 放寬就再也偵測不到上游改版。
const THEMES = [
  { key: "lesson", name: "上課用語", turnCount: 9, backgroundExt: "jpg", introMarker: "開學第一天" },
  { key: "find", name: "尋找物品", turnCount: 8, backgroundExt: "png", introMarker: "婚禮" },
  { key: "outside", name: "戶外活動", turnCount: 7, backgroundExt: "png", introMarker: "星期六" },
];

// 官方用說話者的圖檔表示角色，跨三個主題一共有四種。
// 同一個人在不同主題用不同圖檔（boy.png / boy-1.png 都是主角）。
const SPEAKER_IMAGES = {
  "boy.png": { id: "protagonist", name: "主角" },
  "boy-1.png": { id: "protagonist", name: "主角" },
  "boy-2.png": { id: "sibling", name: "哥哥" },
  "girl.png": { id: "classmate", name: "同學" },
  "mom.png": { id: "mother", name: "媽媽" },
};

// 與 apps/basic-learning/body-parts-practice/dialects.mjs 一致（1–11、13–43，沒有 12）。
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

// 每個主題都是 1 段開場 + 固定輪數的交替發話，42 個方言逐一驗證過。
const INTRO_COUNT = 1;
const SOUND_PATTERN = /^text\/sound\/\d+\/\d+$/;

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

async function fetchValidated(url) {
  const backoff = [500, 1500, 4000];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("回應為空（klokah 在併發過高時會這樣）");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parseDialogueJson(text);
      return { bytes, text };
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

// 茂林魯凱語（31）的官方 JSON 在 phase2 少一個逗號（"la" 後接 "psédmala"），
// 整份無法 JSON.parse。補逗號只影響 phase2 的座標；phase1 對話逐字不動。
// 這裡用「同一個陣列內、換行相鄰的兩個字串值」當條件，範圍比整份取代小得多。
function repairMissingComma(text) {
  return text.replace(/"([^"\n]*)"(\r?\n\s*)"([^"\n]*)"/g, '"$1",$2"$3"');
}

function parseDialogueJson(text) {
  try {
    return { json: JSON.parse(text), sanitized: false };
  } catch (error) {
    let repaired;
    try {
      repaired = JSON.parse(repairMissingComma(text));
    } catch {
      throw new Error(`JSON 無法解析，且補逗號也救不回來：${error.message}`);
    }
    return { json: repaired, sanitized: true };
  }
}

function stripTags(value) {
  return String(value ?? "").replace(/<br\s*\/?>/gi, "").replace(/\s+/g, " ").trim();
}

// 恆春阿美語（5）／戶外活動第 7 輪，官方把族語整句貼在中文欄位後面：
// textCh 是「沒問題，我們一定會的！Hay， mafana' to kami.」，中文參考答案因此永遠對不上翻譯結果。
//
// 貼上來的殘段跟同一輪的 text 欄位並不完全一樣（少了 "a mina'on"），所以不能用字串比對；
// 改用形態判斷：中文內容、標點，之後還接著拉丁字母，就是上游誤植。
// 全庫 1008 輪只有這 1 筆命中，而且沒有任何正常參考句是以拉丁字母結尾，不會誤傷。
function trimDuplicatedIndigenous(chineseText) {
  const text = String(chineseText ?? "");
  return text.replace(/([一-鿿][，,。、！？!?；;])\s*[A-Za-z][\s\S]*$/, "$1").trim();
}

function extractDialogue(json, theme, dialectId, dialectName) {
  const where = `${dialectName}（${dialectId}）／${theme.name}`;
  // 上課用語與尋找物品用 theme 欄位，戶外活動用 name 欄位——這是上游的不一致，照實處理。
  const declared = json?.theme ?? json?.name;
  if (declared !== theme.name) throw new Error(`${where} 的主題名是「${declared}」，不是預期的「${theme.name}」`);
  const phase1 = json?.data?.phase1;
  if (!Array.isArray(phase1)) throw new Error(`${where} 沒有 phase1 對話陣列`);
  const expected = INTRO_COUNT + theme.turnCount;
  if (phase1.length !== expected) {
    throw new Error(`${where} 的 phase1 預期 ${expected} 筆，實得 ${phase1.length} 筆`);
  }

  const [intro, ...rawTurns] = phase1;
  const introText = stripTags(intro?.text);
  if (!introText || intro.sound || intro.textCh) {
    throw new Error(`${where} 的第一筆必須是只有中文的開場白`);
  }
  // 開場白是官方對這個情境的說明，換掉就代表情境已經改版，要停下來看。
  if (!introText.includes(theme.introMarker)) {
    throw new Error(`${where} 的開場白已不含「${theme.introMarker}」，官方情境可能已改版`);
  }

  const turns = rawTurns.map((turn, index) => {
    const order = index + 1;
    const indigenousText = stripTags(turn?.text);
    const chineseText = trimDuplicatedIndigenous(stripTags(turn?.textCh));
    const sound = String(turn?.sound ?? "");
    const speaker = SPEAKER_IMAGES[turn?.image];
    const background = String(turn?.background ?? "");
    if (!indigenousText) throw new Error(`${where} 第 ${order} 輪沒有族語`);
    if (!chineseText) throw new Error(`${where} 第 ${order} 輪沒有中文`);
    if (!SOUND_PATTERN.test(sound)) throw new Error(`${where} 第 ${order} 輪的音檔路徑不合法：${sound}`);
    if (!speaker) throw new Error(`${where} 第 ${order} 輪的說話者圖檔不認得：${turn?.image}`);
    if (!background.endsWith(`.${theme.backgroundExt}`)) {
      throw new Error(`${where} 第 ${order} 輪的場景圖不是 .${theme.backgroundExt}：${background}`);
    }
    return {
      id: `${dialectId}-hordequest-${theme.key}-${order}`,
      order,
      speaker: speaker.id,
      speakerName: speaker.name,
      indigenousText,
      chineseText,
      audioUrl: `${audioBase}/${sound}.mp3`,
      imageUrl: `${imageBase}/${theme.key}/${turn.image}`,
      background,
    };
  });

  const speakers = new Set(turns.map((turn) => turn.speaker));
  if (speakers.size < 2) throw new Error(`${where} 的對話應該至少有兩位說話者，實得 ${speakers.size} 位`);
  for (let index = 1; index < turns.length; index += 1) {
    if (turns[index].speaker === turns[index - 1].speaker) {
      throw new Error(`${where} 第 ${index + 1} 輪與前一輪同一人發話，應為交替對話`);
    }
  }

  // characters 只列實際有發話的角色，用 id 去重並保留第一次出場的順序。
  // 戶外活動是三人對話，同一個人會在好幾段連續發話開頭出現，不能只擋相鄰重複。
  const seen = new Set();
  const characters = [];
  for (const turn of turns) {
    if (seen.has(turn.speaker)) continue;
    seen.add(turn.speaker);
    characters.push({ id: turn.speaker, name: turn.speakerName, imageUrl: turn.imageUrl });
  }

  return { intro: introText, characters, turns };
}

console.log(`開始下載 ${THEMES.length} 個主題 JSON：${selectedDialects.length} 個方言`);
let done = 0;
const fetched = await mapLimit(selectedDialects, 3, async ([dialectId, ethnicity, dialectName]) => {
  const themes = [];
  for (const theme of THEMES) {
    const url = `${jsonBase}/${paddedId(dialectId)}/${theme.key}.json`;
    const { bytes, text } = await fetchValidated(url);
    const { json, sanitized } = parseDialogueJson(text);
    themes.push({ theme, url, bytes, sanitized, ...extractDialogue(json, theme, dialectId, dialectName) });
  }
  done += 1;
  if (done % 10 === 0) console.log(`  方言 ${done}/${selectedDialects.length}`);
  return { dialectId, ethnicity, dialectName, themes };
});

if (verifyAudio !== "none") {
  const all = fetched.flatMap((entry) => entry.themes.flatMap((item) => item.turns.map((turn) => turn.audioUrl)));
  const targets = verifyAudio === "all" ? [...new Set(all)] : [...new Set(all)].slice(0, 42);
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
  console.log(JSON.stringify({
    dialectId: first.dialectId,
    themes: first.themes.map((item) => ({
      key: item.theme.key,
      name: item.theme.name,
      sanitized: item.sanitized,
      intro: item.intro,
      characters: item.characters,
      turns: item.turns.slice(0, 2),
    })),
  }, null, 2));
  const total = fetched.reduce((sum, entry) => sum + entry.themes.reduce((n, item) => n + item.turns.length, 0), 0);
  console.log(`JSON ${fetched.length * THEMES.length} 份，共 ${total} 輪對話，所有數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== dialects.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "dialects"), { recursive: true });

const files = [];
for (const theme of THEMES) {
  await mkdir(path.join(outputRoot, "raw", theme.key), { recursive: true });
}
for (const entry of fetched) {
  for (const item of entry.themes) {
    const relative = `raw/${item.theme.key}/${entry.dialectId}.json`;
    await writeFile(path.join(outputRoot, relative), item.bytes);
    files.push({
      dialectId: entry.dialectId,
      theme: item.theme.key,
      url: item.url,
      path: relative,
      bytes: item.bytes.length,
      sha256: sha256(item.bytes),
      sanitized: item.sanitized,
    });
  }
}

const shards = [];
for (const entry of fetched) {
  const shard = {
    schemaVersion: 2,
    dialectId: entry.dialectId,
    dialectName: entry.dialectName,
    ethnicity: entry.ethnicity,
    sanitized: entry.themes.map((item) => item.sanitized),
    themes: entry.themes.map((item) => ({
      key: item.theme.key,
      name: item.theme.name,
      intro: item.intro,
      characters: item.characters,
      turns: item.turns,
    })),
  };
  const relative = `dialects/${entry.dialectId}.json`;
  const text = `${JSON.stringify(shard, null, 2)}\n`;
  await writeFile(path.join(outputRoot, relative), text, "utf8");
  files.push({
    dialectId: entry.dialectId,
    path: relative,
    bytes: Buffer.byteLength(text),
    sha256: sha256(Buffer.from(text, "utf8")),
  });
  shards.push(shard);
}

const dataset = {
  schemaVersion: 2,
  title: "互動模組中級：溝通式教學法情境對話",
  description: "族語 E 樂園互動模組中級的三個生活情境（上課用語、尋找物品、戶外活動）：42 個方言別，每個主題 1 段開場白加固定輪數的交替發話，供情境應用的角色扮演使用。圖與音檔熱連結。",
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
  imagePolicy: "hotlinked-at-runtime",
  imageNote: "說話者與場景圖不入庫，執行時直接由 web.klokah.tw 熱連結。",
  dialectCount: dialects.length,
  themes: THEMES.map((theme) => ({
    key: theme.key,
    name: theme.name,
    turnsPerDialect: theme.turnCount,
    recordCount: dialects.length * theme.turnCount,
  })),
  recordCount: dialects.length * THEMES.reduce((sum, theme) => sum + theme.turnCount, 0),
  dialects: dialects.map(([id, ethnicity, name]) => ({ id, ethnicity, name })),
  notes: {
    speakers: "角色由官方說話者圖檔辨識：boy.png 與 boy-1.png 都是主角，boy-2.png 是哥哥，girl.png 是同學，mom.png 是媽媽。上課用語與尋找物品是兩人對話，戶外活動是三人。",
    themeNameKey: "上課用語與尋找物品的主題名在 theme 欄位，戶外活動在 name 欄位，這是上游的不一致。",
    duplicatedChinese: "恆春阿美語（5）戶外活動第 7 輪，官方把族語整句貼在中文欄位後面；下載時把重複的族語扣掉，只留中文參考答案。",
    malformedJson: "茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，下載時補上；分片的 sanitized 陣列對應到主題順序，只有 lesson 為 true。phase1 對話未改動。",
    phase2: "三個主題都另有 phase2 的互動關卡（問周圍的人、辨認特徵、把東西放進購物籃）。本單元只收 phase1 對話，關卡玩法尚未實作。",
  },
};
const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(path.join(outputRoot, "dataset.json"), datasetText, "utf8");
files.push({ path: "dataset.json", bytes: Buffer.byteLength(datasetText), sha256: sha256(Buffer.from(datasetText, "utf8")) });

const manifest = {
  generatedAt: dataset.source.retrievedAt,
  recordCount: dataset.recordCount,
  files,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const license = `# 素材授權與標示

資料來源－[原住民族語E樂園](${sourcePage})，由財團法人原住民族語言研究發展基金會製作，以[創用CC 姓名標示－非商業性－相同方式分享 4.0 國際授權條款](${licensePage})釋出。

## 使用限制

- 必須標示網站全稱及原著作網址。
- 不得作商業用途；商業使用須另向權利人申請授權。
- 改作或衍生作品必須以相同授權條款散布。
- 本資料僅涵蓋本單元文字，不代表授權原始網站程式碼、商標或其他未收錄內容。

## 音檔與圖片

本目錄不收錄任何音檔或圖片。應用程式執行時直接連往 \`web.klokah.tw\` 播放官方錄音並熱連結官方圖片，
不重製、不轉存、不代為散布。同樣的姓名標示與非商業限制適用於這些錄音與圖片。
`;
await writeFile(path.join(outputRoot, "LICENSE.md"), license, "utf8");

const readme = `# 互動模組中級：溝通式教學法情境對話

本目錄保存「族語 E 樂園」[互動模組／中級：溝通式教學法](${sourcePage}) 42 個方言別的三個生活情境對話，供情境應用的角色扮演使用。

- \`dataset.json\`：索引、來源與完整性數字。**不含對話本身。**
- \`dialects/{dialectId}.json\`：每方言三個主題，每個主題 1 段開場白加上固定輪數的交替發話，
  含說話者、族語、中文、音檔 URL 與場景圖。**換方言別時只載入這一個檔案。**
- \`raw/{theme}/{dialectId}.json\`：官方原始 JSON。
- \`manifest.json\`：來源 URL、檔案大小及 SHA-256。
- \`LICENSE.md\`：授權、標示與使用限制。

| 主題 | 每方言輪數 | 角色 |
| --- | --- | --- |
${THEMES.map((theme) => `| ${theme.name}（\`${theme.key}\`） | ${theme.turnCount} | — |`).join("\n")}

角色由官方說話者圖檔辨識：\`boy.png\` 與 \`boy-1.png\` 是主角，\`boy-2.png\` 是哥哥，\`girl.png\` 是同學，\`mom.png\` 是媽媽。
上課用語與尋找物品是兩人對話，戶外活動是三人，逐輪交替發話。

**音檔與圖片都不入庫。** 每輪帶 \`audioUrl\` 與 \`imageUrl\`，執行時由 \`web.klokah.tw\` 直接播放與熱連結。

茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，整份無法解析；下載時補上逗號，
分片的 \`sanitized\` 陣列對應到主題順序，只有 \`lesson\` 為 \`true\`，phase1 的對話文字沒有改動。

上游的小不一致：上課用語與尋找物品的主題名在 \`theme\` 欄位，戶外活動在 \`name\` 欄位。

## 收錄範圍

三個主題都只收 \`phase1\` 的對話。官方另有 \`phase2\` 的互動關卡（問周圍的人要找什麼、辨認特徵、把東西放進購物籃），
玩法與對話不同，本單元尚未收錄；要實作時再擴充，屆時在 \`THEMES\` 之外加一段解析即可。

## 重新下載

\`\`\`
node scripts/download-hordequest.mjs
\`\`\`

其他參數：\`--dry-run --dialects=1,31,42\`、\`--verify-audio\`、\`--verify-audio=all\`。
`;
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");

console.log(`完成：${shards.length} 個方言、${dataset.recordCount} 輪對話。`);