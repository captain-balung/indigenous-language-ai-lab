// 「部落大小事」情境對話的純邏輯：把官方逐輪排好的對話，整理成角色扮演的發言順序。
//
// 官方每個情境都是 1 段開場白 + 固定輪數的交替發話，角色由說話者圖檔辨識：
// 主角、哥哥、媽媽、同學。學者選一個角色，其餘由系統代說，逐一輪到學者時才需要開口。

import { isCaseMeaningful } from "../../basic-learning/body-parts-practice/core.mjs";

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
    backgroundUrl: turn.backgroundUrl,
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

// 聽力播放清單：整段對話依序播完，不標記「換你說」。
export function buildPlaylist(shard, themeKey) {
  const theme = dialogueTheme(shard, themeKey);
  if (!theme.playable) return { theme, exchanges: [] };
  return {
    theme,
    exchanges: theme.turns.map((turn) => ({ ...turn, mine: false, partnerName: "" }))
  };
}

// 學者選的角色決定哪些輪次要開口。回傳的 exchanges 是完整時間線，只是 mine 標記不同。
// （任務關卡與單元測試仍會用到；對話 STEP 2 已改走 buildPlaylist。）
export function buildExchanges(shard, themeKey, learnerSpeaker) {
  const theme = dialogueTheme(shard, themeKey);
  if (!theme.playable) return { theme, exchanges: [] };
  if (learnerSpeaker === openingSpeaker(theme)) return { theme, exchanges: [] };
  if (!theme.roles.some((role) => role.id === learnerSpeaker)) return { theme, exchanges: [] };
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

export function indigenousKey(value, ethnicity) {
  // 多數方言羅馬字的大小寫不帶意思，一律轉小寫再比。
  // 例外：賽夏的大寫 S（'aewhaeS）、噶瑪蘭的大寫 R（biRi、qaRabi）是正寫法的一部分，
  // 兩族要保留原樣，改由 sameIndigenousKey 的句首容忍處理 ASR 的句首大寫慣例。
  const text = String(value ?? "").normalize("NFC").replace(PUNCTUATION, "");
  return isCaseMeaningful(ethnicity) ? text : text.toLowerCase();
}

function foldFirstLetter(key) {
  return key ? key.charAt(0).toLowerCase() + key.slice(1) : key;
}

// 兩個已 key 化的族語是否視為相同。
//   一般方言 → 小寫後相同即可（indigenousKey 已折疊）。
//   賽夏／噶瑪蘭 → 完全相同，或只剩「句首第一個字母」的大小寫差異（ASR 慣例）。
export function sameIndigenousKey(mine, textbook, ethnicity) {
  if (!mine || !textbook) return false;
  if (mine === textbook) return true;
  return isCaseMeaningful(ethnicity) && foldFirstLetter(mine) === foldFirstLetter(textbook);
}

export function chineseKey(value) {
  return indigenousKey(value).replace(TAIL_PARTICLE, "");
}

// 判定順序：族語與教材相同 → 說對了；系統懂成與教材中文相同 → 意思對上；其餘 → 再試試看。
export function judgeReply({ answer, translation, exchange, ethnicity }) {
  const mine = indigenousKey(answer, ethnicity);
  const textbook = indigenousKey(exchange?.indigenousText, ethnicity);
  if (sameIndigenousKey(mine, textbook, ethnicity)) return "exact";
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
// ── 任務關卡（官方 phase2）─────────────────────────────────────────
// 官方 phase2 是拖詞卡拼句子；詞卡等於直接送出答案的詞彙與順序，所以除了
// 上課用語第 1、2 關的「拖名牌」之外，句子都改成學者自己錄音或打字說出來。
// 詞卡只留作提示（不給順序），對象由學者自己選——選錯人算答錯，
// 因為官方用 player[].only 標記「這句只能對某一個人說」，對其他人說官方也判錯。

// 官方詞卡是給「拖詞卡排句子」用的，同一個詞可能出現兩次（句子需要兩個）；
// 這裡只把詞卡當字彙提示，所以顯示前去重，避免同一個詞列兩次。
function uniqueHintWords(words, ethnicity) {
  const seen = new Set();
  const unique = [];
  for (const word of words) {
    const key = indigenousKey(word, ethnicity);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(word);
  }
  return unique;
}

export function questPack(shard, themeKey) {
  const theme = themeOf(shard, themeKey);
  const quests = (theme?.quests ?? [])
    // 結語關沒有對象也沒有句子，只要 goal.kind 還在就留下來。
    .filter((quest) => quest?.goal?.kind && (quest.goal.kind === "end" || (Array.isArray(quest?.lines) && quest.lines.length > 0)))
    .map((quest) => {
      let hintWords = (quest.hintWords ?? []).filter((word) => typeof word === "string" && word.trim());
      let goal = quest.goal;
      // 借刀那關的詞卡是「可以借我刀子嗎」，要說的卻是道謝。
      // 詞卡沒有那句的詞，中文也沒收，不背過族語就過不了。
      if (goal?.kind === "selectAndSpeak" && goal.prompt) {
        const seen = new Set(hintWords.map((word) => indigenousKey(word, shard?.ethnicity)));
        for (const token of String(goal.prompt).split(/\s+/)) {
          const clean = token.replace(/^[，。！？、,.!?]+|[，。！？、,.!?]+$/g, "");
          const key = indigenousKey(clean, shard?.ethnicity);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          hintWords.push(clean);
        }
        const promptChinese = goal.promptChinese || (String(quest.tips ?? "").match(/和對方說「([^」]+)」/)?.[1] ?? "");
        goal = { ...goal, promptChinese };
      }
      hintWords = uniqueHintWords(hintWords, shard?.ethnicity);
      return {
        ...quest,
        themeKey,
        goal,
        targets: (quest.targets ?? []).filter((target) => target?.id && target?.imageUrl),
        hintWords
      };
    })
    .sort((a, b) => a.order - b.order);
  return {
    // 上課用語是一張共用的場景圖＋主角圖；尋找物品與戶外活動每一關都有自己的場景圖，
    // 主角畫在場景裡，所以這兩個會是空字串。
    sceneUrl: String(theme?.questSceneUrl ?? ""),
    playerImageUrl: String(theme?.questPlayerImageUrl ?? ""),
    // 上課用語場景圖桌上印好的藍色名牌文字（官方 .table-card）。
    deskTags: Array.isArray(theme?.questDeskTags) ? theme.questDeskTags : [],
    quests,
    available: quests.length > 0
  };
}

// 借筆、借橡皮擦這兩關不直接指定要問哪一位：要讓學習者從對方的回答判斷
// 誰有多的。題目、進度與示範句都只說「同學」，不露出左邊／右邊或名字。
export function questIsBorrowQuest(quest) {
  return quest?.themeKey === "lesson" && (quest?.order === 3 || quest?.order === 4);
}

// 把官方示範句開頭的同學名字換成「同學」，保留後半句。
// 借筆／借橡皮擦的句子沒有逗號（Kacaw借我…），拿掃把則有（Kacaw，請幫我…）。
function genericAskPhrase(phrase) {
  const text = String(phrase ?? "").trim();
  if (!text) return "同學";
  const comma = text.search(/[，,]/);
  if (comma >= 0) {
    const rest = text.slice(comma + 1).replace(/^[，,、\s]+/, "");
    return rest ? `同學，${rest}` : "同學";
  }
  const verb = text.search(/借我|請幫我/);
  if (verb > 0) return `同學，${text.slice(verb)}`;
  return text;
}

// 問錯人時，借筆／借橡皮擦的同學照官方回應：
// 第 3 關問到右邊的同學，對方說「我只有一隻」；第 4 關問到左邊的同學，
// 對方說「我也沒有」。兩句都有族語與錄音，不再自行改寫成沒有音檔的「我沒有」。
export function questWrongPersonLine(quest, targetId) {
  if (!questIsBorrowQuest(quest)) return null;
  const expected = quest?.goal?.targetId;
  const wrongTargetId = targetId
    ?? (quest.targets ?? []).find((target) => target.id !== expected)?.id;
  if (!wrongTargetId || wrongTargetId === expected) return null;
  return questLineFor(quest, wrongTargetId);
}

// 官方 tips 的「（同學名字）」是佔位符；顯示時換成這一關要問的對象名字，
// 其餘文字逐字保留。第 3、4 關借東西不公布名字，改用通用的「同學」。
// 找不到句子時維持原文，不猜名字。
export function questTipsText(quest) {
  const tips = String(quest?.tips ?? "").trim();
  const targetId = quest?.goal?.targetId;
  if (!tips || !targetId) return tips;
  const phrase = String(questLineFor(quest, targetId)?.chineseText ?? "").trim();
  if (!phrase) return tips;
  // 第 3～5 關都是先選人再問；選人前不要用名字透露正確對象。
  const askPerson = quest.themeKey === "lesson" && quest.goal.kind === "askRightPerson";
  const shown = askPerson ? genericAskPhrase(phrase) : phrase;
  return tips.replace(/「（同學名字）[^」]*」/, `「${shown}」`);
}

// 尋找物品與戶外活動不是校園情境，不要把所有對象都叫「同學」。
export function questPeopleLabel(quest) {
  return quest?.themeKey === "lesson" ? "同學" : "其他人";
}

export function questLineFor(quest, targetId) {
  return (quest?.lines ?? []).find((line) => line.targetId === targetId) ?? null;
}

// 句子沒對上時，那位同學照官方會說 rebound（phase2[target]["0"]：「什麼？」「不知道」），
// 這裡只負責把資料撈出來；播與顯示在 app 做。
export function questReboundFor(quest, targetId) {
  return quest?.rebounds?.[targetId] ?? null;
}

// 判定跟對話同一套規則：族語去掉標點後相同 → 說對了；系統懂成的意思跟教材中文
// 相同 → 意思對上；其餘 → 再試試看。
// 多出一種 wrongTarget：句子本身是對的，但這句只能對另一個人說。
export function judgeQuestLine(quest, targetId, { answer, translation, allowChinese = false, ethnicity }) {
  const line = questLineFor(quest, targetId);
  if (!line) return { verdict: "retry", line: null, rightTargetId: null };
  const mine = indigenousKey(answer, ethnicity);
  const typedChinese = allowChinese ? chineseKey(answer) : "";
  if (mine && sameIndigenousKey(mine, indigenousKey(line.indigenousText, ethnicity), ethnicity)) {
    return { verdict: "exact", line, rightTargetId: null };
  }
  // 直接把教材中文那句打進來（打字模式／除錯驗證用）也算過——但只限
  // debug 開關（?debug_mode）放行，一般學者的輸入不能靠打中文過關，
  // 也不要讓翻譯系統把這種輸入弄成「不清楚你在問什麼」。
  if (typedChinese && typedChinese === chineseKey(line.chineseText)) {
    return { verdict: "exact", line, rightTargetId: null };
  }
  const heard = chineseKey(translation);
  if (heard && heard === chineseKey(line.chineseText)) return { verdict: "semantic", line, rightTargetId: null };
  // 第 1、2 關兩個對象要說的是同一句，那種情況不存在「說錯人」，不要誤報。
  // 中文直入是除錯用的第二種輸入，也要能判斷「這句是另一位同學的」。
  const spokenElsewhere = (quest.lines ?? []).find((item) => (
    item.targetId !== targetId
    && item.indigenousText !== line.indigenousText
    && (
      (mine && sameIndigenousKey(mine, indigenousKey(item.indigenousText, ethnicity), ethnicity))
      || (typedChinese && typedChinese === chineseKey(item.chineseText))
    )
  ));
  if (spokenElsewhere) return { verdict: "wrongTarget", line, rightTargetId: spokenElsewhere.targetId };
  return { verdict: "retry", line, rightTargetId: null };
}

export function questIsLearned(quest, targetId, state) {
  return (state?.learned ?? []).includes(targetId);
}

// 兩種過關條件：
//   nameTags：把兩位同學的正確名牌放到對應的桌上，才算過關（答對後不會自動放名字）。
//             跟官方一樣不強制先問完兩位；候選名牌在第一個人答對後出現，
//             之後可以只靠拖名牌完成。
//   askRightPerson：對指定的人問出指定的那句
export function questIsComplete(quest, state) {
  const goal = quest?.goal;
  if (!goal) return false;
  const learned = state?.learned ?? [];
  const placed = state?.placed ?? {};
  if (goal.kind === "nameTags") {
    // 官方 checkDrop 只比對兩張桌上的名牌，沒有再檢查問過幾個人。
    return Object.entries(goal.answers ?? {}).every(([targetId, name]) => placed[targetId] === name);
  }
  if (goal.kind === "askRightPerson") {
    return learned.includes(goal.targetId) && questLineFor(quest, goal.targetId)?.code === goal.code;
  }
  return false;
}

// 任務進度給 UI 顯示：名牌關先問一位取得名牌，之後拖名牌；問對象的關卡
// 要說清楚「還沒問到對的人」。
export function questProgress(quest, state) {
  const goal = quest?.goal;
  const learned = (state?.learned ?? []).filter((id) => (quest?.targets ?? []).some((target) => target.id === id));
  const total = (quest?.targets ?? []).length;
  if (goal?.kind === "nameTags") {
    const placedCount = Object.keys(state?.placed ?? {}).length;
    // 官方候選名牌在第一位答對後才出現；出現後不強制再問第二位。
    if (placedCount >= total) return `名牌都放上桌了（${placedCount}/${total}）`;
    if (!learned.length) return `先問一位${questPeopleLabel(quest)}，取得名牌`;
    return `名牌已放 ${placedCount}/${total}`;
  }
  if (goal?.kind === "end") return "任務結束";
  // 問對象：問到指定那位才算過，問到別人只是換個人再問。
  if (goal.kind === "askRightPerson") {
    if (learned.includes(goal.targetId)) return "任務完成";
    // 借筆／借橡皮擦不先公布要問左邊還是右邊，讓學習者自己從回答判斷。
    if (questIsBorrowQuest(quest)) {
      return learned.length ? "還沒問到對的人，換一位問問看" : "先問問同學，看看誰能借你";
    }
    // 進度一行用位置說法（questProgress 沒有名字可查）；輸入區標題才用名字。
    return learned.length
      ? "還沒問到對的人，換一位問問看"
      : `先問問${targetLabel(goal.targetId, quest)}的人`;
  }
  // 選東西的關卡：先問人拿線索，再從候選裡挑。picked 開局是 null，不能拿來判斷還沒選。
  if (goal.kind === "select") {
    return (state?.learned ?? []).length ? "從下面的選項挑一個" : `先問問${questPeopleLabel(quest)}，再挑出正確的那一個`;
  }
  if (goal.kind === "take") {
    // 有些東西要先問對人才拿得到（官方 condition.lock）。
    // 跟原版一樣，問到一次正確句子就會顯示可拿的東西；不要求問完所有人。
    const learned = state?.learned ?? [];
    const unlocked = !goal.lock
      || goal.unlock?.targetId === undefined
      || learned.includes(goal.unlock.targetId);
    // 有 lock 的關卡先講清楚要問哪一位；沒有 lock 才用一般「先問人」。
    if (!unlocked) return `先問問${targetLabel(goal.unlock.targetId, quest)}的人，才拿得到正確的東西`;
    if (!learned.length) return `先問問${questPeopleLabel(quest)}，再拿正確的東西`;
    const need = goal.answers.length;
    const got = (state?.taken ?? []).length;
    return `把正確的東西放進籃子（已放 ${got} 樣，要 ${need} 樣）`;
  }
  if (goal.kind === "click") {
    return learned.length ? "點場景裡該點的地方" : `先問問${questPeopleLabel(quest)}，再點場景裡該點的地方`;
  }
  if (goal.kind === "selectAndSpeak") {
    if (!state?.picked) {
      return learned.length ? "選要道謝的人" : `先問問${questPeopleLabel(quest)}，再選要道謝的人`;
    }
    return goal.promptChinese ? `用族語說出「${goal.promptChinese}」` : "用族語說出那句話";
  }
  return learned.length ? "對方已經回答" : `先問 ${total} 位${questPeopleLabel(quest)}（${learned.length}/${total}）`;
}

export function questResultHeadline(verdict) {
  if (verdict === "exact") return "說對了";
  if (verdict === "semantic") return "意思對上教材";
  if (verdict === "wrongTarget") return "這句要問別人";
  if (verdict === "unavailable") return "這次沒有判定";
  return "再試試看";
}

export function questResultDetail(verdict) {
  if (verdict === "exact") return "你說的跟教材這句一模一樣。";
  if (verdict === "semantic") return "說法跟教材不同，但意思對得上。";
  if (verdict === "wrongTarget") return "這句要對另一個人說，換個人再問一次。";
  if (verdict === "unavailable") return "沒有送出任何判定，這次不算答錯。";
  return "這次的意思跟教材不同，再說一次試試看。";
}

// ── 尋找物品與戶外活動的關卡 ────────────────────────────────────
// 官方玩法是「先問人拿到線索，再在場景裡挑出正確的東西」，過關條件有五種：
//   select          從候選裡選對一個（陶壺、哪條路）
//   take            把正確的東西放進籃子（可能不只一個），
//                   而且有的是問對人才解鎖（官方 condition.lock）
//   click           點某個位置（例如門），換掉背景並收尾
//   selectAndSpeak  選一個人，然後要自己說出那句話（官方是拖詞卡排句子）
//   end             結語，沒有互動
// 選項與可點位置都來自官方的 setup 檔，已換算成百分比。

export function questOptions(quest) {
  return (quest?.goal?.options ?? []).filter((option) => option?.id && option?.imageUrl);
}

// take 的候選放在場景裡（官方用 take-option 的絕對定位），select 的候選是獨立清單。
export function questSceneOptions(quest) {
  return questOptions(quest).filter((option) => option.box);
}

// 教材的對象沒有名字，只有座標，所以用左右位置稱呼。
// 兩個人是左／右；三個人才有中間。固定套「左、中、右」會把右邊那位叫成中間。
export function targetLabel(targetId, quest) {
  const sorted = [...(quest?.targets ?? [])].sort((a, b) => (a.box?.left ?? 0) - (b.box?.left ?? 0));
  const index = sorted.findIndex((item) => item.id === targetId);
  if (index < 0 || sorted.length < 2) return "那邊";
  const names = sorted.length === 2 ? ["左邊", "右邊"] : ["左邊", "中間", "右邊"];
  return names[index] ?? "那邊";
}

// 選項是不是被鎖住：官方 condition.lock 指定的那一個，要問對人才能拿。
export function questOptionLocked(quest, optionId, state) {
  const lock = quest?.goal?.lock;
  if (!lock || lock !== optionId) return false;
  const unlock = quest.goal.unlock;
  if (!unlock) return false;
  return !(state?.learned ?? []).includes(unlock.targetId);
}

// select：選對就過關。locked 的選項不能選（要先問對人）。
export function judgeQuestPick(quest, optionId, state) {
  const goal = quest?.goal;
  if (!goal) return { ok: false, reason: "no-goal" };
  const option = questOptions(quest).find((item) => item.id === optionId);
  if (!option) return { ok: false, reason: "unknown" };
  if (questOptionLocked(quest, optionId, state)) return { ok: false, reason: "locked" };
  return { ok: goal.answers.includes(optionId), reason: goal.answers.includes(optionId) ? "correct" : "wrong" };
}

// take：把選到的東西放進籃子。放對不消耗（跟名牌一樣），放錯可以再換；
// 籃子滿了再放新的會把最早放的擠掉，跟官方 setTake 的行為一致。
export function addToBasket(quest, optionId, state) {
  const goal = quest?.goal;
  const taken = [...(state?.taken ?? [])];
  const limit = (goal?.answers ?? []).length || 1;
  if (questOptionLocked(quest, optionId, state)) return { taken, reason: "locked" };
  if (taken.includes(optionId)) return { taken, reason: "already" };
  if (taken.length >= limit) taken.shift();
  taken.push(optionId);
  return { taken, reason: "added" };
}

// take 的確定：官方會把兩邊排序後比對，所以順序不影響結果。
export function judgeBasket(quest, taken) {
  const answers = [...(quest?.goal?.answers ?? [])].sort();
  const list = [...(taken ?? [])].sort();
  return answers.length > 0 && answers.length === list.length && answers.every((item, index) => item === list[index]);
}

// selectAndSpeak：先選一個人，再由學者自己說出那句話。
// 官方是拖詞卡把句子排出來，我們換成錄音或打字，判定比對 goal.prompt。
export function judgeQuestPrompt(quest, { answer, translation, ethnicity }) {
  const prompt = quest?.goal?.prompt;
  if (!prompt) return "retry";
  const mine = indigenousKey(answer, ethnicity);
  if (mine && sameIndigenousKey(mine, indigenousKey(prompt, ethnicity), ethnicity)) return "exact";
  const heard = chineseKey(translation);
  const expected = chineseKey(quest.goal.promptChinese ?? "");
  if (heard && expected && heard === expected) return "semantic";
  return "retry";
}

// 這一關現在該做什麼（給進度列與提示用）。
export function questHint(quest, state) {
  const goal = quest?.goal;
  if (!goal) return "";
  const learned = state?.learned ?? [];
  if (goal.kind === "end") return "任務結束";
  if (goal.kind === "select") {
    if (!learned.length) return `先問問${questPeopleLabel(quest)}，再挑出正確的那一個`;
    return state?.picked ? "再看看誰才對" : "從下面的選項挑一個";
  }
  if (goal.kind === "take") {
    if (goal.lock && goal.unlock?.targetId && !learned.includes(goal.unlock.targetId)) {
      return `先問問${targetLabel(goal.unlock.targetId, quest)}的人，才拿得到正確的東西`;
    }
    if (!learned.length) return `先問問${questPeopleLabel(quest)}，再拿正確的東西`;
    return `把正確的東西放進籃子（${(state?.taken ?? []).length}/${goal.answers.length}）`;
  }
  if (goal.kind === "click") {
    return learned.length ? "點場景裡該點的地方" : `先問問${questPeopleLabel(quest)}，再點場景裡該點的地方`;
  }
  if (goal.kind === "selectAndSpeak") {
    if (!state?.picked) {
      return learned.length ? "選要道謝的人" : `先問問${questPeopleLabel(quest)}，再選要道謝的人`;
    }
    return goal.promptChinese ? `用族語說出「${goal.promptChinese}」` : "用族語說出那句話";
  }
  if (goal.kind === "askRightPerson" && questIsBorrowQuest(quest)) {
    return learned.length ? "還沒問到對的人，換一位問問看" : "問問看同學，看看誰能借你";
  }
  if (goal.kind === "nameTags") {
    const placed = Object.keys(state?.placed ?? {}).length;
    const total = (quest?.targets ?? []).length;
    return learned.length
      ? `名牌已放 ${placed}/${total}`
      : `先問一位${questPeopleLabel(quest)}，取得名牌`;
  }
  return `問問看${questPeopleLabel(quest)}`;
}

// 尋找物品／戶外活動的官方 tips 有現成的問句，和任務提示用同一個說法；
// 避免同一關 tips 寫「陶壺」、輸入標題卻用方言句子的「陶甕」。
function tipQuestionChinese(quest) {
  if (quest?.themeKey === "lesson") return "";
  return String(quest?.tips ?? "").match(/「([^」]+)」/)?.[1]?.trim() ?? "";
}

// 輸入區標題：依關卡顯示「點誰、說什麼」，不寫死「換你說」。
function speakPhraseChinese(quest, targetId) {
  const tipPhrase = tipQuestionChinese(quest);
  if (tipPhrase) return tipPhrase;
  if (targetId) {
    const line = questLineFor(quest, targetId);
    if (line?.chineseText) return String(line.chineseText).trim();
  }
  // 還沒點人時，示範句要拿「這關要問的那位」的句子；借筆／借橡皮擦
  // 在 questTurnTitle 會再把名字換成「同學」，不提前公布要問哪一位。
  const goalTarget = questLineFor(quest, quest?.goal?.targetId);
  if (goalTarget?.chineseText) return String(goalTarget.chineseText).trim();
  const first = (quest?.lines ?? []).find((line) => line?.chineseText);
  if (first?.chineseText) return String(first.chineseText).trim();
  return String(quest?.goal?.promptChinese ?? "").trim();
}

export function questTurnTitle(quest, { targetId = null, state = null, names = null } = {}) {
  const goal = quest?.goal;
  if (!goal || goal.kind === "end") return "";

  // 稱呼用位置（左邊／右邊），不寫死「同學」——婚禮、出遊場景不是同學。
  if (goal.kind === "selectAndSpeak") {
    // 已選好道謝對象、且沒在問人：引導說出那句道謝話。
    if (state?.picked && !targetId) {
      const phrase = goal.promptChinese || "謝謝你的幫忙！";
      return `說「${phrase}」`;
    }
    if (targetId) {
      const phrase = speakPhraseChinese(quest, targetId);
      const who = targetLabel(targetId, quest);
      return phrase ? `對${who}的人說「${phrase}」` : `對${who}的人說話`;
    }
    // 已經問過人、選項也出現了：下一步是挑要道謝的人，不要再叫學習者問一次。
    if (state?.learned?.length) return "選要道謝的人";
    const ask = speakPhraseChinese(quest, null);
    return ask
      ? `先點一個人問問「${ask}」，再選要道謝的人`
      : "先問問場景裡的人，再選要道謝的人";
  }

  if (targetId) {
    const phrase = speakPhraseChinese(quest, targetId);
    // 第 1 關問名字時，名字就是拖曳答案，只能用位置稱呼；第 2 關（問住處）
    // 時名字已在第 1 關問過，可以直接叫名字。其他關卡也沿用已知名字。
    const mayUseName = goal.kind !== "nameTags" || (quest.order ?? 0) > 1;
    const who = mayUseName && names?.[targetId]
      ? names[targetId]
      : `${targetLabel(targetId, quest)}的人`;
    return phrase ? `對${who}說「${phrase}」` : `對${who}說話`;
  }

  const phrase = speakPhraseChinese(quest, null);
  if (goal.kind === "nameTags") {
    // 問過一位後，輸入區不再重複「放名牌」的操作提示；名牌狀態看進度列。
    if (state?.learned?.length) return "任務";
    return phrase ? `先點一個人，再說「${phrase}」` : "先點一個人，再開口問";
  }
  if (goal.kind === "askRightPerson") {
    // 還沒點人時不顯示正確對象的名字；借筆、借橡皮擦和拿掃把都一樣。
    const ask = genericAskPhrase(phrase);
    return ask ? `先點要問的人，再說「${ask}」` : "先點要問的人，再開口問";
  }
  // select／take／click：問到人之後，下一步是挑東西／放籃子／點場景，
  // 不要一直停在「先點場景裡的人」。
  if (state?.learned?.length) return questProgress(quest, state);
  return phrase ? `先點場景裡的人，再說「${phrase}」` : "先點場景裡的人，再開口問";
}
