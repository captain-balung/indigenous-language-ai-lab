import { createSingleFlight } from "../../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import {
  THEME_ORDER, addToBasket, buildPlaylist, dialogueTheme, judgeBasket,
  judgeQuestLine, judgeQuestPick, judgeQuestPrompt, questHint, questIsBorrowQuest,
  questPeopleLabel, questReboundFor, questWrongPersonLine,
  questIsComplete, questIsLearned, questLineFor, questOptionLocked, questOptions, questPack,
  questProgress, questResultDetail, questResultHeadline, questSceneOptions, questTipsText,
  questTurnTitle, targetLabel
} from "./core.mjs";
import { judgeAiMeaning } from "./semantic-judge.mjs";
import { wireInputMode } from "../../shared/input-mode.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $("#setup"), ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), scene: $("#scene"), label: $("#dialect-label"), progress: $("#progress"),
  backSetup: $("#back-setup"), sceneIntro: $("#scene-intro"), backSetupReport: $("#back-setup-report"),
  themeGrid: $("#theme-grid"),
  sceneBody: $("#scene-body"), sceneSide: $(".scene-side"),
  background: $("#scene-background"), avatar: $("#scene-avatar"), speaker: $("#turn-speaker"),
  zh: $("#scene-title"), indigenous: $("#partner-text"),
  myTurn: $("#my-turn"), turnTitle: $("#turn-title"), answer: $("#answer"),
  player: $("#player"),
  record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"), recordNote: $("#record-note"),
  state: $("#record-state"), stateText: $("#record-state-text"),
  submit: $("#submit"), rerecord: $("#rerecord"), retry: $("#retry"),
  result: $("#result"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again"),
  questOffer: $("#quest-offer"), startQuest: $("#start-quest"), toQuest: $("#to-quest"),
  toDialogue: $("#to-dialogue"), questLevels: $("#quest-levels"),
  quest: $("#quest"), questLabel: $("#quest-label"), questCount: $("#quest-count"),
  questBack: $("#quest-back"), questProgress: $("#quest-progress"),
  questHint: $("#quest-hint"), questHintBox: $("#quest-hint-box"), questHintWords: $("#quest-hint-words"),
  questBody: $("#quest-body"), questSide: $("#quest-side"), questGoal: $("#quest-goal"),
  questStage: $("#quest-stage"),
  questScene: $("#quest-scene"), questSceneBox: $("#quest-scene-box"), questPlayer: $("#quest-player"),
  questLayers: $("#quest-layers"),
  questReward: $("#quest-reward"), questSpeaker: $("#quest-speaker"),
  questText: $("#quest-text"), questTips: $("#quest-tips"), questReply: $("#quest-reply"),
  questTags: $("#quest-tags"), questHeard: $("#quest-heard"),
  questTagSection: $("#quest-tag-section"), questTagDock: $("#quest-tag-dock"),
  questComplete: $("#quest-complete"),
  questAutoAsk: $("#quest-autoask"),
  questReplay: $("#quest-replay"), questAudioState: $("#quest-audio-state"),
  questAudio: $("#quest-audio"), questNext: $("#quest-next"),
  questRightSound: $("#quest-right-sound"), questWrongSound: $("#quest-wrong-sound"),
  inputModeToggle: $("#input-mode-toggle"), inputType: $("#input-type"), inputVoice: $("#input-voice")
};

const STATES = {
  idle: ["●", "尚未錄音"],
  recording: ["◉", "錄音中…再按一次停止"],
  recorded: ["■", "錄音完成，正在送出"],
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

let selectedDialect, shard, exchanges = [], index = 0;
let themeKey = THEME_ORDER[0];
let pending = false, graded = false, asrAudit = null, recorder = null, lastHeard = null;
// 辨識還沒回來就換句或換關時，舊的那次不能寫進新的畫面。
let runEpoch = 0;
// 「dialogue」是 STEP 2 的對話，「quest」是 STEP 4 的任務關卡。兩者共用同一個輸入面板
// （.scene-side 會被搬到關卡畫面），所以送出、錄音狀態都要知道現在是哪一關。
let mode = "dialogue";
let pack = null, quests = [], questIndex = 0, questState = null, questTarget = null, questResults = [];
// 結果面板是共用的，要記住現在顯示的是哪一階段的結果，「再練一次」才知道要重來哪個。
let reportKind = "dialogue";
let inputMode = null;

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
        ui.record.disabled = true;
        ui.recordLabel.textContent = "已錄音";
        ui.rerecord.hidden = true;
        setState("recorded");
        updateSubmit();
        // 對話 STEP 2 只播音；錄音送出只服務任務關卡。
        if (mode === "quest") runQuestLine();
        return;
      }
      if (blob) return;
      ui.record.classList.remove("is-recording");
      ui.recordLabel.textContent = "開始錄音";
      ui.rerecord.hidden = true;
      setState("idle");
      updateSubmit();
    },
    onTick(seconds) { ui.time.textContent = clock(seconds); }
  });
  inputMode = wireInputMode({
    root: ui.myTurn,
    toggle: ui.inputModeToggle,
    typePanel: ui.inputType,
    voicePanel: ui.inputVoice,
    onModeChange(next) {
      if (next === "type") clearRecording();
      else ui.answer.value = "";
      updateSubmit();
      if (next === "type") ui.answer.focus();
      else ui.record.focus();
    }
  });
  // 三個場景一進來就先畫出來，方言別還沒選也看得到。
  renderThemes();
  await verifyServices();
  if (!supportsRecording()) {
    ui.record.disabled = true;
    setState("failed", "這個瀏覽器不支援錄音，請切換為打字");
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
  notes.push("語意使用 vLLM AI 判別");
  // 不附加「先聽再說／不計分」這類流程說明。
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

function inputReady() {
  return inputMode?.mode() === "voice" ? Boolean(recorder?.blob) : Boolean(ui.answer.value.trim());
}

function updateSubmit() {
  // 語音：停錄即自動送出，送出鈕只服務打字模式。對話 STEP 2 不收音，只有任務關卡會用到。
  if (inputMode?.mode() === "voice") {
    ui.submit.hidden = true;
    ui.submit.disabled = true;
    return;
  }
  ui.submit.hidden = false;
  if (mode === "quest") {
    ui.submit.disabled = pending || !questReadyToSpeak() || Boolean(questState?.done) || !inputReady();
    return;
  }
  ui.submit.disabled = true;
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
    exchanges = buildPlaylist(shard, themeKey).exchanges;
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

function updateSceneNote() {
  if (!shard) return;
  const theme = dialogueTheme(shard, themeKey);
  if (!exchanges.length) {
    ui.api.textContent = "△ 這個方言目前沒有可播放的情境對話";
    ui.api.dataset.state = "fallback";
    return;
  }
  ui.api.textContent = `● ${theme.name}：已載入 ${exchanges.length} 輪對話`;
  ui.api.dataset.state = "ok";
}

ui.start.addEventListener("click", () => {
  if (!exchanges.length) return;
  index = 0;
  ui.scene.hidden = false;
  ui.report.hidden = true;
  // 情境一旦開始就把 STEP 1 收起來，這一頁只留對話；要改設定再按「回到設定」。
  ui.setup.hidden = true;
  ui.sceneIntro.textContent = dialogueTheme(shard, themeKey).intro;
  showExchange();
  scrollToTop();
});

// STEP 1 與 STEP 2 各自是一個畫面：回到設定時收掉場景、清掉對話進度，
// 但語言別與已載入的教材留著，改場景或改方言別就能直接重來。
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
  // 從任務回來時若對話已聽完（index 等於句數），停在最後一句，不要去讀不存在的句子。
  if (!exchanges[index] && exchanges.length) index = exchanges.length - 1;
  const exchange = exchanges[index];
  if (!exchange) { showSetup(); return; }
  graded = false;
  lastHeard = null;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${themeName()}`;
  ui.progress.textContent = `第 ${index + 1} / ${exchanges.length} 句`;
  // 來源有三種寬高比（上課用語 1000×700、另外兩個主題 1000×707），
  // 所以圖載入後用它自己的固有比例，否則 object-fit:contain 會在框內留邊。
  setSceneImage(ui.background, exchange.backgroundUrl ?? "");
  ui.avatar.src = exchange.imageUrl || "";
  ui.speaker.textContent = `${exchange.speakerName}說`;
  // 顯示當句中文與族語；不收音、不用開口回應。
  ui.zh.textContent = exchange.chineseText;
  ui.zh.hidden = false;
  ui.indigenous.textContent = exchange.indigenousText;
  ui.indigenous.hidden = false;
  ui.myTurn.hidden = true;
  ui.sceneBody.classList.add("scene-body--solo");
  ui.answer.value = "";
  ui.result.hidden = true;
  ui.retry.hidden = true;
  clearRecording();
  // 「下一步」一進句就顯示，不必等音檔播完。
  const last = index + 1 >= exchanges.length;
  ui.next.hidden = false;
  ui.next.textContent = last ? (quests.length ? "去任務" : "完成") : "下一步";
  prepareAudio(exchange.audioUrl);
  playCurrent();
}

function prepareAudio(url) {
  ui.player.pause();
  ui.player.src = url;
}

function playCurrent() {
  if (!ui.player.src) return;
  try { ui.player.currentTime = 0; } catch { /* 來源還沒準備好時略過 */ }
  const play = ui.player.play();
  if (play && typeof play.catch === "function") play.catch(() => {});
}

ui.next.addEventListener("click", () => {
  ui.player.pause();
  index += 1;
  if (index >= exchanges.length) {
    if (quests.length) startQuest();
    else showSetup();
    return;
  }
  showExchange();
});

ui.record.addEventListener("click", async () => {
  if (!recorder || graded || pending || mode !== "quest") return;
  if (recorder.recording) { recorder.stop(); return; }
  ui.player.pause();
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
        ? "瀏覽器沒有給這個頁面麥克風權限。可以在網址列允許麥克風後再錄，或切換為打字。"
        : "這台裝置沒有可用的麥克風，請切換為打字。";
    }
  }
});

function clearRecordNote() {
  ui.recordNote.textContent = "";
}

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });
ui.answer.addEventListener("input", updateSubmit);
// 送出鈕只服務任務關卡（對話 STEP 2 只播音）。
ui.submit.addEventListener("click", () => { if (mode === "quest") runQuestLine(); });
ui.retry.addEventListener("click", () => { if (mode === "quest") runQuestLine(); });

function clearRecording() {
  lastHeard = null;
  recorder?.clear();
  ui.time.textContent = "00:00";
  clearRecordNote();
  ui.record.classList.remove("is-recording");
  ui.recordLabel.textContent = "開始錄音";
  ui.rerecord.hidden = true;
  setState("idle");
  updateSubmit();
}

ui.again.addEventListener("click", () => {
  if (reportKind === "quest") startQuest();
});

// ── STEP 4：任務關卡 ────────────────────────────────────────────
// 上課用語第 1、2 關保留官方的「拖名牌」；其餘關卡把拖詞卡拼句子換成自己說：
// 先點一位同學，再錄音或打字。輸入面板沿用 STEP 2 的那一個（把 .scene-side 搬過來），
// 錄音、翻譯、判定都共用。

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
  scrollToTop();
}

// 從任務切回對話。兩個階段共用一個輸入面板，所以要先把面板搬回去。
  // 對話的進度（index）留著，切回去還是原來那一句。
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
});

ui.toQuest.addEventListener("click", () => startQuest());
ui.toDialogue.addEventListener("click", backToDialogue);
ui.startQuest.addEventListener("click", startQuest);
ui.questBack.addEventListener("click", backToDialogue);

function currentQuest() {
  return quests[questIndex] ?? null;
}

// 官方 select 候選用 randomArray 隨機排；這裡只在進入關卡時洗一次，
// 之後重畫（選取、提示、換焦點）不會一直跳位。
function shuffledOptions(ids) {
  const list = [...ids];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function resetQuestRun() {
  runEpoch += 1;
  // questFailures 累計這一關「說了但判定沒對上」的次數；錯滿 3 次出現
  // 「自動說這句」（官方 autoask-btn 的行為：系統代說，讓關卡往下走）。
  const quest = currentQuest();
  // 名牌關的候選卡要保留「卡片實體」：有些方言兩位同學的名字相同，
  // 候選區會有兩張同文字的卡，不能只用文字判斷哪一張已經放上桌。
  const cards = quest?.goal?.kind === "nameTags"
    ? (quest.goal.choices ?? []).map((text, index) => ({ id: `card-${index}`, text: String(text) }))
    : [];
  questState = {
    learned: [], placed: {}, cardAt: {}, cards, selectedCard: null,
    taken: [], picked: null, done: false, failures: 0, buylistOpen: true,
    optionOrder: quest?.goal?.kind === "select"
      ? shuffledOptions(questOptions(quest).map((option) => option.id))
      : []
  };
  questTarget = null;
  ui.questAutoAsk.hidden = true;
  ui.questReward.hidden = true;
  ui.questReward.removeAttribute("src");
  ui.questTags.hidden = true;
  ui.questTagSection.hidden = true;
  ui.questTagDock.innerHTML = "";
  ui.questHintBox.hidden = true;
  ui.questTips.hidden = true;
  ui.questNext.hidden = true;
  ui.questReply.textContent = "";
  ui.result.hidden = true;
  ui.questGoal.hidden = true;
  ui.questGoal.innerHTML = "";
  ui.questLayers.innerHTML = "";
  hideQuestComplete();
}

// 完成任務／下一關：判定條件一滿，右欄下方出現「下一關 →」鈕（最後一關是
// 「看任務結果」），學者自己按了才往前——不用彈窗，就是一顆按鈕。
function showQuestComplete() {
  const last = questIndex + 1 >= quests.length;
  ui.questComplete.textContent = last ? "看任務結果" : "下一關 →";
  ui.questComplete.hidden = false;
  ui.questComplete.focus({ preventScroll: true });
}
function hideQuestComplete() {
  ui.questComplete.hidden = true;
}

// 官方桌上名卡的座標（phase2.setup.text）是「字的左上角」，
// 六張藍卡的實際範圍是從三張 1000×700 圖層裡量出來的（場景 2.jpg 的後排兩張桌
// ＋ target-1-1.png 的前排左桌、target-2-1.png 的前排右桌、player-1.png 的前排中桌；
// 範圍如下，key 是官方錨點 top|left 的百分比）：
//   57.14|25.5 → 卡 253–323 × 399–422     57.14|34 → 卡 328–392 × 399–421
//   57.14|60.8 → 卡 604–673 × 400–421     57.14|69 → 卡 679–742 × 399–422
//   87.14|49   → 卡 477–546 × 608–631     87.14|56 → 卡 551–616 × 609–633
// 官方錨點落在卡的最左上（少數偏進卡內 12px），字看起來偏在卡片左邊，
// 長名字（如 remeremang、djiniljepan）整個伸出卡外。這裡把錨點換成卡片幾何中心，
// 配合 .quest-desk-tag 的 translate(-50%,-50%) 讓字置中在卡上。
// 42 個方言的錨點全是同一組（官方六張卡共用一套座標），所以 key 是座標不是文字。
const DESK_TAG_CENTERS = {
  "57.14|25.5": { x: 28.8, y: 58.64 },
  "57.14|34": { x: 36, y: 58.57 },
  "57.14|60.8": { x: 63.85, y: 58.64 },
  "57.14|69": { x: 71.05, y: 58.64 },
  "87.14|49": { x: 51.15, y: 88.5 },
  "87.14|56": { x: 58.35, y: 88.71 },
};
// 官方座標可能有個位數的浮點誤差，兩軸都在 1%（約卡寬／卡高的十分之一）內
// 就當同一張卡；對不上的錨點照官方座標去擺（退回左上角定位），不亂猜。
function deskTagCenterFor(left, top) {
  let best = null;
  for (const [key, center] of Object.entries(DESK_TAG_CENTERS)) {
    const [cardTop, cardLeft] = key.split("|").map(Number);
    if (Math.abs(cardTop - top) > 1 || Math.abs(cardLeft - left) > 1) continue;
    if (!best
      || Math.abs(cardTop - top) + Math.abs(cardLeft - left)
        < Math.abs(best.cardTop - top) + Math.abs(best.cardLeft - left)) {
      best = { ...center, cardTop, cardLeft };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

// 場景疊圖與可點區。座標全部來自教材（已換算成百分比），所以疊在場景上就好。
// 上課用語的人物圖不在 props 裡，另外補一層；尋找物品與戶外活動的 setup.img
// 已經包含人物圖，就不要重複疊。
function renderQuestLayers(quest) {
  const parts = [];
  const propIds = new Set();
  const targetIds = new Set(quest.targets.map((target) => target.id));
  const clickTargetId = quest.goal.kind === "click" ? (quest.goal.answers ?? [])[0] : null;
  for (const prop of quest.props ?? []) {
    propIds.add(prop.id);
    // 尋找物品／戶外活動的人物是 props 的整幅透明圖；掛上 data-target-img
    // 才能跟 lesson 的獨立人物圖層一樣套用 hover／選取光暈。
    const targetAttr = targetIds.has(prop.id) ? ` data-target-img="${escapeHtml(prop.id)}"` : "";
    // 官方點門前的 hoverGlow2：門的可點區 hover 時讓門的圖層發亮。
    const clickAttr = prop.id === clickTargetId ? ` data-click-img="${escapeHtml(prop.id)}"` : "";
    parts.push(`<img class="quest-layer"${targetAttr}${clickAttr} src="${escapeHtml(prop.imageUrl)}" alt="" aria-hidden="true">`);
  }
  for (const target of quest.targets) {
    if (!propIds.has(target.id)) {
      parts.push(`<img class="quest-layer" data-target-img="${escapeHtml(target.id)}" src="${escapeHtml(target.imageUrl)}" alt="${escapeHtml(target.name ?? "")}" aria-hidden="true">`);
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
      aria-label="點門"></button>`);
  }
  // 上課用語才有獨立的主角圖層：中間那一位是「主角（你自己）」，放個小標示讓人
  // 認得出來這是自己的座位；主角自己的名字官方已印在桌牌上，不用再顯示。
  if (pack.playerImageUrl) {
    parts.push(`<span class="quest-player-badge" aria-hidden="true">主角（就是你）</span>`);
  }
  // 桌上藍色名牌：字疊在場景圖印好的牌子上（官方 .table-card）。
  for (const tag of pack?.deskTags ?? []) {
    const tone = tag.tone === "brown" ? "quest-desk-tag--brown" : "quest-desk-tag--blue";
    // 官方座標是「字的左上角」，字會貼著卡片左緣、長名字還會伸出卡外。
    // 換成官方錨點對應那張藍卡的幾何中心，字用 translate(-50%,-50%) 置中在卡上。
    const center = deskTagCenterFor(tag.left, tag.top);
    const style = center
      ? `top:${center.y}%;left:${center.x}%;transform:translate(-50%,-50%)`
      : `top:${Number(tag.top)}%;left:${Number(tag.left)}%`;
    parts.push(`<span class="quest-desk-tag ${tone}" style="${style}" aria-hidden="true">${escapeHtml(tag.text)}</span>`);
  }
  ui.questLayers.innerHTML = parts.join("");
}

function boxStyle(box) {
  if (!box) return "";
  return Object.entries(box)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value}%`)
    .join(";");
}

// 右欄的目標面板：選項清單（select／selectAndSpeak）、購物籃（take）、
// 結語（end）、名牌（nameTags，見 #quest-tags）。
function renderQuestGoal(quest) {
  const goal = quest.goal;
  if (goal.kind === "nameTags") {
    // 名牌關用獨立的 #quest-tags，右欄目標面板留空。
    ui.questGoal.hidden = true;
    ui.questGoal.innerHTML = "";
    renderNameTagsPanel(quest);
    return;
  }
  ui.questTags.hidden = true;
  // 官方 ask() 只有在問到一次正確句子後才顯示 respond-box；在那之前
  // 選項、購物籃、點擊提示都先收起來，避免看起來可以直接跳過提問。
  const ready = (questState?.learned ?? []).length > 0;
  if (goal.kind === "select" || goal.kind === "selectAndSpeak") {
    ui.questGoal.hidden = !ready;
    if (!ready) { ui.questGoal.innerHTML = ""; return; }
    const options = questOptions(quest);
    // select 照官方每次進入關卡隨機排候選；selectAndSpeak 的對象維持官方順序。
    const ordered = goal.kind === "select" && questState.optionOrder?.length
      ? questState.optionOrder.map((id) => options.find((option) => option.id === id)).filter(Boolean)
      : options;
    const confirm = goal.kind === "select"
      ? `<button type="button" class="primary" id="option-confirm" ${questState.picked ? "" : "disabled"}>確定</button>`
      : "";
    ui.questGoal.innerHTML = `<h3>${goal.kind === "selectAndSpeak" ? "選要道謝的人" : "挑出正確的那一個"}</h3>
      <div class="quest-options">${ordered.map((option, index) => `
        <button type="button" class="quest-option-btn${goal.kind === "select" ? " quest-option-btn--select" : ""}${questState.picked === option.id ? " is-picked" : ""}"
          data-pick="${escapeHtml(option.id)}" aria-pressed="${questState.picked === option.id}"
          ${goal.kind === "select" ? `aria-label="選擇第 ${index + 1} 個"` : ""}>
          <img src="${escapeHtml(option.imageUrl)}" alt="${escapeHtml(option.name ?? "")}">
        </button>`).join("")}</div>${confirm}`;
    return;
  }
  if (goal.kind === "take") {
    ui.questGoal.hidden = !ready;
    if (!ready) { ui.questGoal.innerHTML = ""; return; }
    // 購物清單放右欄而不是壓在場景上的任務卡：戶外活動第一關有 7 項，
    // 放進卡片會把上半個場景蓋掉。清單可以折疊（官方 #buying-list-btn 的行為）。
    const open = questState.buylistOpen !== false;
    const list = quest.buylist?.length
      ? `<h3>購物清單<button type="button" class="quest-buylist-toggle" data-buylist-toggle aria-expanded="${open}">${open ? "收起" : "展開"}</button></h3>
         <ul class="quest-shopping${open ? "" : " is-collapsed"}">${quest.buylist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
    // 窄螢幕時場景裡的東西只有 30幾個像素寬（小到不好點），所以下面多給一列按鈕；
    // 寬螢幕就藏起來，讓人直接點場景（官方也是這樣）。
    // 被 condition.lock 鎖住的東西要等問對解鎖者才出現（官方 .lock 也是 display:none）。
    const available = questSceneOptions(quest)
      .filter((option) => !questOptionLocked(quest, option.id, questState));
    const fallback = `<div class="quest-options quest-options--compact">${available.map((option) => `
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
    // 結語文字已經顯示在任務卡（#quest-text），這裡只留往下走的按鈕，
    // 不要讓同一段收尾文字在畫面上出現兩次。
    ui.questGoal.innerHTML = `<h3>任務結束</h3>
      <div class="submit-row"><button type="button" class="primary" id="quest-end-next">${questIndex + 1 >= quests.length ? "看任務結果" : "下一關 →"}</button></div>`;
    return;
  }
  if (goal.kind === "click") {
    ui.questGoal.hidden = !ready;
    ui.questGoal.innerHTML = ready
      ? `<h3>接下來要做</h3><p>${escapeHtml(questHint(quest, questState))}</p>`
      : "";
    return;
  }
  ui.questGoal.hidden = true;
  ui.questGoal.innerHTML = "";
}

// 手機／平板的輸入區在場景與目標面板下方；問對後目標面板才出現，
// 若不把面板帶進視窗，學習者會停在輸入框、看不到剛出現的選項／購物籃。
function revealQuestGoal() {
  if (!ui.questGoal || ui.questGoal.hidden) return;
  if (!matchMedia("(max-width: 1200px)").matches) return;
  requestAnimationFrame(() => {
    ui.questGoal.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: reduced() ? "auto" : "smooth"
    });
  });
}

// 點門關的行動目標在場景上；手機問完人後把門帶進視窗，不用自己找。
function revealQuestClick() {
  if (!matchMedia("(max-width: 1200px)").matches) return;
  const click = ui.questLayers.querySelector("[data-click]");
  if (!click) return;
  requestAnimationFrame(() => {
    click.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: reduced() ? "auto" : "smooth"
    });
  });
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
  // 從「下一關」或關卡鈕換關時都要重畫；否則左上角目前關卡的標記會停在舊關。
  renderLevelPicker();
  ui.questText.textContent = quest.quest;
  const tips = questTipsText(quest);
  const isEnd = quest.goal.kind === "end";
  ui.questTips.textContent = tips;
  ui.questTips.hidden = !tips;
  // 結語關沒有互動，也沒有詞卡提示；留著按鈕只會打開空盒。
  ui.questHint.hidden = isEnd;
  // 結語關沒有要播的句子，播放控制也一起收起來。
  ui.questReplay.hidden = isEnd;
  ui.questAudioState.hidden = isEnd;
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
  // 第五關的掃把從一開始就在場景裡，學習者要先看到它在哪一位同學旁邊，
  // 才知道該問誰；其他關卡的獎勵物件仍然過關後才出現。
  if (quest.themeKey === "lesson" && quest.order === 5) showQuestReward(quest, { initial: true });
  // 對象都可以點；指定要問誰的關卡讓學習者自己判斷，問錯人會得到原版的反應。
  syncTargetLooks();
  renderQuestGoal(quest);
  // 任務說明在 #quest-stage 外面，所以 click 關不用再把卡片讓開。
  // 尋找物品／戶外活動只保留場景盒的外框樣式，不再需要移動任務卡。
  ui.questStage.classList.toggle("is-static-board", quest.themeKey !== "lesson");
  syncQuestMarks();
  updateQuestProgress();
  clearRecording();
  ui.questAudio.pause();
  ui.questAudio.removeAttribute("src");
  setQuestAudioState("idle", "想聽再按播放");
  ui.questReplay.disabled = true;
  ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: questTarget });
  // 輸入面板是從 STEP 2 搬過來的，那邊最後一輪可能是對方在說、面板是收起的，
  // 搬過來要自己打開，否則右欄會是空的。結語關沒有要說的句子，面板留著只會是空的送出鈕。
  ui.myTurn.hidden = quest.goal.kind === "end";
  if (quest.goal.kind === "end") {
    // 結語關：沒有互動，收尾文字顯示在右欄目標面板（#quest-end-next 是「下一關 →」）。
    questState.done = true;
    questResults[questIndex] = { order: quest.order, quest: quest.quest, ok: true };
    renderLevelPicker();
  }
  ui.retry.hidden = true;
  focusFirstTarget();
}

// 問到的名字放上桌的位置：每張桌子有兩張空名牌卡（官方 1000×700 圖層實測：
// 左桌卡 (161-230)/(235-299)、右桌卡 (800-870)/(875-938)，y 皆 610-632）。
// 第 1 關的名字放**右卡置中**、第 2 關的名字放**左卡置中**——跟桌上印好的
// 成對名牌（diniljepan／Veneng）同一種擺法，字級也同一套。
const DESK_DROP_SLOTS = [
  { "target-1": { x: 26.7, y: 88.7 }, "target-2": { x: 90.65, y: 88.8 } },
  { "target-1": { x: 19.6, y: 88.7 }, "target-2": { x: 83.5, y: 88.8 } },
];

function syncQuestMarks() {
  const quest = currentQuest();
  if (!quest) return;
  // 名字上桌：不再掛在人物按鈕框裡（那樣位置會跟著人的框漂、字級也跟桌上
  // 印的字不一致），改放官方桌上卡片的右緣，換關或重問都會整批重畫。
  for (const tag of ui.questLayers.querySelectorAll(".quest-dropped-tag")) tag.remove();
  // 名字會累積：第 1、2 關問到的名字，之後第 3、4、5 關（同一間教室）照官方一直留在桌上。
  // 沒玩到的關不能提前把答案放上桌；其他主題沒有名牌關，迴圈跑完不會有東西。
  {
    let nameStage = -1;
    for (let s = 0; s < quests.length; s++) {
      const level = quests[s];
      if (level.goal.kind !== "nameTags") continue;
      nameStage += 1;
      const entries = s === questIndex
        ? Object.entries(questState?.placed ?? {})
        : s < questIndex
          ? Object.entries(level.goal.answers ?? {})
          : []; // 還沒玩到的關不能提前把答案放上桌
      for (const [targetId, name] of entries) {
        const slot = DESK_DROP_SLOTS[nameStage]?.[targetId];
        if (!slot || !name) continue;
        // 這一關放上去的名牌可以再點一下拿回候選區；之前關卡的牌子照官方留在桌上。
        const movable = s === questIndex && !questState?.done;
        const tag = document.createElement(movable ? "button" : "span");
        if (movable) {
          tag.type = "button";
          tag.dataset.returnCard = targetId;
          tag.setAttribute("aria-label", `把${targetLabel(targetId, level)}同學的名牌拿回候選區`);
        }
        tag.className = `quest-dropped-tag quest-dropped-tag--${nameStage + 1}${movable ? " quest-dropped-tag--movable" : ""}`;
        tag.textContent = name;
        tag.style.top = `${slot.y}%`;
        tag.style.left = `${slot.x}%`;
        // 名字一律置中在卡上（跟桌上印好的名字同擺法）
        tag.style.transform = "translate(-50%,-50%)";
        ui.questLayers.append(tag);
      }
    }
  }
  for (const button of ui.questLayers.querySelectorAll("[data-target]")) {
    const learned = questIsLearned(quest, button.dataset.target, questState);
    button.classList.toggle("is-asked", learned);
    // 已經選了候選名牌時，所有同學都可以放名牌（跟官方一樣不必先問完）。
    button.classList.toggle("is-placing", Boolean(questState?.selectedCard));
    button.setAttribute("aria-pressed", String(button.dataset.target === questTarget));
    button.classList.toggle("is-selected", button.dataset.target === questTarget);
  }
  const ready = (questState?.learned ?? []).length > 0;
  for (const button of ui.questLayers.querySelectorAll("[data-option]")) {
    const id = button.dataset.option;
    const locked = questOptionLocked(quest, id, questState);
    button.classList.toggle("is-locked", locked);
    button.classList.toggle("is-taken", (questState.taken ?? []).includes(id));
    // 原版 take-option 在問到人前是 display:none；鎖住的東西也先不顯示。
    button.hidden = !ready || locked;
    // 用 aria-disabled 而不是 disabled：實心按鈕點了不會觸發，就沒辦法告訴他
    // 為什麼不能拿、該先去問誰。
    button.setAttribute("aria-disabled", String(locked));
  }
  for (const button of ui.questLayers.querySelectorAll("[data-click]")) {
    // 原版可點的門要 ask() code!=0 才顯示，不能一開始就點門跳過提問。
    button.hidden = !ready;
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
  if (quest.goal.kind === "nameTags") {
    renderNameTagsPanel(quest);
  } else {
    ui.questTags.hidden = true;
    // 原版要問到一次正確句子才顯示選項／購物籃／點擊提示；
    // 這裡也讓目標面板跟著 learned 狀態重畫。
    renderQuestGoal(quest);
  }
  syncQuestMarks();
}

// 名牌關右欄：上半是問過的人留下的回答，下半是官方候選名牌。
// 第一位同學答對後才出現候選名牌；之後可以繼續問，也可以直接把正確的名牌
// 拖到（或點到）任何一位同學的桌上。還沒問到人之前右欄保持空白，不先透露答案。
function renderNameTagsPanel(quest) {
  const heard = quest.targets.filter((target) => questIsLearned(quest, target.id, questState));
  ui.questTags.hidden = heard.length === 0;
  renderHeardNames(quest);
  renderNameTagDock(quest, heard.length > 0);
}

function usedNameCards() {
  return new Set(Object.values(questState?.cardAt ?? {}));
}

function remainingNameCards() {
  const used = usedNameCards();
  return (questState?.cards ?? []).filter((card) => !used.has(card.id));
}

// 候選名牌跟官方一樣在第一位同學答對後出現：卡片本身就是拖曳來源，
// 也可以只用點選（先點名牌、再點同學），手機與鍵盤都能操作。
function renderNameTagDock(quest, hasHeard) {
  const show = Boolean(hasHeard) && !questState?.done;
  ui.questTagSection.hidden = !show;
  if (!show) {
    ui.questTagDock.innerHTML = "";
    return;
  }
  const cards = remainingNameCards();
  if (!cards.length) {
    ui.questTagDock.innerHTML = `<p class="quest-tag-empty">名牌都放上桌了</p>`;
    return;
  }
  ui.questTagDock.innerHTML = cards.map((card) => {
    const selected = questState.selectedCard === card.id;
    return `<button type="button" class="quest-tag${selected ? " is-selected" : ""}"
      data-card="${escapeHtml(card.id)}" draggable="true"
      aria-pressed="${selected}">${escapeHtml(card.text)}</button>`;
  }).join("");
}

function renderHeardNames(quest) {
  const heard = quest.targets.filter((target) => questIsLearned(quest, target.id, questState));
  if (!heard.length) {
    ui.questHeard.innerHTML = "";
    return;
  }
  // 不顯示回答句子或「他叫／他住 X」：那會直接把要拖的名牌寫出來。
  // 只留下「這位問過了」和重播鈕，讓學習者靠聽力判斷。
  ui.questHeard.innerHTML = heard.map((target) => {
    const who = `${targetLabel(target.id, quest)}同學`;
    return `<div class="quest-heard__row">
      <button type="button" class="quest-heard__replay" data-replay-target="${escapeHtml(target.id)}"
        aria-label="再聽一次${escapeHtml(who)}的回答">再聽一次</button>
      <span class="quest-heard__who">${escapeHtml(who)}</span>
      <span class="quest-heard__done">已問過</span>
    </div>`;
  }).join("");
}

function selectNameCard(cardId) {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "nameTags" || questState?.done || pending) return;
  questState.selectedCard = questState.selectedCard === cardId ? null : cardId;
  renderNameTagsPanel(quest);
  ui.questSpeaker.textContent = "任務";
  if (questState.selectedCard) {
    // 選了名牌就是「放名牌」模式，先把剛才點來問的同學取消選取，
    // 免得輸入面板還停在送出問句的狀態。
    questTarget = null;
    syncTargetLooks();
    updateSubmit();
    const button = ui.questTagDock.querySelector(`[data-card="${questState.selectedCard}"]`);
    if (button && !reduced()) button.focus({ preventScroll: true });
  }
}

function focusFirstCard() {
  const button = ui.questTagDock.querySelector("[data-card]");
  if (button && !reduced()) button.focus({ preventScroll: true });
}

function flashWrongCard(cardId) {
  const button = ui.questTagDock.querySelector(`[data-card="${cardId}"]`);
  if (!button) return;
  button.classList.add("is-wrong");
  setTimeout(() => button.classList.remove("is-wrong"), 450);
}

// 只接受那位同學的正確名牌：拖錯就留在候選區，不跳判定卡、也不播對錯音效
// （官方拖名牌本來就沒有音效）。不必先問過該位同學，跟官方一樣可以直接拖名字。
// 桌上已經有牌時，放對會把原本那張換回候選區。
function placeNameCard(targetId, cardId) {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "nameTags" || questState?.done || pending) return false;
  const card = (questState.cards ?? []).find((item) => item.id === cardId);
  if (!card) return false;
  const expected = quest.goal.answers?.[targetId] ?? "";
  if (card.text !== expected) {
    questState.selectedCard = cardId;
    // updateQuestProgress 會重畫候選區，並把「可以放名牌」的同學標成 is-placing。
    updateQuestProgress();
    flashWrongCard(cardId);
    ui.questSpeaker.textContent = `這張不是${targetLabel(targetId, quest)}同學的名牌，再試一次`;
    return false;
  }
  delete questState.placed[targetId];
  delete questState.cardAt[targetId];
  questState.placed[targetId] = card.text;
  questState.cardAt[targetId] = card.id;
  questState.selectedCard = null;
  updateQuestProgress();
  if (questIsComplete(quest, questState)) { finishQuest(); return true; }
  const allAsked = questState.learned.length >= quest.targets.length;
  ui.questSpeaker.textContent = "任務";
  if (allAsked) focusFirstCard();
  else focusFirstTarget();
  return true;
}

function returnNameCard(targetId) {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "nameTags" || questState?.done || pending) return;
  if (!(targetId in (questState.cardAt ?? {}))) return;
  delete questState.cardAt[targetId];
  delete questState.placed[targetId];
  questState.selectedCard = null;
  updateQuestProgress();
  ui.questSpeaker.textContent = "任務";
  focusFirstCard();
}

function focusFirstTarget() {
  const quest = currentQuest();
  const next = quest?.targets.find((target) => !questIsLearned(quest, target.id, questState));
  const button = ui.questLayers.querySelector(`[data-target="${next?.id ?? ""}"]`);
  if (button && !reduced()) button.focus({ preventScroll: true });
}

// 第 1 關問到的名字（targetId → 名字）：之後關卡的提示直接叫名字，
// 「先問問 Muni」「對 Muni 說…」不是只說位置的「右邊的人」。
function questNamesMap() {
  const stage = quests.find((level) => level?.goal.kind === "nameTags");
  return stage?.goal.answers ?? {};
}
function questTurnTitleFor(quest, opts = {}) {
  return questTurnTitle(quest, { ...opts, names: questNamesMap() });
}

function selectTarget(targetId) {
  const quest = currentQuest();
  if (!quest) return;
  // 要問下一位同學時，把剛才點選的名牌取消，免得問完後仍停在「放名牌」模式。
  if (quest.goal.kind === "nameTags" && questState?.selectedCard) {
    questState.selectedCard = null;
    renderNameTagsPanel(quest);
  }
  // 名牌關問過的人不用再問；其他關卡可以重複點同一位（原版 target 也可以重新選），
  // 這樣問錯人時才能再換人。指定對象的關卡也不再鎖住其他人：對錯人會得到
  // 原版的 rebound，而不是被介面擋下。
  if (quest.goal.kind === "nameTags" && questIsLearned(quest, targetId, questState)) return;
  questTarget = targetId;
  syncTargetLooks();
  ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId });
  // 任務卡維持「任務」＋關卡說明，操作指引寫在輸入區標題。
  ui.questSpeaker.textContent = "任務";
  syncQuestMarks();
  updateSubmit();
  ui.answer.focus();
}

// 選人時的圖像變化對齊舊站 targetClick：
//   上課用語的同學圖層換成 target-N-2.png（官方選中變體）＋持續光暈；
//   尋找物品／戶外活動的 2-target-1.png 不是選中變體，不能套 replace，
//   否則會換成另一個人的圖（2-target-1.png → 2-target-2.png）。
//   主角圖**換向**：官方問右邊的同學（target-2）才換 player-2.png（朝右的變體），
//   問左邊的同學時維持 player-1.png——兩張都是朝向那個方向的圖。
const TARGET_SELECT_VARIANT = (url) => url ? url.replace(/-1\.png$/, "-2.png") : "";

function syncTargetLooks() {
  const quest = currentQuest();
  for (const target of quest?.targets ?? []) {
    const img = ui.questLayers.querySelector(`img[data-target-img="${target.id}"]`);
    if (img) {
      const selected = questTarget === target.id;
      const selectedSrc = selected && quest.themeKey === "lesson"
        ? (TARGET_SELECT_VARIANT(target.imageUrl) || target.imageUrl)
        : target.imageUrl;
      img.src = selectedSrc;
      // 官方 hoverGlow2：選中的同學持續帶光暈。
      img.classList.toggle("is-glow", selected);
    }
  }
  // 主角圖隨點的對象換向（官方 targetClick）：點左邊的同學維持 player-1.png（朝左），
  // 點右邊的同學換 player-2.png（朝右）。主角圖是獨立節點 #quest-player。
  if (pack.playerImageUrl) {
    ui.questPlayer.src = questTarget === "target-2"
      ? (TARGET_SELECT_VARIANT(pack.playerImageUrl) || pack.playerImageUrl)
      : pack.playerImageUrl;
  }
  for (const button of ui.questLayers.querySelectorAll("[data-target]")) {
    const selected = button.dataset.target === questTarget;
    // 官方 hoverGlow2 是持續的光暈：選中的同學一直亮著。
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    // 指定要問誰的關卡也不鎖其他人：問錯人會得到原版的 rebound。
    button.classList.remove("is-locked");
    button.setAttribute("aria-disabled", "false");
    // 選了名牌時，所有同學都是可以放名牌的對象（官方不要求先問過）。
    const placing = quest.goal?.kind === "nameTags" && Boolean(questState?.selectedCard);
    button.classList.toggle("is-placing", placing);
  }
}

// 場景上的點擊全部用事件委派處理：圖層與可點區是每一關重新產生的，
// 直接綁在按鈕上的話換關就失效了。hover 光暈也是：官方的 hoverGlow 用這裡代做。
ui.questLayers.addEventListener("click", (event) => {
  if (questLocked()) return;
  const quest = currentQuest();
  if (!quest) return;
  // 桌上已經放好的名牌：點一下拿回候選區（官方也可以把名牌拖回去）。
  const returnTag = event.target.closest("[data-return-card]");
  if (returnTag) {
    returnNameCard(returnTag.dataset.returnCard);
    return;
  }
  const target = event.target.closest("[data-target]");
  if (target) {
    // 已經選了候選名牌，點同學就是「放名牌」；沒選名牌才是「問他」。
    // 跟官方一樣，不必先問過那一位才能放。
    if (quest.goal.kind === "nameTags" && questState?.selectedCard) {
      placeNameCard(target.dataset.target, questState.selectedCard);
      return;
    }
    selectTarget(target.dataset.target);
    return;
  }
  const option = event.target.closest("[data-option]");
  if (option) { pickSceneOption(option.dataset.option); return; }
  if (event.target.closest("[data-click]")) handleQuestClick();
});

// hover 高亮：官方 hoverGlow／hoverGlow2 圖檔沒給，用濾鏡做出光暈。
ui.questLayers.addEventListener("mouseover", (event) => {
  const click = event.target.closest("[data-click]");
  if (click) {
    const img = ui.questLayers.querySelector("img[data-click-img]");
    if (img) img.classList.add("is-glow2");
    return;
  }
  const button = event.target.closest("[data-target]");
  if (!button) return;
  const img = ui.questLayers.querySelector(`img[data-target-img="${button.dataset.target}"]`);
  if (img) img.classList.add("is-glow");
});
ui.questLayers.addEventListener("mouseout", (event) => {
  const click = event.target.closest("[data-click]");
  if (click) {
    const img = ui.questLayers.querySelector("img[data-click-img]");
    if (img) img.classList.remove("is-glow2");
    return;
  }
  const button = event.target.closest("[data-target]");
  if (!button) return;
  const img = ui.questLayers.querySelector(`img[data-target-img="${button.dataset.target}"]`);
  // 已選中的人要保留官方 selectGlow；這裡只清掉 hover 暫時加上的光暈。
  if (img && !button.classList.contains("is-selected")) img.classList.remove("is-glow");
});

// 候選名牌：桌面用原生拖曳，手機／鍵盤用點選（官方在手機上也是點選放置）。
let dragCardId = null;

ui.questTags.addEventListener("click", (event) => {
  // 句子不顯示，但每一位問過的人都要能單獨重播，不能只能重播最後一句。
  const replay = event.target.closest("[data-replay-target]");
  if (replay) {
    const quest = currentQuest();
    if (!quest || quest.goal.kind !== "nameTags" || pending) return;
    const line = questLineFor(quest, replay.dataset.replayTarget);
    if (line && questIsLearned(quest, line.targetId, questState)) playQuestReply(line);
    return;
  }
  const card = event.target.closest("[data-card]");
  if (card) selectNameCard(card.dataset.card);
});

ui.questTags.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-card]");
  if (!card || pending) {
    event.preventDefault();
    return;
  }
  dragCardId = card.dataset.card;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragCardId);
  card.classList.add("is-dragging");
});

ui.questTags.addEventListener("dragend", () => {
  dragCardId = null;
  for (const card of ui.questTagDock.querySelectorAll(".is-dragging")) card.classList.remove("is-dragging");
  for (const target of ui.questLayers.querySelectorAll(".is-drop-over")) target.classList.remove("is-drop-over");
});

ui.questLayers.addEventListener("dragover", (event) => {
  if (!dragCardId) return;
  const target = event.target.closest("[data-target]");
  // 只有這一關的名牌卡可以放到人身上；其他關卡沒有候選卡。
  if (!target || currentQuest()?.goal.kind !== "nameTags") return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  for (const button of ui.questLayers.querySelectorAll(".is-drop-over")) {
    if (button !== target) button.classList.remove("is-drop-over");
  }
  target.classList.add("is-drop-over");
});

ui.questLayers.addEventListener("dragleave", (event) => {
  const target = event.target.closest("[data-target]");
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("is-drop-over");
});

ui.questLayers.addEventListener("drop", (event) => {
  if (!dragCardId) return;
  const target = event.target.closest("[data-target]");
  if (!target) return;
  event.preventDefault();
  const cardId = dragCardId;
  dragCardId = null;
  target.classList.remove("is-drop-over");
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "nameTags") return;
  // 不必先問過該位同學；placeNameCard 只檢查名牌是否屬於目標。
  placeNameCard(target.dataset.target, cardId);
});

// 目標面板的點擊：選項清單、購物籃的確定、結語的下一關。
ui.questGoal.addEventListener("click", (event) => {
  if (pending) return;
  // 結語關一進來就算完成，下一關按鈕仍要能點。其餘過關後不能再改答案。
  if (questState?.done && !event.target.closest("#quest-end-next")) return;
  // 購物清單折疊（官方 #buying-list-btn 的 toggle）。
  const toggle = event.target.closest("[data-buylist-toggle]");
  if (toggle) {
    const quest = currentQuest();
    if (!quest) return;
    questState.buylistOpen = !(questState.buylistOpen !== false);
    renderQuestGoal(quest);
    return;
  }
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
  if (event.target.closest("#option-confirm")) { confirmSelectOption(); return; }
  if (event.target.closest("#basket-confirm")) { confirmBasket(); return; }
  if (event.target.closest("#quest-end-next")) {
    questIndex += 1;
    if (questIndex >= quests.length) showQuestReport();
    else showQuest();
    renderLevelPicker();
  }
});

// take：點場景裡的東西放進籃子（跟 select 一樣：先答對一句才開放，官方 ask() 才 show）。
function pickSceneOption(optionId) {
  const quest = currentQuest();
  if (!quest) return;
  if (questPickGated(quest)) {
    ui.questSpeaker.textContent = "先問問場景裡的人，他們才知道東西在哪裡";
    ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
    return;
  }
  const outcome = addToBasket(quest, optionId, questState);
  questState.taken = outcome.taken;
  if (outcome.reason === "locked") {
    // 操作狀況提醒寫在任務卡那一行，不畫結果卡（鎖著的東西不是「答錯」）。
    // 不要在這裡公布解鎖者，讓學習者從對方的回答判斷。
    ui.questSpeaker.textContent = "這個還不能拿，先問問其他人，看看誰知道";
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
    ? "先問問其他人，才知道要拿什麼"
    : questState.taken.length >= need
      ? `放進籃子了，按「確定」看看有沒有拿對`
      : `放進籃子了，再看看還缺什麼（${questState.taken.length}/${need}）`;
}

// take：按確定才判對錯（官方也是這樣，順序不影響結果）。
// 對／錯的回饋照官方只有音效（right／wrong），不畫結果卡；
// 沒放東西、還沒問到人這些操作狀況的提醒寫在任務卡那一行。
function confirmBasket() {
  const quest = currentQuest();
  if (!quest) return;
  const ok = judgeBasket(quest, questState.taken);
  playJudgeSound(ok);
  if (ok) { finishQuest(); return; }
  if (quest.goal.lock && !(questState.learned ?? []).includes(quest.goal.unlock?.targetId)) {
    ui.questSpeaker.textContent = "還不能確定，先問問其他人，看看誰知道";
    return;
  }
  if (!questState.taken.length) {
    ui.questSpeaker.textContent = "籃子還是空的，先點場景裡的東西";
    return;
  }
  clearQuestResult();
}

// 官方的 select／take／select&order 在還沒答對一句之前，右欄根本不顯示（
// ask() code!=0 才 show。）這裡用同一個閘：問到人之前點選項一律不收。
function questPickGated(quest) {
  const kind = quest?.goal?.kind;
  return (kind === "select" || kind === "take" || kind === "selectAndSpeak") && !(questState?.learned ?? []).length;
}

// select：選一個就判（判定音效照官方 respondClick：對 right、錯 wrong）。
function pickQuestOption(optionId) {
  const quest = currentQuest();
  if (!quest) return;
  if (questPickGated(quest)) {
    ui.questSpeaker.textContent = "先問問場景裡的人，他們才知道答案";
    ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
    return;
  }
  // 官方 select 的 optionClick 只先標記選取，按「確認」才在 respondClick 判定；
  // 這裡保留兩段式，讓學習者能換陶壺後再確定。
  if (quest.goal.kind === "select") {
    const option = questOptions(quest).find((item) => item.id === optionId);
    if (!option) return;
    questState.picked = optionId;
    clearQuestResult();
    updateQuestProgress();
    ui.questSpeaker.textContent = "任務";
    ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
    // 重畫後把焦點留在「確定」，鍵盤操作不用再找一次按鈕。
    ui.questGoal.querySelector("#option-confirm")?.focus({ preventScroll: true });
    return;
  }
  const outcome = judgeQuestPick(quest, optionId, questState);
  // 對／錯照官方只有音效回饋（selectAndSpeak 也播 right／wrong），不畫結果卡。
  if (quest.goal.kind === "selectAndSpeak") {
    if (!outcome.ok) {
      playJudgeSound(false);
      return;
    }
    questState.picked = optionId;
    questTarget = null;
    syncTargetLooks();
    clearQuestResult();
    renderQuestGoal(quest);
    updateQuestProgress();
    ui.questSpeaker.textContent = "任務";
    ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
    ui.answer.focus();
    updateSubmit();
    return;
  }
  playJudgeSound(outcome.ok);
  if (outcome.ok) { finishQuest(); return; }
  clearQuestResult();
}

// 官方 select 的「確認」：只有這時才判對錯，錯了可以換一個再按。
function confirmSelectOption() {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "select" || !questState?.picked || pending) return;
  const outcome = judgeQuestPick(quest, questState.picked, questState);
  playJudgeSound(outcome.ok);
  if (outcome.ok) { finishQuest(); return; }
  clearQuestResult();
}

// click：官方是點下去就換背景、播收尾台詞。
function handleQuestClick() {
  const quest = currentQuest();
  if (!quest || quest.goal.kind !== "click") return;
  // 原版要先問到人，`ask()` 才會顯示可點的門；不能直接點門跳過提問。
  if (!(questState?.learned ?? []).length) {
    ui.questSpeaker.textContent = `先問問${questPeopleLabel(quest)}，再點場景裡該點的地方`;
    ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
    return;
  }
  if (quest.goal.backgroundUrl) {
    setSceneImage(ui.questScene, quest.goal.backgroundUrl);
    ui.questLayers.innerHTML = "";
    ui.questPlayer.hidden = true;
  }
  finishQuest();
}

// 名牌關的拖放見 placeNameCard：只接受該位同學的正確名牌，放錯會留在候選區並提示。
// 拖到桌上的位置仍然沿用 DESK_DROP_SLOTS 的桌上空卡座標。

// 官方 quest-lesson.css 的 #item-3-img 初始位置（1000×700 舞台）：
// top:335px、left:-40px、width:151px、height:313px。換算後掃把在左邊同學的左側，
// 先讓學習者看到它，才能判斷要問哪一位；過關後才移到 goal.reward 的位置。
const LESSON_BROOM_START = {
  top: "47.857%",
  left: "-4%",
  width: "15.1%",
  height: "44.714%"
};

// 把這一關的獎勵物件（筆／橡皮擦／掃把）放進場景。第五關的掃把會在一開始
// 就呼叫這個函式；其他關卡則是 finishQuest 時才顯示。
function showQuestReward(quest, { initial = false } = {}) {
  const reward = quest?.goal?.reward;
  if (!reward?.imageUrl) return;
  const placement = initial && quest.themeKey === "lesson" && quest.order === 5
    ? { ...reward, ...LESSON_BROOM_START }
    : reward;
  ui.questReward.src = placement.imageUrl;
  ui.questReward.style.top = placement.top ?? "";
  ui.questReward.style.left = placement.left ?? "";
  ui.questReward.style.right = placement.right ?? "";
  ui.questReward.style.width = placement.width ?? "";
  ui.questReward.style.height = placement.height ?? "";
  ui.questReward.style.rotate = placement.rotate ?? "";
  ui.questReward.hidden = false;
}

// 判定條件一滿的過關：官方會讓那個東西出現在桌上（筆、橡皮擦、掃把），位置是官方 px 換算百分比；
// 畫面亮「！」，學者自己按下才出現「任務完成！」（官方 showComplete → completeClick 的兩段）。
function finishQuest() {
  const quest = currentQuest();
  // 過關之後輸入就沒用了，先收掉，免得學者以為還要再說一次。
  questState.done = true;
  ui.myTurn.hidden = true;
  for (const button of ui.questLayers.querySelectorAll("button")) button.disabled = true;
  for (const button of ui.questGoal.querySelectorAll("button")) button.disabled = true;
  for (const button of ui.questTags.querySelectorAll("button")) button.disabled = true;
  ui.questTagSection.hidden = true;
  ui.questTagDock.innerHTML = "";
  // 過關後不要再留著「點場景…」或購物籃的舊指令；右欄只留完成鈕。
  ui.questGoal.hidden = true;
  ui.questGoal.innerHTML = "";
  // 過關後桌上的名牌改成不可再拿回來的靜態字（狀態已 done）。
  syncQuestMarks();
  updateSubmit();
  // 過關不畫「說對了」結果卡：完成是用「！」→「任務完成！」彈窗呈現。
  showQuestReward(quest);
  // 官方完成時會播一句收尾台詞（方言別 JSON 的 stage.complete.sound），
  // 收起台詞（例如第 4 關點門後的 Ini kaku…）也照官方顯示在任務卡。
  if (quest.closing?.text) {
    ui.questReply.innerHTML = `<span class="quest-reply__line">${escapeHtml(quest.closing.text)}</span>`;
  }
  if (quest.closing?.audioUrl) playQuestClip(quest.closing.audioUrl);
  ui.questSpeaker.textContent = "任務完成";
  // 關卡鈕上的完成標記要立刻更新，不然要換關卡才看得到。
  questResults[questIndex] = { order: quest.order, quest: quest.quest, ok: true };
  renderLevelPicker();
  showQuestComplete();
  // 完成後輸入區收起、右欄可能把畫面帶到下方；獎勵物件在場景裡，
  // 若它不在視窗內就捲進來，讓筆／橡皮擦／掃把真的看得到。
  requestAnimationFrame(() => {
    if (!ui.questReward.hidden) {
      ui.questReward.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (matchMedia("(max-width: 1200px)").matches && !ui.questComplete.hidden) {
      // 手機的完成鈕在下方；完成後把它帶進視窗，才不會停在一塊空白。
      ui.questComplete.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

function questLevelCount() { return quests.length; }

// 中文直入教材句子（打字模式）的判定後門：只供除錯驗證，網址帶 ?debug_mode 才生效。
const QUEST_DEBUG_MODE = new URLSearchParams(globalThis.location?.search ?? "").has("debug_mode");

// 官方判定音效：select／take 的確定鍵判定時播 right／wrong（官方 #right-sound／#wrong-sound，
// 熱連結同一批素材）。答錯可以一直重試，音效只是回饋不改變流程。
function playJudgeSound(ok) {
  const audio = ok ? ui.questRightSound : ui.questWrongSound;
  if (!audio || !audio.src) return;
  audio.pause();
  audio.currentTime = 0;
  const play = audio.play();
  if (play && typeof play.catch === "function") play.catch(() => {});
}

// 答錯 3 次（這關內累計）出現「自動說這句」：官方 autoask-btn 的行為——
// 系統代學者說一次（含回應錄音照播），關卡照樣往下走，
// 結果卡上會標明是系統代說、不是自己答對的。
function updateAutoAsk() {
  const quest = currentQuest();
  const can = Boolean(questState && !questState.done && quest?.goal?.kind !== "end" && questState.failures >= 3);
  ui.questAutoAsk.hidden = !can;
  if (can) ui.questAutoAsk.focus({ preventScroll: true });
}

function autoAskClick() {
  const quest = currentQuest();
  if (!quest || questState?.done) return;
  // 道謝關（selectAndSpeak）：選好對象之後，這句是 goal.prompt 的示範錄音。
  if (quest.goal.kind === "selectAndSpeak" && questState.picked) {
    if (quest.goal.promptAudioUrl) playQuestClip(quest.goal.promptAudioUrl);
    finishQuest();
    return;
  }
  // 沒點人時視同官方 autoAsk 用當下選取對象：這關還沒問到的人裡挑第一位。
  // 借筆／借橡皮擦不公布哪一位，但自動示範要直接問對的人，否則會卡在錯的人。
  const targetId = questIsBorrowQuest(quest)
    ? quest.goal.targetId
    : questTarget
      ?? quest.targets.find((target) => !questState.learned.includes(target.id))?.id;
  const line = questLineFor(quest, targetId);
  if (!line) return;
  questTarget = targetId;
  syncTargetLooks();
  // 系統代說：示範句播完接同學回應，關卡照樣往下走。畫面上不另寫
  // 「系統替你說／不算答對」的結果卡。
  if (line.audioUrl) playQuestClip(line.audioUrl, line.reply.audioUrl);
  onQuestAnswered(line, { skipReplyAudio: true });
}

ui.questAutoAsk.addEventListener("click", autoAskClick);

// 「下一關 →」（右欄下方）：按下去就往前一關（或看任務結果）。
ui.questComplete.addEventListener("click", () => {
  if (!questState?.done) return;
  ui.questComplete.hidden = true;
  questIndex += 1;
  if (questIndex >= quests.length) { showQuestReport(); return; }
  showQuest();
});

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

function playQuestClip(url, nextUrl) {
  ui.questAudio.pause();
  ui.questAudio.src = url;
  ui.questReplay.disabled = false;
  setQuestAudioState("playing", "播放中…");
  // nextUrl：上一段播完接著播（自動說的示範句→同學回應）。
  // 用 once 監聽，避免「再聽一次」也把下一段鏈出去。
  if (nextUrl) {
    ui.questAudio.addEventListener("ended", () => { playQuestClip(nextUrl); }, { once: true });
  }
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

// 第 3、4 關借筆／借橡皮擦：問錯人時照官方讓對方回答自己那句
// （第 3 關「我只有一隻」、第 4 關「我也沒有」），族語、中文與錄音一起顯示。
function showBorrowRefusal(targetId) {
  const quest = currentQuest();
  const line = questWrongPersonLine(quest, targetId);
  questState.failures = (questState.failures ?? 0) + 1;
  updateAutoAsk();
  ui.questAudio.pause();
  ui.questAudio.removeAttribute("src");
  setQuestAudioState("idle", "沒有回應錄音");
  ui.questReplay.disabled = true;
  if (targetId) ui.questSpeaker.textContent = `${targetLabel(targetId, quest)}的人說`;
  if (line?.reply) {
    const who = `${targetLabel(targetId, quest)}${quest.themeKey === "lesson" ? "同學" : "的人"}`;
    const chinese = line.reply.chineseText ? `　（${line.reply.chineseText}）` : "";
    ui.questReply.innerHTML = `<span class="quest-reply__line"><b>${escapeHtml(who)}</b> ${escapeHtml(line.reply.indigenousText)}${escapeHtml(chinese)}</span>`;
    if (line.reply.audioUrl) playQuestClip(line.reply.audioUrl);
  } else {
    ui.questReply.textContent = "我沒有";
  }
  // 這個人已經回答過了，把選取狀態收掉，下一步才不會一直停在錯誤的人；
  // 標題也回到通用的「問問同學」，不公布真正要問哪一位。
  questTarget = null;
  syncTargetLooks();
  ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
  clearQuestResult();
}

// 送出任務句：跟 STEP 2 同一條路徑（轉檔 → 辨識 → 翻譯 → 判定），
// 只是判定對象換成「對這位同學該說的那句」，而且答錯不鎖住，可以一直重試。
const runQuestLine = createSingleFlight(async () => {
  const quest = currentQuest();
  const typed = inputMode?.mode() === "type" ? ui.answer.value.trim() : "";
  const useVoice = inputMode?.mode() === "voice" && recorder?.blob;
  const epoch = runEpoch;
  if (!quest || !questReadyToSpeak() || pending || (!typed && !useVoice)) return;
  // 停掉上一句回應。不能放在判定結束後：那會把剛剛開始播的回應一起停掉，
  // play() 還會被中斷，畫面上變成「無法播放」。
  ui.questAudio.pause();
  pending = true;
  ui.submit.disabled = true;
  ui.retry.disabled = true;
  ui.record.disabled = true;

  // 借筆／借橡皮擦：選到不對的人就直接得到那位同學的官方回應（我只有一隻／我也沒有），
  // 不必等辨識；不能先判定句子，否則對方自己的名字句會被當成問對，無法過關卻給了正面回應。
  if (questIsBorrowQuest(quest) && questTarget && questTarget !== quest.goal.targetId) {
    showBorrowRefusal(questTarget);
    finishQuestTurn();
    return;
  }

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
    } catch (error) {
      clearTimeout(slowHint);
      if (dropped(epoch)) return;
      setState("failed", "這次沒有辨識成功");
      showQuestResult("unavailable", `目前無法辨識（${error.message}），再說一次試試看。`);
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
    showQuestResult("unavailable", `目前無法翻譯（${error.message}），再說一次試試看。`);
    ui.retry.hidden = false;
    finishQuestTurn();
    return;
  }
  if (dropped(epoch)) return;

  // 點了場景上的人就是問借刀；沒點人而且已選好對象，才比對道謝。
  const thanking = quest.goal.kind === "selectAndSpeak" && questState?.picked && !questTarget;
  let judged = thanking
    ? { verdict: judgeQuestPrompt(quest, { answer: indigenous, translation, ethnicity: selectedDialect.ethnicity }), line: { indigenousText: quest.goal.prompt, chineseText: quest.goal.promptChinese || null, reply: null } }
    : judgeQuestLine(quest, questTarget, { answer: indigenous, translation, allowChinese: QUEST_DEBUG_MODE, ethnicity: selectedDialect.ethnicity });
  // 規則沒過（retry）時，再用 AI 看譯文與教材中文意思是否一致；判過就升級成 semantic。
  // wrongTarget（這句要對另一個人說）不升級——句子再對，對象錯了就是錯。AI 連不上
  // 或判不通時維持 retry：連不上會在回應行註明，判定不會比本來的規則更嚴。
  let aiOutcome = null;
  if (judged.verdict === "retry") {
    const targetChinese = thanking ? (quest.goal.promptChinese || "") : (judged.line?.chineseText || "");
    setState("transcribing", "AI 判別中，請稍候");
    aiOutcome = await judgeAiMeaning({ translation, targetChinese });
    if (dropped(epoch)) return;
    if (aiOutcome.pass) {
      judged = { ...judged, verdict: "semantic", verdictBy: "ai", rationale: aiOutcome.rationale ?? null };
      aiOutcome = null;
    }
  }
  // 畫面上不顯示「對／錯」判定：對的人會直接聽到回應、場景跟進度自己往前；
  // 沒對上就靜靜再說一次（錯 3 次會出現「自動說這句」當出口）。
  if (judged.verdict === "exact" || judged.verdict === "semantic") {
    if (thanking) finishQuest();
    else onQuestAnswered(judged.line);
  } else if (judged.verdict === "retry" || judged.verdict === "wrongTarget") {
    // 這關內的失敗累計（官方 count_w 只算「說了但沒對上」），滿 3 次出現「自動說這句」；
    // 失敗本身不畫「你答錯了」的結果卡，而是照官方讓那位同學說 rebound
    // （「什麼？／不知道」）：任務卡的回應行顯示他說的話、播 rebound 錄音。
    questState.failures = (questState.failures ?? 0) + 1;
    updateAutoAsk();
    const reboundId = questTarget
      ?? (quest.goal.kind === "selectAndSpeak" && questState.picked ? questState.picked : null);
    const rebound = questReboundFor(quest, reboundId);
    if (rebound?.audioUrl) {
      playQuestClip(rebound.audioUrl);
      if (reboundId) ui.questSpeaker.textContent = `${targetLabel(reboundId, quest)}的人說`;
      // 回應文字照官方 textCh（「什麼？／不知道」），不另外改寫成別的句子。
      // AI 連不上時在後面註明原因（逾時／proxy 沒開／金鑰等），避免讓人以為是
      // AI「聽不懂」；AI 判意思不同時不打擾畫面，只在 console 留一句 AI 的說明。
      const aiHint = aiOutcome?.reason === "failed"
        ? `　（AI 判別暫時連不上：${aiOutcome.error ?? "不明原因"}；這次照教材字面判定）`
        : "";
      if (aiOutcome?.reason === "rejected") {
        console.log("[AI 判別] 認為意思不同：", aiOutcome.rationale);
      }
      const reboundChinese = rebound.chineseText ? `　（${rebound.chineseText}）` : "";
      ui.questReply.textContent = `${rebound.indigenousText}${reboundChinese}${aiHint}`;
    }
    clearQuestResult();
  }
  finishQuestTurn();
});

// 同學的回應要同時給族語與中文，而且兩位都要留著：名牌要從「誰說了哪個名字」認出來，
// 只留最後一句會認錯人。少數方言的自我介紹中文沿用了別的名字，下載時已把那句中文
// 收成 null，那種情況就只顯示族語，不要顯示錯的名字。
// 名牌關例外：回答句子會直接寫出名字／地名，等於提前公布拖曳答案，所以只播音檔，
// 句子不進任務卡；要重聽請用右欄「已問過的同學」旁邊的重播鈕。
function renderLearnedReplies() {
  const quest = currentQuest();
  if (quest?.goal.kind === "nameTags") { ui.questReply.textContent = ""; return; }
  const heard = (quest?.lines ?? []).filter((line) => questIsLearned(quest, line.targetId, questState));
  if (!heard.length) { ui.questReply.textContent = ""; return; }
  const person = quest?.themeKey === "lesson" ? "同學" : "的人";
  ui.questReply.innerHTML = heard.map((line) => {
    const chinese = line.reply.chineseText ? `　（${line.reply.chineseText}）` : "";
    return `<span class="quest-reply__line"><b>${targetLabel(line.targetId, quest)}${person}</b> ${escapeHtml(line.reply.indigenousText)}${escapeHtml(chinese)}</span>`;
  }).join("");
}

function onQuestAnswered(line, { skipReplyAudio = false } = {}) {
  const quest = currentQuest();
  if (!questState.learned.includes(line.targetId)) questState.learned.push(line.targetId);
  // 答對一次就把這關的失敗計數帶走（官方 count_w 每關重置，而且過關後不累計）。
  questState.failures = 0;
  // 剛問完人，先把「選了名牌要放」的模式收掉；候選區會重新出現，讓學習者再選。
  if (quest.goal.kind === "nameTags") questState.selectedCard = null;
  updateAutoAsk();
  renderLearnedReplies();
  if (!skipReplyAudio) playQuestReply(line);
  updateQuestProgress();
  if (questIsComplete(quest, questState)) { finishQuest(); return; }
  // 名牌關：第一位答對後名牌區就出現；兩位都問完後收起輸入面板，
  // 讓畫面只剩「把名牌放到對的桌上」這個動作。
  const allAsked = quest.goal.kind === "nameTags" && questState.learned.length >= quest.targets.length;
  if (quest.goal.kind === "nameTags") ui.myTurn.hidden = allAsked;
  const asksThenActs = quest.goal.kind === "select"
    || quest.goal.kind === "take"
    || quest.goal.kind === "click";
  ui.questSpeaker.textContent = asksThenActs
    ? questProgress(quest, questState)
    : quest.goal.kind === "selectAndSpeak"
      ? "選要道謝的人"
      : quest.goal.kind === "nameTags"
        ? "任務"
        : `再問${quest.themeKey === "lesson" ? "另一位同學" : "其他人"}`;
  questTarget = null;
  syncTargetLooks();
  ui.turnTitle.textContent = questTurnTitleFor(quest, { state: questState, targetId: null });
  ui.answer.value = "";
  syncQuestMarks();
  if (allAsked) focusFirstCard();
  else focusFirstTarget();
  // 手機的目標面板在輸入區下方，問對後把剛出現的選項／購物籃帶進畫面；
  // 點門關則把場景上的門帶進來，下一步才不會停在看不到的畫面。
  if (quest.goal.kind === "click") revealQuestClick();
  else if (quest.goal.kind === "select" || quest.goal.kind === "take" || quest.goal.kind === "selectAndSpeak") {
    revealQuestGoal();
  }
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
  // 任務結果面板：可以重玩任務，也可以切回對話。
  ui.questOffer.hidden = true;
  ui.startQuest.hidden = true;
  ui.toDialogue.hidden = false;
  ui.again.hidden = false;
  ui.again.textContent = "再玩一次任務";
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

function resetProgress() {
  runEpoch += 1;
  ui.player?.pause();
  ui.questAudio?.pause();
  index = 0;
  ui.scene.hidden = true;
  ui.report.hidden = true;
  ui.quest.hidden = true;
  // 輸入面板要跟著畫面走：回到設定時一定還在 STEP 2 那邊。
  mountInputPanel(ui.sceneBody);
  mode = "dialogue";
  reportKind = "dialogue";
  questState = null;
  questTarget = null;
  clearRecording();
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