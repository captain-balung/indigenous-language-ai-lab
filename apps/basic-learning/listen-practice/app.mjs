import { createQuestionDeck } from "../body-parts-practice/core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "../body-parts-practice/dialects.mjs";
import { THEMES, loadThemeShards, recordsForTheme, themeById } from "../body-parts-practice/themes.mjs";
import { listenRecords, pickChoices } from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"),
  themes: $("#themes"), themeGrid: $("#theme-grid"), modes: $("#modes"), modeGrid: $("#mode-grid"),
  quiz: $("#quiz"), label: $("#dialect-label"), progress: $("#progress"), title: $("#question-title"),
  replay: $("#replay"), audioState: $("#audio-state"), player: $("#player"),
  choices: $("#choices"), result: $("#result"), next: $("#next")
};

let selectedDialect, selectedTheme, selectedMode, shards, records = [];
let question, deck, choices = [], roundSize = 0, answeredCount = 0, answered = false;

ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(""));

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const list = DIALECTS.filter((item) => item.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = list.length
    ? `<option value="">請選擇方言別</option>${list.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`
    : `<option value="">請先選擇語言別</option>`;
  ui.dialect.disabled = !list.length;
  updateStart();
});

ui.dialect.addEventListener("change", () => {
  resetQuiz();
  selectedDialect = dialectById(ui.dialect.value);
  loadThemes();
  updateStart();
});

ui.themeGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-theme]");
  if (!button || button.disabled) return;
  selectedTheme = themeById(button.dataset.theme);
  records = listenRecords(recordsForTheme(selectedTheme, shards?.junior, shards?.jobs));
  for (const item of ui.themeGrid.querySelectorAll("button[data-theme]")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  ui.modes.hidden = false;
  updateStart();
});

ui.modeGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  selectedMode = button.dataset.mode;
  for (const item of ui.modeGrid.querySelectorAll("button[data-mode]")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  updateStart();
});

function updateStart() {
  ui.start.disabled = !selectedDialect || !selectedTheme || !selectedMode || records.length < 3;
}

async function loadThemes() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.themes.hidden = false;
  ui.themeGrid.innerHTML = "<p>載入主題中…</p>";
  try {
    shards = await loadThemeShards(dialect.id);
    if (selectedDialect !== dialect) return;
    ui.themeGrid.innerHTML = THEMES.map((theme) => {
      const count = listenRecords(recordsForTheme(theme, shards.junior, shards.jobs)).length;
      return `<button type="button" data-theme="${theme.id}" ${count >= 3 ? "" : "disabled"} aria-pressed="false">${escapeHtml(theme.name)}<small>${count} 題</small></button>`;
    }).join("");
  } catch (error) {
    if (selectedDialect !== dialect) return;
    shards = null;
    ui.themeGrid.innerHTML = `<p>主題教材無法載入：${escapeHtml(error.message)}</p>`;
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  if (records.length < 3) return;
  deck = createQuestionDeck(records);
  roundSize = records.length;
  answeredCount = 0;
  ui.quiz.hidden = false;
  nextQuestion();
  ui.quiz.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
});

function nextQuestion() {
  question = deck.next();
  answeredCount += 1;
  answered = false;
  choices = pickChoices(question, records);
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${selectedTheme.name} · ${selectedMode === "picture" ? "選圖" : "選意思"}`;
  ui.progress.textContent = `本輪 ${answeredCount} / ${roundSize}`;
  ui.title.textContent = selectedMode === "picture" ? "聽到的是哪一張圖？" : "聽到的是哪個意思？";
  ui.result.hidden = true;
  ui.next.hidden = true;
  renderChoices();
  playAudio(true);
}

function renderChoices() {
  ui.choices.dataset.mode = selectedMode;
  ui.choices.innerHTML = choices.map((item, index) => selectedMode === "picture"
    ? `<button type="button" class="choice choice--picture" data-id="${escapeHtml(item.id)}"><img src="${escapeHtml(item.imageSrc)}" alt="選項 ${index + 1}"></button>`
    : `<button type="button" class="choice" data-id="${escapeHtml(item.id)}">${escapeHtml(item.chineseText)}</button>`
  ).join("");
}

ui.choices.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || answered) return;
  answered = true;
  const correct = button.dataset.id === question.id;
  for (const item of ui.choices.querySelectorAll("button")) {
    item.disabled = true;
    if (item.dataset.id === question.id) item.dataset.correct = "true";
    else if (item === button && !correct) item.dataset.wrong = "true";
  }
  ui.result.hidden = false;
  ui.result.dataset.state = correct ? "exact" : "retry";
  ui.result.innerHTML = correct
    ? "<strong>答對了！</strong><p>可以再聽一次，或進入下一題。</p>"
    : `<strong>再聽一次</strong><p>正解是「${escapeHtml(question.chineseText)}」。</p>`;
  ui.next.hidden = false;
});

ui.replay.addEventListener("click", () => playAudio(false));
ui.next.addEventListener("click", () => {
  if (answeredCount >= roundSize) answeredCount = 0;
  nextQuestion();
});

function playAudio(fromNewQuestion) {
  if (!question?.audioUrl) return;
  ui.player.src = question.audioUrl;
  setAudioState("playing", "播放中…");
  const start = () => {
    const play = ui.player.play();
    if (play && typeof play.catch === "function") {
      play.catch(() => setAudioState("failed", "無法自動播放，請按播放音檔"));
    }
  };
  if (fromNewQuestion && reduced()) {
    setAudioState("idle", "請按播放音檔");
    return;
  }
  start();
}

ui.player.addEventListener("ended", () => setAudioState("ended", "播放結束"));
ui.player.addEventListener("error", () => setAudioState("failed", "音檔載入失敗"));

function setAudioState(state, text) {
  ui.audioState.dataset.state = state;
  ui.audioState.textContent = text;
}

function resetQuiz() {
  stopAudio();
  selectedDialect = undefined;
  selectedTheme = undefined;
  selectedMode = undefined;
  shards = undefined;
  records = [];
  deck = undefined;
  question = undefined;
  ui.quiz.hidden = true;
  ui.themes.hidden = true;
  ui.modes.hidden = true;
  ui.themeGrid.replaceChildren();
  ui.result.hidden = true;
  ui.next.hidden = true;
  for (const item of ui.modeGrid.querySelectorAll("button[data-mode]")) {
    item.setAttribute("aria-pressed", "false");
  }
}

function stopAudio() {
  ui.player.pause();
  ui.player.removeAttribute("src");
  ui.player.load();
  setAudioState("idle", "尚未播放");
}

function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

window.addEventListener("pagehide", stopAudio);
