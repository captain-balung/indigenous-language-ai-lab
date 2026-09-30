// 「部落大小事」情境對話的純邏輯：把官方逐輪排好的對話，整理成角色扮演的發言順序。
//
// 官方每個情境都是 1 段開場白 + 固定輪數的交替發話，角色由說話者圖檔辨識：
// 主角、哥哥、媽媽、同學。學者選一個角色，其餘由系統代說，逐一輪到學者時才需要開口。

// 要說的是「你自己的名字、你自己的來處」的句子，學者跟教材本來就不會一樣，
// 這種只當參考句顯示，不判對錯。
//
// 不要用「中文裡有拉丁字母」當判斷條件：那會把「Payu，明天是星期天，你打算去哪裡？」
// 這種稱呼開頭、或「我明天要和 Lisin 去溪邊烤肉」這種提到第三人的句子也算進去，
// 但那些正是學者該照教材說的內容。全庫 1008 輪裡因此誤判了 84 輪。
// 全庫 42 句自我介紹都寫「我叫X」，42 句來處有 41 句寫「我從X部落來」，
// 太魯閣語（7）省略主詞寫成「努呼路瑪路瑪部落來」，所以用「部落來」涵蓋兩種寫法。
// 「你叫甚麼名字？」不含「我叫」，不會被誤判。
const SELF_PATTERNS = [/我叫/, /我的名字/, /部落來/, /來自/];

// 整句只有一個拉丁字母人名（沒有任何中文）時，也是自我介紹。
function isLatinOnlyName(chineseText) {
  const text = String(chineseText ?? "").trim();
  return Boolean(text) && !/[一-鿿]/.test(text) && /[A-Za-z]/.test(text);
}

export function isPersonalTurn(chineseText) {
  const text = String(chineseText ?? "");
  return SELF_PATTERNS.some((pattern) => pattern.test(text)) || isLatinOnlyName(text);
}

export const THEME_ORDER = ["lesson", "find", "outside"];

function mapTurn(turn) {
  return {
    id: turn.id,
    order: turn.order,
    speaker: turn.speaker,
    speakerName: turn.speakerName,
    indigenousText: turn.indigenousText,
    chineseText: turn.chineseText,
    audioUrl: turn.audioUrl,
    imageUrl: turn.imageUrl,
    background: turn.background,
    kind: isPersonalTurn(turn.chineseText) ? "reference" : "practice"
  };
}

export function themeOf(shard, key) {
  const themes = Array.isArray(shard?.themes) ? shard.themes : [];
  return themes.find((theme) => theme?.key === key) || null;
}

export function dialogueTheme(shard, key) {
  const theme = themeOf(shard, key);
  const turns = (theme?.turns ?? [])
    .filter((turn) => turn?.audioUrl && turn?.indigenousText && turn?.chineseText && turn?.speaker)
    .map(mapTurn)
    .sort((a, b) => a.order - b.order);
  const characters = (theme?.characters ?? []).filter((character) => character?.id && character?.name);
  const speakerIds = new Set(turns.map((turn) => turn.speaker));
  // 角色清單要涵蓋每一個有發話的人，萬一官方只給了圖檔順序而非出場順序也兜得住。
  const roles = characters.length
    ? characters
    : turns.map((turn) => ({ id: turn.speaker, name: turn.speakerName, imageUrl: turn.imageUrl }));
  return {
    key: theme?.key ?? key,
    name: theme?.name ?? "",
    intro: String(theme?.intro ?? "").trim(),
    turns,
    roles: roles.filter((role) => speakerIds.has(role.id)),
    playable: speakerIds.size >= 2 && turns.length >= 2
  };
}

// 每段對話的第一句一定是某位角色的開場白。開場那一句前面沒有任何台詞可以接，
// 學者只能憑空猜一句（例如「媽媽今天家裡來了好多親戚哦！」），後面整段都掛在這個猜測上。
// 所以不開放扮演開場者——只能扮演會回應的角色。
export function openingSpeaker(theme) {
  return theme.turns[0]?.speaker ?? null;
}

export function respondableRoles(theme) {
  const opening = openingSpeaker(theme);
  return theme.roles.filter((role) => role.id !== opening);
}

// 學者選的角色決定哪些輪次要開口。回傳的 exchanges 是完整時間線，只是 mine 標記不同。
export function buildExchanges(shard, themeKey, learnerSpeaker) {
  const theme = dialogueTheme(shard, themeKey);
  if (!theme.playable) return { theme, exchanges: [] };
  if (learnerSpeaker === openingSpeaker(theme)) return { theme, exchanges: [] };
  if (!theme.roles.some((role) => role.id === learnerSpeaker)) return { theme, exchanges: [] };
  const speakerNames = new Map(theme.turns.map((turn) => [turn.speaker, turn.speakerName]));
  const learnerName = theme.roles.find((role) => role.id === learnerSpeaker)?.name || "";
  return {
    theme,
    learnerName,
    exchanges: theme.turns.map((turn, position) => {
      // 夾在中間的系統台詞照順序播，但要知道「剛才是誰在跟你說話」，
      // 提示句才寫得出對方的名字。
      const previous = theme.turns[position - 1];
      return {
        ...turn,
        mine: turn.speaker === learnerSpeaker,
        speakerName: turn.speaker === learnerSpeaker ? learnerName : turn.speakerName,
        partnerName: previous ? previous.speakerName : ""
      };
    })
  };
}

export function mineCount(exchanges) {
  return exchanges.filter((exchange) => exchange.mine).length;
}

export function judgedCount(exchanges) {
  return exchanges.filter((exchange) => exchange.mine && exchange.kind === "practice").length;
}

// 課堂測驗用的 verdictFromTranslation 要求中文逐字相同，語音辨識輸出卻很少帶標點，
// 教材中文也常帶句末語助詞（「還沒耶！」）。情境對話裡照抄教材應該算說對，
// 所以這裡自己比對：族語去掉標點、中文再去掉句末語助詞後相同就算對上。
const PUNCTUATION = /[\s，。！？、,.!?'"「」『』（）()~…・:：;；\-—]/g;
const TAIL_PARTICLE = /[耶呀喔哦呢啦嘛啊]/;

export function indigenousKey(value) {
  // 羅馬字的大小寫不帶意思，一律轉小寫再比。
  return String(value ?? "").normalize("NFC").toLowerCase().replace(PUNCTUATION, "");
}

export function chineseKey(value) {
  return indigenousKey(value).replace(TAIL_PARTICLE, "");
}

// 判定順序：族語與教材相同 → 說對了；系統懂成與教材中文相同 → 意思對上；其餘 → 再試試看。
export function judgeReply({ answer, translation, exchange }) {
  const mine = indigenousKey(answer);
  const textbook = indigenousKey(exchange?.indigenousText);
  if (mine && mine === textbook) return "exact";
  const heard = chineseKey(translation);
  const expected = chineseKey(exchange?.chineseText);
  if (heard && heard === expected) return "semantic";
  return "retry";
}

// 結果標示與課堂測驗一致：exact（字面一致）、semantic（意思接近教材）、
// retry（再試試）、unavailable（沒有完成判定，不算答錯）、reference（參考句，不判對錯）。
export function resultHeadline(type) {
  if (type === "exact") return "說對了";
  if (type === "semantic") return "意思對上教材";
  if (type === "retry") return "再試試看";
  if (type === "reference") return "不用判";
  return "這次沒有判定";
}

export function resultDetail(type) {
  if (type === "exact") return "你說的跟教材這句一模一樣。";
  if (type === "semantic") return "說法跟教材不同，但意思對得上。";
  if (type === "retry") return "這次的意思跟教材不同，可以再聽一次對方怎麼說。";
  if (type === "reference") return "這句要說的是你自己的名字或來處，跟教材本來就不同，不用判對錯。";
  return "沒有送出任何判定，這輪不算答錯。";
}

export function tally(results) {
  const list = Array.isArray(results) ? results : [];
  const skipped = list.filter((item) => item === "unavailable").length;
  const passed = list.filter((item) => item === "exact" || item === "semantic").length;
  const reference = list.filter((item) => item === "reference").length;
  const judged = passed + list.filter((item) => item === "retry").length;
  return { passed, judged, reference, skipped, total: list.length };
}

export function tallyLabel(summary) {
  const skip = summary.skipped ? `，${summary.skipped} 輪沒有判定` : "";
  return `說對 ${summary.passed} / ${summary.judged}${skip}`;
}