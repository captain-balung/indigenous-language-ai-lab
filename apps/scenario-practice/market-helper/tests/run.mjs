import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BARGAIN_REJECT, BRIEF_PLACEHOLDER, BUDGET, FAIL, PRICE_ROLES, ROUND_SIZE,
  addToCart, buildBrief, cartPieceCount, cartQtyOf, cartTotal, catalogItem,
  emptyCart, emptyUnlocks, formatItemList, giveFreeItem, judgeCheckout, judgeStallUtterance,
  lineCost, matchItemName, pickRoundCatalog, priceLabel, priceQuote, removeFromCart,
  rollBargain, setCartQty, settleBargain, shoppingList, unlockDetail, unlockPrice
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
assert.ok(catalog.every((item) => item.indigenousText !== "無此詞彙"));

const onlyPlaceholder = [
  { code: "08-27", chineseText: "蕃茄", indigenousText: "無此詞彙" },
  { code: "08-31", chineseText: "胡瓜", indigenousText: " 無此詞彙 " },
  { code: "08-38", chineseText: "蔥", indigenousText: "無此詞彙" }
];
assert.deepEqual(pickRoundCatalog(onlyPlaceholder, { count: 3 }), []);

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
assert.equal(matchItemName({ answer: "pawli", item: { chineseText: "香蕉", indigenousText: "Pawli" }, ethnicity: "阿美" }).kind, "exact", "一般方言不分大小寫");
assert.equal(matchItemName({ answer: "rutung", item: { chineseText: "猴子", indigenousText: "Rutung" }, ethnicity: "噶瑪蘭" }).kind, "exact", "句首第一個字母容忍");
assert.equal(matchItemName({ answer: "biri", item: { chineseText: "走", indigenousText: "biRi" }, ethnicity: "噶瑪蘭" }).kind, "retry", "噶瑪蘭大寫 R 不能吃掉");
assert.equal(matchItemName({ translation: "地瓜", item: { chineseText: "甘藷", indigenousText: "vunga" } }).kind, "semantic");
assert.ok(catalogItem(catalog, catalog[0].id));
assert.equal(cartQtyOf(setCartQty(catalog, emptyCart(), catalog[0].id, 2), catalog[0].id), 2);
assert.equal(cartPieceCount(removeFromCart(addToCart(catalog, emptyCart(), catalog[0].id, 1), catalog[0].id)), 0);
assert.ok(cartTotal(catalog, addToCart(catalog, emptyCart(), catalog[0].id, 1)) > 0);
assert.equal(FAIL.notFull.headline, "清單還沒買齊");

// 三種角色照販賣單位各買一份（1 個／3 個一組／1 斤＝約 5 個），總價必須能過關。
const pricedSum = PRICE_ROLES.reduce((sum, role) => {
  const qty = role.pricing.kind === "pack" ? role.pricing.packSize : role.pricing.kind === "jin" ? role.pricing.approxPerJin : 1;
  return sum + lineCost({ pricing: role.pricing }, qty);
}, 0);
assert.ok(pricedSum <= BUDGET, `照定價買齊應在預算內，目前 ${pricedSum} > ${BUDGET}`);
assert.equal(pricedSum, 90);

assert.equal(rollBargain(() => 0), "refuse");
assert.equal(rollBargain(() => 0.49), "refuse");
assert.equal(rollBargain(() => 0.5), "off");
assert.equal(rollBargain(() => 0.74), "off");
assert.equal(rollBargain(() => 0.75), "extra");

const eachTen = { pricing: { kind: "each", price: 10 } };
assert.equal(lineCost(eachTen, 1), 10);
assert.equal(lineCost({ ...eachTen, bargain: "off" }, 1), 8);
const stock = catalog.map((row) => ({ ...row }));
stock[0] = { ...stock[0], bargain: "off" };
assert.equal(cartTotal(stock, addToCart(stock, emptyCart(), stock[0].id, 1)), 8);

const gifted = giveFreeItem(catalog, emptyCart(), catalog[0].id);
assert.equal(cartQtyOf(gifted, catalog[0].id), 1);
assert.equal(cartTotal(catalog, gifted), 0);
const paidAndGift = giveFreeItem(catalog, addToCart(catalog, emptyCart(), catalog[0].id, 1), catalog[0].id);
assert.equal(cartQtyOf(paidAndGift, catalog[0].id), 2);
assert.equal(cartTotal(catalog, paidAndGift), cartTotal(catalog, addToCart(catalog, emptyCart(), catalog[0].id, 1)));

let onlyGifts = emptyCart();
for (const item of catalog) onlyGifts = giveFreeItem(catalog, onlyGifts, item.id);
assert.equal(cartTotal(catalog, onlyGifts), 0);
assert.equal(judgeCheckout(catalog, onlyGifts).code, "win");

const deal = { id: "deal" };
assert.deepEqual(settleBargain(deal, () => 0.9), { outcome: "extra", fresh: true });
assert.deepEqual(settleBargain(deal, () => 0), { outcome: "extra", fresh: false });

assert.equal(priceLabel({ ...catalog[0], bargain: "off" }, emptyUnlocks()), "價錢未問，已八折");
const asked = unlockPrice(emptyUnlocks(), catalog[0].id);
assert.match(priceLabel({ ...catalog[0], bargain: "off" }, asked), /八折/);

const judge = (intent) => judgeStallUtterance({
  translation: "這句話",
  itemChinese: "香蕉",
  complete: async () => `{"intent":"${intent}","rationale":"測試"}`
});
assert.equal((await judge("price")).intent, "price");
assert.equal((await judge("bargain")).intent, "bargain");
assert.equal((await judge("other")).intent, "other");
const down = await judgeStallUtterance({
  translation: "多少錢",
  itemChinese: "香蕉",
  complete: async () => { throw new Error("無法連線"); }
});
assert.equal(down.intent, "undetermined");
assert.equal(down.reason, "failed");
let called = false;
const blank = await judgeStallUtterance({
  translation: "  ",
  itemChinese: "香蕉",
  complete: async () => { called = true; return "{}"; }
});
assert.equal(blank.reason, "empty");
assert.equal(called, false);
const junk = await judgeStallUtterance({
  translation: "嗯",
  itemChinese: "香蕉",
  complete: async () => "不是 json"
});
assert.equal(junk.reason, "failed");

const page = read("apps/scenario-practice/market-helper/index.html");
const appSource = read("apps/scenario-practice/market-helper/app.mjs");
const appCode = stripComments(appSource);

assert.ok(page.includes("市場小幫手"));
assert.ok(page.includes("情境應用 · MISSION 02"));
assert.ok(page.includes('class="task-brief"') && page.includes("怎麼玩"));
assert.ok(page.includes('id="input-mode-toggle"') && page.includes('id="input-type"') && page.includes('id="input-voice"'));
assert.ok(!page.includes("再買最多顆"));
assert.ok(appCode.includes("wireInputMode"));
assert.ok(/state === "recorded"[\s\S]*?runFlow\(\)/.test(appCode), "語音停錄後必須自動送出");
assert.ok(appCode.includes("function dropped(epoch)"), "換局之後不能把舊的判定寫進來");
assert.ok(/epoch === runEpoch\) setState\("slow"\)/.test(appCode), "慢提示不能寫到下一局");
assert.ok(/mode\(\) === "voice"[\s\S]*?ui\.submit\.hidden = true/.test(appCode), "語音模式必須隱藏送出鈕");
assert.ok(appCode.includes("buildBrief"));
assert.ok(appCode.includes("judgeCheckout"));
assert.ok(appCode.includes("攤主：聽不懂，再說一次。"), "沒聽懂要由攤主回應");
assert.ok(!appCode.includes("系統聽到"), "不要把辨識內容顯示出來");
assert.ok(appCode.includes("judgeStallUtterance"));
assert.ok(appCode.includes("語意使用 vLLM AI 判別"));
assert.ok(!page.includes("能便宜一點嗎"));
assert.ok(page.includes("一斤大約幾個？"));
assert.ok(appCode.includes("ui.setup.hidden = true"));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(appCode));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page + appSource));

const dataset = JSON.parse(read("data/market-helper/dataset.json"));
assert.ok(dataset.schemaVersion >= 2);
assert.ok(dataset.dialectCount >= 40);

console.log("market-helper tests passed");
