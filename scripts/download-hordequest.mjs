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

// ── phase2 任務關卡 ──────────────────────────────────────────────
// 官方 phase2 是「拖詞卡拼句子 → 選對象 → 提問」。詞卡等於把答案的詞彙與順序
// 都送給學習者，所以我們只留詞卡當重試時的提示，句子改由錄音或打字產生。
//
// 任務說明（quest／tips）有兩個來源，官方頁面用的是共用的 setup 檔：
//   json/setup/{theme}.json  → 顯示用文案，42 個方言共用
//   json/{dialect}/{theme}.json 的 phase2.stage[i].quest／tips → 方言別變體，官方沒有拿來顯示
// 兩份文字語意相同、共用版比較乾淨，所以顯示用 setup，句子與過關條件用方言別的。
// 這個「兩份文案」是上游的不一致，記在 notes.questTextSource。
const QUEST_THEMES = ["lesson", "find", "outside"];
const QUEST_SETUP_URL = `${jsonBase}/setup`;
// 三個主題的關卡數不同：上課用語與尋找物品 5 關，戶外活動 4 關。
const QUEST_STAGE_COUNT = { lesson: 5, find: 5, outside: 4 };
// phase2 的場景與人物是整幅圖（quest-*.css 的 .img-layer），官方用 px（上課用語）
// 或 vw（另外兩個主題）定位，換算成百分比後版面才不會隨視窗寬度跑掉。
const QUEST_STAGE_SIZE = { width: 1000, height: 700 };
// 尋找物品與戶外活動的 phase2 背景圖都是 1000×707，所以 1vw ＝ 0.7071 個舞台高度。
const QUEST_SCENE_RATIO = { width: 1000, height: 707 };
// 上課用語的人物可點範圍：官方 CSS 寫的框（left 50px、寬 250px、top 330px、高 340px）
// 比圖上人物偏右上、也切到桌面。這裡改用官方 target-N-1.png 的不透明範圍量過的值
// （門檻 200 的量測結果），換算成百分比。
const LESSON_TARGET_BOX = { top: 49.1, left: 2.5, width: 28.6, height: 50.7 };
const LESSON_TARGET_BOX_RIGHT = { top: 49.3, left: 66.8, width: 28.6, height: 50.3 };
// 過關時出現在桌上的物件。item-N-img 這個 id 來自官方 CSS 的層名，
// 對應哪張圖不在 JSON 裡，只能照 quest-lesson.css 對應（pen / eraser / broom）。
const QUEST_ITEM_IMAGES = {
  "item-1-img": { file: "pen.png", width: 63, height: 52 },
  "item-2-img": { file: "eraser.png", width: 46, height: 55 },
  "item-3-img": { file: "broom.png", width: 151, height: 313 },
};
// phase2 的人物層：主角一張、每個對象一張，都是 1000×700 的整幅圖。
const QUEST_PLAYER_IMAGE = "player-1.png";
const QUEST_SCENE = { phase1: "1.jpg", phase2: "2.jpg" };

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

// 官方偶爾把族語整句貼在中文欄位後面，例如恆春阿美語（5）／戶外活動第 7 輪的
// textCh 是「沒問題，我們一定會的！Hay， mafana' to kami.」，中文參考答案因此永遠對不上翻譯結果。
//
// 貼上來的殘段跟同一輪的 text 欄位並不完全一樣（少了 "a mina'on"），所以不能用字串比對；
// 改用形態判斷：第一個句號之後若整段沒有中文、卻有拉丁字母，就是上游誤植。
// 全庫只有下列 4 筆命中，而且沒有任何正常中文句是這樣收尾的，不會誤傷：
//   find/2 phase2 target-3.1、lesson/27 phase2 target-2.1、outside/5 phase1 第 8 輪、outside/8 phase2 target-2.2
const CJK_PATTERN = /[一-鿿]/;
function trimDuplicatedIndigenous(chineseText) {
  const text = String(chineseText ?? "").trim();
  const stop = /[。！？]/.exec(text);
  if (!stop) return text;
  const tail = text.slice(stop.index + 1);
  if (!CJK_PATTERN.test(tail) && /[A-Za-z]/.test(tail)) return text.slice(0, stop.index + 1).trim();
  return text;
}

// 人名在中文欄位通常原樣保留，不翻譯，所以可以拿來核對官方有沒有漏改。
// 比對前先正規化：官方同一個名字有時大小寫不同（Panay／panay）、
// 引號用不同的彎引號（Kaynu’／Kaynu'），那不算缺陷。
const APOSTROPHE_PATTERN = /[’‘ʼʻ＇]/g;
function normalizeProperName(value) {
  return String(value ?? "").replace(APOSTROPHE_PATTERN, "'").replace(/\s+/g, "").toLowerCase();
}

// 名字對不上時不顯示那句中文：寧可只留族語與錄音，也不要教錯名字。
// 正確的名字以 phase2 的名牌答案（complete[target]）為準，那才是學習者要貼的牌。
function announcedNameMatches(chineseText, name) {
  if (!chineseText) return false;
  return normalizeProperName(chineseText).includes(normalizeProperName(name));
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
    // 場景圖的副檔名依主題不同（.jpg / .png），所以存完整網址。
    // 之前只存檔名、要靠呼叫端自己拼路徑，拼錯主題的目錄就會 404。
    return {
      id: `${dialectId}-hordequest-${theme.key}-${order}`,
      order,
      speaker: speaker.id,
      speakerName: speaker.name,
      indigenousText,
      chineseText,
      audioUrl: `${audioBase}/${sound}.mp3`,
      imageUrl: `${imageBase}/${theme.key}/${turn.image}`,
      backgroundUrl: `${imageBase}/${theme.key}/${background}`,
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

// 官方座標是 px（寫在 complete.item.css），換算成百分比才不會隨視窗寬度跑掉。
function percentOfStage(px) {
  return `${Number(((parseFloat(px) / QUEST_STAGE_SIZE.width) * 100).toFixed(3))}%`;
}
function heightPercentOfStage(px) {
  return `${Number(((parseFloat(px) / QUEST_STAGE_SIZE.height) * 100).toFixed(3))}%`;
}

// 尋找物品與戶外活動的 setup 用 vw 定位（"28vw"），背景圖是 1000×707。
// 水平：1vw ＝ 舞台寬度的 1%。垂直：1vw ＝ 舞台寬度的 1%，要再除以高寬比換算成高度百分比。
function vwToPercent(value) {
  const vw = parseFloat(value);
  if (!Number.isFinite(vw)) throw new Error(`vw 座標不合法：${value}`);
  return Number((vw).toFixed(3));
}
function vwToHeightPercent(value) {
  const vw = parseFloat(value);
  if (!Number.isFinite(vw)) throw new Error(`vw 座標不合法：${value}`);
  return Number((vw / (QUEST_SCENE_RATIO.height / QUEST_SCENE_RATIO.width)).toFixed(3));
}

// setup 的 target／option 座標鍵不一致（有 top/left、有 right、有 width/height、
// 也有把高度寫成 0 表示不畫），照實轉換並保留原字串單位。
function convertBox(raw, where) {
  if (!raw || typeof raw !== "object") throw new Error(`${where} 的座標不是物件`);
  const box = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "rotate") { box.rotate = String(value); continue; }
    const numeric = vwToPercent(value);
    if (key === "top" || key === "bottom" || key === "height") box[key] = vwToHeightPercent(value);
    else box[key] = numeric;
  }
  return box;
}

// 過關禮物的擺位：官方 complete.item.css 只有 top／left／right／rotate，
// 沒有寬高，尺寸寫在 quest-lesson.css（px）。兩邊合起來才畫得出那個物件。
function itemPlacement(item) {
  const asset = QUEST_ITEM_IMAGES[item.id];
  if (!asset) throw new Error(`不認得過關物件的層名：${item.id}`);
  const css = item.css ?? {};
  const placement = {
    imageUrl: `${imageBase}/lesson/${asset.file}`,
    width: percentOfStage(asset.width),
    height: heightPercentOfStage(asset.height),
  };
  for (const key of ["top", "left", "right"]) {
    if (css[key] !== undefined) placement[key] = key === "top" ? heightPercentOfStage(css[key]) : percentOfStage(css[key]);
  }
  if (css.rotate !== undefined) placement.rotate = String(css.rotate);
  return placement;
}

// 句子比對要先忽略大小寫與多餘空白：官方同一句話在 auto 與 player 兩處的大小寫
// 偶爾不同（魯凱語霧台 28 的「siaaneane ku nagane su」／「Siaaneane ku nagane su」），
// 官方用嚴格比對所以那關玩不過，但我們不必跟著壞。
const WHITESPACE_PATTERN = /\s+/g;
function normalizeSentence(value) {
  return stripTags(value).replace(WHITESPACE_PATTERN, " ").trim().toLowerCase();
}

// 少數方言的 auto 句在 player 清單裡找不到（真的是錯字，例：卑南語 40 第 4 關
// 「aitrul maw」／player 的「aitulr maw」），這種關卡在官方玩到會得到 code 0
// （對方回「什麼？」），等於過不了關。
//
// 這時改用「同一關、同一個對象」的那一句：回應索引 code 在全庫 328 句可完整比對的
// 資料裡 100% 等於關卡序號（1…5），所以 code === 關卡序號 可以安全回推。
// 剛好一筆才採用，不是一筆就停下來——上游若改版，寧可報錯也不要猜。
function findPlayerEntry(player, { text, onlyKey, stageOrder, where }) {
  const wanted = normalizeSentence(text);
  const exact = player.find((item) => normalizeSentence(item?.text) === wanted);
  if (exact) return { entry: exact, repaired: false };
  const candidates = player.filter((item) => (
    String(item?.code ?? "") === String(stageOrder)
    && (item?.only ? String(item.only) : null) === onlyKey
  ));
  if (candidates.length !== 1) {
    throw new Error(`${where} 的句子在 player 清單裡找不到（大小寫無關），而且同關同對象的候選有 ${candidates.length} 筆：${stripTags(text)}`);
  }
  return { entry: candidates[0], repaired: true };
}

// 一個對象在某一關要說的句子，加上對方的那句回應。
// 回應的索引是 code：官方 player[].code 對到 phase2[target][code]。
// 回應 0（"什麼？"／"聽不懂？"）是答錯或問錯人時的 rebounds，本檔不收，
// 因為答錯時我們要讓學習者重試，不該拿「聽不懂」當回饋。
function questLine(phase2, player, { targetId, onlyKey, stageOrder, sentenceText, where, repairs }) {
  const text = stripTags(sentenceText);
  if (!text) throw new Error(`${where} 對 ${targetId} 沒有要說的句子`);
  const { entry, repaired } = findPlayerEntry(player, { text, onlyKey, stageOrder, where });
  if (repaired) {
    repairs.push({ stageOrder, targetId, auto: text, used: stripTags(entry.text) });
  }
  const code = String(entry.code ?? "");
  const reply = phase2[targetId]?.[code];
  if (!reply?.text || !SOUND_PATTERN.test(String(reply.sound ?? ""))) {
    throw new Error(`${where} 對 ${targetId} 找不到 code ${code} 的回應台詞`);
  }
  return {
    targetId,
    code,
    // only 表示這句只能對某一個人說；對其他人說官方會判成答錯，我們也要判錯。
    onlyTargetId: entry.only ? String(entry.only) : null,
    // 採用 player 清單裡那句的文字當標準答案（不是 auto 那句錯字），
    // 因為 player 才有對應的錄音，學習者要對照的是那個聲音。
    indigenousText: stripTags(entry.text),
    displayText: stripTags(entry.textAb) || stripTags(entry.text),
    chineseText: trimDuplicatedIndigenous(stripTags(entry.textCh)),
    audioUrl: `${audioBase}/${stripTags(entry.sound)}.mp3`,
    reply: {
      indigenousText: stripTags(reply.text),
      chineseText: trimDuplicatedIndigenous(stripTags(reply.textCh)),
      audioUrl: `${audioBase}/${stripTags(reply.sound)}.mp3`,
    },
  };
}

// 上課用語的 phase2：5 關，兩個對象，過關條件有兩種。
//   drag：先問出兩個同學的名字，再把名牌放到對的人桌上（choices 5 選 2）
//   ask：跟對的人問對的句子（complete.target／complete.code 指定）
function extractLessonQuests(json, setupStages, dialectId, dialectName) {
  const where = `${dialectName}（${dialectId}）／上課用語 phase2`;
  const nameMismatches = [];
  // auto 句與 player 句對不上的紀錄（上游錯字），要寫進 dataset 的說明。
  const repairs = [];
  const phase2 = json?.data?.phase2;
  if (!phase2) throw new Error(`${where} 沒有 phase2`);
  if (!Array.isArray(phase2.stage) || phase2.stage.length !== QUEST_STAGE_COUNT.lesson) {
    throw new Error(`${where} 的關卡預期 ${QUEST_STAGE_COUNT.lesson} 關，實得 ${phase2?.stage?.length ?? 0} 關`);
  }
  const targetIds = Object.keys(phase2).filter((key) => key.startsWith("target-")).sort();
  if (targetIds.length !== 2) throw new Error(`${where} 預期 2 個對象，實得 ${targetIds.length}：${targetIds.join(",")}`);
  if (!Array.isArray(phase2.player) || phase2.player.length === 0) throw new Error(`${where} 沒有 player 句型`);
  if (!Array.isArray(setupStages) || setupStages.length !== QUEST_STAGE_COUNT.lesson) {
    throw new Error(`上課用語的 setup 檔預期 ${QUEST_STAGE_COUNT.lesson} 關，實得 ${setupStages?.length ?? 0} 關`);
  }

  // 可點範圍一併放進資料，畫面就不用為上課用語寫死 CSS 座標。
  const targets = targetIds.map((id) => ({
    id,
    imageUrl: `${imageBase}/lesson/${id}-1.png`,
    box: id === "target-1" ? { ...LESSON_TARGET_BOX } : { ...LESSON_TARGET_BOX_RIGHT }
  }));

  const quests = phase2.stage.map((stage, index) => {
    const order = index + 1;
    const at = `${where} 第 ${order} 關`;
    const quest = stripTags(setupStages[index]?.setup?.quest);
    const tips = stripTags(setupStages[index]?.setup?.tips);
    if (!quest) throw new Error(`${at} 的任務說明是空的`);
    if (!Array.isArray(stage.words) || stage.words.length === 0) throw new Error(`${at} 沒有提示詞卡`);

    // auto 是字串時代表兩個對象要說同一句（沒有指定對象）；是物件時每個對象一句（會帶對方的名字）。
    const auto = stage.auto;
    const perTarget = typeof auto === "string";
    const lines = targetIds.map((targetId) => questLine(phase2, phase2.player, {
      targetId,
      onlyKey: perTarget ? null : targetId,
      stageOrder: order,
      sentenceText: perTarget ? auto : auto?.[targetId],
      where: at,
      repairs,
    }));

    const complete = stage.complete;
    const type = complete?.type;
    let goal;
    if (type === "drag") {
      const choices = (complete.drag ?? []).map((value) => stripTags(value)).filter(Boolean);
      const answers = {};
      for (const targetId of targetIds) {
        const answer = stripTags(complete[targetId]);
        if (!answer) throw new Error(`${at} 的名牌答案缺少 ${targetId}`);
        if (!choices.includes(answer)) throw new Error(`${at} 的名牌答案 ${answer} 不在候選名單裡`);
        answers[targetId] = answer;
      }
      goal = { kind: "nameTags", choices, answers };
      // 只有第 1 關是自我介紹，該拿來核對名字。第 2 關的名牌是地名，
      // 官方本來就把它翻成中文（「Kenuy」→「根努夷」），拿中文核對會全部誤判。
      if (order === 1) {
        if (type !== "drag") throw new Error(`${at} 應該是自我介紹關（名牌），實得 ${type}`);
        for (const line of lines) {
          const name = answers[line.targetId];
          if (announcedNameMatches(line.reply.chineseText, name)) continue;
          nameMismatches.push({ targetId: line.targetId, name, chineseText: line.reply.chineseText });
          line.reply.chineseText = null;
        }
      }
    } else if (type === "ask") {
      const targetId = String(complete.target ?? "");
      if (!targetIds.includes(targetId)) throw new Error(`${at} 的過關對象 ${targetId} 不在場上`);
      const code = String(complete.code ?? "");
      const line = lines.find((item) => item.targetId === targetId);
      if (!line || line.code !== code) {
        throw new Error(`${at} 的過關條件是對 ${targetId} 說 code ${code}，但該句的 code 是 ${line?.code ?? "無"}`);
      }
      goal = { kind: "askRightPerson", targetId, code, reward: itemPlacement(complete.item ?? {}) };
    } else {
      throw new Error(`${at} 的過關條件類型不認得：${type}`);
    }

    return {
      id: `${dialectId}-hordequest-lesson-quest-${order}`,
      order,
      quest,
      tips,
      goal,
      // 詞卡只當「看提示」時的字彙提示，不給順序，否則等於直接送答案。
      hintWords: stage.words.map((value) => stripTags(value)).filter(Boolean),
      targets,
      lines,
    };
  });

  return {
    sceneUrl: `${imageBase}/lesson/${QUEST_SCENE.phase2}`,
    playerImageUrl: `${imageBase}/lesson/${QUEST_PLAYER_IMAGE}`,
    quests,
    // 官方漏改名字的自我介紹，記下來給 dataset 的 notes 與 README 用。
    nameMismatches,
    // auto 句在 player 清單裡找不到、改用同關同對象那一句的紀錄。
    sentenceRepairs: repairs,
  };
}

// 尋找物品與戶外活動的 phase2：玩法是「先問人得到線索，再在場景裡挑出正確的東西」。
// 官方把整個玩法放在共用的 setup 檔（每關的圖層、可點位置、過關條件），
// 方言別 JSON 只有句子（auto／player／target 回應）。兩邊合起來才是完整的一關。
//
// 官方用 img/{theme}/{關卡序號 + 1}-{物件}.png 取圖（關卡序號是 1-based，
// 所以第 1 關取 2-*.png），不是 {關卡序號}-*.png——照字面組網址會全部 404。
function sceneAssetUrl(themeKey, order, name) {
  return `${imageBase}/${themeKey}/${order + 1}${name ? `-${name}` : ""}.png`;
}

// setup 的 target 座標多半只給「人的上角」（top+left 或 top+right），
// 沒有寬高——官方 quest-find.css／quest-outside.css 的 .target 也沒有尺寸，
// 所以那兩個主題的對象在官方是 0×0、根本點不到，連「問對人才解鎖」都走不到。
// 這裡用官方 target-N.png 的不透明範圍量過的典型值（寬 13～21%、高 46～68%）
// 補一個預設尺寸，並把 right／bottom 換算成 left／top，讓框真的罩在人物上。
const DEFAULT_TARGET_BOX = { width: 20, height: 60 };

function sceneTargets(phase2, setupStage, themeKey, order, where, dropped) {
  const ids = Object.keys(phase2).filter((key) => key.startsWith("target-")).sort();
  if (ids.length === 0) throw new Error(`${where} 沒有對象`);
  const boxes = setupStage?.setup?.target ?? [];
  if (boxes.length !== ids.length) {
    throw new Error(`${where} 的可點位置有 ${boxes.length} 個，對象有 ${ids.length} 個，對不上`);
  }
  const targets = [];
  ids.forEach((id, index) => {
    const raw = boxes[index] ?? {};
    // 先換算官方給的座標，缺寬高才補預設值（預設值已經是百分比，不能再換算一次）。
    const box = convertBox(raw, `${where} ${id}`);
    const width = box.width ?? DEFAULT_TARGET_BOX.width;
    const height = box.height ?? DEFAULT_TARGET_BOX.height;
    // 戶外活動第一關的第三個人官方設成 width 0、height 0，而且那個人剛好沒有
    // 這一句的回應（上游漏了一筆），所以這一關不提供他。
    if (width <= 0 || height <= 0) {
      dropped.push({ order, targetId: id, reason: "官方設成不可點" });
      return;
    }
    // 官方用 right／bottom 定位時只給了人的上角，先換算成 left／top 再夾住。
    if (raw.right !== undefined && raw.left === undefined) {
      box.left = Number((100 - box.right - width).toFixed(3));
      delete box.right;
    }
    if (raw.bottom !== undefined && raw.top === undefined) {
      box.top = Number((100 - box.bottom - height).toFixed(3));
      delete box.bottom;
    }
    // 補上高度後可能超出場景，夾住：框落到畫面外等於點不到。
    box.width = Math.min(width, 100 - (box.left ?? 0));
    box.height = Math.min(height, 100 - (box.top ?? 0));
    if (box.width <= 0 || box.height <= 0) {
      dropped.push({ order, targetId: id, reason: "補上尺寸後超出場景" });
      return;
    }
    targets.push({ id, imageUrl: sceneAssetUrl(themeKey, order, id), box });
  });
  return targets;
}

// take 的候選是 [id, top, left, width, height]（vw）；select 的候選只有 id，
// 官方是把它們畫成一個選項清單（#respond-area），不是放在場景裡。
function sceneOptions(themeKey, order, complete, kind, where) {
  const list = complete.option ?? [];
  if (list.length === 0) throw new Error(`${where} 沒有候選物件`);
  return list.map((entry) => {
    if (typeof entry === "string") {
      return { id: entry, imageUrl: sceneAssetUrl(themeKey, order, entry), box: null };
    }
    if (!Array.isArray(entry) || entry.length !== 5) throw new Error(`${where} 的候選格式不認得：${JSON.stringify(entry)}`);
    const [id, top, left, width, height] = entry;
    return {
      id,
      imageUrl: sceneAssetUrl(themeKey, order, id),
      box: convertBox({ top, left, width, height }, `${where} ${id}`)
    };
  });
}

function extractSceneQuests(json, setupStages, theme, dialectId, dialectName) {
  const where = `${dialectName}（${dialectId}）／${theme.name} phase2`;
  const expected = QUEST_STAGE_COUNT[theme.key];
  const phase2 = json?.data?.phase2;
  if (!phase2) throw new Error(`${where} 沒有 phase2`);
  if (!Array.isArray(phase2.stage) || phase2.stage.length !== expected) {
    throw new Error(`${where} 的關卡預期 ${expected} 關，實得 ${phase2?.stage?.length ?? 0} 關`);
  }
  if (!Array.isArray(phase2.player) || phase2.player.length === 0) throw new Error(`${where} 沒有 player 句型`);
  if (!Array.isArray(setupStages) || setupStages.length !== expected) {
    throw new Error(`${theme.name} 的 setup 檔預期 ${expected} 關，實得 ${setupStages?.length ?? 0} 關`);
  }

  const repairs = [];
  const droppedTargets = [];
  const quests = phase2.stage.map((stage, index) => {
    const order = index + 1;
    const at = `${where} 第 ${order} 關`;
    const setupStage = setupStages[index];
    const setup = setupStage?.setup ?? {};
    const complete = setupStage?.complete ?? {};
    const type = complete.type;

    // 最後一關是結語：沒有任務說明、沒有人也沒有句子，只有官方寫好的收尾文字。
    if (type === "end") {
      const endText = stripTags(complete.text);
      if (!endText) throw new Error(`${at} 的結語是空的`);
      if ((setup.img ?? []).length || (setup.target ?? []).length) {
        throw new Error(`${at} 是結語關，不該有圖層或對象`);
      }
      return {
        id: `${dialectId}-hordequest-${theme.key}-quest-${order}`,
        order,
        quest: endText,
        tips: "",
        goal: { kind: "end", prompt: null, options: [], answers: [], lock: null, unlock: null, box: null, backgroundUrl: null, endText },
        closing: null,
        buylist: null,
        hintWords: [],
        sceneUrl: sceneAssetUrl(theme.key, order, null),
        props: [],
        targets: [],
        lines: [],
      };
    }

    const quest = stripTags(setup.quest);
    if (!quest) throw new Error(`${at} 的任務說明是空的`);
    const targets = sceneTargets(phase2, setupStage, theme.key, order, at, droppedTargets);
    // 這一關問每個人的句子都一樣（auto 是字串），所以對象綁定為 null。
    const lines = targets.map((target) => questLine(phase2, phase2.player, {
      targetId: target.id,
      onlyKey: null,
      stageOrder: order,
      sentenceText: stage.auto,
      where: at,
      repairs
    }));

    let goal;
    if (type === "select" || type === "take") {
      const options = sceneOptions(theme.key, order, complete, type, at);
      const answers = (Array.isArray(complete.answer) ? complete.answer : [complete.answer]).map((value) => stripTags(value));
      if (answers.includes(undefined)) throw new Error(`${at} 的正確答案不是 id`);
      for (const answer of answers) {
        if (!options.some((option) => option.id === answer)) throw new Error(`${at} 的正確答案 ${answer} 不在候選裡`);
      }
      if (type === "take" && options.some((option) => !option.box)) {
        throw new Error(`${at} 是 take 關，候選應該都有場景座標`);
      }
      const condition = setupStage.condition;
      goal = {
        kind: type,
        prompt: null,
        options,
        answers,
        // take 關有一個選項被鎖住，問對的人才解鎖（官方 condition.lock）。
        lock: type === "take" && condition?.lock ? stripTags(condition.lock) : null,
        unlock: null,
        box: null,
        backgroundUrl: null
      };
      if (condition?.target) {
        const line = lines.find((item) => item.targetId === String(condition.target));
        if (!line) throw new Error(`${at} 的解鎖對象 ${condition.target} 不在場上`);
        if (String(condition.code) !== line.code) {
          throw new Error(`${at} 的解鎖條件是對 ${condition.target} 說 code ${condition.code}，但該句的 code 是 ${line.code}`);
        }
        goal.unlock = { targetId: String(condition.target), code: String(condition.code) };
      }
    } else if (type === "click") {
      const position = complete.position;
      if (!Array.isArray(position) || position.length !== 4) throw new Error(`${at} 的 click 座標不認得`);
      const [top, left, width, height] = position;
      if (!complete.target) throw new Error(`${at} 的 click 缺少目標 id`);
      goal = {
        kind: "click",
        prompt: null,
        options: [],
        answers: [stripTags(complete.target)],
        lock: null,
        unlock: null,
        box: convertBox({ top, left, width, height }, `${at} click`),
        backgroundUrl: complete.background ? `${imageBase}/${theme.key}/${complete.background}` : null
      };
    } else if (type === "select&order") {
      const options = sceneOptions(theme.key, order, complete, type, at);
      const answer = stripTags(complete.answer);
      if (!options.some((option) => option.id === answer)) throw new Error(`${at} 的正確答案 ${answer} 不在候選裡`);
      // 官方是拖詞卡排出這句話；我們改成學者自己說出這句（詞彙由 hintWords 提示），
      // 所以把那句話存成 prompt，判定比對它。
      const prompt = stripTags(stage.complete?.text);
      if (!prompt) throw new Error(`${at} 缺少要說的句子（stage.complete.text）`);
      if (!SOUND_PATTERN.test(String(stage.complete?.sound ?? ""))) throw new Error(`${at} 的完成音檔路徑不合法`);
      goal = {
        kind: "selectAndSpeak",
        prompt,
        promptAudioUrl: `${audioBase}/${stripTags(stage.complete.sound)}.mp3`,
        options,
        answers: [answer],
        lock: null,
        unlock: null,
        box: null,
        backgroundUrl: null
      };
    } else if (type === "end") {
      throw new Error(`${at} 的結語關應該在上面就處理掉了`);
    } else {
      throw new Error(`${at} 的過關條件類型不認得：${type}`);
    }

    // 有些關卡完成時會有一句收尾台詞（官方放在方言別 JSON 的 stage.complete.text/sound）。
    const closing = stage.complete?.text ? {
      text: trimDuplicatedIndigenous(stripTags(stage.complete.text)),
      audioUrl: `${audioBase}/${stripTags(stage.complete.sound)}.mp3`
    } : null;
    if (closing && !SOUND_PATTERN.test(String(stage.complete.sound ?? ""))) {
      throw new Error(`${at} 的結語音檔路徑不合法`);
    }

    return {
      id: `${dialectId}-hordequest-${theme.key}-quest-${order}`,
      order,
      quest,
      tips: stripTags(setup.tips),
      goal,
      closing,
      // 戶外活動第一關有一張購物清單（官方是把它顯示出來，後來註解掉了）。
      buylist: Array.isArray(stage.buylist) ? stage.buylist.map((value) => stripTags(value)).filter(Boolean) : null,
      hintWords: (stage.words ?? []).map((value) => stripTags(value)).filter(Boolean),
      sceneUrl: sceneAssetUrl(theme.key, order, null),
      props: (setup.img ?? []).filter(Boolean).map((id) => ({ id, imageUrl: sceneAssetUrl(theme.key, order, id) })),
      targets,
      lines,
    };
  });

  return {
    sceneUrl: null,
    playerImageUrl: null,
    quests,
    nameMismatches: [],
    sentenceRepairs: repairs,
    droppedTargets,
  };
}

console.log(`開始下載 ${THEMES.length} 個主題 JSON：${selectedDialects.length} 個方言`);

// phase2 的任務說明放在共用的 setup 檔，42 個方言同一份，先抓一次。
const questSetup = {};
for (const key of QUEST_THEMES) {
  const url = `${QUEST_SETUP_URL}/${key}.json`;
  const { text } = await fetchValidated(url);
  const { json } = parseDialogueJson(text);
  if (!Array.isArray(json)) throw new Error(`${url} 應該是關卡陣列`);
  questSetup[key] = json;
}

let done = 0;
const fetched = await mapLimit(selectedDialects, 3, async ([dialectId, ethnicity, dialectName]) => {
  const themes = [];
  for (const theme of THEMES) {
    const url = `${jsonBase}/${paddedId(dialectId)}/${theme.key}.json`;
    const { bytes, text } = await fetchValidated(url);
    const { json, sanitized } = parseDialogueJson(text);
    const entry = { theme, url, bytes, sanitized, ...extractDialogue(json, theme, dialectId, dialectName) };
    // 上課用語的 phase2 是拖名牌、另外兩個是「問人 → 挑出正確的東西」，資料形狀不同。
    if (QUEST_THEMES.includes(theme.key)) {
      Object.assign(entry, theme.key === "lesson"
        ? extractLessonQuests(json, questSetup[theme.key], dialectId, dialectName)
        : extractSceneQuests(json, questSetup[theme.key], theme, dialectId, dialectName));
    }
    themes.push(entry);
  }
  done += 1;
  if (done % 10 === 0) console.log(`  方言 ${done}/${selectedDialects.length}`);
  return { dialectId, ethnicity, dialectName, themes };
});

if (verifyAudio !== "none") {
  const all = fetched.flatMap((entry) => entry.themes.flatMap((item) => [
    ...item.turns.map((turn) => turn.audioUrl),
    // 任務關卡每句都有「你說的」與「對方回的」兩支錄音，漏驗會在上線後才發現。
    ...(item.quests ?? []).flatMap((quest) => quest.lines.flatMap((line) => [line.audioUrl, line.reply.audioUrl])),
  ]));
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
      quests: item.quests?.slice(0, 1),
    })),
  }, null, 2));
  const total = fetched.reduce((sum, entry) => sum + entry.themes.reduce((n, item) => n + item.turns.length, 0), 0);
  const questTotal = fetched.reduce((sum, entry) => sum + entry.themes.reduce((n, item) => n + (item.quests?.length ?? 0), 0), 0);
  console.log(`JSON ${fetched.length * THEMES.length} 份，共 ${total} 輪對話、${questTotal} 個任務關卡，所有數量與欄位斷言通過。`);
  process.exit(0);
}

if (selectedDialects.length !== dialects.length) {
  throw new Error("只有抓取全部 42 個方言時才允許寫入；部分抓取請加 --dry-run");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "dialects"), { recursive: true });
await mkdir(path.join(outputRoot, "raw", "setup"), { recursive: true });

const files = [];
for (const theme of THEMES) {
  await mkdir(path.join(outputRoot, "raw", theme.key), { recursive: true });
}
// 共用的任務說明檔也留一份，來源可追溯。
for (const key of QUEST_THEMES) {
  const url = `${QUEST_SETUP_URL}/${key}.json`;
  const { bytes } = await fetchValidated(url);
  await writeFile(path.join(outputRoot, `raw/setup/${key}.json`), bytes);
  files.push({ url, path: `raw/setup/${key}.json`, bytes: bytes.length, sha256: sha256(bytes) });
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
      // quests：官方 phase2 的任務關卡。上課用語是拖名牌、另外兩個是「問人 → 挑東西」，
      // 詞卡都改成由錄音或打字取代。sceneUrl／playerImageUrl 只有上課用語有整幅人物圖。
      ...(item.quests ? {
        ...(item.sceneUrl ? { questSceneUrl: item.sceneUrl } : {}),
        ...(item.playerImageUrl ? { questPlayerImageUrl: item.playerImageUrl } : {}),
        quests: item.quests
      } : {}),
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

// 官方漏改名字的地方寫成一句可讀的說明，不要只留數字。
const nameMismatchSummary = (() => {
  const rows = [];
  for (const entry of fetched) {
    for (const item of entry.themes) {
      for (const bad of item.nameMismatches ?? []) {
        rows.push(`${entry.dialectName}（${entry.dialectId}）${bad.targetId} 的名字是 ${bad.name}，官方中文卻寫「${bad.chineseText}」`);
      }
    }
  }
  if (rows.length === 0) return "無";
  return `上課用語第 1 關有 ${rows.length} 處自我介紹的中文沿用了別的名字，已把該句中文收成 null（只留族語與錄音），正確名字以名牌答案為準：${rows.join("；")}。`;
})();

const sentenceRepairSummary = (() => {
  const rows = [];
  for (const entry of fetched) {
    for (const item of entry.themes) {
      for (const bad of item.sentenceRepairs ?? []) {
        rows.push(`${entry.dialectName}（${entry.dialectId}）第 ${bad.stageOrder} 關對 ${bad.targetId} 的 auto 句「${bad.auto}」不在 player 清單裡，改用「${bad.used}」`);
      }
    }
  }
  if (rows.length === 0) return "無";
  return `上課用語有 ${rows.length} 處 auto 句在 player 清單裡找不到（上游錯字，官方玩到會得到錯誤回應），已改用同關同對象、帶錄音的那一句：${rows.join("；")}。句子比對忽略大小寫與多餘空白。`;
})();

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
    ...(QUEST_THEMES.includes(theme.key)
      ? { questsPerDialect: QUEST_STAGE_COUNT[theme.key], questCount: dialects.length * QUEST_STAGE_COUNT[theme.key] }
      : {}),
  })),
  recordCount: dialects.length * THEMES.reduce((sum, theme) => sum + theme.turnCount, 0),
  questCount: dialects.length * QUEST_THEMES.reduce((sum, key) => sum + QUEST_STAGE_COUNT[key], 0),
  dialects: dialects.map(([id, ethnicity, name]) => ({ id, ethnicity, name })),
  notes: {
    speakers: "角色由官方說話者圖檔辨識：boy.png 與 boy-1.png 都是主角，boy-2.png 是哥哥，girl.png 是同學，mom.png 是媽媽。上課用語與尋找物品是兩人對話，戶外活動是三人。",
    themeNameKey: "上課用語與尋找物品的主題名在 theme 欄位，戶外活動在 name 欄位，這是上游的不一致。",
    duplicatedChinese: "恆春阿美語（5）戶外活動第 7 輪，官方把族語整句貼在中文欄位後面；下載時把重複的族語扣掉，只留中文參考答案。",
    malformedJson: "茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，下載時補上；分片的 sanitized 陣列對應到主題順序，只有 lesson 為 true。phase1 對話未改動。",
    phase2: "官方 phase2 是「拖詞卡拼句子 → 選對象 → 提問」的任務關卡，三個主題都有。本單元三個主題都收了（quests，共 588 關）：上課用語是放名牌與問對的人，尋找物品與戶外活動是「問人拿線索 → 挑出正確的東西」，過關條件有 select／take／click／selectAndSpeak／end。詞卡只留作提示詞彙、句子改由錄音或打字產生。",
    questSceneNaming: "官方取圖寫的是 img/{theme}/{關卡序號 + 1}[-{物件}].png，關卡序號從 1 開始，所以第 1 關取 2-*.png。照關卡序號組網址會全部 404——本單元一開始就是這樣，差點誤判成官方沒有素材。",
    questTargetBox: "尋找物品與戶外活動的 setup.target 只給人物的上角（top+left 或 top+right），沒有寬高，官方 quest-find.css／quest-outside.css 的 .target 也沒有尺寸，所以那兩個主題的對象在官方是 0×0、點不到，連「問對人才解鎖」都走不到。本單元用官方人物 PNG 的不透明範圍量過的典型值（寬 20%、高 60%）補上，並把 right／bottom 換算成 left／top，再夾住不讓框超出場景。",
    questDroppedTargets: "戶外活動第一關的第三個人，官方把可點範圍設成 width 0、height 0，而且那個人剛好沒有這一句的回應（上游漏了一筆，42 個方言都一樣），所以這一關不提供他。",
    questTextSource: "任務說明有兩份：共用的 json/setup/{theme}.json（官方頁面顯示用）與方言別 phase2.stage[i].quest／tips（官方未拿來顯示）。本單元的 quest／tips 取自共用檔，句子與過關條件取自方言別 JSON。",
    questItemLayers: "過關時出現在桌上的物件（pen／eraser／broom）不在 JSON 裡，對應關係來自官方 quest-lesson.css 的層名 item-1-img／item-2-img／item-3-img；官方 px 座標已換算成百分比。",
    questPlayerLines: "上課用語的 player 句型帶 only 欄位，表示這句只能對某一個人說（例如「Kacaw 借我筆」只能問 Kacaw），對其他人說官方會判錯。已存成 lines[].onlyTargetId。",
    questSoundPaths: "phase2 的 player 與 target 錄音是另一組 sound 路徑，與 phase1 不同；回應索引是 code，0（什麼？／聽不懂？）是答錯時的 rebounds，本單元不收。",
    questNameMismatch: nameMismatchSummary,
    questSentenceRepair: sentenceRepairSummary,
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
- \`raw/setup/{theme}.json\`：官方共用的任務說明檔（phase2 的文案來源）。
- \`manifest.json\`：來源 URL、檔案大小及 SHA-256。
- \`LICENSE.md\`：授權、標示與使用限制。

| 主題 | 每方言輪數 | 每方言任務關卡 |
| --- | --- | --- |
${THEMES.map((theme) => `| ${theme.name}（\`${theme.key}\`） | ${theme.turnCount} | ${QUEST_THEMES.includes(theme.key) ? QUEST_STAGE_COUNT[theme.key] : "—"} |`).join("\n")}

角色由官方說話者圖檔辨識：\`boy.png\` 與 \`boy-1.png\` 是主角，\`boy-2.png\` 是哥哥，\`girl.png\` 是同學，\`mom.png\` 是媽媽。
上課用語與尋找物品是兩人對話，戶外活動是三人，逐輪交替發話。

## 任務關卡（官方 phase2）

官方互動模組的 phase2 是「拖詞卡拼句子 → 選對象 → 提問／在場景裡挑東西」：詞卡直接送出了
答案的詞彙與順序。三個主題的 phase2 都收（\`themes[].quests\`），詞卡只留作提示（\`hintWords\`，不給順序），
句子改由錄音或打字產生，判定比對 \`lines[].indigenousText\`。

上課用語是拖名牌與問對的人；另外兩個主題是「問人拿線索 → 挑出正確的東西」，過關條件有
\`select\`／\`take\`／\`click\`／\`selectAndSpeak\`／\`end\` 五種。
圖檔索引是**關卡序號 + 1**（官方寫法），照關卡序號組網址會全部 404。

每關的結構：

| 欄位 | 說明 |
| --- | --- |
| \`quest\` / \`tips\` | 任務說明與提示，取自共用的 \`json/setup/{theme}.json\` |
| \`hintWords\` | 官方詞卡，只在按下「看提示」時出現，不含順序 |
| \`targets\` | 在場的人，附可點範圍（\`box\`，百分比）與立像網址 |
| \`lines[]\` | 對每個對象要說的句子：族語、帶標點的顯示用文字、中文、音檔、\n以及對方的回應（\`reply\`）。\`onlyTargetId\` 表示這句只能對某個人說 |
| \`goal\` | 過關條件：\`nameTags\`（問完兩個人後把名牌放對桌）或 \`askRightPerson\`（問對的人） |

\`goal.kind === "nameTags"\` 的 \`answers\` 是每位同學的正確名牌，\`choices\` 是五張候選名牌。
\`goal.kind === "askRightPerson"\` 的 \`reward\` 是過關後出現在桌上的物件（筆／橡皮擦／掃把）與其百分比座標。

尋找物品與戶外活動另有 \`sceneUrl\`（每關自己的背景圖）、\`props\`（要疊上去的圖層）、
\`goal.options\`（候選物件與座標）、\`goal.lock\`／\`goal.unlock\`（要先問對人才拿得到的東西）、
\`goal.prompt\`（要學者自己說的那句話）與 \`buylist\`（購物清單）。

**音檔與圖片都不入庫。** 每輪帶 \`audioUrl\` 與 \`imageUrl\`，執行時由 \`web.klokah.tw\` 直接播放與熱連結。

茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，整份無法解析；下載時補上逗號，
分片的 \`sanitized\` 陣列對應到主題順序，只有 \`lesson\` 為 \`true\`，phase1 的對話文字沒有改動。

上游的小不一致：上課用語與尋找物品的主題名在 \`theme\` 欄位，戶外活動在 \`name\` 欄位。

## 收錄範圍

三個主題都收 \`phase1\` 的對話，也都收 \`phase2\` 的任務關卡（見上）。

## 重新下載

\`\`\`
node scripts/download-hordequest.mjs
\`\`\`

其他參數：\`--dry-run --dialects=1,31,42\`、\`--verify-audio\`、\`--verify-audio=all\`。
`;
await writeFile(path.join(outputRoot, "README.md"), readme, "utf8");

console.log(`完成：${shards.length} 個方言、${dataset.recordCount} 輪對話、${dataset.questCount} 個任務關卡。`);