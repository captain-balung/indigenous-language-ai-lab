// 市場小幫手：隨機貨品、價目、問價解鎖、購物籃與結帳判定（純邏輯，不碰 DOM）。
import { exactMatch, glossKey, semanticMatch } from "../../basic-learning/body-parts-practice/core.mjs";
import { complete as defaultComplete } from "../../shared/llm-complete.mjs";

export const BUDGET = 100;
export const ROUND_SIZE = 3;

/** 三種價目角色：每局打亂後套到隨機抽中的貨上。 */
export const PRICE_ROLES = [
  {
    key: "cheap",
    unit: "個",
    pricing: { kind: "each", price: 10 },
    reveal: { base: "一個 10 元。" }
  },
  {
    key: "pack",
    unit: "個",
    pricing: { kind: "pack", packSize: 3, packPrice: 30 },
    reveal: { base: "3 個 30 元。" }
  },
  {
    key: "jin",
    unit: "個",
    pricing: { kind: "jin", jinPrice: 50, approxPerJin: 5 },
    reveal: {
      base: "論斤賣，一斤 50 元。",
      detail: "一斤大約 5 個。"
    }
  }
];

export const FAIL = {
  overBudget: { code: "overBudget", headline: "超過預算了", detail: "請將花費控制在 100 元以內。" },
  notFull: { code: "notFull", headline: "清單還沒買齊", detail: "媽媽交代的東西還沒都買到。" },
  win: { code: "win", headline: "恭喜過關", detail: "" }
};

export const BARGAIN_REJECT = "現在景氣不好，不能再算便宜了。價錢都是固定的。";

/** 尚未抽貨時的佔位文案。 */
export const BRIEF_PLACEHOLDER = {
  scenario: "媽媽會給你 100 元，並交代要買哪幾樣菜或水果。",
  mission: "開始任務後，會依這次抽到的品項顯示購物清單。",
  hint: ""
};

/** 把名稱列成「A、B跟C」。 */
export function formatItemList(names) {
  const list = (names ?? []).map((name) => String(name ?? "").trim()).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}、${list[1]}`;
  return `${list.slice(0, -1).join("、")}跟${list[list.length - 1]}`;
}

/** 依本局貨品產生任務說明。 */
export function buildBrief(catalog, budget = BUDGET) {
  const names = (catalog ?? []).map((item) => item.chineseText);
  const listText = formatItemList(names);
  if (!listText) return { ...BRIEF_PLACEHOLDER };
  return {
    scenario: `媽媽給你 ${budget} 元，請你到市場攤位把這些買回來：${listText}。`,
    mission: `購物清單：${listText}。每樣至少買一個，別超過預算。`,
    hint: ""
  };
}

export function shoppingList(catalog) {
  return (catalog ?? []).map((item) => ({
    itemId: item.id,
    chineseText: item.chineseText,
    qty: 1
  }));
}

export function shuffle(list, random = Math.random) {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function catalogItem(catalog, id) {
  return (catalog ?? []).find((item) => item.id === id) || null;
}

/**
 * 從方言詞庫抽 ROUND_SIZE 種，並套上三種價目角色。
 * @param {Array} dialectItems market-helper shard items
 */
export function pickRoundCatalog(dialectItems, { count = ROUND_SIZE, random = Math.random } = {}) {
  const pool = (dialectItems ?? []).filter((row) => {
    const indigenous = String(row?.indigenousText ?? "").trim();
    return row?.chineseText && indigenous && indigenous !== "無此詞彙";
  });
  if (pool.length < count) return [];
  const picked = shuffle(pool, random).slice(0, count);
  const roles = shuffle(PRICE_ROLES, random).slice(0, count);
  return picked.map((row, index) => {
    const role = roles[index];
    const id = String(row.code || row.chineseText).replace(/[^\w\u4e00-\u9fff-]+/g, "_");
    return {
      id,
      code: row.code || id,
      chineseText: row.chineseText,
      indigenousText: row.indigenousText,
      audioUrl: row.audioUrl || null,
      imageUrl: row.imageUrl || (row.imagePath ? `https://klokah.tw/${row.imagePath}` : null),
      unit: role.unit,
      pricing: { ...role.pricing },
      reveal: { ...role.reveal },
      roleKey: role.key
    };
  });
}

export function emptyUnlocks() {
  return { asked: new Set(), detailAsked: new Set() };
}

export function unlockPrice(unlocks, itemId) {
  const next = { asked: new Set(unlocks.asked), detailAsked: new Set(unlocks.detailAsked) };
  next.asked.add(itemId);
  return next;
}

export function unlockDetail(unlocks, itemId) {
  const next = { asked: new Set(unlocks.asked), detailAsked: new Set(unlocks.detailAsked) };
  next.detailAsked.add(itemId);
  return next;
}

/** 攤主報價文案：未問過回 null；有 detail 且已追問才附上。 */
export function priceQuote(item, unlocks) {
  if (!item || !unlocks?.asked?.has(item.id)) return null;
  if (item.reveal?.detail && unlocks.detailAsked?.has(item.id)) {
    return `${item.reveal.base}${item.reveal.detail}`;
  }
  return item.reveal.base;
}

/** 貨卡上的價錢。八折立刻可見；還沒問價時不把金額說出來。 */
export function priceLabel(item, unlocks) {
  const quoted = priceQuote(item, unlocks);
  if (item?.bargain !== "off") return quoted;
  if (!quoted) return "價錢未問，已八折";
  return `${String(quoted).replace(/。$/, "")}，八折。`;
}

export function unitPrice(item) {
  const p = item?.pricing;
  if (!p) return null;
  if (p.kind === "each") return p.price;
  if (p.kind === "pack") return p.packPrice / p.packSize;
  if (p.kind === "jin") return p.jinPrice / p.approxPerJin;
  return null;
}

export function lineCost(item, qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!item || n <= 0) return 0;
  const p = item.pricing;
  let cost = 0;
  if (p.kind === "each") cost = n * p.price;
  else if (p.kind === "pack") cost = Math.round((n * p.packPrice) / p.packSize);
  else if (p.kind === "jin") cost = Math.round((n * p.jinPrice) / p.approxPerJin);
  if (item.bargain === "off") return Math.round(cost * 0.8);
  return cost;
}

export function emptyCart() {
  return [];
}

export function addToCart(catalog, cart, itemId, qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!catalogItem(catalog, itemId) || n <= 0) return cart.slice();
  const next = cart.map((line) => ({ ...line }));
  const existing = next.find((line) => line.itemId === itemId);
  if (existing) existing.qty += n;
  else next.push({ itemId, qty: n, free: 0 });
  return next;
}

/** 當下多放一個，不加錢。 */
export function giveFreeItem(catalog, cart, itemId) {
  if (!catalogItem(catalog, itemId)) return (cart ?? []).map((line) => ({ ...line }));
  const next = (cart ?? []).map((line) => ({ ...line }));
  const existing = next.find((line) => line.itemId === itemId);
  if (existing) existing.free = Math.max(0, Math.floor(existing.free || 0)) + 1;
  else next.push({ itemId, qty: 0, free: 1 });
  return next;
}

export function setCartQty(catalog, cart, itemId, qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const prev = (cart ?? []).find((line) => line.itemId === itemId);
  const free = Math.max(0, Math.floor(prev?.free || 0));
  const next = (cart ?? []).filter((line) => line.itemId !== itemId).map((line) => ({ ...line }));
  if ((n > 0 || free > 0) && catalogItem(catalog, itemId)) next.push({ itemId, qty: n, free });
  return next;
}

export function removeFromCart(cart, itemId) {
  return cart.filter((line) => line.itemId !== itemId).map((line) => ({ ...line }));
}

export function cartTotal(catalog, cart) {
  return (cart ?? []).reduce((sum, line) => {
    const item = catalogItem(catalog, line.itemId);
    return sum + lineCost(item, line.qty);
  }, 0);
}

export function linePieces(line) {
  return Math.max(0, Math.floor(line?.qty || 0)) + Math.max(0, Math.floor(line?.free || 0));
}

export function cartPieceCount(cart) {
  return (cart ?? []).reduce((sum, line) => sum + linePieces(line), 0);
}

export function cartQtyOf(cart, itemId) {
  return linePieces((cart ?? []).find((line) => line.itemId === itemId));
}

export function cheapestPerPiece(catalog) {
  return (catalog ?? [])
    .map((item) => ({ item, unit: unitPrice(item) }))
    .filter((row) => row.unit != null)
    .sort((a, b) => a.unit - b.unit || a.item.chineseText.localeCompare(b.item.chineseText, "zh-Hant"))[0] ?? null;
}

/** 在預算內能買到的最大個數。 */
export function maxAffordableQty(item, budget = BUDGET) {
  if (!item) return 0;
  let qty = 0;
  while (lineCost(item, qty + 1) <= budget) qty += 1;
  return qty;
}

/**
 * 結帳判定。過關：購物清單上每樣至少買到指定數量，且總額 ≤ 預算。
 */
export function judgeCheckout(catalog, cart, budget = BUDGET) {
  const total = cartTotal(catalog, cart);
  const pieces = cartPieceCount(cart);
  const list = shoppingList(catalog);
  const missing = list.filter((row) => cartQtyOf(cart, row.itemId) < row.qty);

  if (total > budget) {
    return { ...FAIL.overBudget, total, pieces, list, missing };
  }
  if (list.length && missing.length === 0) {
    const listText = formatItemList(list.map((row) => row.chineseText));
    return {
      ...FAIL.win,
      detail: `清單上的貨都買到了：${listText}。合計 ${total} 元。`,
      total,
      pieces,
      list,
      missing
    };
  }
  const missText = formatItemList(missing.map((row) => row.chineseText));
  return {
    ...FAIL.notFull,
    detail: missText ? `還沒買到：${missText}。` : FAIL.notFull.detail,
    total,
    pieces,
    list,
    missing
  };
}

/** 族語詞或翻譯中文是否對上該貨品。 */
export function matchItemName({ answer, translation, item, ethnicity }) {
  if (!item) return { ok: false, kind: "miss" };
  if (item.indigenousText && answer && exactMatch(answer, item.indigenousText, ethnicity)) {
    return { ok: true, kind: "exact" };
  }
  const zh = String(translation ?? "").trim();
  if (zh && semanticMatch(zh, item.chineseText)) return { ok: true, kind: "semantic" };
  if (zh && glossKey(zh) === glossKey(item.chineseText)) return { ok: true, kind: "semantic" };
  // 甘藷／地瓜、柑橘／橘子 等近義。
  const aliases = {
    甘藷: ["地瓜", "甘藷"],
    地瓜: ["地瓜", "甘藷"],
    柑橘: ["橘子", "柑橘", "柳丁"],
    "辣椒(通稱)": ["辣椒", "辣椒(通稱)"]
  };
  const options = aliases[item.chineseText] || [item.chineseText];
  if (zh && options.some((name) => glossKey(zh) === glossKey(name) || semanticMatch(zh, name))) {
    return { ok: true, kind: "semantic" };
  }
  return { ok: false, kind: "retry" };
}

const STALL_SYSTEM = `你是市場攤位的評分助手。學習者已經點選了一項貨，用族語問價或講價。
依「中文譯文」判斷意圖。只回傳 JSON，不要 markdown：
{"intent":"price"|"bargain"|"other"|"undetermined","rationale":"一句話"}
price：正在問這項貨多少錢、怎麼賣、怎麼算。沒講出貨名但就是在問價錢也算。
bargain：想少付、打折、便宜一點、算便宜。
other：只講貨名、問別的貨、閒聊。
無法判斷時 intent 用 undetermined。`;

function parseJudgeBody(text) {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM 回傳不是 JSON 物件");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * 譯文是在問價、殺價，還是都不是。連不上或沒有譯文時不當成聽不懂。
 * @returns {Promise<{ intent: "price"|"bargain"|"other"|"undetermined", reason: string, error?: string }>}
 */
export async function judgeStallUtterance({ translation, itemChinese, complete: run = defaultComplete } = {}) {
  const heard = typeof translation === "string" ? translation.trim() : "";
  const item = typeof itemChinese === "string" ? itemChinese.trim() : "";
  if (!heard || !item) return { intent: "undetermined", reason: "empty" };
  try {
    const body = parseJudgeBody(await run({
      system: STALL_SYSTEM,
      user: `貨品：${item}\n中文譯文：${heard}`
    }));
    const intent = body?.intent;
    if (intent === "price" || intent === "bargain" || intent === "other") {
      return { intent, reason: "ok" };
    }
    return { intent: "undetermined", reason: "undetermined" };
  } catch (error) {
    return {
      intent: "undetermined",
      reason: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** 約一半拒絕，四分之一八折，四分之一多給一個。 */
export function rollBargain(random = Math.random) {
  const n = random();
  if (n < 0.5) return "refuse";
  if (n < 0.75) return "off";
  return "extra";
}

/** 同一項只抽一次；再講維持原結果。fresh 為 true 時才是這次新抽到的。 */
export function settleBargain(item, random = Math.random) {
  if (!item) return { outcome: "refuse", fresh: false };
  if (item.bargain) return { outcome: item.bargain, fresh: false };
  item.bargain = rollBargain(random);
  return { outcome: item.bargain, fresh: true };
}
