import { createQuestionDeck, createSingleFlight, judgeAnswer } from "./core.mjs";
import { DIALECTS, ETHNICITIES, dialectById } from "./dialects.mjs";
import { THEMES, loadThemeShards, recordsForTheme, themeById } from "./themes.mjs";

const API = "https://ai3.iformosa.com.tw/formosan_ai/api.php";
const $ = (selector) => document.querySelector(selector);
const ui = {
  ethnicity: $("#ethnicity"), dialect: $("#dialect"), start: $("#start"), api: $("#api-status"),
  themes: $("#themes"), themeGrid: $("#theme-grid"), quiz: $("#quiz"), label: $("#dialect-label"),
  progress: $("#progress"), image: $("#question-image"), answer: $("#answer"), submit: $("#submit"),
  result: $("#result"), retry: $("#retry"), reveal: $("#reveal"), next: $("#next"), model: $("#model-answer")
};
let selectedDialect, selectedTheme, shards, records = [], question, deck, roundSize = 0, answeredCount = 0, pending = false, apiCodes = new Set(DIALECTS.map((d) => d.code));

async function init() {
  ui.ethnicity.insertAdjacentHTML("beforeend", ETHNICITIES.map((name) => `<option value="${name}">${name}</option>`).join(""));
  verifyApiLanguages();
}

async function verifyApiLanguages() {
  try {
    const response = await fetch(`${API}?action=translate_languages`);
    const body = await response.json();
    if (!response.ok || body.ok !== true || !Array.isArray(body.data?.language_codes)) throw new Error();
    apiCodes = new Set(body.data.language_codes);
    ui.api.textContent = `● 翻譯服務已連線；已驗證 ${apiCodes.size} 個語言代碼`;
    ui.api.dataset.state = "ok";
  } catch {
    ui.api.textContent = "△ 即時清單暫時無法取得，使用 2026-07-27 官方清單；教材完全比對仍可離線運作。";
    ui.api.dataset.state = "fallback";
  }
  updateStart();
}

ui.ethnicity.addEventListener("change", () => {
  resetQuiz();
  const choices = DIALECTS.filter((d) => d.ethnicity === ui.ethnicity.value);
  ui.dialect.innerHTML = `<option value="">請選擇方言別</option>${choices.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}`;
  ui.dialect.disabled = !choices.length; updateStart();
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
  records = recordsForTheme(selectedTheme, shards?.junior, shards?.jobs);
  for (const item of ui.themeGrid.querySelectorAll("button[data-theme]")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  updateStart();
});
function updateStart() { ui.start.disabled = !selectedDialect || !selectedTheme || !records.length; }

async function loadThemes() {
  const dialect = selectedDialect;
  if (!dialect) return;
  ui.themes.hidden = false;
  ui.themeGrid.innerHTML = "<p>載入主題中…</p>";
  try {
    shards = await loadThemeShards(dialect.id);
    if (selectedDialect !== dialect) return;
    ui.themeGrid.innerHTML = THEMES.map((theme) => {
      const count = recordsForTheme(theme, shards.junior, shards.jobs).length;
      return `<button type="button" data-theme="${theme.id}" ${count ? "" : "disabled"} aria-pressed="false">${escapeHtml(theme.name)}<small>${count} 題</small></button>`;
    }).join("");
  } catch (error) {
    if (selectedDialect !== dialect) return;
    shards = null;
    ui.themeGrid.innerHTML = `<p>主題教材無法載入：${escapeHtml(error.message)}</p>`;
  }
  updateStart();
}

ui.start.addEventListener("click", () => {
  if (!records.length) return showResult("unavailable", "此主題目前沒有完整圖卡，暫停出題。");
  deck = createQuestionDeck(records); roundSize = records.length; answeredCount = 0; ui.quiz.hidden = false; nextQuestion(); ui.quiz.scrollIntoView({behavior: reduced() ? "auto" : "smooth"});
});

function nextQuestion() {
  question = deck.next(); answeredCount += 1; pending = false;
  ui.label.textContent = `${selectedDialect.ethnicity} · ${selectedDialect.name} · ${selectedTheme.name}`;
  ui.progress.textContent = `本輪 ${answeredCount} / ${roundSize}`;
  ui.image.src = question.imageSrc;
  ui.image.alt = `請辨認圖片（${selectedTheme.name}，${selectedDialect.name}）`;
  ui.answer.value = ""; ui.answer.disabled = false; ui.submit.disabled = false;
  ui.result.hidden = ui.retry.hidden = ui.reveal.hidden = ui.next.hidden = ui.model.hidden = true;
  ui.answer.focus();
}

$("#submit").addEventListener("click", submitAnswer);
ui.answer.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submitAnswer(); } });
async function submitAnswer() {
  const answer = ui.answer.value.trim(); if (!answer || pending) return;
  pending = true; ui.submit.disabled = true; ui.submit.textContent = "判定中…";
  const result = await runJudgement({ answer, question, code: selectedDialect.code });
  ui.submit.textContent = "送出答案"; pending = false;
  renderResult(result, answer);
}

const runJudgement = createSingleFlight(({ answer, question, code }) =>
  judgeAnswer({ answer, question, translate: (text) => translateToZh(text, code) })
);

async function translateToZh(text, srcLang) {
  if (!apiCodes.has(srcLang)) throw new Error("此方言目前沒有翻譯代碼");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(API, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"translate_to_zh",text,src_lang:srcLang}),signal:controller.signal});
    let body; try { body = await response.json(); } catch { throw new Error("服務回傳不是有效 JSON"); }
    if (!response.ok) throw new Error(`翻譯服務 HTTP ${response.status}`);
    if (body.ok !== true) throw new Error(body.error || "翻譯服務拒絕請求");
    if (typeof body.data?.translation !== "string" || !body.data.translation.trim()) throw new Error("翻譯服務缺少譯文");
    return body.data.translation.trim();
  } catch (error) { if (error.name === "AbortError") throw new Error("翻譯服務逾時"); throw error; }
  finally { clearTimeout(timer); }
}

function renderResult(result, answer) {
  ui.result.hidden = false; ui.result.dataset.state = result.type;
  const messages = {exact:["完全正確！","教材答案完全符合，不需要呼叫翻譯服務。"],semantic:["意思正確，通過！","你的回答意思接近；可參考教材標準句型。"],retry:["再試一次","譯文與本題不相符。"],unavailable:["目前無法使用翻譯服務判定","你的答案尚未被判錯，輸入已保留。"]};
  const [title, detail] = messages[result.type];
  ui.result.innerHTML = `<strong>${title}</strong><p>${detail}</p>${result.translation ? `<dl><dt>你的族語回答</dt><dd>${escapeHtml(answer)}</dd><dt>API 中文譯文</dt><dd>${escapeHtml(result.translation)}</dd>${result.type === "semantic" ? `<dt>教材族語</dt><dd>${escapeHtml(question.indigenousText)}</dd><dt>教材中文</dt><dd>${escapeHtml(question.chineseText)}</dd>` : ""}</dl>` : ""}`;
  const passed = result.type === "exact" || result.type === "semantic";
  ui.next.hidden = !passed; ui.reveal.hidden = passed; ui.retry.hidden = result.type !== "unavailable";
  ui.answer.disabled = passed; ui.submit.disabled = passed;
}

ui.retry.addEventListener("click", submitAnswer);
ui.reveal.addEventListener("click", () => { ui.model.hidden = false; ui.model.innerHTML = `<strong>教材答案</strong><p>${escapeHtml(question.indigenousText)}</p><small>${escapeHtml(question.chineseText)}</small>`; });
ui.next.addEventListener("click", () => { if (answeredCount >= roundSize) answeredCount = 0; nextQuestion(); });
function resetQuiz() {
  selectedDialect = undefined; selectedTheme = undefined; shards = undefined; records = []; deck = undefined; question = undefined;
  ui.quiz.hidden = true; ui.themes.hidden = true; ui.themeGrid.replaceChildren();
}
function showResult(state, text) { ui.result.hidden = false; ui.result.dataset.state = state; ui.result.textContent = text; }
function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function escapeHtml(value) { const div=document.createElement("div"); div.textContent=value; return div.innerHTML; }
init().catch((error) => { ui.api.textContent = `教材無法載入：${error.message}`; ui.api.dataset.state = "error"; });
