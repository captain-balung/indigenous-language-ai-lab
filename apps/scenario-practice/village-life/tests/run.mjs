import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  THEME_ORDER, addToBasket, buildExchanges, chineseKey, dialogueTheme, indigenousKey,
  isPersonalTurn, judgedCount, judgeBasket, judgeQuestLine, judgeQuestPick, judgeQuestPrompt,
  judgeReply, mineCount, openingSpeaker, placeNameTag, questHint, questIsComplete,
  questLineFor, questOptionLocked, questOptions, questPack, questProgress, questResultDetail,
  questResultHeadline, questSceneOptions, respondableRoles, resultDetail, resultHeadline,
  tally, tallyLabel, targetLabel, themeOf
} from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = read("apps/scenario-practice/village-life/index.html");
const appSource = read("apps/scenario-practice/village-life/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("部落大小事"));
assert.ok(page.includes("情境應用 · MISSION 01"));
assert.ok(page.includes("想練哪一個場景？"));
// 角色欄位已併入場景區，只有真的能選時才出現切換鈕；單一角色時不給假的選擇。
assert.ok(!page.includes("你要當哪一位？"), "角色欄位不應再單獨存在");
assert.ok(page.includes('id="role-picker"'));
assert.ok(page.includes("你要回應誰？"));
assert.ok(appCode.includes("if (roles.length < 2)"), "只有一個可扮演角色時不顯示切換鈕");
assert.ok(appCode.includes("ui.rolePicker.hidden = true"));
// 介面不用劇場式的說法。
assert.ok(!/演哪一齣|哪一齣|演出/.test(page + appSource), "介面不得使用劇場比喻");
assert.ok(page.includes('id="theme-grid"'));
assert.ok(page.includes('id="role-grid"'));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'));
assert.ok(page.includes('href="/apps/scenario-practice/village-life/styles.css"'));
assert.ok(page.includes('src="/apps/scenario-practice/village-life/app.mjs"'));
assert.ok(!page.includes('href="styles.css"'));
assert.ok(page.includes("互動模組"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(page.includes("web.klokah.tw"), "頁面必須揭露教材音檔與場景圖由第三方載入");
assert.ok(appCode.includes("judgeReply"));
assert.ok(appCode.includes("transcribe") && appCode.includes("translateToZh"));
assert.ok(appCode.includes("prefers-reduced-motion"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode), "不得寫入瀏覽器儲存");
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource), "介面不得使用 emoji");
assert.ok(!/\bpoints\b/.test(appCode), "情境練習不顯示考試配分");

// STEP 1 與 STEP 2 是兩個畫面：開始後設定區要收起來，另留返回按鈕。
assert.ok(page.includes('id="setup"'));
assert.ok(page.includes('id="back-setup"'));
assert.ok(page.includes("回到設定"));
assert.ok(appCode.includes("ui.setup.hidden = true"), "開始情境後必須收起 STEP 1");
// 對方的台詞播完才解鎖「下一句」，而且不能只靠 ended：自動播放被擋時要有人工逾時與錯誤處理，
// 否則第 1 句會變成死路，使用者永遠走不到自己該說的那一句。
assert.ok(appCode.includes("unlockPartnerTurn"));
assert.ok(appCode.includes('addEventListener("ended"'));
assert.ok(appCode.includes("armPartnerUnlock(20000)"), "音檔沒有播完時要有看門計時器");
assert.ok(/ui\.player\.addEventListener\("error"[\s\S]{0,200}unlockPartnerTurn\(\)/.test(appCode), "音檔壞掉也要能往下走");
assert.ok(appCode.includes("play.catch"), "自動播放被擋要自己解鎖");
// 換你說的那一句不能先露出教材中文：先看到等於看到答案。
assert.ok(page.includes('id="record-note"'));
assert.ok(appCode.includes('ui.zh.textContent = exchange.mine ? "" : exchange.chineseText'), "自己的句子不能預先顯示中文");
assert.ok(appCode.includes("ui.zh.hidden = exchange.mine"));
assert.ok(appCode.includes("turnHint(exchange)"), "自己的句子改用提示取代答案");
// 麥克風不能用要能退回打字，不能把這一句判成結束。
assert.ok(appCode.includes("ui.recordNote.textContent"));
assert.ok(!/denied[\s\S]{0,160}showResult/.test(appCode), "麥克風權限被拒不得結束這一句");
// 失敗（辨識／翻譯中斷）不能鎖住這一句，否則「重試判定」按了不會有任何反應。
assert.ok(
  /function showResult[\s\S]*?\n}/.test(appCode) && !/function showResult[\s\S]*?graded = true[\s\S]*?\n}/.test(appCode),
  "失敗路徑不得設 graded，否則重試判定會失效"
);
assert.ok(appCode.includes("runExchange = createSingleFlight"), "送出流程要單飛，避免連點重複送出");
// 逐句回答紀錄會一直往下撐開、把當下的場景擠出畫面，已經移除。
assert.ok(!page.includes("dialogue-log"), "不得再有逐句回答紀錄");
assert.ok(!appCode.includes("appendLog"));
assert.ok(!appCode.includes("ui.log"));
// 每句都會比對的時候不必說「其中 N 句會比對意思」，那是預設行為。
assert.ok(appCode.includes("roleNote"), "角色說明要共用同一個判斷");
assert.ok(!/句會比對意思/.test(appCode + page), "全部都比對時不得顯示這句");
// 開始前不要先丟細節：角色卡與狀態列只寫要說幾句，不判對錯的留到送出後再說。
assert.ok(!/句要說，其中/.test(appCode), "角色說明不要預告不判對錯的句子");
assert.ok(!/你說\d+ 句，其中/.test(appCode), "狀態列只寫要說幾句");
// 「只當參考」太縮了，介面一律用白話。
assert.ok(!/只當參考/.test(appCode + page), "介面不得使用「只當參考」這種沒解釋的說法");
// STEP 2 是遊戲式舞台：對話卡壓在場景圖上（跟官方一樣），輸入區在寬螢幕獨立成右欄。
assert.ok(page.includes('class="scene-side"'), "輸入區要獨立成右欄");
assert.ok(page.includes('class="stage__bg"'), "舞台要有場景圖");
assert.ok(page.includes('class="dialogue"'), "要有對話卡");
assert.ok(page.includes('class="dialogue__avatar"') && page.includes('class="dialogue__say"'));
assert.ok(page.includes('class="arrow"'), "下一句鈕要在對話卡裡");
assert.ok(!page.includes("scene-stage") && !page.includes("scene-top"), "舊的場景版面已換掉");
const stageStyle = read("apps/scenario-practice/village-life/styles.css");
// 對話卡壓在場景上
assert.ok(/\.dialogue\{[^}]*position:absolute[^}]*bottom:1rem/.test(stageStyle), "對話卡要壓在場景上");
assert.ok(/\.dialogue\{[^}]*rgba\(255,253,245,\.9/.test(stageStyle), "對話卡要半透明才看得到場景");
// 場景圖不拉伸、不裁切（教材三個主題比例略有不同：1000×700 與 1000×707）
assert.ok(/\.stage__bg\{[^}]*object-fit:contain/.test(stageStyle), "場景圖不可裁切");
assert.ok(/\.stage__bg\{[^}]*aspect-ratio:1000\/700/.test(stageStyle), "場景圖要有接近教材的比例當版位");
// 但比例只有三種、寫死會讓比例不符的主題在框內留一圈空白邊（object-fit:contain
// 會把圖縮到塞滿較窄的一邊）。所以圖載入後要用它自己的固有比例。
assert.ok(
  appCode.includes("img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`"),
  "場景圖載入後要用圖自己的固有比例，否則框內會留空白邊"
);
assert.ok(
  appCode.includes("setSceneImage(ui.background, exchange.backgroundUrl ?? \"\")") &&
  appCode.includes("setSceneImage(ui.questScene, quest.sceneUrl || pack.sceneUrl || \"\")"),
  "對話與任務的場景圖都要走同一套比例設定"
);
// 矮螢幕（max-height:640px）要讓高度決定大小、寬度等比縮小。
// 只壓 max-height 而寬度維持 100%，框會比圖寬、左右留一大片空白。
const shortBlock = stageStyle.match(/@media\(max-height:640px\)\{[\s\S]*?\n\}/);
assert.ok(shortBlock, "要能找到矮螢幕的版面設定");
assert.ok(
  /\.stage__bg\{[^}]*width:auto[^}]*height:240px/.test(shortBlock[0]),
  "矮螢幕要等比縮圖（width:auto 讓寬度跟著高度縮），不能只壓高度"
);
// 1201px 以上：左場景、右輸入區，兩欄都在正常流程裡——先前用絕對定位時
// 輸入區不撐高容器，會從 STEP 2 面板底部溢出。較窄時場景填滿剩餘空間。
const wideBlock = stageStyle.match(/@media\(min-width:1201px\)\{[\s\S]*?\n\}/);
assert.ok(wideBlock, "要能找到寬螢幕的版面設定");
assert.ok(
  /\.scene-body\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(\d+px,\d+px\)/.test(wideBlock[0]),
  "寬螢幕要左右兩欄，右欄留給輸入區"
);
assert.ok(!/position:absolute/.test(wideBlock[0]), "兩欄不可用絕對定位，否則輸入區會溢出面板");
// 夠寬才置中：左右各留 (輸入區 + 間距) 一樣寬，場景才是整個面板的正中央。
// 1700px 這個門檻要讓置中的場景跟填滿剩餘空間的一樣大，切換時才不會突然縮小。
const centeredBlock = stageStyle.match(/@media\(min-width:1700px\)\{[\s\S]*?\n\}/);
assert.ok(centeredBlock, "要能找到置中的版面設定");
assert.ok(
  /\.scene-body\{[^}]*grid-template-columns:minmax\(\d+px,1fr\) minmax\(0,\d+px\) minmax\(\d+px,1fr\)/.test(centeredBlock[0]),
  "置中要用對稱三欄，左右留白一樣寬"
);
assert.ok(/\.stage\{[^}]*grid-column:2/.test(centeredBlock[0]), "場景要放在中間那一欄");
assert.ok(/\.scene-side\{[^}]*grid-column:3/.test(centeredBlock[0]), "輸入區要放在最右邊那一欄");
// 1200px 以下全部上下疊，場景用滿版寬
assert.ok(
  /@media\(max-width:1200px\)\{[\s\S]*?\.scene-body\{grid-template-columns:1fr\}/.test(stageStyle),
  "1200px 以下要單欄，否則場景會被擠得很小"
);
// 主角圖層只有上課用語有（另外兩個主題的主角畫在場景圖裡）。
// 沒有圖時必須整個隱藏：src 留空字串但沒隱藏的 <img> 會在場景左上角
// 顯示一個壞掉的圖示（瀏覽器會自己畫那個小圖）。
// 名牌要真的出現在桌上：可點框是動態產生的，名牌 span 也要跟著生，
// 否則「放對了」但畫面上看不到名牌。
assert.ok(
  appCode.includes('slot = document.createElement("span");') &&
  appCode.includes('slot.className = "quest-target__tag";'),
  "放對的名牌要出現在桌上（可點框是動態生成的，名牌 span 也得自己生）"
);
// 點名牌時要把焦點移到還沒放名牌的那位。這裡原本誤用了只在別的函式裡
// 有定義的區域變數 quest，點名牌會在 console 噴錯。
assert.ok(
  appCode.includes("const current = currentQuest();") &&
  appCode.includes("(current?.targets ?? []).find((item) => !questState.placed?.[item.id])"),
  "點名牌要把焦點移到還沒放名牌的那位"
);
// 對話走完後 index 會等於句數（報告頁就是這個狀態）。此時從任務按
// 「回到對話」不能去讀不存在的第 index+1 句。
assert.ok(
  appCode.includes("if (!exchange) { showReport(); return; }"),
  "對話已結束時回到對話要停在報告頁，不能去讀不存在的句子"
);
assert.ok(
  appCode.includes("const playerImage = quest.props?.length ? \"\" : pack.playerImageUrl;") &&
  appCode.includes("ui.questPlayer.hidden = !playerImage;") &&
  appCode.includes("ui.questPlayer.removeAttribute(\"src\")"),
  "沒有主角圖時要把圖層藏起來並收掉 src，不然左上角會出現壞圖示"
);
// 輸入區的標題是使用者給的一句話，長度不定，縮窄時不可超出面板
assert.ok(/\.my-turn h2\{[^}]*overflow-wrap:anywhere/.test(stageStyle), "標題要在任何地方斷行");
assert.ok(/\.my-turn h2\{[^}]*font-size:clamp\(/.test(stageStyle), "標題字級要跟著視窗縮放");
// 按鈕都有 3px 粗邊框，瀏覽器預設的 focus 圈常常看不清楚，
// 用鍵盤操作時一定要看得見自己在哪裡。
assert.ok(
  /a:focus-visible,button:focus-visible,select:focus-visible,textarea:focus-visible[^{]*\{[^}]*outline:[34]px solid/.test(stageStyle),
  "鍵盤操作要有看得見的焦點圈"
);
// 舞台跟「回到設定」之間要有間距
assert.ok(/\.scene-body\{[^}]*margin-top:[^;}]+\}/.test(stageStyle), "場景跟上方回到設定要有間距");
// 場景面板要比全站內容區寬，否則會被 1040px 的上限壓小
assert.ok(/\.scene\{[^}]*width:min\(\d+px,\d+vw\)/.test(stageStyle), "場景面板要能比內容區更寬");
// 三個主題都要能被選，角色清單必須來自教材而不是寫死。
assert.deepEqual([...THEME_ORDER], ["lesson", "find", "outside"]);
assert.ok(appCode.includes('event.target.closest("[data-theme]")'));
assert.ok(appCode.includes('event.target.closest("[data-role]")'));
assert.ok(!/data-role="protagonist"/.test(page), "角色不可寫死在 HTML，必須由教材產生");

// ── 教材 ────────────────────────────────────────────────
const dataset = JSON.parse(read("data/hordequest/dataset.json"));
assert.equal(dataset.schemaVersion, 2);
assert.equal(dataset.dialectCount, 42);
assert.equal(dataset.audioPolicy, "hotlinked-at-runtime");
assert.deepEqual(dataset.themes.map((theme) => [theme.key, theme.name, theme.turnsPerDialect]), [
  ["lesson", "上課用語", 9],
  ["find", "尋找物品", 8],
  ["outside", "戶外活動", 7]
]);
assert.equal(dataset.recordCount, 42 * (9 + 8 + 7));

const EXPECTED_ROLES = {
  lesson: ["同學", "主角"],
  find: ["同學", "媽媽"],
  outside: ["主角", "哥哥", "媽媽"]
};

const dialectIds = fs.readdirSync(path.join(root, "data/hordequest/dialects")).map((name) => name.replace(/\.json$/, ""));
assert.equal(dialectIds.length, 42, "42 個方言分片都要在");

let sanitizedCount = 0;
for (const id of dialectIds) {
  const shard = JSON.parse(read(`data/hordequest/dialects/${id}.json`));
  assert.equal(shard.schemaVersion, 2);
  assert.equal(shard.themes.length, 3, `${id} 應有三個主題`);
  assert.deepEqual(shard.sanitized, [true, false, false].map((flag) => flag && id === "31"), `${id} 的 sanitized 不對`);
  if (id === "31") sanitizedCount += 1;
  for (const theme of shard.themes) {
    const spec = dataset.themes.find((item) => item.key === theme.key);
    assert.equal(theme.name, spec.name, `${id}/${theme.key} 主題名不對`);
    assert.ok(theme.intro.length > 10, `${id}/${theme.key} 缺開場白`);
    assert.equal(theme.turns.length, spec.turnsPerDialect, `${id}/${theme.key} 輪數不對`);
    assert.deepEqual(theme.characters.map((item) => item.name), EXPECTED_ROLES[theme.key], `${id}/${theme.key} 角色不對`);
    assert.equal(new Set(theme.characters.map((item) => item.id)).size, theme.characters.length, `${id}/${theme.key} 角色有重複`);
    theme.turns.forEach((turn, index) => {
      assert.ok(turn.id && turn.indigenousText && turn.chineseText && turn.speakerName, `${id}/${theme.key} 第 ${index + 1} 輪缺欄位`);
      assert.match(turn.audioUrl, /^https:\/\/web\.klokah\.tw\/text\/sound\/\d+\/\d+\.mp3$/, `${id} 音檔網址不合法`);
      assert.match(turn.imageUrl, new RegExp(`^https://web\\.klokah\\.tw/interact/hordequest/img/${theme.key}/`), `${id} 圖片網址不合法`);
      // 場景圖的副檔名依主題不同（上課用語 .jpg、另外兩個主題 .png），所以必須存完整網址。
      // 之前只存檔名、靠 app 自己拼「img/lesson/」，另外兩個主題的對話背景全部 404。
      assert.match(
        turn.backgroundUrl,
        new RegExp(`^https://web\\.klokah\\.tw/interact/hordequest/img/${theme.key}/\\d+-\\d+\\.`),
        `${id}/${theme.key} 第 ${index + 1} 輪的場景圖網址不合法`
      );
      assert.ok(theme.characters.some((item) => item.id === turn.speaker), `${id}/${theme.key} 第 ${index + 1} 輪說話者不在角色清單`);
      if (index > 0) assert.notEqual(turn.speaker, theme.turns[index - 1].speaker, `${id}/${theme.key} 對話必須交替`);
    });
  }
}
assert.equal(sanitizedCount, 1, "只有茂林魯凱語需要補逗號");

// ── 邏輯 ────────────────────────────────────────────────
const shard = JSON.parse(read("data/hordequest/dialects/1.json"));
assert.equal(themeOf(shard, "lesson").name, "上課用語");
assert.equal(themeOf(shard, "nope"), null);

for (const key of THEME_ORDER) {
  const theme = dialogueTheme(shard, key);
  assert.equal(theme.playable, true, `${key} 應該可以進行`);
  assert.equal(theme.roles.length, EXPECTED_ROLES[key].length, `${key} 角色數`);
  assert.equal(theme.turns.length, dataset.themes.find((item) => item.key === key).turnsPerDialect);
}
assert.deepEqual(dialogueTheme({}, "lesson").roles, []);
assert.equal(dialogueTheme(shard, "lesson").playable, true);
assert.equal(dialogueTheme({}, "lesson").playable, false);

// 開場說第一句的角色不能扮演：開場白前面沒有任何台詞可以接，只能憑空猜一句。
for (const key of THEME_ORDER) {
  const theme = dialogueTheme(shard, key);
  const opener = openingSpeaker(theme);
  const respondable = respondableRoles(theme);
  assert.ok(opener, `${key} 應有開場角色`);
  assert.ok(theme.roles.some((item) => item.id === opener), `${key} 開場角色應在角色清單中`);
  assert.ok(!respondable.some((item) => item.id === opener), `${key} 不該把開場者列為可扮演`);
  assert.ok(respondable.length >= 1, `${key} 至少要留一個可扮演的角色`);
  assert.equal(buildExchanges(shard, key, opener).exchanges.length, 0, `${key} 的開場者不能演`);
  // 可扮演的角色不該出現「前面沒有人說過話」的情況
  for (const role of respondable) {
    const built = buildExchanges(shard, key, role.id).exchanges;
    assert.ok(built[0].mine === false, `${key}/${role.id} 第一句應由對方說`);
    assert.ok(built[0].partnerName === "", `${key}/${role.id} 第一句前面沒有對方`);
  }
}
// 全庫都要遵守這條規則
{
  const files = fs.readdirSync(path.join(root, "data/hordequest/dialects"));
  for (const name of files) {
    const each = JSON.parse(readFileSync(path.join(root, "data/hordequest/dialects", name), "utf8"));
    for (const key of THEME_ORDER) {
      const theme = dialogueTheme(each, key);
      assert.ok(respondableRoles(theme).length >= 1, `${name}/${key} 沒有可扮演的角色`);
      for (const role of theme.roles) {
        if (role.id === openingSpeaker(theme)) {
          assert.equal(buildExchanges(each, key, role.id).exchanges.length, 0, `${name}/${key} 開場者竟可演出`);
        } else {
          assert.ok(buildExchanges(each, key, role.id).exchanges.length > 0, `${name}/${key}/${role.id} 竟無法演出`);
        }
      }
    }
  }
}

// 主角的自我介紹不判對錯，後面兩句才比對意思。
const lessonHero = buildExchanges(shard, "lesson", "protagonist");
assert.equal(lessonHero.exchanges.length, 9);
assert.equal(mineCount(lessonHero.exchanges), 4);
assert.equal(judgedCount(lessonHero.exchanges), 2, "主角 4 句裡有 2 句帶名字或部落名");
assert.equal(buildExchanges(shard, "lesson", "nobody").exchanges.length, 0, "不存在的角色不能演");
assert.deepEqual(
  lessonHero.exchanges.filter((item) => item.mine).map((item) => item.kind),
  ["reference", "reference", "practice", "practice"],
  "主角的兩句自我介紹不判對錯，後面兩句才比對意思"
);

// 三人的情境：兩位可扮演的角色句數加總，要等於扣掉開場者後的輪數。
const outsideTurns = dialogueTheme(shard, "outside").turns.length;
const respondable = respondableRoles(dialogueTheme(shard, "outside"));
const counts = respondable.map((item) => mineCount(buildExchanges(shard, "outside", item.id).exchanges));
assert.equal(respondable.length, 2, "戶外活動有哥哥與媽媽可扮演");
assert.equal(counts.reduce((a, b) => a + b, 0), outsideTurns - dialogueTheme(shard, "outside").turns.filter((t) => t.speaker === openingSpeaker(dialogueTheme(shard, "outside"))).length);
assert.ok(counts.every((count) => count >= 1), "每位可扮演的角色都要有台詞");

// 提到第三人的句子（「我明天要和 Lisin 去溪邊烤肉」）要照教材判，不是參考句。
// 戶外活動第 1 句以「Payu，」開頭，但那是開場者的稱呼，學者本來就不會演那一句。
assert.equal(judgedCount(buildExchanges(shard, "outside", "sibling").exchanges), 2, "哥哥 2 句都要比對");
assert.equal(judgedCount(buildExchanges(shard, "outside", "mother").exchanges), 1);
assert.equal(judgedCount(buildExchanges(shard, "find", "mother").exchanges), 4);

// 提示句要寫得出對方的名字，且不能洩漏這句的內容。
const findMom = buildExchanges(shard, "find", "mother");
const mineInFind = findMom.exchanges.filter((item) => item.mine);
assert.ok(mineInFind.every((item) => item.partnerName), "自己的句子要帶對方的名字");
assert.ok(mineInFind.every((item) => item.partnerName !== item.speakerName));
// 學者不再扮演開場者，所以每一句都要有前一句可以接。
// turnHint 仍保留「沒有對方」的分支當防線（萬一教材改了讓學者開場，也不會出現「接著的話」）。
const findAll = buildExchanges(shard, "find", "mother").exchanges;
assert.ok(findAll.filter((item) => item.mine).every((item) => item.partnerName), "自己每一句前面都要有對方");
assert.ok(appCode.includes("if (!exchange.partnerName)"), "開場句要有自己的提示（防線）");

// 參考句只認「自己的名字／自己的來處」，不能因為中文裡有拉丁字母就當成個人資料——
// 那會把「Payu，明天是星期天，你打算去哪裡？」這種稱呼開頭的句子也算進去，而那正是該照教材說的。
assert.ok(isPersonalTurn("我叫Kacaw。"));
assert.ok(isPersonalTurn("我從安通部落來。"));
assert.ok(isPersonalTurn("努呼路瑪路瑪部落來。"), "省略主詞的來處句也要認得");
assert.ok(!isPersonalTurn("你叫甚麼名字？"), "問句不是自我介紹");
assert.ok(isPersonalTurn("Kukui"), "整句只有一個拉丁人名也算自我介紹");
assert.ok(!isPersonalTurn("還沒耶！"));
assert.ok(!isPersonalTurn("我沒有帶錢。你可以借我錢嗎？"));
assert.ok(!isPersonalTurn("Payu，明天是星期天，你打算去哪裡？"), "稱呼對方不算個人資料");
assert.ok(!isPersonalTurn("我明天要和Lisin去溪邊烤肉，你呢？"), "提到第三人不算個人資料");

// 全部 1008 輪掃一遍：自我介紹句一定要被認出來，其餘拉丁名字的句子一定要被判為要比對。
{
  const SELF = [/我叫/, /部落來/];
  const files = fs.readdirSync(path.join(root, "data/hordequest/dialects"));
  let personal = 0;
  let vocative = 0;
  for (const name of files) {
    const shard = JSON.parse(readFileSync(path.join(root, "data/hordequest/dialects", name), "utf8"));
    for (const theme of shard.themes) {
      for (const turn of theme.turns) {
        const self = SELF.some((pattern) => pattern.test(turn.chineseText));
        if (self) personal += 1;
        // 戶外活動第 1、2 輪是稱呼對方與提到第三人，教材就是要學者照著說。
        if (!self && theme.key === "outside" && turn.order <= 2) vocative += 1;
        assert.equal(isPersonalTurn(turn.chineseText), self || !/[一-鿿]/.test(turn.chineseText), `${name}/${theme.key}/${turn.order} 參考句分類錯誤`);
      }
    }
  }
  assert.equal(personal, 84, "自我介紹與來處共 84 輪");
  assert.equal(vocative, 84, "稱呼與第三人共 84 輪，必須照教材判");
}

assert.equal(resultHeadline("exact"), "說對了");
assert.equal(resultHeadline("retry"), "再試試看");
assert.equal(resultHeadline("reference"), "不用判");
assert.ok(resultDetail("reference").includes("不用判對錯"));
assert.equal(resultHeadline("undetermined"), "這次沒有判定");

// 情境判定：族語去標點相同就算說對；中文再去掉句末語助詞後相同才算意思對上。
const exchange = { indigenousText: "Caay hen!", chineseText: "還沒耶！" };
assert.equal(judgeReply({ answer: "Caay hen.", translation: "還沒", exchange }), "exact");
assert.equal(judgeReply({ answer: "caay hen", translation: "還沒", exchange }), "exact");
assert.equal(judgeReply({ answer: "Caay anini.", translation: "還沒", exchange }), "semantic", "說法不同但系統懂成對上就算過");
assert.equal(judgeReply({ answer: "Caay hen!", translation: "我還沒吃早餐", exchange }), "exact", "族語與教材相同時以字面為準");
assert.equal(judgeReply({ answer: "Caay anini ku.", translation: "我要回家了", exchange }), "retry");
assert.equal(judgeReply({ answer: "", translation: "", exchange }), "retry");
assert.equal(judgeReply({ answer: "Caay hen!", translation: "", exchange }), "exact");
assert.equal(indigenousKey("Caay hen!"), "caayhen");
assert.equal(chineseKey("我還沒吃早餐耶！"), "我還沒吃早餐");

const summary = tally(["exact", "semantic", "retry", "reference", "unavailable"]);
assert.deepEqual(summary, { passed: 2, judged: 3, reference: 1, skipped: 1, total: 5 });
assert.ok(tallyLabel(summary).includes("2 / 3"));

// 失敗（辨識／翻譯中斷）要算「不計分」而不是答錯：分母要排除它，也不能顯示成未過。
assert.equal(tallyLabel(tally(["unavailable", "exact", "exact", "exact"])), "說對 3 / 3，1 輪沒有判定");
assert.equal(tally(["unavailable", "retry", "semantic", "exact"]).judged, 3, "失敗不進分母");
assert.equal(tally(["reference", "reference"]).judged, 0, "參考句不進分母");
assert.equal(tally(["unavailable", "unavailable"]).judged, 0);
assert.ok(!/未過|答錯/.test(tallyLabel(tally(["unavailable"]))), "不計分不能寫成答錯");

console.log("PASS: 部落大小事三個情境、角色分配、參考句判定、熱連結教材，無儲存");
// ── 任務關卡（官方 phase2）──────────────────────────────────
// 三個主題都收錄了：上課用語是拖名牌、尋找物品與戶外活動是「問人 → 挑出正確的東西」。
// 官方原本都靠拖詞卡拼句子，詞卡等於直接送出答案的詞彙與順序，所以詞卡只留作提示，
// 句子改由錄音或打字說出來。
assert.deepEqual(dataset.themes.map((theme) => theme.questsPerDialect), [5, 5, 4]);
assert.equal(dataset.questCount, 42 * (5 + 5 + 4));

const QUEST_KINDS = {
  lesson: ["nameTags", "nameTags", "askRightPerson", "askRightPerson", "askRightPerson"],
  find: ["select", "take", "take", "click", "end"],
  outside: ["take", "select", "selectAndSpeak", "end"]
};
const GOAL_KINDS = new Set(["nameTags", "askRightPerson", "select", "take", "click", "selectAndSpeak", "end"]);

let questCount = 0;
let nullChineseReplies = 0;
let lockedStages = 0;
for (const id of dialectIds) {
  const current = JSON.parse(read(`data/hordequest/dialects/${id}.json`));
  for (const theme of current.themes) {
    const expected = QUEST_KINDS[theme.key];
    assert.ok(theme.quests, `${id}/${theme.key} 應該有任務關卡`);
    assert.equal(theme.quests.length, expected.length, `${id}/${theme.key} 任務關卡數不對`);
    if (theme.key === "lesson") {
      assert.match(theme.questSceneUrl, /img\/lesson\/2\.jpg$/);
      assert.match(theme.questPlayerImageUrl, /img\/lesson\/player-1\.png$/);
    } else {
      // 尋找物品與戶外活動的每關都有自己的場景圖與圖層，人物畫在場景裡。
      assert.equal(theme.questSceneUrl, undefined, `${id}/${theme.key} 不該有共用的場景圖`);
      assert.equal(theme.questPlayerImageUrl, undefined, `${id}/${theme.key} 不該有主角圖層`);
    }
    theme.quests.forEach((quest, position) => {
      questCount += 1;
      const goal = quest.goal;
      assert.ok(quest.id && quest.quest, `${id}/${theme.key} 第 ${quest.order} 關缺文案`);
      assert.equal(goal.kind, expected[position], `${id}/${theme.key} 第 ${quest.order} 關的過關條件不對`);
      assert.ok(GOAL_KINDS.has(goal.kind));
      assert.ok(Array.isArray(quest.hintWords), `${id}/${theme.key} 第 ${quest.order} 關缺提示詞`);
      assert.ok(Array.isArray(quest.targets), `${id}/${theme.key} 第 ${quest.order} 關缺對象`);
      for (const target of quest.targets) {
        assert.ok(target.id && target.imageUrl, `${id} 對象缺欄位`);
        assert.match(target.imageUrl, /^https:\/\/web\.klokah\.tw\/interact\/hordequest\/img\//);
        // 可點範圍必須有寬高與位置，而且都在場景內（百分比）
        assert.ok(target.box.width > 0 && target.box.height > 0, `${id} ${target.id} 的可點範圍沒有大小`);
        assert.ok(target.box.left >= 0 && target.box.left + target.box.width <= 100, `${id} ${target.id} 的可點範圍超出畫面`);
        assert.ok(target.box.top >= 0 && target.box.top + target.box.height <= 100, `${id} ${target.id} 的可點範圍超出畫面`);
      }
      for (const line of quest.lines) {
        assert.ok(line.indigenousText && line.chineseText && line.audioUrl, `${id} 句子缺欄位`);
        assert.match(line.audioUrl, /^https:\/\/web\.klokah\.tw\/text\/sound\/\d+\/\d+\.mp3$/);
        assert.ok(line.reply.indigenousText && line.reply.audioUrl, `${id} 同學的回應缺欄位`);
        if (line.reply.chineseText === null) nullChineseReplies += 1;
      }
      if (theme.key !== "lesson") {
        assert.match(quest.sceneUrl, new RegExp(`img/${theme.key}/${quest.order + 1}\\.png$`),
          `${id}/${theme.key} 第 ${quest.order} 關的場景圖索引不對（官方用關卡序號 + 1）`);
        for (const prop of quest.props ?? []) assert.match(prop.imageUrl, new RegExp(`img/${theme.key}/${quest.order + 1}-`));
      }
      if (goal.kind === "nameTags") {
        assert.ok(goal.choices.length >= 3, `${id} 第 ${quest.order} 關候選名牌太少`);
        assert.deepEqual(Object.keys(goal.answers).sort(), ["target-1", "target-2"]);
        for (const answer of Object.values(goal.answers)) {
          assert.ok(goal.choices.includes(answer), `${id} 正確名牌不在候選名單裡`);
        }
      } else if (goal.kind === "select" || goal.kind === "take" || goal.kind === "selectAndSpeak") {
        assert.ok(goal.options.length >= 2, `${id} 第 ${quest.order} 關候選太少`);
        for (const option of goal.options) {
          assert.match(option.imageUrl, new RegExp(`img/${theme.key}/${quest.order + 1}-`));
        }
        for (const answer of goal.answers) {
          assert.ok(goal.options.some((option) => option.id === answer), `${id} 正確答案 ${answer} 不在候選裡`);
        }
        if (goal.kind === "take") {
          // take 的候選放在場景裡，座標必須齊全且在場景內
          for (const option of goal.options) {
            assert.ok(option.box, `${id} take 候選 ${option.id} 沒有場景座標`);
            assert.ok(option.box.left + option.box.width <= 100 && option.box.top + option.box.height <= 100);
          }
        } else {
          for (const option of goal.options) assert.equal(option.box, null, `${id} select 候選不該有場景座標`);
        }
        if (goal.lock) {
          lockedStages += 1;
          assert.ok(goal.unlock, `${id} 有鎖住的選項就要有解鎖條件`);
          const line = quest.lines.find((item) => item.targetId === goal.unlock.targetId);
          assert.ok(line, `${id} 解鎖對象不在場上`);
          assert.equal(line.code, goal.unlock.code, `${id} 解鎖條件對不上句子`);
          assert.ok(goal.options.some((option) => option.id === goal.lock));
        }
        if (goal.kind === "selectAndSpeak") {
          assert.ok(goal.prompt, `${id} selectAndSpeak 要有要說的句子`);
          assert.ok(quest.closing?.audioUrl, `${id} selectAndSpeak 要有完成音檔`);
        }
      } else if (goal.kind === "click") {
        assert.ok(goal.box && goal.box.width > 0, `${id} click 關要有可點範圍`);
        assert.ok(quest.closing?.audioUrl, `${id} click 關要有結語音檔`);
      } else if (goal.kind === "end") {
        assert.ok(goal.endText, `${id} 結語關要有文字`);
        assert.equal(quest.targets.length, 0, `${id} 結語關不該有對象`);
        assert.equal(quest.props.length, 0, `${id} 結語關不該有圖層`);
      }
      if (quest.buylist) assert.ok(quest.buylist.length >= 3, `${id} 購物清單太短`);
      if (quest.closing) assert.match(quest.closing.audioUrl, /^https:\/\/web\.klokah\.tw\/text\/sound\/\d+\/\d+\.mp3$/);
    });
  }
}
assert.equal(questCount, 42 * (5 + 5 + 4));
assert.equal(lockedStages, 42, "每個方言的尋找物品第 2 關都有一個要先問對人才解鎖的選項");
// 官方有 6 個方言的自我介紹中文沿用了別的名字，下載時收成 null（只留族語）。
assert.equal(nullChineseReplies, 7, "名字不一致而被收掉中文的回應數量");
assert.match(dataset.notes.questNameMismatch, /7 處/);
assert.match(dataset.notes.questSentenceRepair, /player 清單裡找不到/);
assert.match(dataset.notes.questTextSource, /json\/setup/);
assert.match(dataset.notes.questSceneNaming, /關卡序號 \+ 1/, "圖檔索引是關卡序號 + 1，這件事要記在 notes");
assert.match(dataset.notes.questTargetBox, /0×0/, "官方那兩個主題的對象點不到，這個修補要記在 notes");

const readShard = (id) => JSON.parse(read(`data/hordequest/dialects/${id}.json`));
const lessonPack = questPack(readShard(1), "lesson");
assert.equal(lessonPack.available, true);
assert.deepEqual(lessonPack.quests.map((quest) => quest.goal.kind), QUEST_KINDS.lesson);
const findPack = questPack(readShard(1), "find");
assert.equal(findPack.available, true, "尋找物品有任務關卡就該能進去");
assert.deepEqual(findPack.quests.map((quest) => quest.goal.kind), QUEST_KINDS.find);
const outsidePack = questPack(readShard(1), "outside");
assert.deepEqual(outsidePack.quests.map((quest) => quest.goal.kind), QUEST_KINDS.outside);

// 判定規則：跟對話同一套，另加「這句只能對某一個人說」。
const pack = lessonPack;
const askQuest = pack.quests[2];
const rightLine = questLineFor(askQuest, askQuest.goal.targetId);
const otherLine = questLineFor(askQuest, askQuest.goal.targetId === "target-1" ? "target-2" : "target-1");
assert.equal(judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: rightLine.indigenousText, translation: "" }).verdict, "exact");
assert.equal(
  judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: rightLine.indigenousText.toUpperCase() + "！", translation: "" }).verdict,
  "exact",
  "大小寫與標點差異不算錯"
);
assert.equal(
  judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: "完全不同的說法", translation: rightLine.chineseText }).verdict,
  "semantic",
  "意思對上教材就算說對"
);
assert.equal(
  judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: otherLine.indigenousText, translation: "" }).verdict,
  "wrongTarget",
  "對的人說另一人的句子要提示換人"
);
assert.equal(
  judgeQuestLine(askQuest, otherLine.targetId, { answer: rightLine.indigenousText, translation: "" }).verdict,
  "wrongTarget",
  "對錯的人說對的句子也算答錯"
);
assert.equal(judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: "月桃", translation: "月桃" }).verdict, "retry");
// 第 1、2 關兩位同學要說的是同一句，不該誤報成「說錯人」。
assert.equal(judgeQuestLine(pack.quests[0], "target-2", { answer: pack.quests[0].lines[0].indigenousText, translation: "" }).verdict, "exact");

// 名牌：放對才固定，放錯不佔位（放錯若也寫進去會把位置鎖死，整關卡住）。
const nameQuest = pack.quests[0];
const wrongTag = nameQuest.goal.choices.find((choice) => choice !== nameQuest.goal.answers["target-1"]);
let placed = placeNameTag(nameQuest, { tag: wrongTag, targetId: "target-1", state: { learned: ["target-1", "target-2"], placed: {} } });
assert.equal(placed.ok, false);
assert.deepEqual(placed.placed, {}, "放錯不該佔位");
placed = placeNameTag(nameQuest, { tag: nameQuest.goal.answers["target-1"], targetId: "target-1", state: { learned: ["target-1", "target-2"], placed: {} } });
assert.equal(placed.ok, true);
assert.equal(placed.reason, "correct");
let tagState = { learned: ["target-1", "target-2"], placed: placed.placed };
assert.equal(questIsComplete(nameQuest, tagState), false, "還有一位沒放名牌不過關");
placed = placeNameTag(nameQuest, { tag: nameQuest.goal.answers["target-2"], targetId: "target-2", state: tagState });
tagState = { learned: ["target-1", "target-2"], placed: placed.placed };
assert.equal(questIsComplete(nameQuest, tagState), true);
// 還沒問完兩位同學時，名牌不算過關。
assert.equal(questIsComplete(nameQuest, { learned: ["target-1"], placed: { "target-1": nameQuest.goal.answers["target-1"], "target-2": nameQuest.goal.answers["target-2"] } }), false);

assert.equal(questIsComplete(askQuest, { learned: [askQuest.goal.targetId], placed: {} }), true, "問對的人就過關");
assert.equal(questIsComplete(askQuest, { learned: [otherLine.targetId], placed: {} }), false, "問錯的人不過關");
assert.equal(questProgress(askQuest, { learned: [], placed: {} }), "先問 2 位同學（0/2）");
assert.match(questProgress(askQuest, { learned: [otherLine.targetId], placed: {} }), /換一位問問看/);
assert.equal(questResultHeadline("wrongTarget"), "這句要問別人");
assert.match(questResultDetail("wrongTarget"), /換個人再問一次/);
assert.equal(questResultHeadline("exact"), "說對了");
assert.equal(questResultHeadline("unavailable"), "這次沒有判定");

// ── 尋找物品與戶外活動的過關判定 ──────────────────────────
const potQuest = findPack.quests[0];
assert.deepEqual(questSceneOptions(potQuest), [], "select 的候選是獨立清單，不放場景裡");
assert.equal(questOptions(potQuest).length, 4);
assert.equal(judgeQuestPick(potQuest, "pot-2", { learned: [] }).ok, false);
assert.equal(judgeQuestPick(potQuest, potQuest.goal.answers[0], { learned: [] }).ok, true);
assert.equal(judgeQuestPick(potQuest, "不存在的東西", { learned: [] }).reason, "unknown");

// take：一個要先問對人才解鎖，籃子放對才算過關，而且順序不影響。
const fernQuest = findPack.quests[1];
const lockId = fernQuest.goal.lock;
assert.equal(questOptionLocked(fernQuest, lockId, { learned: [] }), true, "還沒問對人應該是鎖住的");
assert.equal(questOptionLocked(fernQuest, lockId, { learned: [fernQuest.goal.unlock.targetId] }), false, "問對人就解鎖");
assert.equal(questOptionLocked(fernQuest, "plant-2", { learned: [] }), false, "只有一個選項是鎖住的");
let basket = addToBasket(fernQuest, lockId, { taken: [], learned: [] });
assert.equal(basket.reason, "locked", "鎖住的選項不能放進籃子");
basket = addToBasket(fernQuest, "plant-2", { taken: [], learned: [] });
assert.equal(basket.reason, "added");
assert.equal(judgeBasket(fernQuest, basket.taken), false, "放錯不算過關");
basket = addToBasket(fernQuest, lockId, { taken: basket.taken, learned: [fernQuest.goal.unlock.targetId] });
assert.deepEqual(basket.taken.slice().sort(), fernQuest.goal.answers.slice().sort());
assert.equal(judgeBasket(fernQuest, basket.taken), true);
// 官方會把兩邊排序後比對，所以順序不影響
assert.equal(judgeBasket(fernQuest, [...fernQuest.goal.answers].reverse()), true);
assert.equal(questSceneOptions(fernQuest).length, 4, "take 的候選放在場景裡");
const order2 = Object.fromEntries(Object.entries(basket.taken).map(([k], i) => [k, i]));
assert.ok(order2);

// selectAndSpeak：官方是拖詞卡排句子，我們改成自己說。
const thanksQuest = outsidePack.quests[2];
assert.equal(thanksQuest.goal.kind, "selectAndSpeak");
assert.ok(thanksQuest.goal.prompt.split(" ").length >= 4, "要說的句子應該不只一個詞");
assert.equal(judgeQuestPrompt(thanksQuest, { answer: thanksQuest.goal.prompt, translation: "" }), "exact");
assert.equal(judgeQuestPrompt(thanksQuest, { answer: thanksQuest.goal.prompt.toUpperCase(), translation: "" }), "exact");
assert.equal(judgeQuestPrompt(thanksQuest, { answer: "謝謝", translation: "" }), "retry");

// take 關被鎖住時，進度要明講要先問誰，而且要說「先問」而不是看起來像已完成。
// 「（1/1）」會讓人以為籃子滿了就是答對，其實還沒判。
assert.match(questProgress(fernQuest, { learned: [], taken: [] }), /先問問中間的人/);
assert.equal(targetLabel(fernQuest.goal.unlock.targetId, fernQuest), "中間");
assert.match(questProgress(fernQuest, { learned: [fernQuest.goal.unlock.targetId], taken: [] }), /要 1 樣/);
assert.doesNotMatch(questProgress(fernQuest, { learned: [], taken: ["plant-2"] }), /\/1/,
  "還沒問人時不要顯示 1/1，那看起來像已完成");

// 場景狀態改變後，上一次的結果訊息要收掉。
// 不收掉的話，東西已經放進籃子，畫面還停在「東西不對」，
// 使用者會以為按哪個都錯。
assert.ok(
  appCode.includes("function clearQuestResult()") &&
  appCode.includes("clearQuestResult();\n  renderQuestGoal(quest);"),
  "籃子內容改變時要清掉上一次的結果訊息"
);
// 籃子裡的東西要能拿出來（官方行為）：放錯了要能自己拿回去換。
assert.ok(
  appCode.includes('class="quest-basket__item" data-remove=') &&
  appCode.includes("questState.taken = questState.taken.filter"),
  "籃子裡的東西可以拿出來換"
);
// 還沒問到人時按確定，要提示去問人而不是說「東西不對」，
// 否則使用會一直換著按。
assert.ok(
  appCode.includes("還不能確定，") && appCode.includes("籃子還是空的"),
  "還沒問人或籃子空時，確定的提示要對應情況"
);
assert.match(questHint(potQuest, {}), /挑一個/);
assert.match(questHint(fernQuest, { taken: [] }), /放進籃子/);
assert.match(questHint(findPack.quests[3], {}), /點場景/);
assert.match(questHint(thanksQuest, {}), /先選要對誰說/);
assert.match(questHint(thanksQuest, { picked: "people-1" }), /說出那句話/);

// ── 任務關卡的版面 ───────────────────────────────────────
assert.ok(page.includes('id="quest"'), "要有任務關卡畫面");
assert.ok(page.includes("STEP 4"));
assert.ok(page.includes('id="quest-hint"'), "要有看提示的按鈕");
assert.ok(page.includes('id="quest-tag-dock"'), "要有放名牌的地方");
assert.ok(page.includes('id="start-quest"'), "對話結果要能接著玩任務");
assert.ok(page.includes('id="quest-layers"'), "圖層與可點區要有一個容器");
assert.ok(page.includes('id="quest-goal"'), "要有目標面板（選項清單、購物籃、結語）");
assert.ok(appCode.includes("quest.buylist?.length"), "戶外活動第一關的購物清單要畫在右欄面板（放進任務卡會蓋掉場景）");
// 圖層與可點區由 JS 依教材產生，所以座標來自資料而不是寫死在 CSS。
// 人物圖層必須是按鈕的兄弟節點：放在按鈕裡會被按鈕的盒子再縮放一次、位置也會偏。
assert.ok(appCode.includes('<button type="button" class="quest-target"'), "同學要是可以點的按鈕");
assert.ok(appCode.includes('class="quest-option"'), "take 的候選要是可以點的按鈕");
assert.ok(!/<button[^>]*class="quest-target"[^>]*>\s*<img/.test(page), "人物圖層要在按鈕外面");
// 圖層與可點框要相對「場景圖」定位：窄螢幕時對話卡排在圖的下面，.stage 會比圖高，
// 圖層用 inset:0 就會被一起撐高、人物被畫偏，還會蓋到下面的卡片上。
assert.ok(
  /<div class="quest-scene" id="quest-scene-box">[\s\S]*?id="quest-layers"[\s\S]*?<\/div>\s*<div class="dialogue quest-board">/.test(page),
  "場景圖、圖層與可點框要包在 .quest-scene 裡，對話卡要在它外面"
);
assert.ok(/\.quest-scene\{position:relative;overflow:hidden\}/.test(stageStyle), "場景盒要相對定位並裁掉溢出的圖層");
// 座標一律由資料帶進來，CSS 不再寫死上課用語的位置
assert.ok(!/\.quest-target\[data-target/.test(stageStyle), "可點範圍應該來自教材，不該寫死在上課用品");
assert.ok(/\.quest-layers\{position:absolute;inset:0\}/.test(stageStyle), "圖層容器要鋪滿場景");
// 任務卡放在場景上方，桌面要留給過關的筆／橡皮擦／掃把
assert.ok(/\.quest-board\{top:1rem;bottom:auto\}/.test(stageStyle), "任務卡要放上方，否則桌面被蓋掉");
assert.ok(/\.quest-reward\{[^}]*z-index:2/.test(stageStyle), "過關物件要蓋在任務卡之上");
// 輸入面板是從 STEP 2 搬過來共用的，錄音與翻譯只有一套
assert.ok(appCode.includes("mountInputPanel(ui.questSide)"), "任務關卡要掛上共用的輸入面板");
assert.ok(appCode.includes("mountInputPanel(ui.sceneBody)"), "回到對話要把輸入面板搬回去");
assert.ok(appCode.includes('if (mode === "quest") runQuestLine(); else runExchange();'), "送出鈕要分辨對話與任務");
assert.ok(appCode.includes("questState?.done"), "過關後要收掉輸入");

// ── 兩個階段互相可切換、關卡可挑 ───────────────────────────
assert.ok(page.includes('id="to-quest"'), "對話進行中要能直接跳去任務關卡");
assert.ok(page.includes('id="quest-back"'), "任務要能切回對話");
assert.ok(page.includes('id="quest-levels"'), "要有關卡選擇");
assert.ok(page.includes('id="to-dialogue"'), "任務結果要能切回對話");
assert.ok(appCode.includes("ui.toQuest.addEventListener"), "對話的任務鈕要接上");
assert.ok(appCode.includes("ui.toDialogue.addEventListener"), "任務的回到對話鈕要接上");
assert.ok(appCode.includes('ui.questLevels.addEventListener'), "關卡選擇要能切換");
// 切回對話時要把輸入面板搬回去，並保留對話進度（不重設 index／results）
assert.ok(appCode.includes("function backToDialogue()"), "要有切回對話的函式");
assert.ok(appCode.includes("if (exchanges.length) showExchange();"), "切回對話要接回原來那一句");
// 結果面板是共用的，要記住是哪個階段的結果，「再練一次」才知道重來哪個
assert.ok(appCode.includes("reportKind"), "要記住結果面板屬於哪個階段");
assert.ok(appCode.includes('if (reportKind === "quest") { startQuest(); return; }'), "再練一次要看階段");
// 關卡按鈕要標出目前那關與已完成過的關
assert.ok(appCode.includes('class="${current ? "is-current" : ""}${done ? " is-done" : ""}"'), "關卡鈕要標目前與完成");
assert.ok(appCode.includes("renderLevelPicker();"), "過關後要重畫關卡鈕的完成標記");
assert.ok(/\.level-picker button\.is-current\{/.test(stageStyle), "目前那關要看得見");
assert.ok(/\.level-picker button\.is-done::after\{content:" ✓"\}/.test(stageStyle), "完成過的關卡要有記號");
assert.ok(/\.level-picker button\{[^}]*min-width:44px/.test(stageStyle), "關卡鈕要夠大好點");
assert.ok(/\.level-picker\{[^}]*flex-wrap:wrap/.test(stageStyle), "關卡鈕要能換行，窄螢幕才不會爆掉");

// 下載器：三個主題都收 phase2，圖檔索引要用「關卡序號 + 1」
const downloader = read("scripts/download-hordequest.mjs");
assert.match(downloader, /const QUEST_THEMES = \["lesson", "find", "outside"\]/);
assert.match(downloader, /"item-1-img": \{ file: "pen\.png"/);
assert.match(downloader, /order \+ 1/, "圖檔索引要用關卡序號 + 1（官方寫法），照字面組網址會全部 404");
assert.ok(!appCode.includes("hordequest/json"), "執行期不應直接讀官方 JSON");
