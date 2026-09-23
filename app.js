const categories = [
  { id: "basics", title: "基礎學習", short: "打好基礎", description: "從聲音、字母與詞彙開始，一步步建立族語能力。", icon: "assets/icons/vocabulary-book.webp", accent: "green" },
  { id: "classroom", title: "課堂測驗", short: "測測實力", description: "用有趣的小挑戰，即時檢視每一堂課的學習成果。", icon: "assets/icons/matching-puzzle.webp", accent: "blue" },
  { id: "certification", title: "認證模擬", short: "考前演練", description: "熟悉認證題型與節奏，為正式挑戰做好萬全準備。", icon: "assets/icons/bronze-medal.webp", accent: "gold" },
  { id: "scenarios", title: "情境應用", short: "生活開口說", description: "走進真實生活場景，練習把族語自然地說出來。", icon: "assets/icons/village-house.webp", accent: "coral" },
  { id: "interaction", title: "學習互動", short: "邊玩邊學", description: "透過遊戲、故事與互動，把學習變成一場冒險。", icon: "assets/icons/hand-drum.webp", accent: "purple" }
];

const applicationSeeds = {
  basics: [
    ["看圖練習", "看圖片寫出族語完整句子。可依身體部位、動物、地點、職業等主題練習。", "assets/icons/friendly-robot.webp", "available", "apps/body-parts-practice/"],
    ["口說練習", "看圖片用族語念出完整句子。可先聽教材再念，也可以直接說。主題與看圖練習相同。", "assets/icons/studio-microphone.webp", "available", "apps/body-parts-speaking/"],
    ["問答練習", "聽族語問句，用打字或錄音自由回答。系統會顯示它聽到、懂成的意思。", "assets/icons/speaking-microphone.webp", "available", "apps/qa-practice/"],
    ["看圖描述", "看認證看圖說話／看圖表達的圖片，用自己的話描述。系統會顯示它懂成的中文意思。", "assets/icons/open-storybook.webp", "available", "apps/describe-practice/"]
  ],
  classroom: [
    ["意思造句", "只看中文意思，自己寫族語。每題都顯示系統懂成的中文。", "assets/icons/sentence-blocks.webp", "available", "apps/classroom-quiz/?mode=compose"],
    ["看圖口說小考", "看圖念出完整句，每題只錄一次，由語音辨識與翻譯計分。", "assets/icons/studio-microphone.webp", "available", "apps/classroom-quiz/?mode=oral"],
    ["聽後轉述", "只聽短句，用族語再講一次。系統顯示它聽到的話，以及懂成的中文。", "assets/icons/listening-ear.webp", "available", "apps/classroom-quiz/?mode=retell"],
    ["接話小考", "聽問句，用族語回答一次。系統先辨識，再判斷有沒有答到。", "assets/icons/speaking-microphone.webp", "available", "apps/classroom-quiz/?mode=reply"]
  ],
  certification: [
    ["初級模擬站", "模擬初級認證的口說三題型與聽力四題型，聽教材錄音作答。", "assets/icons/bronze-medal.webp", "available", "apps/beginner-mock-exam/"],
    ["中級模擬站", "模擬中級認證的口說三題型與聽力四題型，聽教材錄音作答。", "assets/icons/silver-medal.webp", "available", "apps/intermediate-mock-exam/"],
    ["口說練習官", "依題目提示組織內容並練習表達。", "assets/icons/studio-microphone.webp"],
    ["考前任務包", "集中演練多種題型，準備上場。", "assets/icons/school-backpack.webp"]
  ],
  scenarios: [
    ["部落的一天", "在日常情境中練習問候與對話。", "assets/icons/village-house.webp"],
    ["市場小幫手", "學會購物、數量與食物相關說法。", "assets/icons/market-basket.webp"],
    ["旅行會話包", "從問路到搭車，練習實用句型。", "assets/icons/travel-bus.webp"],
    ["文化故事屋", "跟著情境故事理解語言與文化。", "assets/icons/campfire-story.webp"]
  ],
  interaction: [
    ["族語闖關島", "完成關卡、收集徽章，展開學習冒險。", "assets/icons/treasure-map.webp"],
    ["故事共創機", "選擇角色與情節，一起完成族語故事。", "assets/icons/open-storybook.webp"],
    ["對話小夥伴", "透過安全的引導情境練習生活對話。", "assets/icons/friendly-robot.webp"],
    ["節奏記憶王", "跟著節拍記住詞語與常用句型。", "assets/icons/hand-drum.webp"]
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
