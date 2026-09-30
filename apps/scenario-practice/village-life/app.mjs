import { createSingleFlight } from "../../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import {
  THEME_ORDER, buildExchanges, dialogueTheme, judgeReply, mineCount,
  respondableRoles, resultDetail, resultHeadline, tally, tallyLabel
} from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $("#setup"), ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  modelNote: $("#model-note"), scene: $("#scene"), label: $("#dialect-label"), progress: $("#progress"),
  backSetup: $("#back-setup"), sceneIntro: $("#scene-intro"), backSetupReport: $("#back-setup-report"),
  themeGrid: $("#theme-grid"), roleGrid: $("#role-grid"), rolePicker: $("#role-picker"),
  sceneBody: $("#scene-body"),
  background: $("#scene-background"), avatar: $("#scene-avatar"), speaker: $("#turn-speaker"),
  zh: $("#scene-title"), indigenous: $("#partner-text"),
  myTurn: $("#my-turn"), turnTitle: $("#turn-title"), answer: $("#answer"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"), recordNote: $("#record-note"),
  state: $("#record-state"), stateText: $("#record-state-text"),
  preview: $("#preview"), submit: $("#submit"), rerecord: $("#rerecord"), retry: $("#retry"),
  heard: $("#heard"), result: $("#result"), next: $("#next"),
  report: $("#report"), score: $("#score-line"), list: $("#score-list"), again: $("#again")
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
  lesson: { name: "開學第一天", hint: "在校門口遇到同學，問名字、問來處、一起吃早餐。" },
  find: { name: "家裡辦婚禮", hint: "親戚都來了，幫忙準備東西、找出要用的物品。" },
  outside: { name: "週末想出門", hint: "和哥哥約好去哪裡，先問過媽媽才出發。" }
};

let selectedDialect, shard, exchanges = [], index = 0, results = [];
let themeKey = THEME_ORDER[0], role = null, learnerName = "";
let pending = false, graded = false, unlocked = false, asrAudit = null, recorder = null, lastHeard = null;

function setState(key, override) {
  const [icon, text] = STATES[key] || STATES.idle;
  ui.state.dataset.state = key;
  ui.state.querySelector(".record-state__icon").textContent = icon;
  ui.stateText.textContent = override || text;
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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
function updateSubmit() { ui.submit.disabled = pending || graded || (!ui.answer.value.trim() && !recorder?.blob); }

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
  } else {
    const built = buildExchanges(shard, themeKey, role);
    exchanges = built.exchanges;
    learnerName = built.learnerName;
  }
  updateStart();
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
  const exchange = exchanges[index];
  graded = false;
  pending = false;
  lastHeard = null;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${themeName()} · 你當${learnerName}`;
  ui.progress.textContent = `第 ${index + 1} / ${exchanges.length} 句`;
  ui.background.src = exchange.background ? `https://web.klokah.tw/interact/hordequest/img/lesson/${exchange.background}` : "";
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
ui.submit.addEventListener("click", () => runExchange());
ui.retry.addEventListener("click", () => runExchange());
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
      setState("failed", "轉檔失敗，沒有送出");
      showResult("unavailable", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      finish();
      return;
    }
    setState("transcribing");
    const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      lastHeard = indigenous;
      renderHeard(indigenous);
    } catch (error) {
      clearTimeout(slowHint);
      setState("failed", "這次沒有辨識成功");
      showResult("unavailable", `目前無法辨識（${error.message}），你這句還沒有被判錯。`);
      ui.retry.hidden = false;
      finish();
      return;
    }
    clearTimeout(slowHint);
  }

  let translation = "";
  try {
    translation = await translateToZh(indigenous, selectedDialect.code);
  } catch (error) {
    setState("failed", "這次沒有翻譯成功");
    showResult("unavailable", `目前無法翻譯（${error.message}），你這句還沒有被判錯。`);
    ui.retry.hidden = false;
    finish();
    return;
  }

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
}

ui.again.addEventListener("click", () => {
  index = 0;
  results = [];
  ui.report.hidden = true;
  ui.scene.hidden = false;
  showExchange();
  scrollToTop();
});

function resetProgress() {
  ui.player?.pause();
  clearTimeout(unlockTimer);
  unlocked = false;
  index = 0;
  results = [];
  ui.scene.hidden = true;
  ui.report.hidden = true;
  clearRecording();
  ui.heard.hidden = true;
  ui.result.hidden = true;
}

function resetScene() {
  resetProgress();
  selectedDialect = undefined;
  shard = undefined;
  exchanges = [];
  updateStart();
}

window.addEventListener("pagehide", () => {
  ui.player?.pause();
  recorder?.clear();
});

init().catch((error) => {
  ui.api.textContent = `教材無法載入：${error.message}`;
  ui.api.dataset.state = "error";
});