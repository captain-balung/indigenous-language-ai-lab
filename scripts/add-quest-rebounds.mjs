// 補上每關每位對象的 rebound（官方 phase2[target]["0"]：句子沒對上時，
// 同學會說「不知道／聽不懂」的回應錄音）。之前 download-hordequest.mjs 特意不收
// code 0；現在玩法需要：判定沒對上時，那位同學要照官方說出這句。
// 資料來源用 tmp/interact/hordequest/json/{兩位數}/lesson|find|outside.json（官方 JSON 的本地快取），
// 補進 data/hordequest/dialects/{n}.json 的 quest.rebounds = { "target-1": {...}, ... }。
// 用法：node scripts/add-quest-rebounds.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data/hordequest/dialects");
const tmpJson = path.join(root, "tmp/interact/hordequest/json");
const THEME_FILES = { lesson: "lesson.json", find: "find.json", outside: "outside.json" };
const audioBase = "https://web.klokah.tw";

const stripTags = (value) => {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return text;
};

// 茂林魯凱語（31）官方 JSON 缺一個逗號；跟 download-hordequest.mjs 同一招補上。
const repairMissingComma = (text) => text.replace(/"([^"\n]*)"(\r?\n\s*)"([^"\n]*)"/g, '"$1",$2"$3"');

const dialectFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
let patched = 0;
let missing = [];

for (const file of dialectFiles) {
  const dialectId = file.replace(".json", "");
  const pack = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
  for (const theme of pack.themes) {
    const tmpFile = path.join(tmpJson, dialectId.padStart(2, "0"), THEME_FILES[theme.key]);
    if (!fs.existsSync(tmpFile)) { missing.push(`${dialectId}/${theme.key}`); continue; }
    let official;
    try {
      official = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    } catch {
      // 茂林魯凱語（31）的官方 JSON 在 phase2 少一個逗號（download-hordequest.mjs
      // 的 repairMissingComma 同一招）。
      const repaired = JSON.parse(repairMissingComma(fs.readFileSync(tmpFile, "utf8")));
      official = repaired;
    }
    const phase2 = official?.data?.phase2;
    if (!phase2) { missing.push(`${dialectId}/${theme.key}（缺 phase2）`); continue; }
    for (const quest of theme.quests) {
      const stageIndex = (quest.order ?? questIndexFallback(quest)) - 1;
      const stage = phase2.stage?.[stageIndex];
      if (!stage) continue;
      const rebounds = {};
      for (const [targetKey, value] of Object.entries(phase2)) {
        if (!/^target-\d+$/.test(targetKey)) continue;
        const rebound = value?.["0"];
        const text = stripTags(rebound?.text);
        const sound = String(rebound?.sound ?? "");
        if (!text || !sound) continue;
        rebounds[targetKey] = {
          indigenousText: text,
          chineseText: stripTags(rebound?.textCh) || null,
          audioUrl: `${audioBase}/${sound}.mp3`,
        };
      }
      if (Object.keys(rebounds).length) {
        quest.rebounds = rebounds;
        patched += 1;
      }
    }
  }
  fs.writeFileSync(path.join(dataDir, file), `${JSON.stringify(pack, null, 2)}\n`);
}

// dataset.json 的說明同步：rebounds 已經收錄。
const datasetPath = path.join(root, "data/hordequest/dataset.json");
if (fs.existsSync(datasetPath)) {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  if (dataset.notes?.questSoundPaths) {
    dataset.notes.questSoundPaths = "phase2 的 player 與 target 錄音是另一組 sound 路徑，與 phase1 不同；回應索引是 code，0（什麼？／聽不懂？）是答錯時的 rebounds，已補進 quests[].rebounds（見 scripts/add-quest-rebounds.mjs）。";
    fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  }
}

console.log(`rebounds 補進 ${patched} 個關卡；缺資料：${missing.length ? missing.join(", ") : "無"}`);

function questIndexFallback() {
  return 1;
}
