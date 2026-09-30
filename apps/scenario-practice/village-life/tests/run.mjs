import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  THEME_ORDER, buildExchanges, chineseKey, dialogueTheme, indigenousKey, isPersonalTurn,
  judgedCount, judgeReply, mineCount, openingSpeaker, respondableRoles,
  resultDetail, resultHeadline, tally, tallyLabel, themeOf
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
// 輸入區的標題是使用者給的一句話，長度不定，縮窄時不可超出面板
assert.ok(/\.my-turn h2\{[^}]*overflow-wrap:anywhere/.test(stageStyle), "標題要在任何地方斷行");
assert.ok(/\.my-turn h2\{[^}]*font-size:clamp\(/.test(stageStyle), "標題字級要跟著視窗縮放");
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