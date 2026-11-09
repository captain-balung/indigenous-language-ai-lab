import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPECIAL_CHARS, insertSymbol, mountSymbolKeyboard } from "../symbol-keyboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/* ───── 字元集：與「族語E樂園」全站檢索（klokah.iformosa.com.tw/all_search）一致 ───── */
assert.deepEqual(SPECIAL_CHARS, ["'", "^", "é", "ṟ", "ɨ", "ʉ"], "符號集須與參考站一致（撇號插半形）");

/* ───── insertSymbol 純函式：游標插入、選取替換、邊界夾住 ───── */
assert.deepEqual(insertSymbol("abcd", 2, 2, "é"), { value: "abécd", caret: 3 }, "游標處插入");
assert.deepEqual(insertSymbol("abcd", 1, 3, "'"), { value: "a'd", caret: 2 }, "選取範圍被替換");
assert.deepEqual(insertSymbol("abcd", 4, 4, "^"), { value: "abcd^", caret: 5 }, "結尾插入");
assert.deepEqual(insertSymbol("abcd", 0, 0, "ɨ"), { value: "ɨabcd", caret: 1 }, "開頭插入");
assert.deepEqual(insertSymbol("abcd", 99, 99, "ʉ"), { value: "abcdʉ", caret: 5 }, "超出長度要夾住");
assert.deepEqual(insertSymbol("abcd", -5, -5, "ṟ"), { value: "ṟabcd", caret: 1 }, "負數要夾住");
assert.deepEqual(insertSymbol("", undefined, undefined, "'"), { value: "'", caret: 1 }, "空值預設插在最後");
assert.deepEqual(insertSymbol("abcd", 5, 2, "é"), { value: "abcdé", caret: 5 }, "start>end 時先夾 start，end 不小於 start");

/* ───── DOM stub：走真實的 click／pointerdown 路徑 ───── */
{
  globalThis.document = {
    createElement(tag) {
      const el = {
        tagName: tag, children: [], listeners: new Map(), attributes: {}, classValue: "", textContent: "",
        set className(v) { this.classValue = v; },
        get className() { return this.classValue; },
        set type(v) { this.typeValue = v; },
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; },
        getAttribute(key) { return this.attributes[key] ?? null; },
        addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); },
        closest() { return null; }
      };
      return el;
    }
  };

  let inserted = null;
  const fakeInput = {
    dataset: {}, value: "U mata kiniya", selectionStart: 9, selectionEnd: 9,
    focus() { fakeInput.focused = true; },
    setSelectionRange(start, end) { fakeInput.caretSet = [start, end]; },
    dispatchEvent(event) { fakeInput.events = [...(fakeInput.events ?? []), event]; },
    parentElement: { insertBefore(node) { inserted = node; } }
  };

  const { keyboard } = mountSymbolKeyboard({ input: fakeInput });
  assert.ok(keyboard, "要回傳掛好的鍵盤");
  assert.equal(inserted, keyboard, "鍵盤要插在輸入框正上方");
  assert.equal(fakeInput.dataset.symbolKeyboard, "1", "掛載後要落防重掛標記");
  assert.ok(keyboard.listeners.has("click") && keyboard.listeners.has("pointerdown"));

  const buttons = keyboard.children;
  assert.equal(buttons.length, SPECIAL_CHARS.length, "按鈕數要等於字元集");
  for (const charItem of SPECIAL_CHARS) {
    const button = buttons.find((item) => item.attributes["data-symbol"] === charItem);
    assert.ok(button, `每個符號都要有按鈕：${charItem}`);
    assert.equal(button.typeValue, "button", "不能用 submit 預設按鈕");
    assert.ok(button.attributes["aria-label"], "每顆按鈕要有 aria-label");
  }

  // 同一個 input 只掛一次；缺 document 時安全略過
  assert.equal(mountSymbolKeyboard({ input: fakeInput }).keyboard, null, "同一個 input 不重複掛");
  globalThis.document = undefined;
  assert.equal(mountSymbolKeyboard({ input: { dataset: {} } }).keyboard, null, "document 存在才掛");
  globalThis.document = {
    createElement(tag) {
      const el = { children: [], listeners: new Map(), attributes: {}, appendChild() {}, setAttribute() {}, addEventListener() {} };
      return el;
    }
  };
  assert.equal(mountSymbolKeyboard({ input: { dataset: {} } }).keyboard !== null || true, true, "保底：掛載函式不拋例外");
  delete globalThis.document;

  // click：在游標處插入、聚焦、設定游標、re-dispatch input
  const button = buttons.find((item) => item.attributes["data-symbol"] === "é");
  for (const handler of keyboard.listeners.get("click")) {
    handler({ target: { closest: (selector) => (selector === "button[data-symbol]" ? button : null) } });
  }
  assert.equal(fakeInput.value, "U mata kiéniya", "要在游標處插入 é");
  assert.equal(fakeInput.focused, true, "插入後要聚焦回輸入框");
  assert.deepEqual(fakeInput.caretSet, [10, 10], "游標要在插入字元之後");
  assert.ok((fakeInput.events ?? []).some((event) => event.type === "input"), "要重發 input 事件");

  // 沒點到按鈕（closest null）不改值
  for (const handler of keyboard.listeners.get("click")) {
    handler({ target: { closest: () => null } });
  }
  assert.equal(fakeInput.value, "U mata kiéniya", "closeest null 不變更");

  // pointerdown：要 preventDefault，讓游標留在輸入框
  let prevented = 0;
  for (const handler of keyboard.listeners.get("pointerdown")) {
    handler({
      target: { closest: (selector) => (selector === "button[data-symbol]" ? button : null) },
      preventDefault() { prevented += 1; }
    });
  }
  assert.equal(prevented, 1, "pointerdown 要擋住按鈕搶焦點");

  delete globalThis.document;
}

/* ───── 掛載點契約：3 處修改覆蓋 8 個 app、13 個輸入框 ───── */
assert.ok(fs.readFileSync(path.join(root, "apps/shared/input-mode.mjs"), "utf8").includes("mountSymbolKeyboard"), "wireInputMode 要自動掛鍵盤");
assert.ok(fs.readFileSync(path.join(root, "apps/classroom-quiz/meaning-sentence/engine.mjs"), "utf8").includes("mountSymbolKeyboard"), "意思考句 compose 面板要掛鍵盤");
assert.ok(fs.readFileSync(path.join(root, "apps/basic-learning/body-parts-practice/app.mjs"), "utf8").includes("mountSymbolKeyboard"), "看圖練習（純打字）要掛鍵盤");

const typingPages = [
  "apps/classroom-quiz/twelve-translation/index.html",
  "apps/classroom-quiz/twelve-pronunciation/index.html",
  "apps/classroom-quiz/alphabet-pronunciation/index.html",
  "apps/basic-learning/twelve-listen-retell/index.html",
  "apps/basic-learning/alphabet-listen-retell/index.html",
  "apps/classroom-quiz/picture-quiz/index.html",
  "apps/classroom-quiz/meaning-sentence/index.html",
  "apps/basic-learning/qa-practice/index.html",
  "apps/basic-learning/describe-practice/index.html",
  "apps/basic-learning/body-parts-practice/index.html",
  "apps/scenario-practice/village-life/index.html",
  "apps/scenario-practice/market-helper/index.html"
];
for (const relativePage of typingPages) {
  const page = fs.readFileSync(path.join(root, relativePage), "utf8");
  assert.ok(page.includes('id="answer"'), `${relativePage} 要有答案輸入框`);
  assert.ok(page.includes("/apps/basic-learning/body-parts-speaking/styles.css"), `${relativePage} 要引用符號鍵盤樣式`);
}
const sharedCss = fs.readFileSync(path.join(root, "apps/basic-learning/body-parts-speaking/styles.css"), "utf8");
assert.ok(sharedCss.includes(".symbol-keyboard"), "共用樣式要有鍵盤容器");
assert.ok(/\.symbol-btn\{[^}]*min-height:2\.75rem/.test(sharedCss), "按鈕最小 44px 觸控尺寸");
assert.ok(/\.symbol-btn:focus-visible\{/.test(sharedCss), "按鈕要有鍵盤焦點樣式");
assert.ok(/prefers-reduced-motion: reduce\)\{[\s\S]*\.symbol-btn/.test(sharedCss), "動效要卡 reduced-motion");

console.log("PASS: symbol keyboard (reference char set, cursor insert, real click path, mount contracts)");
