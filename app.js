const categories = [
  { id: "basics", title: "基礎學習", short: "打好基礎", description: "從聲音、字母與詞彙開始，一步步建立族語能力。", icon: "assets/icons/vocabulary-book.webp", accent: "green" },
  { id: "classroom", title: "課堂測驗", short: "測測實力", description: "用有趣的小挑戰，即時檢視每一堂課的學習成果。", icon: "assets/icons/matching-puzzle.webp", accent: "blue" },
  { id: "certification", title: "認證模擬", short: "考前演練", description: "熟悉認證題型與節奏，為正式挑戰做好萬全準備。", icon: "assets/icons/bronze-medal.webp", accent: "gold" },
  { id: "scenarios", title: "情境應用", short: "生活開口說", description: "走進真實生活場景，練習把族語自然地說出來。", icon: "assets/icons/village-house.webp", accent: "coral" },
  { id: "interaction", title: "學習互動", short: "邊玩邊學", description: "透過遊戲、故事與互動，把學習變成一場冒險。", icon: "assets/icons/hand-drum.webp", accent: "purple" }
];

const applicationSeeds = {
  basics: [
    ["十二年國教", "聽十二年國教教材的短句，再用族語跟唸一次。", "assets/icons/listening-ear.webp", "available", "apps/basic-learning/twelve-listen-retell/"],
    ["跟唸", "聽一段短句，再用族語講一次。", "assets/icons/listening-ear.webp", "available", "apps/classroom-quiz/listen-retell/"],
    ["看圖口說練習", "看圖用族語念出完整句子；想聽教材再跟讀也可以。", "assets/icons/studio-microphone.webp", "available", "apps/basic-learning/body-parts-speaking/"],
    ["問答練習", "看中文題目，用自己的話回答。", "assets/icons/speaking-microphone.webp", "available", "apps/basic-learning/qa-practice/"],
    ["看圖描述", "一次看一張圖，用自己的話描述。", "assets/icons/open-storybook.webp", "available", "apps/basic-learning/describe-practice/"]
  ],
  classroom: [
    ["十二年國教", "看族語句子練發音，或看中文練翻譯；兩種練習都在這裡。", "assets/icons/sentence-blocks.webp", "available", "apps/classroom-quiz/twelve/"],
    ["發音練習", "看到圖片就念出對應的族語，每題只錄一次。", "assets/icons/studio-microphone.webp", "available", "apps/classroom-quiz/picture-speaking-quiz/"],
    ["意思造句", "只看中文意思，自己寫出對應的族語。", "assets/icons/sentence-blocks.webp", "available", "apps/classroom-quiz/meaning-sentence/"],
    ["問答測驗", "聽問句，立刻用族語回一句。", "assets/icons/speaking-microphone.webp", "available", "apps/classroom-quiz/question-reply/"],
    ["看圖測驗", "一次看完整組圖，用自己的話描述。", "assets/icons/open-storybook.webp", "available", "apps/classroom-quiz/picture-quiz/"]
  ],
  certification: [
    ["初級口說模擬站", "照初級認證的口說三題型，整卷練習一遍。", "assets/icons/bronze-medal.webp", "available", "apps/certification-mock/beginner-mock-exam/"],
    ["中級模擬站", "照中級認證的口說與聽力題型，整卷練習一遍。", "assets/icons/silver-medal.webp", "available", "apps/certification-mock/intermediate-mock-exam/"],
    ["口說練習官", "依題目提示，組織內容並練習口頭表達。", "assets/icons/studio-microphone.webp"],
    ["考前任務包", "把多種題型集中起來，考前一次演練。", "assets/icons/school-backpack.webp"]
  ],
  scenarios: [
    ["部落大小事", "走進開學、婚禮、出遊三個生活場景，先聽對話再玩任務。", "assets/icons/village-house.webp", "available", "apps/scenario-practice/village-life/"],
    ["市場小幫手", "到攤位問價、比較與結帳，練習購物用語。", "assets/icons/market-basket.webp"],
    ["旅行會話包", "從問路到搭車，練習旅途中的實用句。", "assets/icons/travel-bus.webp"],
    ["文化故事屋", "跟著情境故事，認識語言背後的文化。", "assets/icons/campfire-story.webp"]
  ],
  interaction: [
    ["族語闖關島", "闖關收集徽章，把練習變成一場冒險。", "assets/icons/treasure-map.webp"],
    ["故事共創機", "選角色與情節，一起完成族語故事。", "assets/icons/open-storybook.webp"],
    ["對話小夥伴", "在引導情境裡練習日常對話。", "assets/icons/friendly-robot.webp"],
    ["節奏記憶王", "跟著節拍記住詞語與常用句。", "assets/icons/hand-drum.webp"]
  ]
};

const applications = categories.flatMap((category) =>
  applicationSeeds[category.id].map(([title, description, icon, status = "coming-soon", href = ""], index) => ({
    id: `${category.id}-${index + 1}`,
    categoryId: category.id,
    title,
    description,
    icon,
    status,
    href,
    openInNewTab: false,
    tags: [category.title],
    order: index + 1
  }))
);

const statusLabels = {
  "coming-soon": "即將推出",
  available: "開始使用",
  maintenance: "維護中"
};

const categoryNav = document.querySelector("#category-nav");
const sectionsRoot = document.querySelector("#category-sections");

categoryNav.innerHTML = categories.map((category) => `
  <a class="category-pill category-pill--${category.accent}" href="#${category.id}">
    <img src="${category.icon}" alt="" aria-hidden="true">
    <span><strong>${category.title}</strong><small>${category.short}</small></span>
  </a>
`).join("");

sectionsRoot.innerHTML = categories.map((category, categoryIndex) => {
  const items = applications
    .filter((application) => application.categoryId === category.id)
    .sort((a, b) => a.order - b.order);
  const cards = items.map((application, index) => renderCard(application, index + 1, category.accent)).join("");
  const grid = `<div class="card-grid">${cards}</div>`;
  const track = items.length > 4
    ? `<div class="card-carousel" tabindex="0" aria-label="${category.title}任務卡片">
        <button type="button" data-carousel-prev aria-label="上一張">←</button>
        <div class="card-carousel__viewport">${grid}</div>
        <button type="button" data-carousel-next aria-label="下一張">→</button>
      </div>`
    : grid;

  return `
    <section class="category-section category-section--${category.accent}" id="${category.id}" aria-labelledby="${category.id}-title">
      <div class="category-heading">
        <div class="category-heading__icon" aria-hidden="true"><img src="${category.icon}" alt=""></div>
        <div>
          <p>MISSION ${String(categoryIndex + 1).padStart(2, "0")}</p>
          <h2 id="${category.id}-title">${category.title}</h2>
          <span>${category.description}</span>
        </div>
        <strong class="category-heading__count">${items.length} 個任務</strong>
      </div>
      ${track}
    </section>
  `;
}).join("");

function pageSize() {
  if (window.matchMedia("(max-width: 560px)").matches) return 1;
  if (window.matchMedia("(max-width: 900px)").matches) return 2;
  return 4;
}

function bindCarousel(root) {
  const viewport = root.querySelector(".card-carousel__viewport");
  const grid = root.querySelector(".card-grid");
  const prev = root.querySelector("[data-carousel-prev]");
  const next = root.querySelector("[data-carousel-next]");
  const count = grid.children.length;
  let slide = 0;

  function layout() {
    const size = pageSize();
    const gap = 16;
    const width = viewport.clientWidth;
    const cardWidth = Math.max(0, (width - (size - 1) * gap) / size);
    for (const card of grid.children) {
      card.style.flex = `0 0 ${cardWidth}px`;
      card.style.maxWidth = `${cardWidth}px`;
    }
    slide = Math.max(0, Math.min(slide, Math.max(0, count - size)));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    grid.style.gap = `${gap}px`;
    grid.style.transition = reduced ? "none" : "transform .22s ease";
    grid.style.transform = `translateX(${-slide * (cardWidth + gap)}px)`;
    const overflow = count > size;
    prev.hidden = next.hidden = !overflow;
    prev.disabled = slide <= 0;
    next.disabled = slide >= count - size;
  }

  prev.addEventListener("click", () => { slide -= 1; layout(); });
  next.addEventListener("click", () => { slide += 1; layout(); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); slide -= 1; layout(); }
    if (event.key === "ArrowRight") { event.preventDefault(); slide += 1; layout(); }
  });
  window.addEventListener("resize", layout);
  layout();
}

function renderCard(application, index, accent) {
  const isAvailable = application.status === "available" && application.href;
  const isMaintenance = application.status === "maintenance";
  const tagName = isAvailable ? "a" : "article";
  const linkAttributes = isAvailable
    ? `href="${application.href}"${application.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : ""}`
    : `aria-disabled="true"`;

  return `
    <${tagName} class="app-card app-card--${accent}${isAvailable ? " app-card--available" : isMaintenance ? "" : " app-card--coming-soon"}" ${linkAttributes}>
      <div class="app-card__top">
        <span class="app-card__number">${String(index).padStart(2, "0")}</span>
        <span class="status-badge${isMaintenance ? " status-badge--maintenance" : ""}">${statusLabels[application.status]}</span>
      </div>
      <div class="app-card__icon" aria-hidden="true"><img src="${application.icon}" alt=""></div>
      <h3>${application.title}</h3>
      <p>${application.description}</p>
      <span class="app-card__action">${isAvailable ? "進入任務 →" : isMaintenance ? "稍後再來" : "敬請期待"}</span>
    </${tagName}>
  `;
}

document.querySelectorAll(".card-carousel").forEach(bindCarousel);

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    history.replaceState(null, "", link.getAttribute("href"));
  });
});
