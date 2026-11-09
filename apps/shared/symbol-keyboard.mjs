/**
 * 族語特殊符號鍵盤：給所有打字輸入框一列常駐的符號按鈕。
 *
 * 字元集與「族語E樂園」全站檢索（klokah.iformosa.com.tw/all_search）的符號列一致：
 * `^ é ṟ ɨ ʉ`，另外補一顆撇號。按鈕插的是正寫法通用的半形撇號 `'`，
 * 判定端（`body-parts-practice/core.mjs` 的 normalizeAnswer）會把 ’ ‘ 等變體正規化成 `'`，
 * 所以只用半形送出最通用。
 *
 * 純 DOM、零 CSS 依賴（樣式在 body-parts-speaking/styles.css 的 .symbol-keyboard），
 * 插入後 re-dispatch `input` 事件，讓各頁既有的送出鈕／驗證監聽即時更新。
 */

/** 參考「族語E樂園」全站檢索的符號集；撇號插半形。 */
export const SPECIAL_CHARS = ["'", "^", "é", "ṟ", "ɨ", "ʉ"];

const NAME_BY_CHAR = {
  "'": "撇號",
  "^": "上標尖號 ^",
  "é": "é",
  "ṟ": "ṟ",
  "ɨ": "ɨ",
  "ʉ": "ʉ"
};

/** 純函式：把 symbol 插進 value 的 start–end 範圍（等同先刪選取再插入），回傳新值與游標位置。 */
export function insertSymbol(value, start, end, symbol) {
  const text = String(value ?? "");
  const length = text.length;
  const from = Number.isFinite(start) ? Math.max(0, Math.min(Math.floor(start), length)) : length;
  const to = Number.isFinite(end) ? Math.max(from, Math.min(Math.floor(end), length)) : from;
  return { value: text.slice(0, from) + symbol + text.slice(to), caret: from + symbol.length };
}

/**
 * 在 input 上方掛符號鍵盤。
 * @param {{ container?: HTMLElement, input?: HTMLInputElement|HTMLTextAreaElement }} options
 * @returns {{ keyboard: HTMLElement|null }}
 */
export function mountSymbolKeyboard({ container, input, chars = SPECIAL_CHARS } = {}) {
  if (!input || input.dataset.symbolKeyboard === "1") return { keyboard: null };
  const host = container ?? input.parentElement;
  if (!host || typeof document === "undefined" || typeof document.createElement !== "function") return { keyboard: null };
  input.dataset.symbolKeyboard = "1";

  const keyboard = document.createElement("div");
  keyboard.className = "symbol-keyboard";
  keyboard.setAttribute("role", "group");
  keyboard.setAttribute("aria-label", "插入族語特殊符號");
  for (const symbol of chars) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-btn";
    button.setAttribute("data-symbol", symbol);
    button.setAttribute("aria-label", `插入${NAME_BY_CHAR[symbol] ?? symbol}`);
    button.textContent = symbol;
    keyboard.appendChild(button);
  }

  // 按下按鈕時不把焦點帶走，游標留在輸入框的插入點
  keyboard.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button[data-symbol]")) event.preventDefault();
  });
  keyboard.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-symbol]");
    if (!button) return;
    const symbol = button.getAttribute("data-symbol") ?? "";
    if (!symbol) return;
    const { value, caret } = insertSymbol(input.value, input.selectionStart, input.selectionEnd, symbol);
    input.value = value;
    input.focus();
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  input.parentElement.insertBefore(keyboard, input);
  return { keyboard };
}
