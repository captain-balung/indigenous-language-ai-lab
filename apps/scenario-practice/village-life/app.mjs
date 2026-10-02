import { createSingleFlight } from "../../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import {
  THEME_ORDER, addToBasket, buildExchanges, dialogueTheme, judgeBasket, judgeQuestLine,
  judgeQuestPick, judgeQuestPrompt, judgeReply, mineCount, placeNameTag, questHint,
  questIsComplete, questIsLearned, questLineFor, questOptionLocked, questOptions, questPack,
  questProgress, questResultDetail, questResultHeadline, questSceneOptions, respondableRoles,
  targetLabel,
  resultDetail, resultHeadline, tally, tallyLabel
} from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $("#setup"), ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), scene: $("#scene"), label: $("#dialect-label"), progress: $("#progress"),
  backSetup: $("#back-setup"), sceneIntro: $("#scene-intro"), backSetupReport: $("#back-setup-report"),
  themeGrid: $("#theme-grid"), roleGrid: $("#role-grid"), rolePicker: $("#role-picker"),
  sceneBody: $("#scene-body"), sceneSide: $(".scene-side"),
  background: $("#scene-background"), avatar: $("#scene-avatar"), speaker: $("#turn-speaker"),
  zh: $("#scene-title"), indigenous: $("#partner-text"),
  myTurn: $("#my-turn"), turnTitle: $("#turn-title"), answer: $("#answer"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"), recordNote: $("#record-note"),
  state: $("#record-state"), stateText: $("#record-state-text"),
  preview: $("#preview"), submit: $("#submit"), rerecord: $("#rerecord"), retry: $("#retry"),
  heard: $("#heard"), result: $("#result"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again"),
  questOffer: $("#quest-offer"), startQuest: $("#start-quest"), toQuest: $("#to-quest"),
  toDialogue: $("#to-dialogue"), questLevels: $("#quest-levels"),
  quest: $("#quest"), questLabel: $("#quest-label"), questCount: $("#quest-count"),
  questBack: $("#quest-back"), questProgress: $("#quest-progress"),
  questHint: $("#quest-hint"), questHintBox: $("#quest-hint-box"), questHintWords: $("#quest-hint-words"),
  questBody: $("#quest-body"), questSide: $("#quest-side"), questGoal: $("#quest-goal"),
  questScene: $("#quest-scene"), questSceneBox: $("#quest-scene-box"), questPlayer: $("#quest-player"),
  questLayers: $("#quest-layers"),
  questReward: $("#quest-reward"), questSpeaker: $("#quest-speaker"),
  questText: $("#quest-text"), questReply: $("#quest-reply"),
  questTags: $("#quest-tags"), questTagDock: $("#quest-tag-dock"),
  questReplay: $("#quest-replay"), questAudioState: $("#quest-audio-state"),
  questAudio: $("#quest-audio"), questNext: $("#quest-next")
};

const STATES = {
  idle: ["●", "尚未錄音，打字也可以送出"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成，可以送出或重錄"],
  converting: ["◐", "轉檔中…"],
  transcribing: ["◍", "辨識中，請稍候"],
  slow: ["◍", "辨識中，長句需要較久，請不要重新整理"],
  failed: ["△", "這次沒有送出"]
};

// 三個情境的主題鍵值固定在 core.mjs，這裡只是顯示用的說明文字。
const THEME_LABELS = {
  lesson: {
    name: "開學第一天",
    hint: "在校門口遇到同學，問名字、問來處、一起吃早餐。",
    quest: "問兩位同學的名字與住處，再借筆、借橡皮擦、拿掃把。"
  },
  find: {
    name: "家裡辦婚禮",
    hint: "親戚都來了，幫忙準備東西、找出要用的物品。",
    quest: "找出陶壺、月桃和檳榔，再點開門。"
  },
  outside: {
    name: "週末想出門",
    hint: "和哥哥約好去哪裡，先問過媽媽才出發。",
    quest: "買齊要帶的東西、找出往溪邊的路，再向借刀的人道謝。"
  }
};

let selectedDialect, shard, exchanges = [], index = 0, results = [];
let themeKey = THEME_ORDER[0], role = null, learnerName = "";
let pending = false, graded = false, unlocked = false, asrAudit = null, recorder = null, lastHeard = null;
// 辨識還沒回來就換句或換關時，舊的那次不能寫進新的畫面。
let runEpoch = 0;
// 「dialogue」是 STEP 2 的對話，「quest」是 STEP 4 的任務關卡。兩者共用同一個輸入面板
// （.scene-side 會被搬到關卡畫面），所以送出、錄音狀態都要知道現在是哪一關。
let mode = "dialogue";
let pack = null, quests = [], questIndex = 0, questState = null, questTarget = null, questTag = null, questResults = [];
// 結果面板是共用的，要記住現在顯示的是哪一階段的結果，「再練一次」才知道要重來哪個。
let reportKind = "dialogue";

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.state.dataset.state = key;
  ui.state.querySelector(".record-state__icon").textContent = icon;
  ui.stateText.textContent = override || text;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// 載入前先留一個接近的比例當版位，載入後用圖自己的固有比例。
// 三種來源寬高比不同（上課用語 1000×700、另外兩個主題 1000×707），
// 若寫死比例，object-fit:contain 就會在框內留一圈空白邊。
function setSceneImage(img, url) {
  img.style.removeProperty("aspect-ratio");
  img.src = url;
  img.onload = () => {
    if (img.naturalWidth > 0) img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  };
  img.onerror = () => img.style.removeProperty("aspect-ratio");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

async function init() {
  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));
  recorder = createRecorder({
    onState(state, blob) {
      if (state === "recording") {
        ui.record.classList.add("is-recording");
        ui.recordLabel.textContent = "停止錄音";
        setState("recording");
        return;
      }
      if (state === "recorded") {
        ui.record.classList.remove("is-recording");
        ui.recordLabel.textContent = "重新錄音";
        ui.rerecord.hidden = false;
        if (recorder.objectUrl) {
          ui.preview.src = recorder.objectUrl;
          ui.preview.hidden = false;
        }
        setState("recorded");
        updateSubmit();
        return;
      }
      if (blob) return;
      ui.record.classList.remove("is-recording");
      ui.recordLabel.textContent = "開始錄音";
      ui.preview.hidden = true;
      ui.preview.removeAttribute("src");
      ui.rerecord.hidden = true;
      setState("idle");
      updateSubmit();
    },
    onTick(seconds) { ui.time.textContent = clock(seconds); }
  });
  // 場景與角色一進來就先畫出來，方言別還沒選也看得到有哪三個場景。
  renderThemes();
  renderRoles();
  await verifyServices();
  if (!supportsRecording()) {
    ui.record.disabled = true;
    setState("failed", "這個瀏覽器不支援錄音，請改用打字");
  }
}

async function verifyServices() {
  const notes = [];
  try {
    const ids = await fetchLiveAsrDialects();
    if (!ids) throw new Error();
    asrAudit = auditAsrModels(ASR_MODELS, ids);
    notes.push(asrAudit.consistent ? "語音辨識服務已連線" : `語音辨識服務已連線；${asrAudit.unavailable.length} 個族別暫時無法辨識`);
  } catch {
    asrAudit = null;
    notes.push("語音辨識即時清單暫時無法取得，改以內建對照表送出");
  }
  try {
    const response = await fetch("https://ai3.iformosa.com.tw/formosan_ai/api.php?action=translate_languages", { signal: AbortSignal.timeout(12000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.language_codes)) throw new Error();
    notes.push(`翻譯服務已驗證 ${body.data.language_codes.length} 個語言代碼`);
  } catch {
    notes.push("翻譯即時清單暫時無法取得，送出時再試");
  }
  notes.push("說完一句就翻成中文，只顯示意思，不計分");
  ui.api.textContent = `● ${notes.join("；")}`;
  ui.api.dataset.state = asrAudit?.consistent ? "ok" : "fallback";
  // 服務檢查可能晚於教材載入回來，這時要讓「已載入幾輪對話」的訊息贏。
  if (shard) updateSceneNote();
  updateStart();
}

function asrStateFor(ethnicity) {
  const model = asrModelFor(ethnicity);
  if (!model) return { model: null, usable: false, reason: "這個語言別沒有對應的語音辨識模型" };
  const blocked = asrAudit?.unavailable.some((item) => item.model === model);
  return { model, usable: !blocked, reason: blocked ? "服務目前沒有提供這個族別的模型" : null };
}

function updateModelNote() {
  const ethnicity = ui.ethnicity.value;
  if (!ethnicity) { ui.modelNote.textContent = ""; return; }
  const { model, usable, reason } = asrStateFor(ethnicity);
  ui.modelNote.textContent = usable
    ? `${selectedDialect?.name || "所選方言"}將使用「${ethnicity}」族級模型 ${model} 進行辨識。打字作答不經過語音辨識。`
    : `${ethnicity}目前無法使用語音辨識：${reason}。仍可打字作答。`;
  ui.modelNote.dataset.blocked = usable ? "false" : "true";
}

function updateStart() { ui.start.disabled = !selectedDialect || !exchanges.length; }
// 任務關卡不會鎖住輸入：答錯要能立刻重說，所以只在「還沒選對象」「這關已經完成」
// 或沒輸入時擋住。
// 點了場景上的人就是在問他。借刀那關即使已經選好道謝對象，再點人仍是問借刀；
// 沒有點人、而且選好了對象，才說道謝。結語關沒有句子。
function questReadyToSpeak() {
  const quest = currentQuest();
  if (!quest || quest.goal.kind === "end") return false;
  if (quest.goal.kind === "selectAndSpeak" && questState?.picked && !questTarget) return true;
  return Boolean(questTarget);
}

function dropped(epoch) {
  if (epoch === runEpoch) return false;
  pending = false;
  updateSubmit();
  return true;
}

// 過關後不能再改選項，否則會把「過關了」蓋成「再試試看」。
// 辨識中也不能改，否則結果會寫到另一關。
function questLocked() {
  return pending || Boolean(questState?.done);
}

function updateSubmit() {
  if (mode === "quest") {
    ui.submit.disabled = pending || !questReadyToSpeak() || Boolean(questState?.done) || (!ui.answer.value.trim() && !recorder?.blob);
    return;
  }
  ui.submit.disabled = pending || graded || (!ui.answer.value.trim() && !recorder?.blob);
}

ui.ethnicity.addEventListener("change", () => {
  resetScene();
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  updateModelNote();
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetScene();
  selectedDialect = dialectById(ui.dialect.value);
  updateModelNote();
  loadScene();
});

ui.themeGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme]");
  if (!button) return;
  themeKey = button.dataset.theme;
  renderThemes();
  renderRoles();
  rebuildExchanges();
  updateSceneNote();
});

ui.roleGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  role = button.dataset.role;
  renderRoles();
  rebuildExchanges();
  updateSceneNote();
});

function renderThemes() {
  const available = new Set((shard?.themes ?? []).map((theme) => theme.key));
  ui.themeGrid.innerHTML = THEME_ORDER.filter((key) => !shard || available.has(key)).map((key) => {
    const label = THEME_LABELS[key] ?? { name: key, hint: "" };
    const selected = key === themeKey;
    return `<button type="button" class="theme${selected ? " is-selected" : ""}" data-theme="${key}" aria-pressed="${selected}">
      <strong>${escapeHtml(label.name)}</strong><small>${escapeHtml(label.hint)}</small></button>`;
  }).join("");
}

// 角色卡與狀態列只寫你要說幾句。
// 不判對錯的句子等送出結果與最後總結時再說明，不要在開始前先丟一句細節。
function roleNote(mine) {
  return `${mine.length} 句要說`;
}

// 開場說第一句的角色不開放扮演：開場白前面沒有任何台詞可以接，只會讓人憑空猜一句。
// 所以永遠由對方先開口；只有這齣有兩個以上可扮演的角色時才需要讓人挑，其餘在狀態列寫明就好。
function renderRoles() {
  const theme = dialogueTheme(shard, themeKey);
  const roles = respondableRoles(theme);
  if (!roles.some((item) => item.id === role)) role = roles[0]?.id ?? null;
  if (roles.length < 2) {
    ui.rolePicker.hidden = true;
    ui.roleGrid.innerHTML = "";
    return;
  }
  ui.rolePicker.hidden = false;
  ui.roleGrid.innerHTML = roles.map((item) => {
    const asLearner = buildExchanges(shard, themeKey, item.id).exchanges.filter((exchange) => exchange.mine);
    return `<button type="button" class="role${item.id === role ? " is-selected" : ""}" data-role="${escapeHtml(item.id)}" aria-pressed="${item.id === role}">
      <img src="${escapeHtml(item.imageUrl)}" alt="" aria-hidden="true">
      <strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(roleNote(asLearner))}</small></button>`;
  }).join("");
}

async function loadScene() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.start.disabled = true;
  ui.api.textContent = "正在載入情境對話…";
  ui.api.dataset.state = "fallback";
  try {
    const response = await fetch(`/data/hordequest/dialects/${dialect.id}.json`);
    if (!response.ok) throw new Error("情境教材載入失敗");
    shard = await response.json();
    if (selectedDialect !== dialect) return;
    renderThemes();
    renderRoles();
    rebuildExchanges();
    updateSceneNote();
  } catch (error) {
    pack = null;
    if (selectedDialect !== dialect) return;
    shard = undefined;
    exchanges = [];
    ui.api.textContent = `情境教材無法載入：${error.message}`;
    ui.api.dataset.state = "error";
  }
  updateStart();
}

// 頁面上顯示的主題名用「開學第一天」這種白話，而不是官方的「上課用語」。
function themeName() {
  return THEME_LABELS[themeKey]?.name ?? dialogueTheme(shard, themeKey).name;
}

function rebuildExchanges() {
  if (!shard) {
    exchanges = [];
    pack = null;
    quests = [];
  } else {
    const built = buildExchanges(shard, themeKey, role);
    exchanges = built.exchanges;
    learnerName = built.learnerName;
    const built2 = questPack(shard, themeKey);
    pack = built2;
    quests = built2.available ? built2.quests : [];
  }
  updateStart();
  updateQuestOffer();
}

function updateQuestOffer() {
  const ready = quests.length > 0;
  // 對話進行中也要能直接跳去玩任務，所以任務鈕不只在結果面板上。
  ui.startQuest.hidden = !ready || reportKind === "quest";
  ui.toQuest.hidden = !ready;
  ui.questOffer.hidden = !ready || reportKind === "quest";
  if (!ready) return;
  ui.questOffer.textContent = `這個場景還有 ${quests.length} 個任務：${THEME_LABELS[themeKey]?.quest ?? ""}`;
}

// 每句都會比對的時候不必多講一句；只有混著不判對錯的句子時才說明是哪些。
function updateSceneNote() {
  if (!shard) return;
  const theme = dialogueTheme(shard, themeKey);
  if (!exchanges.length) {
    ui.api.textContent = "△ 這個方言目前沒有可播放的情境對話";
    ui.api.dataset.state = "fallback";
    return;
  }
  const mine = mineCount(exchanges);
  const who = learnerName ? `你當${learnerName}，` : "";
  ui.api.textContent = `● ${theme.name}：已載入 ${theme.turns.length} 輪對話；${who}要說 ${mine} 句`;
  ui.api.dataset.state = "ok";
}

ui.start.addEventListener("click", () => {
  if (!exchanges.length) return;
  index = 0;
  results = [];
  ui.scene.hidden = false;
  ui.report.hidden = true;
  // 情境一旦開始就把 STEP 1 收起來，這一頁只留對話；要改設定再按「回到設定」。
  ui.setup.hidden = true;
  ui.sceneIntro.textContent = dialogueTheme(shard, themeKey).intro;
  showExchange();
  scrollToTop();
});

// STEP 1 與 STEP 2 各自是一個畫面：回到設定時收掉場景、清掉對話進度，
// 但語言別與已載入的教材留著，改角色或改方言別就能直接重來。
function showSetup() {
  resetProgress();
  ui.setup.hidden = false;
  ui.sceneIntro.textContent = "";
  updateSceneNote();
  ui.setup.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
}

ui.backSetup.addEventListener("click", showSetup);
ui.backSetupReport.addEventListener("click", showSetup);

function showExchange() {
  runEpoch += 1;
  const exchange = exchanges[index];
  // 防護：對話走完後 index 會等於句數（報告頁就是這個狀態）。
  // 萬一從任務按「回到對話」回到這裡，畫面會停在報告頁，
  // 不會去讀不存在的第 index+1 句、把整個場景弄壞。
  if (!exchange) { showReport(); return; }
  graded = false;
  lastHeard = null;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${themeName()} · 你當${learnerName}`;
  ui.progress.textContent = `第 ${index + 1} / ${exchanges.length} 句`;
  // 來源有三種寬高比（上課用語 1000×700、另外兩個主題 1000×707），
  // 所以圖載入後用它自己的固有比例，否則 object-fit:contain 會在框內留邊。
  setSceneImage(ui.background, exchange.backgroundUrl ?? "");
  ui.avatar.src = exchange.imageUrl || "";
  ui.speaker.textContent = exchange.mine ? `${exchange.speakerName}（換你說）` : `${exchange.speakerName}說`;
  // 換你說的那一句不能先露出中文：那是教材的參考句，先看到等於看到答案。
  // 只給對方的話看中文與族語，自己該說的那句等送出後才揭曉。
  ui.zh.textContent = exchange.mine ? "" : exchange.chineseText;
  ui.zh.hidden = exchange.mine;
  ui.indigenous.textContent = exchange.mine ? turnHint(exchange) : exchange.indigenousText;
  ui.myTurn.hidden = !exchange.mine;
  // 對方說話時右欄是空的，場景就佔滿整欄；有輸入區時才左右並排（兩欄同高）。
  ui.sceneBody.classList.toggle("scene-body--solo", !exchange.mine);
  ui.turnTitle.textContent = exchange.kind === "reference" ? "這句是你的名字或來處" : "換你說";
  ui.answer.value = "";
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.next.hidden = true;
  ui.retry.hidden = true;
  clearRecording();
  clearTimeout(unlockTimer);
  unlocked = false;
  prepareAudio(exchange.audioUrl);
  if (exchange.mine) {
    const canRecord = supportsRecording() && asrStateFor(selectedDialect.ethnicity).usable;
    ui.record.disabled = !canRecord;
    updateSubmit();
    ui.answer.focus();
  } else {
    // 對方的台詞不能按「下一句」跳過：得先讓它自己播完，播完（或播不成）
    // 才解鎖下一步按鈕，否則使用者會卡在這一句、也不知道要幹嘛。
    playCurrent();
  }
}

// 對方台詞的「下一句」：音檔播完（或播不成）之後才出現。
let unlockTimer = null;

function unlockPartnerTurn() {
  if (unlocked) return;
  unlocked = true;
  if (exchanges[index]?.mine) return;
  ui.next.hidden = false;
  ui.next.textContent = index + 1 >= exchanges.length ? "看這段結果" : "接下一句 →";
  ui.next.focus();
}

// 有些瀏覽器在 ended 不會照順序回來（自動播放被擋、來源中途改變），
// 所以放一個看門的計時器：時間到就放行，不能讓這一句變成死路。
function armPartnerUnlock(milliseconds) {
  clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => {
    if (ui.audioState.dataset.state === "playing") setAudioState("failed", "音檔沒有播完，可以按播放重試");
    unlockPartnerTurn();
  }, milliseconds);
}

function prepareAudio(url) {
  ui.player.pause();
  ui.player.src = url;
  setAudioState("idle", "想聽再按播放");
  ui.replay.disabled = !url;
}

// 換你說的時候，場景區要說明「現在該做什麼」，但不能說出這句的內容。
// 參考句只是自我介紹與來處，提示可以講明要說什麼類型；比對句則提示接續對方的話。
// 開場那一句前面沒有人說過話，寫成「接著X的話」會變成「接著的話」，要另外處理。
function turnHint(exchange) {
  if (exchange.kind === "reference") return "用族語說出自己的名字或來處。";
  if (!exchange.partnerName) return "這是對話的第一句，用族語開口。";
  return `接著${exchange.partnerName}的話，用族語回應。`;
}

function playCurrent() {
  if (!ui.player.src) {
    setAudioState("failed", "本句沒有音檔");
    unlockPartnerTurn();
    return;
  }
  setAudioState("playing", "播放中…");
  const play = ui.player.play();
  if (play && typeof play.catch === "function") {
    play.catch(() => {
      setAudioState("failed", "無法播放，請再試一次");
      unlockPartnerTurn();
    });
  }
  // 每句教材錄音都很短，20 秒還沒結束就當它卡住了。
  armPartnerUnlock(20000);
}

function setAudioState(state, text) {
  ui.audioState.dataset.state = state;
  ui.audioState.textContent = text;
}

// 已經解鎖之後又按重播，不要把焦點從使用者身上搶回來。
ui.replay.addEventListener("click", playCurrent);
ui.player.addEventListener("ended", () => {
  setAudioState("ended", "播放結束");
  const shouldFocus = !unlocked;
  unlockPartnerTurn();
  if (!shouldFocus) ui.replay.focus();
});
ui.player.addEventListener("error", () => {
  if (!ui.player.src) return;
  setAudioState("failed", "音檔載入失敗");
  // 音檔壞掉不能變成死路：仍然讓使用者能往下走。
  unlockPartnerTurn();
});

ui.record.addEventListener("click", async () => {
  if (!recorder || graded || pending) return;
  if (recorder.recording) { recorder.stop(); return; }
  ui.player.pause();
  if (ui.audioState.dataset.state === "playing") setAudioState("ended", "已停止播放");
  try {
    await recorder.start();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    const missing = error?.name === "NotFoundError";
    setState("failed", denied ? "沒有麥克風權限" : missing ? "找不到可用的麥克風" : "麥克風啟動失敗");
    // 麥克風不能用只是換一種輸入方式，不該把這一句判成結束或未完成，
    // 所以只在錄音列說明原因，打字框繼續留著。
    if (denied || missing) {
      ui.recordNote.textContent = denied
        ? "瀏覽器沒有給這個頁面麥克風權限。可以在網址列允許麥克風後再錄，或直接用打字送出。"
        : "這台裝置沒有可用的麥克風，請用打字送出。";
    }
  }
});

function clearRecordNote() {
  ui.recordNote.textContent = "";
}

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });
ui.answer.addEventListener("input", updateSubmit);
// 同一顆送出鈕服務兩個畫面：現在在對話就送對話，現在在任務就送任務那句。
ui.submit.addEventListener("click", () => { if (mode === "quest") runQuestLine(); else runExchange(); });
ui.retry.addEventListener("click", () => { if (mode === "quest") runQuestLine(); else runExchange(); });
ui.next.addEventListener("click", () => {
  index += 1;
  if (index >= exchanges.length) showReport();
  else showExchange();
});

function clearRecording() {
  lastHeard = null;
  recorder?.clear();
  ui.time.textContent = "00:00";
  clearRecordNote();
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "開始錄音";
  ui.preview.hidden = true;
  ui.preview.removeAttribute("src");
  ui.rerecord.hidden = true;
  setState("idle");
  updateSubmit();
}

const runExchange = createSingleFlight(async () => {
  const exchange = exchanges[index];
  const typed = ui.answer.value.trim();
  const epoch = runEpoch;
  if (!exchange || pending || graded || (!typed && !recorder?.blob)) return;
  pending = true;
  ui.submit.disabled = true;
  ui.retry.disabled = true;
  ui.record.disabled = true;

  let indigenous = typed;
  if (!indigenous) {
    let wav;
    setState("converting");
    try {
      wav = await convertToAsrWav(recorder.blob);
    } catch (error) {
      if (dropped(epoch)) return;
      setState("failed", "轉檔失敗，沒有送出");
      showResult("unavailable", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      finish();
      return;
    }
    if (dropped(epoch)) return;
    setState("transcribing");
    const slowHint = setTimeout(() => { if (epoch === runEpoch) setState("slow"); }, SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      lastHeard = indigenous;
      renderHeard(indigenous);
    } catch (error) {
      clearTimeout(slowHint);
      if (dropped(epoch)) return;
      setState("failed", "這次沒有辨識成功");
      showResult("unavailable", `目前無法辨識（${error.message}），你這句還沒有被判錯。`);
      ui.retry.hidden = false;
      finish();
      return;
    }
    clearTimeout(slowHint);
    if (dropped(epoch)) return;
  }

  let translation = "";
  try {
    translation = await translateToZh(indigenous, selectedDialect.code);
  } catch (error) {
    if (dropped(epoch)) return;
    setState("failed", "這次沒有翻譯成功");
    showResult("unavailable", `目前無法翻譯（${error.message}），你這句還沒有被判錯。`);
    ui.retry.hidden = false;
    finish();
    return;
  }
  if (dropped(epoch)) return;

  // 參考句要說的是自己的名字或來處，跟教材本來就不同，只顯示不判定。
  const type = exchange.kind === "reference"
    ? "reference"
    : judgeReply({ answer: indigenous, translation, exchange });
  results[index] = type;
  renderResult(type, { indigenous, translation });
  finish();
});

function finish() {
  pending = false;
  ui.retry.disabled = false;
  ui.record.disabled = !(supportsRecording() && selectedDialect && asrStateFor(selectedDialect.ethnicity).usable);
  updateSubmit();
}

function renderHeard(text) {
  ui.heard.hidden = false;
  ui.heard.innerHTML = `<strong>系統聽到的是</strong><p class="heard-text">${escapeHtml(text)}</p>
    <small>這是語音辨識的結果。如果和你念的不一樣，可能是族級模型的限制，不代表你念錯。</small>`;
}

function renderResult(type, { indigenous, translation }) {
  const exchange = exchanges[index];
  ui.result.hidden = false;
  ui.result.dataset.state = type;
  const yours = lastHeard ? "系統聽到的族語" : "你的族語";
  // 送出後就把麥克風提示收掉，否則它會一直擋在這一頁的說明裡。
  clearRecordNote();
  ui.result.innerHTML = `<strong>${resultHeadline(type)}</strong><p>${resultDetail(type)}</p>
    <dl><dt>${yours}</dt><dd>${escapeHtml(indigenous)}</dd>
    <dt>系統懂成</dt><dd>${escapeHtml(translation)}</dd>
    <dt>教材族語</dt><dd>${escapeHtml(exchange.indigenousText)}</dd>
    <dt>教材中文</dt><dd>${escapeHtml(exchange.chineseText)}</dd></dl>`;
  graded = true;
  ui.submit.disabled = true;
  ui.record.disabled = true;
  ui.next.hidden = false;
  ui.next.textContent = index + 1 >= exchanges.length ? "看這段結果" : "下一句 →";
  ui.next.focus();
}

// 失敗路徑：只顯示訊息，不鎖住這一句。
// 如果在這裡設 graded = true，runExchange 開頭會直接 return，「重試判定」按了也不會有任何反應。
function showResult(state, text) {
  ui.result.hidden = false;
  ui.result.dataset.state = "unavailable";
  ui.result.textContent = text;
  results[index] = state;
  ui.next.hidden = false;
  updateSubmit();
}

function showReport() {
  ui.scene.hidden = true;
  ui.report.hidden = false;
  // results 以對話位置為索引，只有學者該說的句子會有值。
  const summary = tally(results.filter((item) => typeof item === "string"));
  const referenceNote = summary.reference ? `，${summary.reference} 句是自己的名字和來處，不判對錯` : "";
  ui.score.textContent = `${tallyLabel(summary)}${referenceNote}`;
  ui.list.innerHTML = exchanges
    .map((exchange, position) => ({ exchange, type: results[position] ?? "unavailable" }))
    .filter((item) => item.exchange.mine)
    .map(({ exchange, type }) => {
      const detail = type === "unavailable"
        ? "沒有完成判定，不算答錯。"
        : `${resultDetail(type)}教材：${exchange.chineseText}`;
      return `<li><strong>${escapeHtml(exchange.speakerName)}｜${escapeHtml(resultHeadline(type))}</strong><p>${escapeHtml(detail)}</p></li>`;
    }).join("");
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  updateStart();
  reportKind = "dialogue";
  ui.toDialogue.hidden = true;
  ui.again.textContent = "再練一次";
  updateQuestOffer();
}

ui.again.addEventListener("click", () => {
  // 結果面板是共用的：「再練一次」要看剛才是哪個階段的結果。
  if (reportKind === "quest") { startQuest(); return; }
  index = 0;
  results = [];
  ui.report.hidden = true;
  ui.scene.hidden = false;
  showExchange();
  scrollToTop();
});

// ── STEP 4：任務關卡 ────────────────────────────────────────────
// 官方 phase2 讓學者拖詞卡拼句子，這裡換成自己說：先點一位同學，再錄音或打字。
// 輸入面板沿用 STEP 2 的那一個（把 .scene-side 搬過來），錄音、翻譯、判定都共用。

// 把輸入面板搬到關卡畫面；回到對話時再搬回去。搬的是同一個節點，
// 所以事件監聽與 recorder 的狀態都不會斷掉。
function mountInputPanel(host) {
  if (ui.myTurn.closest(".scene-side") !== host) host.append(ui.sceneSide);
}

// 進任務關卡。level 省略時從第 1 關開始（「再玩一次任務」）；
// 對話進行中也可以直接進來，questResults 留著，切回去時對話停在原來那一輪。
function startQuest(level) {
  if (!quests.length) return;
  mode = "quest";
  questIndex = Number.isInteger(level) && level >= 0 && level < quests.length ? level : 0;
  if (!Number.isInteger(level)) questResults = [];
  mountInputPanel(ui.questSide);
  ui.scene.hidden = true;
  ui.report.hidden = true;
  ui.setup.hidden = true;
  ui.quest.hidden = false;
  setSceneImage(ui.questScene, pack.sceneUrl ?? "");
  // 這兩個主題沒有獨立的主角圖層（主角畫在場景圖裡），先把 src 收掉，
  // 否則畫面左上角會先出現一個壞圖示。
  ui.questPlayer.hidden = true;
  ui.questPlayer.removeAttribute("src");
  showQuest();
  renderLevelPicker();
  scrollToTop();
}

// 從任務切回對話。兩個階段共用一個輸入面板，所以要先把面板搬回去。
// 對話的進度（index、results）都留著，切回去還是原來那一句。
function backToDialogue() {
  ui.quest.hidden = true;
  ui.report.hidden = true;
  mountInputPanel(ui.sceneBody);
  mode = "dialogue";
  resetQuestRun();
  ui.scene.hidden = false;
  if (exchanges.length) showExchange();
  else { ui.setup.hidden = false; updateSceneNote(); }
  scrollToTop();
}

// 關卡選擇：想重玩第幾關就直接點。已完成過的關卡標 ✓，正在玩的那關標成 current。
function renderLevelPicker() {
  ui.questLevels.innerHTML = quests.map((quest, position) => {
    const current = position === questIndex;
    const done = Boolean(questResults[position]);
    return `<button type="button" class="${current ? "is-current" : ""}${done ? " is-done" : ""}"
      data-level="${position}" aria-current="${current ? "true" : "false"}"
      aria-label="第 ${quest.order} 關${done ? "（已完成）" : ""}">${quest.order}</button>`;
  }).join("");
}

ui.questLevels.addEventListener("click", (event) => {
  if (pending) return;
  const button = event.target.closest("[data-level]");
  if (!button) return;
  questIndex = Number(button.dataset.level);
  showQuest();
  renderLevelPicker();
});

ui.toQuest.addEventListener("click", () => startQuest());
ui.toDialogue.addEventListener("click", backToDialogue);
ui.startQuest.addEventListener("click", startQuest);
ui.questBack.addEventListener("click", backToDialogue);

function currentQuest() {
  return quests[questIndex] ?? null;
}

function resetQuestRun() {
  runEpoch += 1;
  questState = { learned: [], placed: {}, taken: [], picked: null, done: false };
  questTarget = null;
  questTag = null;
  ui.questReward.hidden = true;
  ui.questReward.removeAttribute("src");
  ui.questTags.hidden = true;
  ui.questHintBox.hidden = true;
  ui.questNext.hidden = true;
  ui.questReply.textContent = "";
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.questGoal.hidden = true;
  ui.questGoal.innerHTML = "";
  ui.questLayers.innerHTML = "";
}

// 場景疊圖與可點區。座標全部來自教材（已換算成百分比），所以疊在場景上就好。
// 上課用語的人物圖不在 props 裡，另外補一層；尋找物品與戶外活動的 setup.img
// 已經包含人物圖，就不要重複疊。
function renderQuestLayers(quest) {
  const parts = [];
  const propIds = new Set();
  for (const prop of quest.props ?? []) {
    propIds.add(prop.id);
    parts.push(`<img class="quest-layer" src="${escapeHtml(prop.imageUrl)}" alt="" aria-hidden="true">`);
  }
  for (const target of quest.targets) {
    if (!propIds.has(target.id)) {
      parts.push(`<img class="quest-layer" src="${escapeHtml(target.imageUrl)}" alt="${escapeHtml(target.name ?? "")}" aria-hidden="true">`);
    }
  }
  for (const target of quest.targets) {
    parts.push(`<button type="button" class="quest-target" data-target="${escapeHtml(target.id)}"
      style="${boxStyle(target.box)}" aria-pressed="false" aria-label="${targetLabel(target.id, quest)}的人，點一下選他"></button>`);
  }
  // take 的候選直接放在場景裡（官方就是這樣），click 的可點區也是。
  for (const option of questSceneOptions(quest)) {
    parts.push(`<button type="button" class="quest-option" data-option="${escapeHtml(option.id)}"
      style="${boxStyle(option.box)}" aria-label="放進籃子"></button>`);
  }
  if (quest.goal.kind === "click" && quest.goal.box) {
    parts.push(`<button type="button" class="quest-click" data-click="1" style="${boxStyle(quest.goal.box)}"
      aria-label="點這裡"></button>`);
  }
  ui.questLayers.innerHTML = parts.join("");
}

function questCompleteLine(quest) {
  if (quest.goal.kind === "end") return "任務結束了。";
  if (quest.goal.kind === "nameTags") return "名牌都放對了。";
  if (quest.goal.kind === "click") return "找到答案了。";
  return "這關過關了。";
}

function boxStyle(box) {
  if (!box) return "";
  return Object.entries(box)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value}%`)
    .join(";");
}

// 右欄的目標面板：選項清單（select／selectAndSpeak）、購物籃（take）、
// 或者結語（end）。上課用具牌 dock 在對話卡裡，所以這裡是空的。
function renderQuestGoal(quest) {
  const goal = quest.goal;
  if (goal.kind === "select" || goal.kind === "selectAndSpeak") {
    ui.questGoal.hidden = false;
    ui.questGoal.innerHTML = `<h3>${goal.kind === "selectAndSpeak" ? "選要道謝的人" : "挑出正確的那一個"}</h3>
      <div class="quest-options">${questOptions(quest).map((option) => `
        <button type="button" class="quest-option-btn${questState.picked === option.id ? " is-picked" : ""}"
          data-pick="${escapeHtml(option.id)}" aria-pressed="${questState.picked === option.id}">
          <img src="${escapeHtml(option.imageUrl)}" alt="${escapeHtml(option.name ?? "")}">
        </button>`).join("")}</div>`;
    return;
  }
  if (goal.kind === "take") {
    ui.questGoal.hidden = false;
    // 購物清單放右欄而不是壓在場景上的任務卡：戶外活動第一關有 7 項，
    // 放進卡片會把上半個場景蓋掉。
    const list = quest.buylist?.length
      ? `<h3>購物清單</h3><ul class="quest-shopping">${quest.buylist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
    // 窄螢幕時場景裡的東西只有 30幾個像素寬（小到不好點），所以下面多給一列按鈕；
    // 寬螢幕就藏起來，讓人直接點場景（官方也是這樣）。
    const fallback = `<div class="quest-options quest-options--compact">${questSceneOptions(quest).map((option) => `
      <button type="button" class="quest-option-btn${(questState.taken ?? []).includes(option.id) ? " is-picked" : ""}"
        data-pick="${escapeHtml(option.id)}" aria-pressed="${(questState.taken ?? []).includes(option.id)}"
        aria-label="放進籃子">
        <img src="${escapeHtml(option.imageUrl)}" alt="">
      </button>`).join("")}</div>`;
    ui.questGoal.innerHTML = `${list}<h3>購物籃（${questState.taken.length}/${goal.answers.length}）</h3>
      <div class="quest-basket" id="quest-basket">${renderBasket(quest)}</div>
      <button type="button" class="primary" id="basket-confirm" ${questState.taken.length ? "" : "disabled"}>確定</button>
      ${fallback}`;
    return;
  }
  if (goal.kind === "end") {
    ui.questGoal.hidden = false;
    ui.questGoal.innerHTML = `<h3>任務結束</h3><p class="quest-end">${escapeHtml(goal.endText)}</p>
      <div class="submit-row"><button type="button" class="primary" id="quest-end-next">${questIndex + 1 >= quests.length ? "看任務結果" : "下一關 →"}</button></div>`;
    return;
  }
  if (goal.kind === "click") {
    ui.questGoal.hidden = false;
    ui.questGoal.innerHTML = `<h3>接下來要做</h3><p>${escapeHtml(questHint(quest, questState))}</p>`;
    return;
  }
  ui.questGoal.hidden = true;
  ui.questGoal.innerHTML = "";
}

function renderBasket(quest) {
  if (!questState.taken.length) return `<p class="quest-basket-empty">點場景裡的東西放進來</p>`;
  // 籃子裡的東西可以點出來（官方也是這樣）：放錯了要能自己拿回去換，
  // 否則只能靠再點別的東西把它擠掉，那個行為看不出來。
  return questState.taken.map((id, index) => {
    const option = questOptions(quest).find((item) => item.id === id);
    if (!option) return "";
    return `<button type="button" class="quest-basket__item" data-remove="${escapeHtml(id)}" data-index="${index}"
      aria-label="拿出籃子">
      <img src="${escapeHtml(option.imageUrl)}" alt=""><span aria-hidden="true">×</span></button>`;
  }).join("");
}

function showQuest() {
  const quest = currentQuest();
  if (!quest) return;
  resetQuestRun();
  ui.questLabel.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${themeName()} · 任務`;
  ui.questCount.textContent = `第 ${questIndex + 1} / ${quests.length} 關`;
  ui.questText.textContent = quest.quest;
  ui.questSpeaker.textContent = "任務";
  ui.questHintWords.innerHTML = (quest.hintWords ?? []).map((word) => `<li>${escapeHtml(String(word).replace(/[，。！？、,.!?]/g, ""))}</li>`).join("");
  setSceneImage(ui.questScene, quest.sceneUrl || pack.sceneUrl || "");
  // 主角是上課用語才有的獨立圖層，尋找物品與戶外活動的主角畫在場景裡。
  // 主角是獨立的整幅圖層，只有上課用語有；尋找物品與戶外活動的主角畫在場景圖裡。
  // 沒有圖就整個隱藏：src 留空字串但沒隱藏的 <img> 會在左上角顯示壞掉的圖示。
  const playerImage = quest.props?.length ? "" : pack.playerImageUrl;
  ui.questPlayer.hidden = !playerImage;
  ui.questPlayer.src = playerImage;
  if (!playerImage) ui.questPlayer.removeAttribute("src");
  renderQuestLayers(quest);
  renderQuestGoal(quest);
  syncQuestMarks();
  updateQuestProgress();
  clearRecording();
  ui.questAudio.pause();
  ui.questAudio.removeAttribute("src");
  setQuestAudioState("idle", "想聽再按播放");
  ui.questReplay.disabled = true;
  ui.turnTitle.textContent = "換你說";
  // 輸入面板是從 STEP 2 搬過來的，那邊最後一輪可能是對方在說、面板是收起的，
  // 搬過來要自己打開，否則右欄會是空的。結語關沒有要說的句子，面板留著只會是空的送出鈕。
  ui.myTurn.hidden = quest.goal.kind === "end";
  if (quest.goal.kind === "end") {
    questState.done = true;
    questResults[questIndex] = { order: quest.order, quest: quest.quest, ok: true };
    renderLevelPicker();
  }
  ui.retry.hidden = true;
  focusFirstTarget();
}

// 已問過的人、已放進籃子的東西、已選好的選項，都要在畫面上留痕。
function syncQuestMarks() {
  const quest = currentQuest();
  if (!quest) return;
  for (const button of ui.questLayers.querySelectorAll("[data-target]")) {
    const learned = questIsLearned(quest, button.dataset.target, questState);
    button.classList.toggle("is-asked", learned);
    button.setAttribute("aria-pressed", String(button.dataset.target === questTarget));
    button.classList.toggle("is-selected", button.dataset.target === questTarget);
    const name = questState.placed?.[button.dataset.target];
    // 名牌 slot 要自己生：可點框是每一關動態產生的，不會附帶名牌 span。
    // 少了這一段，放對的名牌不會出現在桌上（畫面看起來像沒放上去）。
    let slot = button.querySelector(".quest-target__tag");
    if (name && !slot) {
      slot = document.createElement("span");
      slot.className = "quest-target__tag";
      button.append(slot);
    }
    if (slot) {
      slot.textContent = name ?? "";
      slot.hidden = !name;
    }
  }
  for (const button of ui.questLayers.querySelectorAll("[data-option]")) {
    const id = button.dataset.option;
    const locked = questOptionLocked(quest, id, questState);
    button.classList.toggle("is-locked", locked);
    button.classList.toggle("is-taken", (questState.taken ?? []).includes(id));
    // 用 aria-disabled 而不是 disabled：實心按鈕點了不會觸發，就沒辦法告訴他
    // 為什麼不能拿、該先去問誰。
    button.setAttribute("aria-disabled", String(locked));
  }
  for (const button of ui.questGoal.querySelectorAll("[data-pick]")) {
    const id = button.dataset.pick;
    // take 的按鈕代表「已在籃子裡」，不是 select 那種單一 picked。
    const on = quest.goal.kind === "take" ? (questState.taken ?? []).includes(id) : id === questState.picked;
    button.classList.toggle("is-picked", on);
    button.setAttribute("aria-pressed", String(on));
  }
}

function updateQuestProgress() {
  const quest = currentQuest();
  if (!quest) return;
  const state = questState;
  ui.questProgress.textContent = questProgress(quest, state);
  const placedCount = Object.keys(state.placed ?? {}).length;
  const total = quest.targets.length;
  // 問完兩位同學才放出名牌：名牌上的名字要從剛才聽到的回答來的。
  const allLearned = quest.targets.every((target) => questIsLearned(quest, target.id, state));
  if (quest.goal.kind === "nameTags" && allLearned && !questIsComplete(quest, state)) {
    if (ui.questTags.hidden) renderTagDock(quest);
  } else if (quest.goal.kind === "nameTags" && !allLearned) {
    ui.questTags.hidden = true;
  }
  if (quest.goal.kind !== "nameTags") ui.questTags.hidden = true;
  if (placedCount && placedCount < total) ui.questProgress.textContent += `（已放 ${placedCount} 張）`;
  syncQuestMarks();
}

function renderTagDock(quest) {
  ui.questTags.hidden = false;
  questTag = null;
  ui.questTagDock.innerHTML = quest.goal.choices.map((choice) => (
    `<button type="button" class="quest-tag" data-tag="${escapeHtml(choice)}" aria-pressed="false">${escapeHtml(choice)}</button>`
  )).join("");
}

function focusFirstTarget() {
  const quest = currentQuest();
  const next = quest?.targets.find((target) => !questIsLearned(quest, target.id, questState));
  const button = ui.questLayers.querySelector(`[data-target="${next?.id ?? ""}"]`);
  if (button && !reduced()) button.focus({ preventScroll: true });
}

function selectTarget(targetId) {
  const quest = currentQuest();
  if (!quest) return;
  if (questIsLearned(quest, targetId, questState)) return;
  questTarget = targetId;
  questTag = null;
  for (const chip of ui.questTagDock.querySelectorAll(".quest-tag")) chip.classList.remove("is-selected");
  ui.turnTitle.textContent = "換你說";
  ui.questSpeaker.textContent = "換你說";
  syncQuestMarks();
  updateSubmit();
  ui.answer.focus();
}

// 場景上的點擊全部用事件委派處理：圖層與可點區是每一關重新產生的，
// 直接綁在按鈕上的話換關就失效了。
ui.questLayers.addEventListener("click", (event) => {
  if (questLocked()) return;
  const quest = currentQuest();
  if (!quest) return;
  const target = event.target.closest("[data-target]");
  if (target) {
    const targetId = target.dataset.target;
    // 名牌階段手上有名牌時，這一下是「把名牌放到這位同學桌上」；
    // 還沒問完兩位同學時名牌還沒放出來，點同學只是換一位要問的人。
    if (quest.goal.kind === "nameTags" && questTag) placeTag(targetId);
    else selectTarget(targetId);
    return;
  }
  const option = event.target.closest("[data-option]");
  if (option) { pickSceneOption(option.dataset.option); return; }
  if (event.target.closest("[data-click]")) handleQuestClick();
});

ui.questTagDock.addEventListener("click", (event) => {
  if (questLocked()) return;
  const chip = event.target.closest("[data-tag]");
  if (!chip || chip.classList.contains("is-used")) return;
  questTag = chip.dataset.tag;
  for (const other of ui.questTagDock.querySelectorAll(".quest-tag")) {
    const on = other === chip;
    other.classList.toggle("is-selected", on);
    other.setAttribute("aria-pressed", String(on));
  }
  ui.questSpeaker.textContent = `把「${questTag}」放到對的同學桌上`;
  // 焦點要移到還沒放名牌的那位。這裡原本誤用了全域的 quest（只在別的函式裡有定義），
  // 點名牌就會在 console 噴錯、焦點也不會移動。
  const current = currentQuest();
  const pendingId = (current?.targets ?? []).find((item) => !questState.placed?.[item.id])?.id ?? "";
  const target = ui.questLayers.querySelector(`[data-target="${pendingId}"]`);
  if (target && !reduced()) target.focus({ preventScroll: true });
});

// 目標面板的點擊：選項清單、購物籃的確定、結語的下一關。
ui.questGoal.addEventListener("click", (event) => {
  if (pending) return;
  // 結語關一進來就算完成，下一關按鈕仍要能點。其餘過關後不能再改答案。
  if (questState?.done && !event.target.closest("#quest-end-next")) return;
  // 籃子裡的東西點一下就拿出來（官方行為）：放錯了要能自己拿回去換。
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const quest = currentQuest();
    if (!quest) return;
    questState.taken = questState.taken.filter((_, index) => index !== Number(remove.dataset.index));
    clearQuestResult();
    renderQuestGoal(quest);
    updateQuestProgress();
    ui.questSpeaker.textContent = "拿出來了，再看看要拿什麼";
    return;
  }
  const pick = event.target.closest("[data-pick]");
  if (pick) {
    // take 關的按鈕列是「放進籃子」，select／selectAndSpeak 的按鈕是「選這個」。
    if (currentQuest()?.goal.kind === "take") pickSceneOption(pick.dataset.pick);
    else pickQuestOption(pick.dataset.pick);
    return;
  }
  if (event.target.closest("#basket-confirm")) { confirmBasket(); return; }
  if (event.target.closest("#quest-end-next")) {
    questIndex += 1;
    if (questIndex >= quests.length) showQuestReport();
    else showQuest();
    renderLevelPicker();
  }
});

// take：點場景裡的東西放進籃子。
function pickSceneOption(optionId) {
  const quest = currentQuest();
  if (!quest) return;
  const outcome = addToBasket(quest, optionId, questState);
  questState.taken = outcome.taken;
  if (outcome.reason === "locked") {
    const who = targetLabel(quest.goal.unlock?.targetId, quest);
    renderQuestResult("retry", { detail: `這個還不能拿，先問問${who}的人，他才知道東西在哪裡。`, lines: [] });
    return;
  }
  if (outcome.reason === "already") {
    ui.questSpeaker.textContent = "這個已經在籃子裡";
    return;
  }
  // 籃子的內容變了，上一次的結果訊息就不再適用。
  // 不清掉的話，放進去的時候畫面還停在「東西不對」，會以為每一個都錯。
  clearQuestResult();
  renderQuestGoal(quest);
  updateQuestProgress();
  const need = quest.goal.answers.length;
  // 還沒問到人、籃子裡的東西就還不對，引導方向應該是先問人，
  // 不要急著叫人去按「確定」。
  const stillLocked = quest.goal.lock
    && !(questState.learned ?? []).includes(quest.goal.unlock?.targetId);
  ui.questSpeaker.textContent = stillLocked
    ? `先問問${targetLabel(quest.goal.unlock?.targetId, quest)}的人，才知道要拿什麼`
    : questState.taken.length >= need
      ? `放進籃子了，按「確定」看看有沒有拿對`
      : `放進籃子了，再看看還缺什麼（${questState.taken.length}/${need}）`;
}

// take：按確定才判對錯（官方也是這樣，順序不影響結果）。
function confirmBasket() {
  const quest = currentQuest();
  if (!quest) return;
  const ok = judgeBasket(quest, questState.taken);
  if (ok) { finishQuest(); return; }
  // 還沒問到人的話，問題不是「拿錯東西」而是「還不知道要拿什麼」，
  // 直接說「東西不對」會讓人一直換著按。
  if (quest.goal.lock && !(questState.learned ?? []).includes(quest.goal.unlock?.targetId)) {
    const who = targetLabel(quest.goal.unlock?.targetId, quest);
    renderQuestResult("retry", { detail: `還不能確定，${who}的人還沒告訴你東西在哪裡。籃子裡的可以拿出來換。`, lines: [] });
    return;
  }
  if (!questState.taken.length) {
    renderQuestResult("retry", { detail: "籃子還是空的，先點場景裡的東西。", lines: [] });
    return;
  }
  renderQuestResult("retry", { detail: "籃子裡的東西還不對，再看看剛才問到的線索；點籃子裡的可以拿出來換。", lines: [] });
}

// select：選一個就判。
function pickQuestOption(optionId) {
  const quest = currentQuest();
  if (!quest) return;
  const outcome = judgeQuestPick(quest, optionId, questState);
  if (quest.goal.kind === "selectAndSpeak") {
    if (!outcome.ok) {
      renderQuestResult("retry", { detail: "這個不是，再看看線索。", lines: [] });
      return;
    }
    questState.picked = optionId;
    questTarget = null;
    clearQuestResult();
    renderQuestGoal(quest);
    updateQuestProgress();
    ui.questSpeaker.textContent = quest.goal.promptChinese
      ? `換你說「${quest.goal.promptChinese}」`
      : "換你說出那句話";
    ui.answer.focus();
    updateSubmit();
    return;
  }
  if (outcome.ok) { finishQuest(); return; }
  renderQuestResult("retry", { detail: "這個不是，再看看線索。", lines: [] });
}

// click：官方是點下去就換背景、播收尾台詞。
function handleQuestClick() {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "click") return;
  if (quest.goal.backgroundUrl) {
    setSceneImage(ui.questScene, quest.goal.backgroundUrl);
    ui.questLayers.innerHTML = "";
    ui.questPlayer.hidden = true;
  }
  finishQuest();
}

function placeTag(targetId) {
  const quest = currentQuest();
  if (!quest || !questTag) return;
  const outcome = placeNameTag(quest, { tag: questTag, targetId, state: questState });
  questState.placed = outcome.placed;
  // 放對才貼到桌上、名牌才收起來；放錯就留在手上，學習者可以換一張再試。
  if (outcome.reason === "correct") {
    const chip = [...ui.questTagDock.querySelectorAll(".quest-tag")].find((item) => item.dataset.tag === questTag);
    if (chip) { chip.classList.add("is-used"); chip.setAttribute("aria-disabled", "true"); }
    questTag = null;
  }
  const tagDetail = outcome.reason === "correct"
    ? "名牌放對了。"
    : outcome.reason === "locked"
      ? "這位已經放好名牌了。"
      : "這張不是這位同學的名牌，再看看剛才的回答。";
  renderQuestResult(outcome.ok ? "exact" : "retry", {
    detail: tagDetail,
    lines: [{ label: "你放的名牌", value: outcome.placed[targetId] ?? questTag ?? "" }]
  });
  if (!outcome.ok) ui.questSpeaker.textContent = "換一張名牌試試";
  updateQuestProgress();
  if (questIsComplete(quest, questState)) finishQuest();
}

// 任務完成：官方會讓那個東西出現在桌上（筆、橡皮擦、掃把），位置是官方 px 換算的百分比。
function finishQuest() {
  const quest = currentQuest();
  // 過關之後輸入就沒用了，先收掉，免得學者以為還要再說一次。
  questState.done = true;
  ui.myTurn.hidden = true;
  for (const button of ui.questLayers.querySelectorAll("button")) button.disabled = true;
  for (const button of ui.questGoal.querySelectorAll("button")) button.disabled = true;
  for (const button of ui.questTagDock.querySelectorAll("button")) button.disabled = true;
  updateSubmit();
  renderQuestResult("exact", { detail: questCompleteLine(quest), lines: [] });
  const reward = quest.goal.reward;
  if (reward?.imageUrl) {
    ui.questReward.src = reward.imageUrl;
    ui.questReward.style.top = reward.top ?? "";
    ui.questReward.style.left = reward.left ?? "";
    ui.questReward.style.right = reward.right ?? "";
    ui.questReward.style.width = reward.width ?? "";
    ui.questReward.style.height = reward.height ?? "";
    ui.questReward.style.rotate = reward.rotate ?? "";
    ui.questReward.hidden = false;
  }
  // 官方在完成時會播一句收尾台詞（方言別 JSON 的 stage.complete.sound）。
  if (quest.closing?.audioUrl) playQuestClip(quest.closing.audioUrl);
  ui.questSpeaker.textContent = "任務完成";
  ui.questNext.hidden = false;
  ui.questNext.textContent = questIndex + 1 >= quests.length ? "看任務結果" : "下一關 →";
  ui.questNext.focus();
  questResults[questIndex] = { order: quest.order, quest: quest.quest, ok: true };
  // 關卡鈕上的完成標記要立刻更新，不然要換關卡才看得到。
  renderLevelPicker();
}

ui.questNext.addEventListener("click", () => {
  questIndex += 1;
  if (questIndex >= quests.length) { showQuestReport(); return; }
  showQuest();
});

ui.questHint.addEventListener("click", () => { ui.questHintBox.hidden = !ui.questHintBox.hidden; });

function setQuestAudioState(state, text) {
  ui.questAudioState.dataset.state = state;
  ui.questAudioState.textContent = text;
}

function playQuestClip(url) {
  ui.questAudio.pause();
  ui.questAudio.src = url;
  ui.questReplay.disabled = false;
  setQuestAudioState("playing", "播放中…");
  const play = ui.questAudio.play();
  if (play && typeof play.catch === "function") {
    play.catch((error) => {
      if (error?.name === "AbortError") return;
      setQuestAudioState("failed", "無法播放，可以按播放重試");
    });
  }
}

function playQuestReply(line) {
  playQuestClip(line.reply.audioUrl);
}

ui.questReplay.addEventListener("click", () => {
  if (!ui.questAudio.src) return;
  setQuestAudioState("playing", "播放中…");
  const play = ui.questAudio.play();
  if (play && typeof play.catch === "function") {
    play.catch((error) => {
      if (error?.name === "AbortError") return;
      setQuestAudioState("failed", "無法播放，可以再試一次");
    });
  }
});
ui.questAudio.addEventListener("ended", () => setQuestAudioState("ended", "播放結束"));
ui.questAudio.addEventListener("error", () => {
  // .src 在拿掉屬性後仍會變成網頁網址，換關時會誤報載入失敗。
  if (!ui.questAudio.getAttribute("src")) return;
  setQuestAudioState("failed", "音檔載入失敗");
});

// 送出任務句：跟 STEP 2 同一條路徑（轉檔 → 辨識 → 翻譯 → 判定），
// 只是判定對象換成「對這位同學該說的那句」，而且答錯不鎖住，可以一直重試。
const runQuestLine = createSingleFlight(async () => {
  const quest = currentQuest();
  const typed = ui.answer.value.trim();
  const epoch = runEpoch;
  if (!quest || !questReadyToSpeak() || pending || (!typed && !recorder?.blob)) return;
  // 停掉上一句回應。不能放在判定結束後：那會把剛剛開始播的回應一起停掉，
  // play() 還會被中斷，畫面上變成「無法播放」。
  ui.questAudio.pause();
  pending = true;
  ui.submit.disabled = true;
  ui.retry.disabled = true;
  ui.record.disabled = true;

  let indigenous = typed;
  if (!indigenous) {
    let wav;
    setState("converting");
    try {
      wav = await convertToAsrWav(recorder.blob);
    } catch (error) {
      if (dropped(epoch)) return;
      setState("failed", "轉檔失敗，沒有送出");
      showQuestResult("unavailable", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      finishQuestTurn();
      return;
    }
    if (dropped(epoch)) return;
    setState("transcribing");
    const slowHint = setTimeout(() => { if (epoch === runEpoch) setState("slow"); }, SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      lastHeard = indigenous;
      renderHeard(indigenous);
    } catch (error) {
      clearTimeout(slowHint);
      if (dropped(epoch)) return;
      setState("failed", "這次沒有辨識成功");
      showQuestResult("unavailable", `目前無法辨識（${error.message}），你這句還沒有被判錯。`);
      ui.retry.hidden = false;
      finishQuestTurn();
      return;
    }
    clearTimeout(slowHint);
    if (dropped(epoch)) return;
  }

  let translation = "";
  try {
    translation = await translateToZh(indigenous, selectedDialect.code);
  } catch (error) {
    if (dropped(epoch)) return;
    setState("failed", "這次沒有翻譯成功");
    showQuestResult("unavailable", `目前無法翻譯（${error.message}），你這句還沒有被判錯。`);
    ui.retry.hidden = false;
    finishQuestTurn();
    return;
  }
  if (dropped(epoch)) return;

  // 點了場景上的人就是問借刀；沒點人而且已選好對象，才比對道謝。
  const thanking = quest.goal.kind === "selectAndSpeak" && questState?.picked && !questTarget;
  const judged = thanking
    ? { verdict: judgeQuestPrompt(quest, { answer: indigenous, translation }), line: { indigenousText: quest.goal.prompt, chineseText: quest.goal.promptChinese || null, reply: null } }
    : judgeQuestLine(quest, questTarget, { answer: indigenous, translation });
  // 只有說對時才換文案；答錯要用預設的「再試試看」說明，不然會出現
  // 「再試試看／你把那句話說出來了」這種自相矛盾的結果。
  renderQuestResult(judged.verdict, thanking && (judged.verdict === "exact" || judged.verdict === "semantic")
    ? { line: judged.line, indigenous, translation, detail: "你把那句話說出來了。" }
    : { line: judged.line, indigenous, translation });
  if (judged.verdict === "exact" || judged.verdict === "semantic") {
    if (thanking) finishQuest();
    else onQuestAnswered(judged.line);
  }
  finishQuestTurn();
});

// 同學的回答要同時給族語與中文，而且兩位都要留著：名牌要從「誰說了哪個名字」認出來，
// 只留最後一句會認錯人。少數方言的自我介紹中文沿用了別的名字，下載時已把那句中文
// 收成 null，那種情況就只顯示族語，不要顯示錯的名字。
function renderLearnedReplies() {
  const quest = currentQuest();
  const heard = (quest?.lines ?? []).filter((line) => questIsLearned(quest, line.targetId, questState));
  if (!heard.length) { ui.questReply.textContent = ""; return; }
  ui.questReply.innerHTML = heard.map((line) => {
    const chinese = line.reply.chineseText ? `　（${line.reply.chineseText}）` : "";
    return `<span class="quest-reply__line"><b>${targetLabel(line.targetId, quest)}同學</b> ${escapeHtml(line.reply.indigenousText)}${escapeHtml(chinese)}</span>`;
  }).join("");
}

function onQuestAnswered(line) {
  const quest = currentQuest();
  questState.learned.push(line.targetId);
  renderLearnedReplies();
  playQuestReply(line);
  updateQuestProgress();
  if (questIsComplete(quest, questState)) { finishQuest(); return; }
  if (quest.goal.kind === "nameTags" && quest.targets.every((target) => questIsLearned(quest, target.id, questState))) {
    ui.questSpeaker.textContent = "名牌出來了";
    renderTagDock(quest);
    return;
  }
  ui.questSpeaker.textContent = quest.goal.kind === "selectAndSpeak" ? "選要道謝的人" : "再問另一位同學";
  questTarget = null;
  ui.answer.value = "";
  syncQuestMarks();
  focusFirstTarget();
}

function renderQuestResult(verdict, { line, indigenous, translation, detail, lines }) {
  const yours = lastHeard ? "系統聽到的族語" : "你的族語";
  const body = lines
    ? (lines.length ? `<dl>${lines.map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`).join("")}</dl>` : "")
    : `<dl><dt>${yours}</dt><dd>${escapeHtml(indigenous ?? "")}</dd>
       <dt>系統懂成</dt><dd>${escapeHtml(translation ?? "")}</dd>
       <dt>教材族語</dt><dd>${escapeHtml(line?.indigenousText ?? "")}</dd>
       ${line?.chineseText ? `<dt>教材中文</dt><dd>${escapeHtml(line.chineseText)}</dd>` : ""}</dl>`;
  ui.result.hidden = false;
  ui.result.dataset.state = verdict;
  clearRecordNote();
  ui.result.innerHTML = `<strong>${questResultHeadline(verdict)}</strong><p>${detail ?? questResultDetail(verdict)}</p>${body}`;
}

function showQuestResult(state, text) {
  ui.result.hidden = false;
  ui.result.dataset.state = "unavailable";
  ui.result.textContent = text;
}

// 場景的狀態改變後，上一次的結果訊息就不適用了，要收掉。
// 沒有這一步的話，東西已經放進籃子，畫面卻還停在「東西不對」，
// 會讓人以為按哪個都錯。
function clearQuestResult() {
  ui.result.hidden = true;
  ui.result.dataset.state = "";
  ui.result.innerHTML = "";
}

// 判定完就把輸入清空、開放重試：任務不像對話要一句一句往下走，答錯要能立刻再說。
function finishQuestTurn() {
  pending = false;
  graded = false;
  ui.retry.disabled = false;
  ui.record.disabled = !(supportsRecording() && selectedDialect && asrStateFor(selectedDialect.ethnicity).usable);
  clearRecording();
  updateSubmit();
}

function showQuestReport() {
  ui.quest.hidden = true;
  mountInputPanel(ui.sceneBody);
  mode = "dialogue";
  reportKind = "quest";
  resetQuestRun();
  ui.report.hidden = false;
  const done = questResults.filter(Boolean);
  ui.score.textContent = `任務完成 ${done.length} / ${quests.length} 關`;
  ui.list.innerHTML = quests.map((quest, position) => {
    const record = questResults[position];
    return `<li><strong>第 ${quest.order} 關｜${record ? "完成" : "未完成"}</strong><p>${escapeHtml(quest.quest)}</p></li>`;
  }).join("");
  // 任務結果面板：可以重玩任務，也可以切回對話。兩個按鈕不會同時出現。
  ui.questOffer.hidden = true;
  ui.startQuest.hidden = true;
  ui.toDialogue.hidden = false;
  ui.again.textContent = "再玩一次任務";
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

function resetProgress() {
  runEpoch += 1;
  ui.player?.pause();
  ui.questAudio?.pause();
  clearTimeout(unlockTimer);
  unlocked = false;
  index = 0;
  results = [];
  ui.scene.hidden = true;
  ui.report.hidden = true;
  ui.quest.hidden = true;
  // 輸入面板要跟著畫面走：回到設定時一定還在 STEP 2 那邊。
  mountInputPanel(ui.sceneBody);
  mode = "dialogue";
  reportKind = "dialogue";
  questState = null;
  questTarget = null;
  questTag = null;
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = true;
}

function resetScene() {
  resetProgress();
  selectedDialect = undefined;
  shard = undefined;
  exchanges = [];
  pack = null;
  quests = [];
  updateStart();
  updateQuestOffer();
}

window.addEventListener("pagehide", () => {
  ui.player?.pause();
  recorder?.clear();
});

init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});