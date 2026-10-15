import { createSingleFlight } from "../../basic-learning/body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../../basic-learning/body-parts-practice/dialects.mjs";
import { ASR_MODELS, asrModelFor, auditAsrModels, SLOW_HINT_AFTER_MS } from "../../basic-learning/body-parts-speaking/asr.mjs";
import {
  convertToAsrWav, createRecorder, fetchLiveAsrDialects, supportsRecording, transcribe, translateToZh
} from "../../certification-mock/beginner-mock-exam/recorder.mjs";
import {
  BARGAIN_REJECT, BRIEF_PLACEHOLDER, BUDGET, ROUND_SIZE,
  addToCart, buildBrief, cartTotal, emptyCart, emptyUnlocks, judgeCheckout,
  matchItemName, pickRoundCatalog, priceQuote, unlockDetail, unlockPrice
} from "./core.mjs";
import { wireInputMode } from "../../shared/input-mode.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $("#setup"), ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"),
  api: $("#api-status"), modelNote: $("#model-note"),
  scene: $("#scene"), label: $("#dialect-label"), phaseLabel: $("#phase-label"),
  backSetup: $("#back-setup"), budgetFill: $("#budget-fill"), budgetText: $("#budget-text"),
  scenarioText: $("#scenario-text"), missionText: $("#mission-text"), hintText: $("#hint-text"),
  productGrid: $("#product-grid"), vendorSay: $("#vendor-say"),
  askDetail: $("#ask-detail"), bargain: $("#bargain"), toBuy: $("#to-buy"), toAsk: $("#to-ask"),
  speakPanel: $("#speak-panel"), turnTitle: $("#turn-title"), turnHint: $("#turn-hint"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  qtyRow: $("#qty-row"), qty: $("#qty"), qtyDec: $("#qty-dec"), qtyInc: $("#qty-inc"),
  answer: $("#answer"), record: $("#record"), recordLabel: $("#record-label"), time: $("#record-time"),
  state: $("#record-state"), stateText: $("#record-state-text"), recordNote: $("#record-note"),
  submit: $("#submit"), rerecord: $("#rerecord"), retry: $("#retry"),
  heard: $("#heard"), result: $("#result"),
  cartPanel: $("#cart-panel"), cartList: $("#cart-list"), cartTotal: $("#cart-total"), checkout: $("#checkout"),
  report: $("#report"), reportHeadline: $("#report-headline"), reportDetail: $("#report-detail"),
  reportMath: $("#report-math"), again: $("#again"), backSetupReport: $("#back-setup-report"),
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

let selectedDialect = null;
let dialectPool = [];
let catalog = [];
let availableDialectIds = new Set();
let phase = "ask";
let selectedItemId = null;
let unlocks = emptyUnlocks();
let cart = emptyCart();
let pending = false;
let asrAudit = null;
let recorder = null;
let lastHeard = null;
let translationCodes = new Set(DIALECTS.map((item) => item.code));
let runEpoch = 0;
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function reduced() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function selectedItem() {
  return catalog.find((item) => item.id === selectedItemId) || null;
}

async function init() {
  ui.ethnicity.insertAdjacentHTML(
    "beforeend",
    ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join("")
  );
  applyBrief(BRIEF_PLACEHOLDER);

  recorder = createRecorder({
    onState(state) {
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
        runFlow();
        return;
      }
      ui.record.classList.remove("is-recording");
      ui.recordLabel.textContent = "開始錄音";
      ui.rerecord.hidden = true;
      setState("idle");
      updateSubmit();
    },
    onTick(seconds) { ui.time.textContent = clock(seconds); }
  });

  inputMode = wireInputMode({
    root: ui.speakPanel,
    toggle: ui.inputModeToggle,
    typePanel: ui.inputType,
    voicePanel: ui.inputVoice,
    onModeChange(mode) {
      if (mode === "type") clearRecording();
      else ui.answer.value = "";
      updateSubmit();
      if (mode === "type") ui.answer.focus();
      else ui.record.focus();
    }
  });

  await Promise.all([verifyServices(), loadDatasetIndex()]);
  if (!supportsRecording()) {
    ui.record.disabled = true;
    setState("failed", "這個瀏覽器不支援錄音，請切換為打字");
  }
}

async function loadDatasetIndex() {
  try {
    const response = await fetch("/data/market-helper/dataset.json");
    if (!response.ok) throw new Error("索引載入失敗");
    const dataset = await response.json();
    availableDialectIds = new Set((dataset.dialects || []).map((row) => Number(row.id)));
  } catch {
    availableDialectIds = new Set(DIALECTS.map((row) => row.id));
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
    const response = await fetch("https://ai3.iformosa.com.tw/formosan_ai/api.php?action=translate_languages", {
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.language_codes)) throw new Error();
    translationCodes = new Set(body.data.language_codes);
    notes.push(`翻譯服務已驗證 ${translationCodes.size} 個語言代碼`);
  } catch {
    notes.push("翻譯即時清單暫時無法取得，送出時再試");
  }
  ui.api.textContent = `● ${notes.join("；")}`;
  ui.api.dataset.state = asrAudit?.consistent ? "ok" : "fallback";
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
  const dialectName = selectedDialect?.name || "所選方言";
  ui.modelNote.textContent = usable
    ? `${dialectName}將使用「${ethnicity}」族級模型 ${model} 進行辨識。打字作答不經過語音辨識。`
    : `${ethnicity}目前無法使用語音辨識：${reason}。仍可打字作答。`;
}

function updateStart() {
  ui.start.disabled = !selectedDialect || dialectPool.length < ROUND_SIZE;
}

function applyBrief(brief) {
  ui.scenarioText.textContent = brief.scenario;
  ui.missionText.textContent = brief.mission;
  ui.hintText.textContent = brief.hint;
}

function dealRound() {
  catalog = pickRoundCatalog(dialectPool, { count: ROUND_SIZE });
  selectedItemId = null;
  unlocks = emptyUnlocks();
  cart = emptyCart();
  phase = "ask";
  pending = false;
  lastHeard = null;
  clearRecording();
  ui.answer.value = "";
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.retry.hidden = true;
  applyBrief(buildBrief(catalog));
  ui.vendorSay.textContent = "點一種貨，用族語說出它的名字來問價。先把媽媽交代的清單問清楚。";
  renderPhase();
  renderProducts();
  renderCart();
  updateBudget();
  updateSpeakPanel();
}

function resetProgress() {
  runEpoch += 1;
  ui.report.hidden = true;
  dealRound();
}

function clearRecording() {
  lastHeard = null;
  recorder?.clear();
  ui.time.textContent = "00:00";
  updateSubmit();
}

function updateSubmit() {
  // 語音：停錄即自動送出，送出鈕只服務打字模式。
  if (inputMode?.mode() === "voice") {
    ui.submit.disabled = true;
    return;
  }
  ui.submit.disabled = pending || !selectedItemId || !ui.answer.value.trim();
}

ui.ethnicity.addEventListener("change", () => {
  dialectPool = [];
  catalog = [];
  selectedDialect = null;
  const choices = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value)
    .filter((item) => !availableDialectIds.size || availableDialectIds.has(item.id));
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length;
  updateModelNote();
  updateStart();
});

ui.dialect.addEventListener("change", async () => {
  dialectPool = [];
  catalog = [];
  selectedDialect = dialectById(ui.dialect.value);
  updateModelNote();
  await loadPool();
});

async function loadPool() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.start.disabled = true;
  ui.api.textContent = "正在載入貨品詞…";
  try {
    const response = await fetch(`/data/market-helper/dialects/${dialect.id}.json`);
    if (!response.ok) throw new Error("這個方言目前沒有植物詞表");
    const shard = await response.json();
    if (selectedDialect !== dialect) return;
    dialectPool = Array.isArray(shard.items) ? shard.items : [];
    if (dialectPool.length < ROUND_SIZE) throw new Error("可賣貨品不足");
    ui.api.textContent = `● 已載入 ${dialectPool.length} 種可賣植物詞（每局隨機 ${ROUND_SIZE} 種）`;
    ui.api.dataset.state = "ok";
  } catch (error) {
    if (selectedDialect !== dialect) return;
    dialectPool = [];
    ui.api.textContent = `貨品詞無法載入：${error.message}`;
    ui.api.dataset.state = "error";
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  if (dialectPool.length < ROUND_SIZE) return;
  ui.setup.hidden = true;
  ui.scene.hidden = false;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name}`;
  resetProgress();
  ui.scene.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

function backToSetup() {
  runEpoch += 1;
  ui.scene.hidden = true;
  ui.report.hidden = true;
  ui.setup.hidden = false;
  stopAudio();
  clearRecording();
  ui.setup.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
}

ui.backSetup.addEventListener("click", backToSetup);
ui.backSetupReport.addEventListener("click", backToSetup);

ui.again.addEventListener("click", () => {
  ui.report.hidden = true;
  ui.scene.hidden = false;
  resetProgress();
});

function renderPhase() {
  const asking = phase === "ask";
  ui.phaseLabel.textContent = asking ? "問價" : "購買";
  ui.qtyRow.hidden = asking;
  ui.cartPanel.hidden = asking;
  ui.toBuy.hidden = asking ? unlocks.asked.size < catalog.length : true;
  ui.toAsk.hidden = asking;
  ui.bargain.hidden = asking;
  ui.checkout.disabled = asking || !cart.length || pending;
  updateDetailButton();
}

function updateDetailButton() {
  const item = selectedItem();
  const canAsk = Boolean(
    phase === "ask"
    && item
    && item.reveal?.detail
    && unlocks.asked.has(item.id)
    && !unlocks.detailAsked.has(item.id)
  );
  ui.askDetail.hidden = !canAsk;
}

function renderProducts() {
  ui.productGrid.innerHTML = catalog.map((item) => {
    const quoted = priceQuote(item, unlocks);
    const selected = item.id === selectedItemId ? " is-selected" : "";
    const known = quoted ? " is-known" : "";
    const img = item.imageUrl
      ? `<img class="product-card__img" src="${escapeHtml(item.imageUrl)}" alt="" width="96" height="96" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="product-card__art" aria-hidden="true"></span>`;
    return `<button type="button" class="product-card${selected}${known}" data-id="${escapeHtml(item.id)}" role="listitem">
      ${img}
      <strong>${escapeHtml(item.chineseText)}</strong>
      <span class="product-card__price">${quoted ? escapeHtml(quoted) : "價錢未問"}</span>
    </button>`;
  }).join("");
}

ui.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  selectedItemId = button.dataset.id;
  ui.heard.hidden = true;
  ui.result.hidden = true;
  ui.retry.hidden = true;
  ui.answer.value = "";
  clearRecording();
  renderProducts();
  updateSpeakPanel();
  updateDetailButton();
});

function updateSpeakPanel() {
  const item = selectedItem();
  const canRecord = supportsRecording() && selectedDialect && asrStateFor(selectedDialect.ethnicity).usable;
  ui.record.disabled = !canRecord || !item;
  if (!item) {
    ui.turnTitle.textContent = "用族語說貨品名";
    ui.turnHint.textContent = phase === "ask" ? "先在左邊點選一種貨。" : "先選要買的貨，再選數量。";
    ui.replay.disabled = true;
    setAudioState("idle", "選貨後可聽");
    updateSubmit();
    return;
  }
  if (phase === "ask") {
    ui.turnTitle.textContent = `問價：說出「${item.chineseText}」的族語`;
    ui.turnHint.textContent = unlocks.asked.has(item.id)
      ? "這種貨的價錢已經問過了，可以改問別的，或去購買。"
      : "語音錄完會自動送出；打字則按送出。說對貨品名後，攤主會報價。";
  } else {
    ui.turnTitle.textContent = `放入籃子：再說一次「${item.chineseText}」`;
    ui.turnHint.textContent = "選定數量後，用族語說出貨品名確認放入購物籃。";
  }
  ui.replay.disabled = !item.audioUrl;
  setAudioState(item.audioUrl ? "idle" : "failed", item.audioUrl ? "想聽再按播放" : "沒有音檔");
  updateSubmit();
}

function updateBudget() {
  const spent = cartTotal(catalog, cart);
  const pct = Math.min(100, Math.round((spent / BUDGET) * 100));
  ui.budgetFill.style.width = `${pct}%`;
  ui.budgetFill.classList.toggle("is-warn", spent > BUDGET * 0.7 && spent <= BUDGET);
  ui.budgetFill.classList.toggle("is-over", spent > BUDGET);
  ui.budgetText.textContent = spent > BUDGET
    ? `${spent} / ${BUDGET} 元（超支）`
    : `${spent} / ${BUDGET} 元`;
}

function renderCart() {
  if (!cart.length) {
    ui.cartList.innerHTML = "<li class=\"cart-empty\">籃子還是空的</li>";
  } else {
    ui.cartList.innerHTML = cart.map((line) => {
      const item = catalog.find((row) => row.id === line.itemId);
      const name = item?.chineseText || line.itemId;
      const unit = item?.unit || "個";
      return `<li><span>${escapeHtml(name)} × ${line.qty} ${unit}</span></li>`;
    }).join("");
  }
  ui.cartTotal.textContent = `合計 ${cartTotal(catalog, cart)} 元`;
  ui.checkout.disabled = phase !== "buy" || !cart.length || pending;
}

ui.toBuy.addEventListener("click", () => {
  phase = "buy";
  ui.vendorSay.textContent = "選貨、選數量，再說一次族語名放入籃子。可以殺價試試，最後按結帳。";
  renderPhase();
  updateSpeakPanel();
  renderCart();
});

ui.toAsk.addEventListener("click", () => {
  phase = "ask";
  ui.vendorSay.textContent = "點一種貨，用族語說出它的名字來問價。";
  renderPhase();
  updateSpeakPanel();
});

ui.askDetail.addEventListener("click", () => {
  const item = selectedItem();
  if (!item?.reveal?.detail) return;
  unlocks = unlockDetail(unlocks, item.id);
  ui.vendorSay.textContent = `攤主：${priceQuote(item, unlocks)}`;
  updateDetailButton();
  renderProducts();
});

ui.bargain.addEventListener("click", () => {
  ui.vendorSay.textContent = `攤主：${BARGAIN_REJECT}`;
});

ui.qty.addEventListener("input", updateSubmit);
ui.qtyDec.addEventListener("click", () => {
  ui.qty.value = String(Math.max(1, (Number.parseInt(ui.qty.value, 10) || 1) - 1));
  updateSubmit();
});
ui.qtyInc.addEventListener("click", () => {
  ui.qty.value = String(Math.min(20, (Number.parseInt(ui.qty.value, 10) || 1) + 1));
  updateSubmit();
});

function stopAudio() {
  ui.player.pause();
  ui.player.removeAttribute("src");
  ui.player.load();
}

function setAudioState(state, text) {
  ui.audioState.dataset.state = state;
  ui.audioState.textContent = text;
}

ui.replay.addEventListener("click", () => {
  const item = selectedItem();
  if (!item?.audioUrl) return;
  ui.player.src = item.audioUrl;
  setAudioState("playing", "播放中…");
  const play = ui.player.play();
  if (play && typeof play.catch === "function") {
    play.catch(() => setAudioState("failed", "無法播放，請再試一次"));
  }
});

ui.player.addEventListener("ended", () => setAudioState("ended", "播放結束"));
ui.player.addEventListener("error", () => setAudioState("failed", "音檔載入失敗"));

ui.record.addEventListener("click", async () => {
  if (recorder.recording) { recorder.stop(); return; }
  ui.player.pause();
  if (ui.audioState.dataset.state === "playing") setAudioState("ended", "已停止播放");
  try {
    await recorder.start();
    ui.recordNote.textContent = "";
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setState("failed", denied ? "沒有麥克風權限" : "找不到可用的麥克風");
    ui.recordNote.textContent = denied
      ? "瀏覽器沒有給這個頁面麥克風權限。可切換為打字，或在網址列允許麥克風後再錄。"
      : "找不到可用的麥克風。可切換為打字。";
  }
});

ui.rerecord.addEventListener("click", () => { clearRecording(); ui.record.focus(); });
ui.answer.addEventListener("input", updateSubmit);
ui.submit.addEventListener("click", () => { runFlow(); });
ui.retry.addEventListener("click", () => { runFlow(); });

async function translateAnswer(text) {
  if (!selectedDialect) throw new Error("尚未選方言");
  return translateToZh(text, selectedDialect.code);
}

const runFlow = createSingleFlight(async () => {
  const item = selectedItem();
  const typed = inputMode?.mode() === "type" ? ui.answer.value.trim() : "";
  const useVoice = inputMode?.mode() === "voice" && recorder?.blob;
  if (pending || !item || (!typed && !useVoice)) return;
  const epoch = runEpoch;
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
      showSpeakResult("undetermined", `無法把這段錄音轉成辨識需要的格式（${error.message}），因此沒有送出任何資料。`);
      finishFlow();
      return;
    }
    setState("transcribing");
    const slowHint = setTimeout(() => setState("slow"), SLOW_HINT_AFTER_MS);
    try {
      indigenous = await transcribe(wav, selectedDialect.ethnicity);
      if (epoch !== runEpoch) return;
      lastHeard = indigenous;
      renderHeard(indigenous);
    } catch (error) {
      clearTimeout(slowHint);
      if (epoch !== runEpoch) return;
      setState("failed", "這次沒有辨識成功");
      showSpeakResult("undetermined", `目前無法辨識（${error.message}），你的答案尚未被判錯。`);
      ui.retry.hidden = false;
      finishFlow();
      return;
    }
    clearTimeout(slowHint);
  } else {
    lastHeard = null;
    ui.heard.hidden = true;
  }

  let translation = "";
  try {
    translation = await translateAnswer(indigenous);
    if (epoch !== runEpoch) return;
  } catch (error) {
    if (epoch !== runEpoch) return;
    showSpeakResult("undetermined", `目前無法完成判定（${error.message}），你的答案尚未被判錯。`);
    ui.retry.hidden = false;
    finishFlow();
    return;
  }

  const matched = matchItemName({ answer: indigenous, translation, item });
  if (epoch !== runEpoch) return;

  if (!matched.ok) {
    showSpeakResult("retry", `系統聽到：${indigenous || "（空白）"}；懂成：${translation || "（無）"}。這次不像「${item.chineseText}」，再試一次。`);
    ui.retry.hidden = false;
    finishFlow();
    return;
  }

  if (phase === "ask") {
    unlocks = unlockPrice(unlocks, item.id);
    const quote = priceQuote(item, unlocks);
    ui.vendorSay.textContent = `攤主：${item.chineseText}？${quote}`;
    showSpeakResult("semantic", `對，這是「${item.chineseText}」（${item.indigenousText}）。價錢已解鎖。`);
    renderProducts();
    renderPhase();
    updateSpeakPanel();
  } else {
    const qty = Math.max(1, Math.min(20, Number.parseInt(ui.qty.value, 10) || 1));
    cart = addToCart(catalog, cart, item.id, qty);
    ui.vendorSay.textContent = `攤主：好，${item.chineseText} ${qty} ${item.unit}放進籃子了。還要別的嗎？`;
    showSpeakResult("semantic", `已放入 ${item.chineseText} × ${qty}。`);
    renderCart();
    updateBudget();
  }
  clearRecording();
  ui.answer.value = "";
  finishFlow();
});

function renderHeard(text) {
  ui.heard.hidden = false;
  ui.heard.textContent = `系統聽到：${text}`;
}

function showSpeakResult(state, message) {
  ui.result.hidden = false;
  ui.result.dataset.state = state;
  ui.result.textContent = message;
}

function finishFlow() {
  pending = false;
  ui.retry.disabled = false;
  const canRecord = supportsRecording() && selectedDialect && asrStateFor(selectedDialect.ethnicity).usable;
  ui.record.disabled = !canRecord || !selectedItem();
  updateSubmit();
  setState(recorder?.blob ? "recorded" : "idle");
}

ui.checkout.addEventListener("click", () => {
  if (!cart.length || pending) return;
  const outcome = judgeCheckout(catalog, cart);
  ui.scene.hidden = true;
  ui.report.hidden = false;
  ui.reportHeadline.textContent = outcome.headline;
  ui.reportDetail.textContent = outcome.detail;
  const lines = cart.map((line) => {
    const item = catalog.find((row) => row.id === line.itemId);
    return `${item?.chineseText || line.itemId} × ${line.qty}`;
  }).join("、");
  ui.reportMath.textContent = `籃子：${lines || "（空）"}。合計 ${outcome.total} 元（預算 ${BUDGET} 元）。`;
  ui.report.dataset.state = outcome.code;
  ui.report.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

init();
