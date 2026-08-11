const categories = [
  { id: "basics", title: "基礎學習", short: "打好基礎", description: "從聲音、字母與詞彙開始，一步步建立族語能力。", icon: "assets/icons/vocabulary-book.webp", accent: "green" },
  { id: "classroom", title: "課堂測驗", short: "測測實力", description: "用有趣的小挑戰，即時檢視每一堂課的學習成果。", icon: "assets/icons/matching-puzzle.webp", accent: "blue" },
  { id: "certification", title: "認證模擬", short: "考前演練", description: "熟悉認證題型與節奏，為正式挑戰做好萬全準備。", icon: "assets/icons/bronze-medal.webp", accent: "gold" },
  { id: "scenarios", title: "情境應用", short: "生活開口說", description: "走進真實生活場景，練習把族語自然地說出來。", icon: "assets/icons/village-house.webp", accent: "coral" },
  { id: "interaction", title: "學習互動", short: "邊玩邊學", description: "透過遊戲、故事與互動，把學習變成一場冒險。", icon: "assets/icons/hand-drum.webp", accent: "purple" }
];

const applicationSeeds = {
  basics: [
    ["身體部位練習", "看圖片練習 42 個方言別的身體部位完整句子。", "assets/icons/friendly-robot.webp", "available", "apps/body-parts-practice/"],
    ["身體部位口說練習", "用說的練習 42 個方言別的身體部位句子，語音辨識會顯示系統聽到的內容。", "assets/icons/studio-microphone.webp", "available", "apps/body-parts-speaking/"],
    ["詞彙收藏冊", "用主題卡片累積生活常用詞彙。", "assets/icons/vocabulary-book.webp"],
    ["跟讀小教練", "跟著提示反覆練習，勇敢開口說。", "assets/icons/speaking-microphone.webp"]
  ],
  classroom: [
    ["聽力快問快答", "聽見關鍵詞，選出最合適的答案。", "assets/icons/listening-ear.webp"],
    ["詞語配對賽", "將族語詞彙與圖片正確配對。", "assets/icons/matching-puzzle.webp"],
    ["句子排列所", "重新排列詞語，拼出完整句子。", "assets/icons/sentence-blocks.webp"],
    ["課堂挑戰榜", "完成一組綜合題目，確認學習進度。", "assets/icons/progress-chart.webp"]
  ],
  certification: [
    ["初級模擬站", "以模擬題熟悉初級認證的答題方式。", "assets/icons/bronze-medal.webp"],
    ["中級模擬站", "挑戰進階聽讀題型與作答節奏。", "assets/icons/silver-medal.webp"],
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
  const cards = applications
    .filter((application) => application.categoryId === category.id)
    .sort((a, b) => a.order - b.order)
    .map((application, index) => renderCard(application, index + 1, category.accent))
    .join("");

  return `
    <section class="category-section category-section--${category.accent}" id="${category.id}" aria-labelledby="${category.id}-title">
      <div class="category-heading">
        <div class="category-heading__icon" aria-hidden="true"><img src="${category.icon}" alt=""></div>
        <div>
          <p>MISSION ${String(categoryIndex + 1).padStart(2, "0")}</p>
          <h2 id="${category.id}-title">${category.title}</h2>
          <span>${category.description}</span>
        </div>
        <strong class="category-heading__count">4 個任務</strong>
      </div>
      <div class="card-grid">${cards}</div>
    </section>
  `;
}).join("");

function renderCard(application, index, accent) {
  const isAvailable = application.status === "available" && application.href;
  const isMaintenance = application.status === "maintenance";
  const tagName = isAvailable ? "a" : "article";
  const linkAttributes = isAvailable
    ? `href="${application.href}"${application.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : ""}`
    : `aria-disabled="true"`;

  return `
    <${tagName} class="app-card app-card--${accent}${isAvailable ? " app-card--available" : ""}" ${linkAttributes}>
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

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    history.replaceState(null, "", link.getAttribute("href"));
  });
});
