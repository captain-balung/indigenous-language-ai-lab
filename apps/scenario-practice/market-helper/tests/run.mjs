import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BARGAIN_REJECT, BRIEF_PLACEHOLDER, BUDGET, FAIL, PRICE_ROLES, ROUND_SIZE,
  addToCart, buildBrief, cartPieceCount, cartQtyOf, cartTotal, catalogItem,
  emptyCart, emptyUnlocks, formatItemList, judgeCheckout, matchItemName,
  pickRoundCatalog, priceQuote, removeFromCart, setCartQty, shoppingList,
  unlockDetail, unlockPrice
} from "../core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

assert.equal(BUDGET, 100);
assert.equal(ROUND_SIZE, 3);
assert.equal(PRICE_ROLES.length, 3);
assert.ok(BRIEF_PLACEHOLDER.scenario);
assert.ok(BARGAIN_REJECT.includes("景氣"));
assert.equal(formatItemList(["香蕉", "空心菜", "鳳梨"]), "香蕉、空心菜跟鳳梨");

const pool = [
  { code: "08-01", chineseText: "香蕉", indigenousText: "pawli", audioUrl: "a.wav", imageUrl: "https://klokah.tw/x.jpg" },
  { code: "08-04", chineseText: "芋頭", indigenousText: "tali", audioUrl: "b.wav", imageUrl: "https://klokah.tw/y.jpg" },
  { code: "08-19", chineseText: "鳳梨", indigenousText: "paringad", audioUrl: "c.wav", imageUrl: "https://klokah.tw/z.jpg" },
  { code: "08-12", chineseText: "玉米", indigenousText: "taviras", audioUrl: "d.wav", imageUrl: "https://klokah.tw/w.jpg" }
];

const catalog = pickRoundCatalog(pool, {
  count: 3,
  random: (() => {
    const seq = [0.9, 0.1, 0.5, 0.2, 0.8, 0.3, 0.7, 0.4];
    let i = 0;
    return () => seq[i++ % seq.length];
  })()
});
assert.equal(catalog.length, 3);

const brief = buildBrief(catalog);
assert.ok(brief.scenario.includes("媽媽給你 100 元"));
assert.ok(brief.mission.includes("購物清單"));
for (const item of catalog) {
  assert.ok(brief.scenario.includes(item.chineseText), item.chineseText);
  assert.ok(brief.mission.includes(item.chineseText), item.chineseText);
}
assert.ok(!/盡量|最多/.test(brief.scenario + brief.mission + brief.hint));

const list = shoppingList(catalog);
assert.equal(list.length, 3);
assert.ok(list.every((row) => row.qty === 1));

let unlocks = emptyUnlocks();
const jinItem = catalog.find((item) => item.pricing.kind === "jin");
assert.ok(jinItem);
unlocks = unlockPrice(unlocks, jinItem.id);
unlocks = unlockDetail(unlocks, jinItem.id);
assert.ok(priceQuote(jinItem, unlocks).includes("5 個"));

let cart = emptyCart();
assert.equal(judgeCheckout(catalog, cart).code, "notFull");

cart = addToCart(catalog, cart, catalog[0].id, 1);
assert.equal(judgeCheckout(catalog, cart).code, "notFull");

for (const item of catalog) {
  cart = addToCart(catalog, cart, item.id, 1);
}
assert.equal(judgeCheckout(catalog, cart).code, "win");
assert.ok(judgeCheckout(catalog, cart).detail.includes("都買到了"));

cart = addToCart(catalog, cart, catalog[0].id, 30);
assert.equal(judgeCheckout(catalog, cart).code, "overBudget");

assert.equal(matchItemName({ answer: "pawli", item: { chineseText: "香蕉", indigenousText: "pawli" } }).kind, "exact");
assert.equal(matchItemName({ translation: "地瓜", item: { chineseText: "甘藷", indigenousText: "vunga" } }).kind, "semantic");
assert.ok(catalogItem(catalog, catalog[0].id));
assert.equal(cartQtyOf(setCartQty(catalog, emptyCart(), catalog[0].id, 2), catalog[0].id), 2);
assert.equal(cartPieceCount(removeFromCart(addToCart(catalog, emptyCart(), catalog[0].id, 1), catalog[0].id)), 0);
assert.ok(cartTotal(catalog, addToCart(catalog, emptyCart(), catalog[0].id, 1)) > 0);
assert.equal(FAIL.notFull.headline, "清單還沒買齊");

const page = read("apps/scenario-practice/market-helper/index.html");
const appSource = read("apps/scenario-practice/market-helper/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes("市場小幫手"));
assert.ok(page.includes("情境應用 · MISSION 02"));
assert.ok(page.includes('id="input-mode-toggle"') && page.includes('id="input-type"') && page.includes('id="input-voice"'));
assert.ok(!page.includes("再買最多顆"));
assert.ok(appCode.includes("wireInputMode"));
assert.ok(appCode.includes("buildBrief"));
assert.ok(appCode.includes("judgeCheckout"));
assert.ok(appCode.includes("ui.setup.hidden = true"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource));
assert.ok(!/llm-complete|OPENAI|GPT/i.test(appCode));

const dataset = JSON.parse(read("data/market-helper/dataset.json"));
assert.ok(dataset.schemaVersion >= 2);
assert.ok(dataset.dialectCount >= 40);

console.log("market-helper tests passed");
