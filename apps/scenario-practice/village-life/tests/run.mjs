import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  THEME_ORDER, addToBasket, buildExchanges, buildPlaylist, chineseKey, dialogueTheme, indigenousKey,
  isPersonalTurn, judgedCount, judgeBasket, judgeQuestLine, judgeQuestPick, judgeQuestPrompt,
  judgeReply, mineCount, openingSpeaker, questHint, questIsBorrowQuest, questIsComplete,
  questPeopleLabel, questLineFor, questOptionLocked, questOptions, questPack, questProgress,
  questResultDetail, questResultHeadline, questSceneOptions, questTipsText, questTurnTitle,
  questWrongPersonLine, respondableRoles,
  resultDetail, resultHeadline,
  tally, tallyLabel, targetLabel, themeOf
} from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const page = read("apps/scenario-practice/village-life/index.html");
const appSource = read("apps/scenario-practice/village-life/app.mjs");
const appCode = stripComments(appSource);
const coreCode = stripComments(read("apps/scenario-practice/village-life/core.mjs"));

assert.ok(page.includes('lang="zh-Hant"'));
assert.ok(page.includes("部落大小事"));
assert.ok(page.includes("情境應用 · MISSION 01"));
assert.ok(page.includes("想聽哪一個場景？"));
assert.ok(page.includes('class="task-brief"') && page.includes("怎麼玩"));
assert.ok(page.includes("開始聽對話"));
assert.ok(page.includes("任務結果"));
assert.ok(!page.includes("這段對話聽完了"), "不得再有對話聽完的 STEP 3");
assert.ok(page.includes(">STEP 3<") && !page.includes(">STEP 4<"), "任務關卡改為 STEP 3");
// 狀態列只報服務／載入狀態，不附加「先聽再說／不計分」這類流程說明。
assert.ok(!appCode.includes("對話先聽再說"));
assert.ok(!appCode.includes("不計分"));
assert.ok(!/任務關卡才用辨識與翻譯/.test(appCode));
assert.ok(!/說完一句就翻成中文/.test(appCode));
assert.ok(page.includes("正在確認翻譯與語音辨識服務"));
assert.ok(appCode.includes("已載入 ${exchanges.length} 輪對話"), "載入成功要顯示輪數");
// STEP 1 不再選角色；對話只聽不說。
assert.ok(!page.includes('id="role-picker"'), "不得再有角色選擇");
assert.ok(!page.includes("你要回應誰？"));
assert.ok(!page.includes('id="role-grid"'));
assert.ok(!appCode.includes("renderRoles"));
assert.ok(appCode.includes("buildPlaylist"), "對話要用播放清單");
assert.ok(!/演哪一齣|哪一齣|演出/.test(page + appSource), "介面不得使用劇場比喻");
assert.ok(page.includes('id="theme-grid"'));
assert.ok(page.includes('href="/apps/basic-learning/body-parts-practice/styles.css"'));
assert.ok(page.includes('href="/apps/scenario-practice/village-life/styles.css"'));
assert.ok(page.includes('src="/apps/scenario-practice/village-life/app.mjs"'));
assert.ok(!page.includes('href="styles.css"'));
assert.ok(page.includes("互動模組"));
assert.ok(page.includes("CC BY-NC-SA 4.0"));
assert.ok(page.includes("web.klokah.tw"), "頁面必須揭露教材音檔與場景圖由第三方載入");
assert.ok(appCode.includes("transcribe") && appCode.includes("translateToZh"), "任務關卡仍要用辨識與翻譯");
assert.ok(appCode.includes("prefers-reduced-motion"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode), "不得寫入瀏覽器儲存");
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource), "介面不得使用 emoji");
assert.ok(!/\bpoints\b/.test(appCode), "情境練習不顯示考試配分");

// STEP 1 與 STEP 2 是兩個畫面：開始後設定區要收起來，另留返回按鈕。
assert.ok(page.includes('id="setup"'));
assert.ok(page.includes('id="back-setup"'));
assert.ok(page.includes("回到設定"));
assert.ok(appCode.includes("ui.setup.hidden = true"), "開始聽對話後必須收起 STEP 1");
// 「下一步」一進句就顯示；按下才換句並播下一句。
assert.ok(appCode.includes('ui.next.textContent = last ? (quests.length ? "去任務" : "完成") : "下一步"'), "一進句就要出現下一步");
assert.ok(appCode.includes("ui.next.hidden = false"), "下一步要直接顯示");
assert.ok(/ui\.next\.addEventListener\("click"[\s\S]*?index \+= 1/.test(appCode), "下一步按下才換句");
assert.ok(appCode.includes("if (quests.length) startQuest()"), "最後一步有任務要直進任務");
assert.ok(!page.includes('id="replay"'), "對話不得有再聽一次");
assert.ok(!page.includes('id="audio-state"'), "對話不得有播放狀態文案");
assert.ok(!appCode.includes("unlockPartnerTurn"), "不得再等播完才解鎖下一步");
assert.ok(!appCode.includes("armPartnerUnlock"), "不得再有播完看門計時器");
// 對話不顯示台詞、不收音；輸入面板留給任務關卡。
assert.ok(page.includes('id="record-note"'));
assert.ok(page.includes('id="input-mode-toggle"') && page.includes('id="input-type"') && page.includes('id="input-voice"'));
assert.ok(appCode.includes("wireInputMode"));
assert.ok(appCode.includes("ui.zh.textContent = exchange.chineseText"), "對話要顯示中文台詞");
assert.ok(appCode.includes("ui.indigenous.textContent = exchange.indigenousText"), "對話要顯示族語台詞");
assert.ok(appCode.includes("ui.myTurn.hidden = true"), "對話不得出現換你說輸入區");
assert.ok(!appCode.includes("turnHint"), "對話不再提示要說什麼");
assert.ok(!appCode.includes("runExchange"), "對話不再送出判定");
assert.ok(!appCode.includes("這句是你的名字或來處"), "對話不得再出現名字／來處提示");
assert.ok(
  /function showExchange\(\) \{[\s\S]*?ui\.myTurn\.hidden = true[\s\S]*?playCurrent\(\);/.test(appCode),
  "對話每一句都只播音、不收音"
);
assert.ok(!appCode.includes("function showReport("), "對話不得再走聽完報告頁");
// 麥克風不能用要能退回打字（任務關卡），不能把這一句判成結束。
assert.ok(appCode.includes("ui.recordNote.textContent"));
assert.ok(appCode.includes("runQuestLine = createSingleFlight"), "任務送出流程要單飛，避免連點重複送出");
// 逐句回答紀錄會一直往下撐開、把當下的場景擠出畫面，已經移除。
assert.ok(!page.includes("dialogue-log"), "不得再有逐句回答紀錄");
assert.ok(!appCode.includes("appendLog"));
assert.ok(!appCode.includes("ui.log"));
assert.ok(!/句會比對意思/.test(appCode + page), "全部都比對時不得顯示這句");
assert.ok(!/只當參考/.test(appCode + page), "介面不得使用「只當參考」這種沒解釋的說法");
// STEP 2 是遊戲式舞台：對話卡壓在場景圖上（跟官方一樣）；輸入區節點留給任務關卡搬用。
assert.ok(page.includes('class="scene-side"'), "輸入區要獨立成右欄（任務關卡會搬過去）");
assert.ok(page.includes('class="stage__bg"'), "舞台要有場景圖");
assert.ok(page.includes('class="dialogue"'), "要有對話卡");
assert.ok(page.includes('class="dialogue__avatar"') && page.includes('class="dialogue__say"'));
assert.ok(page.includes('id="next"') && page.includes("下一步"), "下一步鈕要在對話卡裡");
assert.ok(page.includes('class="arrow"'), "任務另有下一關箭頭鈕");
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
// 矮螢幕（max-height:640px）要讓場景變小但維持圖的固有比例。
// 上課用語圖是 1000×700、另外兩個主題是 1000×707，比例不同不能寫死，
// 所以這裡用「寬」當上限（341px ⇔ 上課用語高 240px、另外兩個主題高約 241px），
// 盒子的寬跟圖的寬用同一個 min(341px,92vw)（英尺不用 %，否則盒跟圖互相參照會解成 0）。
// 只壓 max-height 而寬度維持 100%，盒會比圖寬、左右留一大片空白，
// 名牌／可點框的百分比座標就整組跑掉。
const shortBlock = stageStyle.match(/@media\(max-height:640px\)\{[\s\S]*?\n\}/);
assert.ok(shortBlock, "要能找到矮螢幕的版面設定");
assert.ok(
  /\.quest-scene\{width:min\(341px,92vw\)/.test(shortBlock[0]) && !/\.quest-scene\{[^}]*height:\d/.test(shortBlock[0]),
  "矮螢幕時場景盒寬要跟圖一樣（同一個 min() 上限），不能壓高度把盒跟圖撐開"
);
// 1201px 以上：任務說明在左、場景在中、輸入區在右，三欄都在正常流程裡。
const wideBlock = stageStyle.match(/@media\(min-width:1201px\)\{[\s\S]*?\n\}/);
assert.ok(wideBlock, "要能找到寬螢幕的版面設定");
assert.ok(
  /\.scene-body\{[^}]*grid-template-columns:minmax\(250px,320px\) minmax\(0,1fr\) minmax\(300px,380px\)/.test(wideBlock[0]),
  "寬螢幕要有任務說明、場景、輸入區三欄"
);
assert.ok(/\.quest-board\{[^}]*grid-column:1/.test(wideBlock[0]), "寬螢幕任務說明要在場景左邊");
assert.ok(/\.stage\{[^}]*grid-column:2/.test(wideBlock[0]), "寬螢幕場景要在中間");
assert.ok(/\.scene-side\{[^}]*grid-column:3/.test(wideBlock[0]), "寬螢幕輸入區要在最右邊");
assert.ok(!/position:absolute/.test(wideBlock[0]), "三欄不可用絕對定位，否則輸入區會溢出面板");
// 夠寬才置中：左右各留 (輸入區 + 間距) 一樣寬，場景才是整個面板的正中央。
// 1700px 這個門檻要讓置中的場景跟填滿剩餘空間的一樣大，切換時才不會突然縮小。
const centeredBlock = stageStyle.match(/@media\(min-width:1700px\)\{[\s\S]*?\n\}/);
assert.ok(centeredBlock, "要能找到置中的版面設定");
assert.ok(
  /\.scene-body\{[^}]*grid-template-columns:minmax\(\d+px,1fr\) minmax\(0,\d+px\) minmax\(\d+px,1fr\)/.test(centeredBlock[0]),
  "置中要用對稱三欄，左右留白一樣寬"
);
assert.ok(/\.quest-board\{[^}]*grid-column:1/.test(centeredBlock[0]), "任務說明要放在場景左邊那一欄");
assert.ok(/\.stage\{[^}]*grid-column:2/.test(centeredBlock[0]), "場景要放在中間那一欄");
assert.ok(/\.scene-side\{[^}]*grid-column:3/.test(centeredBlock[0]), "輸入區要放在最右邊那一欄");
// 1200px 以下全部上下疊，場景用滿版寬
assert.ok(
  /@media\(max-width:1200px\)\{[\s\S]*?\.scene-body\{grid-template-columns:1fr\}/.test(stageStyle),
  "1200px 以下要單欄，否則場景會被擠得很小"
);
assert.ok(
  /@media\(min-width:1201px\)\{[\s\S]*\.scene-body--solo\{[^}]*minmax\(720px,1000px\)/.test(stageStyle)
    && /@media\(min-width:1201px\)\{[\s\S]*\.scene-body--solo \.stage__bg\{[^}]*min-width:720px/.test(stageStyle),
  "字幕疊在圖上時 STEP 2 場景最窄 720px"
);
assert.ok(
  /\.scene-body--solo\{[^}]*minmax\(0,1000px\)/.test(stageStyle)
    && !/\.scene-body--solo \.stage\{[^}]*min-width/.test(stageStyle),
  "字幕在圖下時場景跟著視窗縮，不設最小寬"
);
// 主角圖層只有上課用語有（另外兩個主題的主角畫在場景圖裡）。
// 沒有圖時必須整個隱藏：src 留空字串但沒隱藏的 <img> 會在場景左上角
// 顯示一個壞掉的圖示（瀏覽器會自己畫那個小圖）。
// 名牌要真的出現在桌上：位置對準桌上那張空名牌卡（第一問的字置中在卡上、
// 第二問的字排在卡左側成對），字級跟桌上印好的字同一套。名字還會跨關累積。
assert.ok(
  appCode.includes("DESK_DROP_SLOTS") &&
  appCode.includes('tag.style.transform = "translate(-50%,-50%)"') &&
  appCode.includes('quest-dropped-tag--${nameStage + 1}'),
  "問到的名字要放到桌上空卡的位置（置中）、跟桌上印字同套字級，並且跨關累積"
);
assert.ok(
  appCode.includes("quest-desk-tag") && appCode.includes("pack?.deskTags"),
  "場景要疊官方桌上藍色名牌文字"
);
// 官方座標是字的左上角，字看起來偏在卡片左邊；app 要換成藍卡的中心讓字置中
// （DESK_TAG_CENTERS 是照卡片實際位置量出來的，見 app.mjs 的 comment）。
assert.ok(
  appCode.includes("deskTagCenterFor(tag.left, tag.top)") && appCode.includes("transform:translate(-50%,-50%)"),
  "桌上名牌的字要用卡片幾何中心置中"
);
// 上課用語第 1、2 關恢復官方的拖名牌：答對只會揭開候選名牌，不會自動放上桌。
assert.ok(page.includes('id="quest-tag-dock"'), "第一位同學答對後要出現候選名牌區");
assert.ok(
  !appCode.includes("questState.placed[line.targetId] = name")
    && appCode.includes("placeNameCard") && appCode.includes("data-card="),
  "問到名字不能自動上桌，要讓學習者自己拖名牌"
);
assert.ok(
  appCode.includes('draggable="true"') && appCode.includes('addEventListener("drop"'),
  "名牌要支援拖放"
);
assert.ok(
  appCode.includes("cardAt") && appCode.includes("card.text !== expected"),
  "候選名牌要有卡片實體，而且只接受該位同學的正確名牌"
);
const placeNameCardFn = appCode.match(/function placeNameCard\(targetId, cardId\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(
  placeNameCardFn && !placeNameCardFn.includes("questIsLearned"),
  "拉名牌不要限制先問完該位同學，跟官方一樣可以直接放"
);
// 回答句子會直接寫出名字／地名，等於提前公布拖曳答案：只播音，不顯示文字。
const heardNamesFn = appCode.match(/function renderHeardNames\(quest\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(
  heardNamesFn.includes("data-replay-target")
    && heardNamesFn.indexOf("data-replay-target") < heardNamesFn.indexOf("quest-heard__who")
    && heardNamesFn.includes("已問過")
    && !heardNamesFn.includes("goal.answers")
    && !heardNamesFn.includes("reply.indigenousText")
    && !heardNamesFn.includes("quest-heard__name"),
  "名牌關右欄只能顯示誰問過了與重播鈕，不能寫出回答或答案"
);
const learnedRepliesFn = appCode.match(/function renderLearnedReplies\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(
  learnedRepliesFn.includes('quest?.goal.kind === "nameTags"')
    && learnedRepliesFn.includes('ui.questReply.textContent = ""')
    && appCode.includes("playQuestReply(line)"),
  "名牌關的回應只播音檔；每位問過的人都要能單獨重播"
);
assert.ok(page.includes('id="quest-tips"'), "任務卡要有官方提示的位置");
assert.ok(page.includes("已問過的同學"), "名牌關右欄不要寫「同學的回答」");
assert.ok(stageStyle.includes(".quest-heard__replay") && stageStyle.includes(".quest-tips"), "提示與重播鈕要有樣式");
// 對話走完後 index 會等於句數。從任務按「回到對話」要停在最後一句，不能讀不存在的句子。
assert.ok(
  appCode.includes("if (!exchanges[index] && exchanges.length) index = exchanges.length - 1"),
  "對話已結束時回到對話要停在最後一句"
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
// 三個主題都要能被選；對話改聽力播放，不再選角色。
assert.deepEqual([...THEME_ORDER], ["lesson", "find", "outside"]);
assert.ok(appCode.includes('event.target.closest("[data-theme]")'));
assert.ok(!/data-role=/.test(page), "頁面不得再有角色選擇");
{
  const playlist = buildPlaylist(JSON.parse(read("data/hordequest/dialects/1.json")), "lesson");
  assert.equal(playlist.exchanges.length, 9);
  assert.ok(playlist.exchanges.every((item) => item.mine === false), "播放清單每一句都不是換你說");
}

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

// buildExchanges 仍保留給單元測試與舊邏輯：可扮演角色的句子要帶對方名字。
const findMom = buildExchanges(shard, "find", "mother");
const mineInFind = findMom.exchanges.filter((item) => item.mine);
assert.ok(mineInFind.every((item) => item.partnerName), "自己的句子要帶對方的名字");
assert.ok(mineInFind.every((item) => item.partnerName !== item.speakerName));
const findAll = buildExchanges(shard, "find", "mother").exchanges;
assert.ok(findAll.filter((item) => item.mine).every((item) => item.partnerName), "自己每一句前面都要有對方");

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
assert.equal(indigenousKey("Caay hen!","賽夏"), "Caayhen", "賽夏保留大小寫（大寫 S 是字母的一部分）");
assert.equal(indigenousKey("Caay hen!","噶瑪蘭"), "Caayhen");
assert.equal(chineseKey("我還沒吃早餐耶！"), "我還沒吃早餐");

// 賽夏／噶瑪蘭的句首容忍：只放行第一個字母的大小寫差異，其餘嚴格。
const caseExchange = { indigenousText: "Sa’ila pa:tol!", chineseText: "請聽話！" };
assert.equal(judgeReply({ answer: "sa’ila pa:tol", translation: "", exchange: caseExchange, ethnicity: "賽夏" }), "exact", "句首容忍");
assert.equal(judgeReply({ answer: "Sa’ila pa:ToL", translation: "", exchange: caseExchange, ethnicity: "賽夏" }), "retry", "句首以外要嚴格");
assert.equal(judgeReply({ answer: "biRi", translation: "", exchange: { indigenousText: "biri", chineseText: "走" }, ethnicity: "噶瑪蘭" }), "retry", "噶瑪蘭大寫 R 不能吃掉");
assert.equal(judgeReply({ answer: "Rutung", translation: "", exchange: { indigenousText: "rutung", chineseText: "猴子" }, ethnicity: "噶瑪蘭" }), "exact");

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
      // 桌上藍色名牌文字來自官方 phase2.setup.text（.table-card）
      assert.ok(Array.isArray(theme.questDeskTags) && theme.questDeskTags.length >= 4, `${id} 上課用語要有桌上名牌`);
      // 官方錨點是「字的左上角」，app 把字換到藍卡的幾何中心（app.mjs 的 DESK_TAG_CENTERS）。
      // 這張表是照官方六張卡的實際位置量的（見 comment），座標 42 個方言全部共用；
      // 上游要是改錨點座標，中心位置就會對不上，測試要擋下來。
      for (const tag of theme.questDeskTags) {
        assert.ok(tag.text && Number.isFinite(tag.top) && Number.isFinite(tag.left), `${id} 名牌座標不完整`);
        assert.ok(tag.tone === "blue" || tag.tone === "brown", `${id} 名牌色調要是 blue／brown`);
        const match = appCode.match(/^const DESK_TAG_CENTERS = \{[\s\S]*?\n\};/m);
        assert.ok(match, "app.mjs 要有桌上名卡置中表");
        assert.ok(
          [...match[0].matchAll(/"([\d.]+)\|([\d.]+)"/g)].some((entry) => {
            const [cardTop, cardLeft] = entry[0].slice(1, -1).split("|").map(Number);
            return Math.abs(cardTop - tag.top) <= 1 && Math.abs(cardLeft - tag.left) <= 1;
          }),
          `${id} 名牌錨點 (${tag.left}, ${tag.top}) 沒有對到置中表，桌上名卡位置要重新量測`
        );
      }
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
      if (goal.kind === "end") {
        assert.equal(quest.tips, "", `${id}/${theme.key} 第 ${quest.order} 關是結語，不該有官方提示`);
        assert.equal(quest.hintWords.length, 0, `${id}/${theme.key} 第 ${quest.order} 關是結語，不該有詞卡`);
      } else {
        assert.ok(quest.tips, `${id}/${theme.key} 第 ${quest.order} 關缺官方任務提示`);
        assert.ok(quest.hintWords.length > 0, `${id}/${theme.key} 第 ${quest.order} 關缺提示詞`);
      }
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
        const needed = new Map();
        for (const answer of Object.values(goal.answers)) {
          needed.set(answer, (needed.get(answer) ?? 0) + 1);
        }
        for (const [answer, count] of needed) {
          assert.ok(
            goal.choices.filter((choice) => choice === answer).length >= count,
            `${id} 第 ${quest.order} 關正確名牌「${answer}」的張數不足（同名要能各放一張）`
          );
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
          assert.ok(quest.closing?.text, `${id} selectAndSpeak 要有官方收尾台詞`);
        }
      } else if (goal.kind === "click") {
        assert.ok(goal.box && goal.box.width > 0, `${id} click 關要有可點範圍`);
        assert.ok(quest.closing?.audioUrl, `${id} click 關要有結語音檔`);
        assert.ok(quest.closing?.text, `${id} click 關要有官方收尾台詞`);
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
for (const built of [lessonPack, findPack, outsidePack]) {
  for (const quest of built.quests) {
    const keys = quest.hintWords.map((word) => indigenousKey(word));
    assert.equal(new Set(keys).size, keys.length, `${quest.id} 的提示詞顯示前要去重`);
    assert.equal(quest.themeKey, quest.id.includes("-lesson-") ? "lesson" : quest.id.includes("-find-") ? "find" : "outside");
  }
}
// 官方 tips 的（同學名字）要換成這一關的對象，其他情境沒有佔位符。
assert.match(questTipsText(lessonPack.quests[0]), /你叫甚麼名字/);
assert.doesNotMatch(questTipsText(lessonPack.quests[2]), /（同學名字）|Kacaw|左邊|右邊/);
assert.match(questTipsText(lessonPack.quests[2]), /同學，借我筆好嗎/);
assert.doesNotMatch(questTipsText(lessonPack.quests[3]), /（同學名字）|Kacaw|Panay|左邊|右邊/);
assert.match(questTipsText(lessonPack.quests[3]), /同學，借我橡皮擦好嗎/);
assert.doesNotMatch(questTipsText(lessonPack.quests[4]), /（同學名字）|Kacaw|Panay/);
assert.match(questTipsText(lessonPack.quests[4]), /同學，請幫我拿掃把/);
assert.equal(questTipsText(findPack.quests[0]), findPack.quests[0].tips);
assert.equal(questTipsText(findPack.quests[4]), "");
assert.equal(questPeopleLabel(lessonPack.quests[0]), "同學");
assert.equal(questPeopleLabel(findPack.quests[0]), "其他人");
assert.equal(questPeopleLabel(outsidePack.quests[0]), "其他人");
// 第 3、4 關不先公布要問誰；問錯人時照官方回覆「我只有一隻／我也沒有」。
assert.equal(questIsBorrowQuest(lessonPack.quests[2]), true);
assert.equal(questIsBorrowQuest(lessonPack.quests[3]), true);
assert.equal(questIsBorrowQuest(lessonPack.quests[4]), false);
const level3Wrong = questWrongPersonLine(lessonPack.quests[2], "target-2");
assert.equal(level3Wrong?.reply?.chineseText, "我只有一隻。");
assert.ok(level3Wrong?.reply?.indigenousText && level3Wrong.reply.audioUrl, "第 3 關問錯人要有族語與錄音");
const level4Wrong = questWrongPersonLine(lessonPack.quests[3], "target-1");
assert.equal(level4Wrong?.reply?.chineseText, "我也沒有。");
assert.ok(level4Wrong?.reply?.indigenousText && level4Wrong.reply.audioUrl, "第 4 關問錯人要有族語與錄音");
assert.equal(questWrongPersonLine(lessonPack.quests[4], "target-2"), null);
assert.match(lessonPack.quests[4].goal.reward.imageUrl, /broom\.png$/, "第 5 關過關要有掃把圖");
// 42 個方言都要能顯示去重後的詞卡，而且上課用語的（同學名字）不能留在畫面上。
for (const id of dialectIds) {
  const currentShard = readShard(id);
  for (const key of ["lesson", "find", "outside"]) {
    for (const quest of questPack(currentShard, key).quests) {
      const keys = quest.hintWords.map((word) => indigenousKey(word, currentShard.ethnicity));
      assert.equal(new Set(keys).size, keys.length, `${id}/${key} 第 ${quest.order} 關提示詞重複`);
      assert.doesNotMatch(questTipsText(quest), /（同學名字）/, `${id}/${key} 第 ${quest.order} 關提示還有名字佔位符`);
      if (key === "lesson" && quest.goal.kind === "askRightPerson") {
        assert.match(questTipsText(quest), /同學，/, `${id} 第 ${quest.order} 關選人前不公布對象名字`);
      }
      if (key === "lesson" && questIsBorrowQuest(quest)) {
        const wrongTargetId = quest.targets.find((target) => target.id !== quest.goal.targetId)?.id;
        const wrong = questWrongPersonLine(quest, wrongTargetId);
        assert.ok(
          wrong?.reply?.indigenousText && wrong?.reply?.chineseText && wrong?.reply?.audioUrl,
          `${id} 第 ${quest.order} 關問錯人要有官方族語、中文與錄音`
        );
      }
      if (key === "lesson" && (quest.order === 1 || quest.order === 2)) {
        for (const target of quest.targets) {
          const rebound = quest.rebounds?.[target.id];
          assert.ok(
            rebound?.indigenousText && rebound?.chineseText && rebound?.audioUrl,
            `${id} 第 ${quest.order} 關問錯問句要有官方回應、中文與錄音`
          );
        }
      }
    }
  }
}

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
assert.equal(
  judgeQuestLine(askQuest, otherLine.targetId, { answer: rightLine.chineseText, translation: "", allowChinese: true }).verdict,
  "wrongTarget",
  "中文直入也要能判斷這句是另一位同學的"
);
assert.equal(judgeQuestLine(askQuest, askQuest.goal.targetId, { answer: "月桃", translation: "月桃" }).verdict, "retry");
// 第 1、2 關兩位同學要說的是同一句，不該誤報成「說錯人」。
assert.equal(judgeQuestLine(pack.quests[0], "target-2", { answer: pack.quests[0].lines[0].indigenousText, translation: "" }).verdict, "exact");

// 名牌關跟官方一樣：第一位答對後候選名牌出現，兩張正確名牌都拖上桌就過關，
// 不強制先問完第二位。
const nameQuest = pack.quests[0];
const placedNames = {
  "target-1": nameQuest.goal.answers["target-1"],
  "target-2": nameQuest.goal.answers["target-2"],
};
assert.equal(
  questIsComplete(nameQuest, { learned: ["target-1"], placed: placedNames }),
  true,
  "只問一位、兩張名牌都放對也要過關"
);
assert.equal(
  questIsComplete(nameQuest, { learned: ["target-1", "target-2"], placed: { "target-1": placedNames["target-1"] } }),
  false,
  "只放一張名牌不算過"
);
assert.equal(questIsComplete(nameQuest, { learned: ["target-1", "target-2"], placed: placedNames }), true, "兩張名牌都放對就過關");
assert.equal(questProgress(nameQuest, { learned: [], placed: {} }), "先問一位同學，取得名牌");
assert.equal(questProgress(nameQuest, { learned: ["target-1"], placed: {} }), "名牌已放 0/2");
assert.equal(questProgress(nameQuest, { learned: ["target-1"], placed: placedNames }), "名牌都放上桌了（2/2）");
assert.match(questHint(nameQuest, {}), /名牌/);

assert.equal(questIsComplete(askQuest, { learned: [askQuest.goal.targetId], placed: {} }), true, "問對的人就過關");
assert.equal(questIsComplete(askQuest, { learned: [otherLine.targetId], placed: {} }), false, "問錯的人不過關");
assert.equal(questProgress(askQuest, { learned: [], placed: {} }), "先問問同學，看看誰能借你");
assert.doesNotMatch(questProgress(askQuest, { learned: [], placed: {} }), /左邊|右邊|Kacaw/);
assert.match(questProgress(askQuest, { learned: [otherLine.targetId], placed: {} }), /換一位問問看/);
assert.equal(questHint(askQuest, {}), "問問看同學，看看誰能借你");
assert.doesNotMatch(questHint(askQuest, {}), /左邊|右邊|Kacaw/);
assert.equal(questProgress(lessonPack.quests[3], { learned: [], placed: {} }), "先問問同學，看看誰能借你");
assert.doesNotMatch(questProgress(lessonPack.quests[3], { learned: [], placed: {} }), /左邊|右邊|Panay/);
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
assert.equal(judgeQuestPrompt(thanksQuest, { answer: "隨便說", translation: "謝謝你的幫忙" }), "semantic");
assert.equal(thanksQuest.goal.promptChinese, "謝謝你的幫忙！");
assert.ok(
  thanksQuest.goal.prompt.split(/\s+/).every((word) => thanksQuest.hintWords.some((hint) => indigenousKey(hint) === indigenousKey(word))),
  "道謝那句的詞要出現在提示裡"
);
assert.match(questProgress(thanksQuest, { picked: "people-1" }), /謝謝你的幫忙/);
assert.equal(judgeQuestPick(thanksQuest, thanksQuest.goal.answers[0], {}).ok, true, "道謝要選教材指定的那一位");
const wrongPerson = thanksQuest.goal.options.find((option) => !thanksQuest.goal.answers.includes(option.id));
assert.equal(judgeQuestPick(thanksQuest, wrongPerson.id, {}).ok, false, "選錯人不能過關");

const lessonTwo = lessonPack.quests[0];
const [leftPerson, rightPerson] = [...lessonTwo.targets].sort((a, b) => a.box.left - b.box.left);
assert.equal(targetLabel(leftPerson.id, lessonTwo), "左邊");
assert.equal(targetLabel(rightPerson.id, lessonTwo), "右邊", "兩個人時右邊不能叫成中間");
assert.match(questProgress(potQuest, { learned: [], picked: null }), /先問問其他人/);
assert.doesNotMatch(questProgress(potQuest, { learned: [], picked: null }), /同學/);
assert.match(questProgress(potQuest, { learned: ["target-1"], picked: null }), /從下面的選項挑一個/);
assert.match(questProgress(potQuest, { learned: ["target-1"], picked: "pot-2" }), /按確定/);
assert.match(questProgress(findPack.quests[3], { learned: [] }), /先問問其他人.*點場景/);
assert.match(questProgress(findPack.quests[3], { learned: ["target-1"] }), /^點場景/);
assert.match(questProgress(outsidePack.quests[0], { learned: [] }), /先問問其他人.*拿正確的東西/);
assert.match(questProgress(outsidePack.quests[0], { learned: ["target-1"] }), /放進籃子/);
assert.equal(
  questProgress(thanksQuest, { learned: ["target-1"], picked: null }),
  "選要道謝的人",
  "問到人後進度要改成選要道謝的人"
);

// take 關被鎖住時，不能先公布解鎖者；要讓學習者從回答判斷誰知道，
// 而且「（1/1）」不能看起來像已完成（其實還沒按確定判）。
assert.match(questProgress(fernQuest, { learned: [], taken: [] }), /先問問其他人/);
assert.doesNotMatch(questProgress(fernQuest, { learned: [], taken: [] }), /中間|target-3/);
assert.match(questProgress(fernQuest, { learned: ["target-1"], taken: [] }), /換一位問問看/);
assert.doesNotMatch(questProgress(fernQuest, { learned: ["target-1"], taken: [] }), /中間|target-3/);
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
assert.match(questHint(potQuest, {}), /先問問其他人/);
assert.match(questHint(potQuest, { learned: ["target-1"] }), /挑一個/);
assert.match(questHint(potQuest, { learned: ["target-1"], picked: "pot-2" }), /按確定/);
assert.match(questHint(fernQuest, { taken: [] }), /先問問其他人/);
assert.doesNotMatch(questHint(fernQuest, { taken: [] }), /中間|target-3/);
assert.match(questHint(fernQuest, { learned: ["target-1"], taken: [] }), /換一位問問看/);
assert.match(questHint(fernQuest, { learned: [fernQuest.goal.unlock.targetId], taken: [] }), /放進籃子/);
assert.match(questHint(findPack.quests[3], {}), /先問問其他人.*點場景/);
assert.match(questHint(findPack.quests[3], { learned: ["target-1"] }), /點場景/);
assert.match(questHint(thanksQuest, {}), /先問問其他人，再選要道謝的人/);
assert.doesNotMatch(questHint(thanksQuest, {}), /同學/);
assert.equal(questHint(thanksQuest, { learned: ["target-1"] }), "選要道謝的人");
assert.match(questHint(thanksQuest, { picked: "people-1" }), /謝謝你的幫忙/);
assert.equal(questHint(findPack.quests[4], {}), "任務結束");
assert.doesNotMatch(questResultDetail("wrongTarget"), /同學/);
// 輸入區標題：依關卡顯示點誰、說什麼，不寫死「換你說」。
assert.match(questTurnTitle(lessonPack.quests[0], {}), /先點一個人，再說「/);
assert.match(
  questTurnTitle(lessonPack.quests[0], {
    targetId: "target-1",
    names: { "target-1": "Kacaw", "target-2": "Panay" }
  }),
  /對左邊的人說「你叫甚麼名字？」/,
  "名牌關選對象時要用位置稱呼，不能提前顯示名字答案"
);
assert.doesNotMatch(
  questTurnTitle(lessonPack.quests[0], {
    targetId: "target-1",
    names: { "target-1": "Kacaw", "target-2": "Panay" }
  }),
  /Kacaw|Panay/,
  "名牌關的輸入標題不能提前公布名牌答案"
);
assert.match(
  questTurnTitle(lessonPack.quests[1], {
    targetId: "target-2",
    names: { "target-1": "Kacaw", "target-2": "Panay" }
  }),
  /對Panay說「你家住哪裡？」/,
  "第 1 關問過名字後，第 2 關可以用名字稱呼"
);
assert.match(
  questTurnTitle(lessonPack.quests[1], { targetId: "target-2" }),
  /對右邊的人說「你家住哪裡？」/,
  "沒有已知名字時，第 2 關仍要能退回位置稱呼"
);
assert.match(questTurnTitle(askQuest, {}), /先點要問的人，再說「/);
assert.match(questTurnTitle(askQuest, {}), /同學，借我筆好嗎/);
assert.doesNotMatch(questTurnTitle(askQuest, {}), /Kacaw|左邊|右邊/);
assert.match(questTurnTitle(lessonPack.quests[3], {}), /同學，借我橡皮擦好嗎/);
assert.doesNotMatch(questTurnTitle(lessonPack.quests[3], {}), /Panay|Kacaw|左邊|右邊/);
assert.match(questTurnTitle(lessonPack.quests[4], {}), /同學，請幫我拿掃把/);
assert.doesNotMatch(questTurnTitle(lessonPack.quests[4], {}), /Panay|Kacaw|左邊|右邊/);
assert.match(questTurnTitle(askQuest, { targetId: askQuest.goal.targetId }), /對.+的人說「/);
assert.match(questTurnTitle(thanksQuest, { state: { picked: "people-1" } }), /^說「/);
assert.match(questTurnTitle(findPack.quests[0], {}), /新的陶壺/);
assert.doesNotMatch(questTurnTitle(findPack.quests[0], {}), /陶甕/, "輸入標題要和官方 tips 用同一個說法");
assert.equal(
  questTurnTitle(findPack.quests[0], { state: { learned: ["target-1"] } }),
  "從下面的選項挑一個",
  "問到人之後輸入區要改提示挑東西，不要一直叫學習者問人"
);
assert.equal(
  questTurnTitle(lessonPack.quests[0], { state: { learned: ["target-1"] } }),
  "任務",
  "名牌關問完一位後不要再顯示放名牌的操作提示"
);
assert.equal(
  questTurnTitle(thanksQuest, { state: { learned: ["target-1"] } }),
  "選要道謝的人",
  "問完後要改提示選要道謝的人"
);
assert.ok(!/同學/.test(questTurnTitle(fernQuest, {})), "尋找物品場景不得稱同學");
assert.ok(!/同學/.test(questTurnTitle(thanksQuest, {})), "戶外活動場景不得稱同學");
assert.ok(appCode.includes("questTurnTitle"), "任務輸入區要用關卡指引");
assert.ok(
  appCode.includes("const asksThenActs = quest.goal.kind === \"select\"")
    && appCode.includes("questProgress(quest, questState)"),
  "問到人之後任務卡要改提示下一個動作，不要一直叫學習者問人"
);
assert.ok(!appCode.includes('ui.turnTitle.textContent = "換你說"'), "不得再寫死換你說");
assert.ok(!appCode.includes('ui.questSpeaker.textContent = "換你說"'), "任務卡不得改成換你說");
assert.ok(appCode.includes("THEME_LABELS[themeKey]?.quest"), "任務說明要跟著場景走");
assert.ok(appCode.includes("找出陶壺、月桃和檳榔，再點開門。"));
assert.ok(appCode.includes("向借刀的人道謝。"));
assert.ok(
  appCode.includes('ui.myTurn.hidden = quest.goal.kind === "end"') &&
  appCode.includes("questResults[questIndex] = { order: quest.order, quest: quest.quest, ok: true }"),
  "結語關要算完成，而且不要留空的送出鈕"
);
assert.ok(appCode.includes("(questState.taken ?? []).includes(id)"), "購物籃按鈕要跟著籃子內容亮起");
assert.ok(
  appCode.includes('const thanking = quest.goal.kind === "selectAndSpeak" && questState?.picked && !questTarget'),
  "點了場景上的人仍是問借刀，沒點人而且選對了才道謝"
);
assert.ok(appCode.includes("function questLocked()"), "過關或辨識中不能再改場景");
assert.ok(appCode.includes("function dropped(epoch)"), "換關之後不能把舊的判定寫進來");
assert.ok(!appCode.includes("value: optionId"), "選錯不能顯示內部代號");
assert.ok(appCode.includes('aria-label="放進籃子"'), "放進籃子的按鈕不能念出內部代號");
{
  const finishTurn = appCode.match(/function finishQuestTurn\(\) \{[\s\S]*?\n\}/);
  assert.ok(finishTurn && !finishTurn[0].includes("questAudio.pause"), "說對之後不能暫停剛開始的回應");
}
assert.ok(
  /const runQuestLine = createSingleFlight\(async \(\) => \{[\s\S]*?ui\.questAudio\.pause\(\)/.test(appCode),
  "送出新的一句時要先停掉上一句回應"
);

// ── 任務關卡的版面 ───────────────────────────────────────
assert.ok(page.includes('id="quest"'), "要有任務關卡畫面");
assert.ok(page.includes("STEP 3"));
assert.ok(page.includes('id="quest-hint"'), "要有看提示的按鈕");
// 任務卡要同時顯示官方的 quest 與 tips；結語關不顯示提示，也不重複收尾文字。
assert.ok(
  appCode.includes("const tips = questTipsText(quest)")
    && appCode.includes("ui.questTips.textContent = tips")
    && appCode.includes("ui.questTips.hidden = !tips"),
  "任務卡要顯示官方任務提示"
);
assert.ok(
  appCode.includes("const isEnd = quest.goal.kind === \"end\"")
    && appCode.includes("ui.questHint.hidden = isEnd")
    && !appCode.includes("goal.endText"),
  "結語關要收起提示，而且收尾文字只能出現一次"
);
// 名牌關恢復官方的候選名牌區與拖放；其他關卡沒有這個區塊。
assert.ok(
  page.includes('id="quest-tag-dock"') && page.includes('id="quest-tag-section"'),
  "名牌關要有候選名牌區"
);
assert.ok(
  appCode.includes("questState?.selectedCard")
    && appCode.includes("placeNameCard(target.dataset.target, questState.selectedCard)"),
  "也可以先點名牌，再點同學"
);
assert.ok(
  !page.includes("也可以先點名牌")
    && !appCode.includes("點一下同學")
    && !appCode.includes("名牌放對了")
    && !appCode.includes("再放另一張")
    && !appCode.includes("再放到對的桌上"),
  "名牌關不要顯示直接放、再放一張這類操作提示"
);
assert.ok(
  stageStyle.includes(".quest-tag.is-selected")
    && stageStyle.includes(".quest-dropped-tag--movable")
    && stageStyle.includes(".quest-target.is-drop-over"),
  "名牌要看得出來已選取、可拿回，拖到同學身上也要有提示"
);
// 選人時的圖像變化對齊官方 targetClick：選中的同學換 target-N-2.png（持續光暈）、
// 上課用語的主角圖換 player-2.png；hover 用 is-glow 做光暈。
assert.ok(
  appCode.includes("TARGET_SELECT_VARIANT") && appCode.includes('data-target-img') &&
  stageStyle.includes(".quest-layer.is-glow"),
  "選中的同學要換 target-N-2.png 變體並帶光暈（hover 也是）"
);
// 官方 quest-find.css 的 hoverGlow／selectGlow 是紅色 0 0 10px rgba(255,0,0,.8)；
// hover 只靠紅光，不要再疊一個白色可點框蓋掉它。
assert.ok(
  stageStyle.includes("drop-shadow(0 0 10px rgba(255,0,0,.8))"),
  "人物 hover／選取光暈要用官方紅色"
);
assert.ok(
  !stageStyle.includes(".quest-target:hover::after"),
  "人物 hover 不要再用白色框，官方只有紅光"
);
assert.ok(
  appCode.includes('ui.questPlayer.src = questTarget === "target-2"'),
  "主角圖要跟官方一樣換向：問右邊的同學才換 player-2.png（問左邊維持 player-1.png）"
);
// 任務說明在場景外面：寬螢幕左側欄、窄螢幕排在場景上方，所以不會再蓋住門或人物。
assert.ok(
  !stageStyle.includes(".quest-stage.is-click-stage .quest-board")
    && !stageStyle.includes(".quest-stage.is-static-board .quest-board"),
  "任務卡不要再用 is-click-stage／is-static-board 疊回場景"
);
assert.ok(
  appCode.includes('ui.questStage.classList.toggle("is-static-board", quest.themeKey !== "lesson")')
    && stageStyle.includes(".quest-stage.is-static-board .quest-scene"),
  "尋找物品與戶外活動仍要保留場景盒外框"
);
// 原版要問到一次正確句子才顯示 respond-box／take-option／門。
assert.ok(
  appCode.includes("ui.questGoal.hidden = !ready")
    && appCode.includes("button.hidden = !ready || locked")
    && appCode.includes("button.hidden = !ready")
    && appCode.includes("filter((option) => !questOptionLocked"),
  "還沒問到人前要藏起選項、購物籃與鎖住的東西"
);
assert.ok(
  appCode.includes("if (!(questState?.learned ?? []).length)")
    && appCode.includes("再點場景裡該點的地方"),
  "click 關要先問到人才能開門，不能直接跳過提問"
);
// 購物清單折疊（官方 #buying-list-btn）
assert.ok(
  appCode.includes("data-buylist-toggle") && stageStyle.includes(".quest-shopping.is-collapsed"),
  "購物清單要有折疊鈕"
);
// 打字直入教材中文的後門只限 debug 模式（網址 ?debug_mode）
assert.ok(
  appCode.includes("QUEST_DEBUG_MODE") && coreCode.includes("allowChinese"),
  "中文直入教材句要由 ?debug_mode 開關放行"
);
// 指定要問誰的關卡跟原版一樣不鎖人：點錯人會得到那位同學的 rebound，不是介面擋下。
const selectTargetFn = appCode.match(/function selectTarget\(targetId\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(
  selectTargetFn
    && !selectTargetFn.includes("is-locked")
    && !selectTargetFn.includes("點錯人了")
    && appCode.includes("wrongTarget"),
  "指定對象的關卡不要鎖住其他人，問錯人要能換人"
);
assert.ok(
  appCode.includes("showBorrowRefusal")
    && appCode.includes("questWrongPersonLine")
    && appCode.includes("questIsBorrowQuest(quest) && questTarget")
    && appCode.includes("line.reply.audioUrl"),
  "借筆／借橡皮擦問錯人要照官方回覆族語、中文與錄音，不能先被判定成問對"
);
assert.ok(
  appCode.includes("rebound.chineseText") && appCode.includes("rebound.audioUrl"),
  "問句不對時要播官方 rebound，中文也要用官方 textCh，不自行改寫"
);
// 「自動說這句」與 3 次失敗的關聯
assert.ok(
  appCode.includes("questState.failures >= 3") && appCode.includes("updateAutoAsk"),
  "答錯累計 3 次才出現自動說"
);
// 過關後右欄只有「下一關 →」／「看任務結果」一顆鈕，不用彈窗
assert.ok(
  !appCode.includes("showQuestPopup") && !page.includes('id="quest-popup"'),
  "完成任務不要彈窗，只留右欄的「下一關 →」鈕"
);
assert.ok(page.includes('id="quest-complete"') && page.indexOf('id="quest-complete"') > page.indexOf('id="quest-tags"'), "過關的「下一關」鈕要在右欄（#quest-tags 之後）");
assert.ok(page.includes('id="quest-autoask"'), "答錯 3 次要有「自動說這句」（官方 autoask-btn）");
assert.ok(page.includes('id="quest-right-sound"') && page.includes('id="quest-wrong-sound"'), "判定的對／錯音效（官方 right/wrong 音效熱連結）");
// 這三項的行為在 app 的新流程宣告
assert.ok(appCode.includes("showQuestComplete"), "過關先出「完成任務」鈕，學者自己按了才彈窗");
assert.ok(appCode.includes("questState.failures") , "答錯要累計次數，滿 3 次出現自動說");
assert.ok(appCode.includes("playJudgeSound(ok)"), "確定鍵判定要播對／錯音效");
assert.ok(page.includes('id="start-quest"'), "任務結果區保留接著玩任務鈕");
assert.ok(page.includes('id="quest-layers"'), "圖層與可點區要有一個容器");
assert.ok(page.includes('id="quest-goal"'), "要有目標面板（選項清單、購物籃、結語）");
assert.ok(appCode.includes("quest.buylist?.length"), "戶外活動第一關的購物清單要畫在右欄面板（放進任務卡會蓋掉場景）");
// 圖層與可點區由 JS 依教材產生，所以座標來自資料而不是寫死在 CSS。
// 人物圖層必須是按鈕的兄弟節點：放在按鈕裡會被按鈕的盒子再縮放一次、位置也會偏。
assert.ok(appCode.includes('<button type="button" class="quest-target"'), "同學要是可以點的按鈕");
assert.ok(appCode.includes('class="quest-option"'), "take 的候選要是可以點的按鈕");
assert.ok(!/<button[^>]*class="quest-target"[^>]*>\s*<img/.test(page), "人物圖層要在按鈕外面");
// 圖層與可點框要相對「場景圖」定位；任務說明在 .quest-stage 外面，
// DOM 順序是任務說明 → 場景 → 右欄，窄螢幕自然變成說明在場景上方。
assert.ok(
  /<div class="quest-scene" id="quest-scene-box">[\s\S]*?id="quest-layers"[\s\S]*?<\/div>\s*<\/div>\s*<div id="quest-side"/.test(page),
  "場景圖、圖層與可點框要包在 .quest-scene 裡"
);
assert.ok(
  page.indexOf('class="dialogue quest-board"') < page.indexOf('class="stage quest-stage"'),
  "任務說明要在場景之前，窄螢幕才會排在遊戲畫面上方"
);
assert.ok(/\.quest-scene\{position:relative;overflow:hidden;container-type:inline-size\}/.test(stageStyle), "場景盒要相對定位、裁掉溢出的圖層，而且是名牌字級的容器查詢基準");
// 桌上名牌的字級要跟著場景寬度縮（官方 1000px 舞台是 1.2em ≈ 寬度的 1.45%）：
// 字級寫死（clamp／.8rem）時場景一縮小，相鄰兩個名字會疊在一起（長名字如 djiniljepan 最嚴重）。
assert.ok(/\.quest-desk-tag\{[^}]*font-size:max\(7px,1\.45cqw\)/.test(stageStyle), "桌上名牌字級要隨場景寬度縮（cqw）");
assert.ok(/\.quest-dropped-tag\{[^}]*font-size:max\(7px,1\.45cqw\)/.test(stageStyle), "放上桌的名字字級也要隨場景寬度縮，跟桌上印字同套");
assert.ok(!/\.quest-desk-tag[^{}]*\{font-size:\.8rem\}/.test(stageStyle) && !/\.quest-desk-tag,\.quest-target__tag\{font-size:\.8rem\}/.test(stageStyle), "窄螢幕不能再寫死桌上名牌的字級");
// 矮視窗時場景盒的寬要跟著圖的固有比例縮：盒子只要比圖寬，百分比座標就會跑掉。
assert.ok(
  /@media\(max-height:640px\)\{[\s\S]*\.quest-scene\{width:min\(341px,92vw\)/.test(stageStyle), "矮視窗時場景盒寬要跟圖用同一個上限，不能只壓高度"
);
// 座標一律由資料帶進來，CSS 不再寫死上課用語的位置
assert.ok(!/\.quest-target\[data-target/.test(stageStyle), "可點範圍應該來自教材，不該寫死在上課用品");
assert.ok(/\.quest-layers\{position:absolute;inset:0\}/.test(stageStyle), "圖層容器要鋪滿場景");
// 任務卡不再絕對定位壓在場景上；寬螢幕靠 grid-column:1 放到左邊，
// 窄螢幕靠 DOM 順序排在場景上方。
assert.ok(
  /\.quest-board\{[^}]*position:static[^}]*margin:0 0 1rem/.test(stageStyle),
  "任務卡要離開場景的絕對定位"
);
assert.ok(!/\.quest-board\{[^}]*top:1rem/.test(stageStyle), "任務卡不能再壓在場景上方");
const rewardIndex = page.indexOf('id="quest-reward"');
const playerIndex = page.indexOf('id="quest-player"');
const layersIndex = page.indexOf('id="quest-layers"');
assert.ok(
  rewardIndex > page.indexOf('id="quest-scene"')
    && rewardIndex < playerIndex
    && rewardIndex < layersIndex,
  "獎勵物件要在人物圖層前面，掃把才會在左邊同學後面"
);
assert.ok(/\.quest-reward\{[^}]*pointer-events:none/.test(stageStyle), "場景裡的獎勵物件不能擋住人物點擊");
assert.ok(
  appCode.includes("quest.order === 5")
    && appCode.includes("showQuestReward(quest, { initial: true })")
    && appCode.includes("LESSON_BROOM_START")
    && appCode.includes('left: "-4%"')
    && appCode.includes("questReward.scrollIntoView"),
  "第五關掃把要依官方初始座標顯示在左邊同學左側，完成後也要把獎勵物件捲進畫面"
);
// 輸入面板是從 STEP 2 搬過來共用的，錄音與翻譯只有一套
assert.ok(appCode.includes("mountInputPanel(ui.questSide)"), "任務關卡要掛上共用的輸入面板");
assert.ok(appCode.includes("mountInputPanel(ui.sceneBody)"), "回到對話要把輸入面板搬回去");
assert.ok(appCode.includes('if (mode === "quest") runQuestLine();'), "送出鈕只服務任務關卡");
assert.ok(/state === "recorded"[\s\S]*?runQuestLine\(\)/.test(appCode), "語音停錄後必須自動送出");
assert.ok(/mode\(\) === "voice"[\s\S]*?ui\.submit\.hidden = true/.test(appCode), "語音模式必須隱藏送出鈕");
assert.ok(appCode.includes("questState?.done"), "過關後要收掉輸入");

// 第二場景（尋找物品）的人物圖在 props 裡，也要套用官方的 hover／選取光暈。
// 但 2-target-1.png 不是 lesson 的 target-N-2 選中變體，不能誤換成另一個人。
assert.match(appCode, /const targetIds = new Set\(quest\.targets\.map/);
assert.match(appCode, /targetIds\.has\(prop\.id\) \? ` data-target-img=/);
assert.match(appCode, /selected && quest\.themeKey === "lesson"/);
assert.match(
  appCode,
  /!button\.classList\.contains\("is-selected"\)[\s\S]*?classList\.remove\("is-glow"\)/,
  "滑鼠移出時要保留已選人物的光暈"
);
// 陶壺照官方先選取、再按確定；候選順序每次進關卡隨機洗牌。
assert.ok(appCode.includes("function shuffledOptions"));
assert.ok(appCode.includes("optionOrder"));
assert.ok(appCode.includes('id="option-confirm"'));
assert.ok(appCode.includes("function confirmSelectOption"));
assert.ok(appCode.includes("questState.picked = optionId"));
assert.ok(
  /\.quest-option-btn--select\.is-picked\{/.test(stageStyle),
  "陶壺選取要用「已選、尚未確定」的樣式，不能長得像答對的綠色"
);
// 點門完成後顯示官方收尾台詞，收掉舊目標面板。
assert.ok(appCode.includes("quest.closing?.text"));
assert.ok(appCode.includes('aria-label="點門"'));
assert.ok(
  appCode.includes("data-click-img") && /\.quest-layer\.is-glow2/.test(stageStyle) &&
  stageStyle.includes("drop-shadow(0 0 10px rgba(255,255,0,.8))"),
  "點門前要有官方黃色 hoverGlow2"
);

// ── 兩個階段互相可切換、關卡可挑 ───────────────────────────
assert.ok(page.includes('id="to-quest"'), "對話進行中要能直接跳去任務關卡");
assert.ok(page.includes('id="quest-back"'), "任務要能切回對話");
assert.ok(page.includes('id="quest-levels"'), "要有關卡選擇");
assert.ok(page.includes('id="to-dialogue"'), "任務結果要能切回對話");
assert.ok(appCode.includes("ui.toQuest.addEventListener"), "對話的任務鈕要接上");
assert.ok(appCode.includes("ui.toDialogue.addEventListener"), "任務的回到對話鈕要接上");
assert.ok(appCode.includes('ui.questLevels.addEventListener'), "關卡選擇要能切換");
// 切回對話時要把輸入面板搬回去，並保留對話進度（不重設 index）
assert.ok(appCode.includes("function backToDialogue()"), "要有切回對話的函式");
assert.ok(appCode.includes("if (exchanges.length) showExchange();"), "切回對話要接回原來那一句");
// 結果面板只服務任務；再玩一次任務要看 reportKind
assert.ok(appCode.includes("reportKind"), "要記住結果面板屬於哪個階段");
assert.ok(appCode.includes('if (reportKind === "quest") startQuest()'), "再玩一次任務要看階段");
// 關卡按鈕要標出目前那關與已完成過的關
assert.ok(appCode.includes('class="${current ? "is-current" : ""}${done ? " is-done" : ""}"'), "關卡鈕要標目前與完成");
assert.ok(appCode.includes("renderLevelPicker();"), "過關後要重畫關卡鈕的完成標記");
assert.match(
  appCode,
  /function showQuest\(\)[\s\S]*?renderLevelPicker\(\);/,
  "每次換關（含按下一關）都要重畫左上角目前關卡"
);
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

/* ───── AI 語意補判（semantic-judge.mjs）────────────────────────── */

{
  const { judgeAiMeaning } = await import("../semantic-judge.mjs");
  const judgeSource = stripComments(read("apps/scenario-practice/village-life/semantic-judge.mjs"));

  // reasonable → 過（附 rationale）；unreasonable／undetermined → 不過但標 rejected。
  const passed = await judgeAiMeaning({
    translation: "我的名字叫 Kacaw。",
    targetChinese: "我的名字叫 Kacaw。",
    complete: async () => '{"verdict":"reasonable","rationale":"同一件事"}',
  });
  assert.deepEqual(passed, { pass: true, reason: "reasonable", rationale: "同一件事" }, "reasonable 要過並附一句 rationale");

  assert.deepEqual(
    await judgeAiMeaning({ translation: "我不知道", targetChinese: "我的名字是 Panay", complete: async () => '{"verdict":"unreasonable","rationale":"x"}' }),
    { pass: false, reason: "rejected", rationale: "x" }, "unreasonable 不能過，標 rejected",
  );
  assert.deepEqual(
    await judgeAiMeaning({ translation: "hello?", targetChinese: "我的名字是 Panay", complete: async () => '{"verdict":"undetermined","rationale":"x"}' }),
    { pass: false, reason: "rejected", rationale: "x" }, "undetermined 不能過，標 rejected",
  );

  // transport 失敗／回傳不是 JSON → failed（呼叫端端維持 retry 規則結果並說明）。
  assert.equal(
    (await judgeAiMeaning({ translation: "x", targetChinese: "y", complete: async () => { throw new Error("LLM proxy 逾時"); } })).reason,
    "failed", "LLM 失敗標 failed 當規則粗判降級",
  );
  assert.equal(
    (await judgeAiMeaning({ translation: "x", targetChinese: "y", complete: async () => "不是 JSON" })).reason,
    "failed", "回傳不是 JSON 標 failed",
  );

  // 沒有譯文或沒有教材中文時不發請求。
  let called = 0;
  await judgeAiMeaning({ translation: "  ", targetChinese: "y", complete: async () => { called += 1; return "{}"; } });
  await judgeAiMeaning({ translation: "x", targetChinese: "", complete: async () => { called += 1; return "{}"; } });
  assert.equal(called, 0, "沒有譯文或教材中文時不應打 LLM");

  // 送出的內容只含教材中文與譯文（防洩參考族語句），也不碰錄音。
  let sentUser = "";
  await judgeAiMeaning({
    translation: "還沒吃飯",
    targetChinese: "還沒吃早餐",
    complete: async ({ user }) => { sentUser = user; return '{"verdict":"reasonable"}'; },
  });
  assert.ok(sentUser.includes("目標中文：還沒吃早餐") && sentUser.includes("中文譯文：還沒吃飯"), "送 LLM 的內容要有目標中文與譯文");
  assert.ok(!judgeSource.includes("transcribe"), "AI 判別模組不碰語音辨識");
  assert.ok(!judgeSource.includes("transcribe"), "AI 判別模組不碰語音辨識");
  assert.ok(sentUser.split("\n").every((line) => !/[A-Za-z]/.test(line.replace(/^[^：]*：/, ""))
    || line.startsWith("目標中文") || line.startsWith("中文譯文")), "user 欄位只送目標中文與譯文");
  assert.ok(appCode.includes("judgeAiMeaning"), "app 要接上 AI 語意補判");
  assert.ok(appCode.includes("語意使用 vLLM AI 判別"), "服務狀態列要標示 AI 判別");
  // 防呆：wrongTarget 不能被 AI 升級成 semantic。
  assert.ok(appCode.includes('judged.verdict === "retry"'), "AI 補判只發生在 retry");
  assert.ok(appCode.includes("AI 判別暫時連不上"), "AI 連不上要在回應行註明，不能讓人誤會 AI 不懂");
  console.log("PASS: village life AI meaning judge (reasonable pass, failure keeps retry, no reference leak)");
}
