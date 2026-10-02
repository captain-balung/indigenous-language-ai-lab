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
// ── 任務關卡（官方 phase2）─────────────────────────────────────────
// 官方 phase2 是拖詞卡拼句子：詞卡直接送出了答案的詞彙與順序，學不到「自己說」。
// 這裡改成同一個任務、同一組句子，但句子要學者自己錄音或打字說出來。
// 詞卡只留作提示（不給順序），對象由學者自己選——選錯人算答錯，
// 因為官方用 player[].only 標記「這句只能對某一個人說」，對其他人說官方也判錯。

export function questPack(shard, themeKey) {
  const theme = themeOf(shard, themeKey);
  const quests = (theme?.quests ?? [])
    // 結語關沒有對象也沒有句子，只要 goal.kind 還在就留下來。
    .filter((quest) => quest?.goal?.kind && (quest.goal.kind === "end" || (Array.isArray(quest?.lines) && quest.lines.length > 0)))
    .map((quest) => {
      const hintWords = (quest.hintWords ?? []).filter((word) => typeof word === "string" && word.trim());
      let goal = quest.goal;
      // 借刀那關的詞卡是「可以借我刀子嗎」，要說的卻是道謝。
      // 詞卡沒有那句的詞，中文也沒收，不背過族語就過不了。
      if (goal?.kind === "selectAndSpeak" && goal.prompt) {
        const seen = new Set(hintWords.map((word) => indigenousKey(word)));
        for (const token of String(goal.prompt).split(/\s+/)) {
          const clean = token.replace(/^[，。！？、,.!?]+|[，。！？、,.!?]+$/g, "");
          const key = indigenousKey(clean);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          hintWords.push(clean);
        }
        const promptChinese = goal.promptChinese || (String(quest.tips ?? "").match(/和對方說「([^」]+)」/)?.[1] ?? "");
        goal = { ...goal, promptChinese };
      }
      return {
        ...quest,
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
    quests,
    available: quests.length > 0
  };
}

export function questLineFor(quest, targetId) {
  return (quest?.lines ?? []).find((line) => line.targetId === targetId) ?? null;
}

// 判定跟對話同一套規則：族語去掉標點後相同 → 說對了；系統懂成的意思跟教材中文
// 相同 → 意思對上；其餘 → 再試試看。
// 多出一種 wrongTarget：句子本身是對的，但這句只能對另一個人說。
export function judgeQuestLine(quest, targetId, { answer, translation }) {
  const line = questLineFor(quest, targetId);
  if (!line) return { verdict: "retry", line: null, rightTargetId: null };
  const mine = indigenousKey(answer);
  if (mine && mine === indigenousKey(line.indigenousText)) return { verdict: "exact", line, rightTargetId: null };
  const heard = chineseKey(translation);
  if (heard && heard === chineseKey(line.chineseText)) return { verdict: "semantic", line, rightTargetId: null };
  // 第 1、2 關兩個對象要說的是同一句，那種情況不存在「說錯人」，不要誤報。
  const spokenElsewhere = (quest.lines ?? []).find((item) => (
    item.targetId !== targetId
    && item.indigenousText !== line.indigenousText
    && mine
    && mine === indigenousKey(item.indigenousText)
  ));
  if (spokenElsewhere) return { verdict: "wrongTarget", line, rightTargetId: spokenElsewhere.targetId };
  return { verdict: "retry", line, rightTargetId: null };
}

export function questIsLearned(quest, targetId, state) {
  return (state?.learned ?? []).includes(targetId);
}

// 兩種過關條件：
//   nameTags：先問完兩位同學，再把名牌放到對的人桌上（choices 是候選名牌）
//   askRightPerson：對指定的人問出指定的那句
// 這裡只判「整關過了沒」，名牌放對放錯由 placeNameTag 回報。
export function questIsComplete(quest, state) {
  const goal = quest?.goal;
  if (!goal) return false;
  const learned = state?.learned ?? [];
  const placed = state?.placed ?? {};
  if (goal.kind === "nameTags") {
    // 還沒問完兩個人就不算過：名牌要從剛才聽到的名字來的。
    const everyone = (quest.targets ?? []).every((target) => learned.includes(target.id));
    if (!everyone) return false;
    return Object.entries(goal.answers ?? {}).every(([targetId, name]) => placed[targetId] === name);
  }
  if (goal.kind === "askRightPerson") {
    return learned.includes(goal.targetId) && questLineFor(quest, goal.targetId)?.code === goal.code;
  }
  return false;
}

// 名牌放對才會固定下來；放錯不佔位，可以再換。
// 早期版本放錯也寫進 placed，結果那張錯名牌會把這個位置鎖死、名牌也標成用過，
// 學習者再也換不掉，整關卡住——放錯要能重來。
export function placeNameTag(quest, { tag, targetId, state }) {
  const goal = quest?.goal;
  const placed = { ...(state?.placed ?? {}) };
  if (goal?.kind !== "nameTags") return { ok: false, reason: "not-nameTags", placed };
  if (placed[targetId]) return { ok: false, reason: "locked", placed };
  if (!goal.choices.includes(tag)) return { ok: false, reason: "unknown", placed };
  if (placed[targetId] === tag) return { ok: true, reason: "correct", placed };
  if (tag !== goal.answers[targetId]) return { ok: false, reason: "wrong", placed };
  placed[targetId] = tag;
  return { ok: true, reason: "correct", placed };
}

// 任務進度給 UI 顯示：先問完人，再放名牌；問對象的關卡要說清楚「還沒問到對的人」。
export function questProgress(quest, state) {
  const goal = quest?.goal;
  const learned = (state?.learned ?? []).filter((id) => (quest?.targets ?? []).some((target) => target.id === id));
  const total = (quest?.targets ?? []).length;
  if (goal?.kind === "nameTags") {
    const placedCount = Object.keys(state?.placed ?? {}).length;
    if (learned.length < total) return `先問完 ${total} 位同學（${learned.length}/${total}）`;
    return `把名牌放到對的桌上（${placedCount}/${total}）`;
  }
  if (goal?.kind === "end") return "任務結束";
  // 問對象：問到指定那位才算過，問到別人只是換個人再問。
  if (goal.kind === "askRightPerson") {
    if (learned.includes(goal.targetId)) return "任務完成";
    return learned.length ? "還沒問到對的人，換一位問問看" : `先問 ${total} 位同學（${learned.length}/${total}）`;
  }
  // 選東西的關卡：先問人拿線索，再從候選裡挑。picked 開局是 null，不能拿來判斷還沒選。
  if (goal.kind === "select") {
    return (state?.learned ?? []).length ? "從下面的選項挑一個" : "先問問同學，再挑出正確的那一個";
  }
  if (goal.kind === "take") {
    // 有些東西要先問對人才拿得到（官方 condition.lock）。
    // 進度要講清楚要問誰、也講清楚「籃子滿了不代表答對」——
    // 只寫「先問問同學」會讓人以為隨便問一個就行，
    // 只寫「1/1」又會讓人以為已經完成。
    const unlocked = !goal.lock
      || goal.unlock?.targetId === undefined
      || (state?.learned ?? []).includes(goal.unlock.targetId);
    if (!unlocked) return `先問問${targetLabel(goal.unlock.targetId, quest)}的人，才拿得到正確的東西`;
    const need = goal.answers.length;
    const got = (state?.taken ?? []).length;
    return `把正確的東西放進籃子（已放 ${got} 樣，要 ${need} 樣）`;
  }
  if (goal.kind === "click") return "先問問同學，再點場景裡該點的地方";
  if (goal.kind === "selectAndSpeak") {
    if (!state?.picked) return "先問問同學，再選要道謝的人";
    return goal.promptChinese ? `用族語說出「${goal.promptChinese}」` : "用族語說出那句話";
  }
  return learned.length ? "對方已經回答" : `先問 ${total} 位同學（${learned.length}/${total}）`;
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
  if (verdict === "wrongTarget") return "這句要對另一位同學說，換個人再問一次。";
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
  if (index < 0 || sorted.length < 2) return "那位同學";
  const names = sorted.length === 2 ? ["左邊", "右邊"] : ["左邊", "中間", "右邊"];
  return names[index] ?? "那位同學";
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
export function judgeQuestPrompt(quest, { answer, translation }) {
  const prompt = quest?.goal?.prompt;
  if (!prompt) return "retry";
  const mine = indigenousKey(answer);
  if (mine && mine === indigenousKey(prompt)) return "exact";
  const heard = chineseKey(translation);
  const expected = chineseKey(quest.goal.promptChinese ?? "");
  if (heard && expected && heard === expected) return "semantic";
  return "retry";
}

// 這一關現在該做什麼（給進度列與提示用）。
export function questHint(quest, state) {
  const goal = quest?.goal;
  if (!goal) return "";
  if (goal.kind === "select") return state?.picked ? "再看看誰才對" : "從下面的選項挑一個";
  if (goal.kind === "take") return `把正確的東西放進籃子（${(state?.taken ?? []).length}/${goal.answers.length}）`;
  if (goal.kind === "click") return "點場景裡該點的地方";
  if (goal.kind === "selectAndSpeak") {
    if (!state?.picked) return "先問問同學，再選要道謝的人";
    return goal.promptChinese ? `用族語說出「${goal.promptChinese}」` : "用族語說出那句話";
  }
  if (goal.kind === "nameTags") return "問完兩位同學後把名牌放對桌";
  return "問問看同學";
}
