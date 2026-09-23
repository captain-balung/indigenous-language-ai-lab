# 族語e樂園 AI 實驗室

族語學習 AI 應用的公開入口網站。首頁分為「基礎學習、課堂測驗、認證模擬、情境應用、學習互動」五大類，每類四張卡片，共 20 項任務。聽音練習頁面仍在，首頁不列出。

## 線上網站

正式網站：[https://indigenous-language-ai-lab.vercel.app/](https://indigenous-language-ai-lab.vercel.app/)

## 本機預覽

本專案是無建置步驟的純 HTML、CSS 與 JavaScript 網站：

```powershell
python -m http.server 4173
```

或使用專案內零依賴的靜態伺服器（需 Node 18 以上）：

```powershell
node scripts/serve.mjs 4173
```

開啟 `http://127.0.0.1:4173/`。

## 修改卡片

卡片唯一資料來源位於 `app.js`：

- `categories`：五大分類的名稱、說明、圖示與色彩。
- `applicationSeeds`：20 張卡片的名稱、說明與圖示。
- `applications`：完整資料模型，包含 `id`、`categoryId`、`status`、`href`、`openInNewTab`、`tags` 與 `order`。

要將卡片上線，將該筆 `status` 改為 `available` 並填入有效 `href`；要暫停服務則改為 `maintenance`。未上線卡片保持 `coming-soon`，頁面不會產生空連結。

## 設計與技術

- Mobile-first，手機單欄、平板雙欄、桌機四欄。
- 入口頁使用純本地資源，不需 CDN、第三方套件、登入或 Cookie；看圖練習與口說練習另使用公開 Formosan AI API，錯誤時保留教材本地比對功能。
- 支援鍵盤焦點、語意化標題、跳至主要內容與 `prefers-reduced-motion`。
- 視覺延續《部落好心人》第二版的明亮配色、厚邊框、大圓角、卡片層次與輕量遊戲動效，但不使用其角色、文字、題目或素材。
- 20 枚任務圖示採統一手繪遊戲美術，不使用平台相依的 emoji；生成與去背紀錄見 `assets/icons/README.md`。
- 首頁使用四位原創校園學生與 AI 小夥伴的漫畫式主視覺，營造放學後組隊解任務的氣氛；舊作角色與校園素材只作風格參考，沒有直接重用。

## 部署

根目錄即為可部署的靜態網站，可直接匯入 Vercel；Framework Preset 選擇 `Other`，不需 Build Command。

## 已上線應用

- [看圖練習](apps/body-parts-practice/README.md)：42 個方言別，依身體部位、動物、植物／水果、物品、地點／景觀、人物、職業看圖寫完整句子；先做教材整句比對，再以 Formosan AI `translate_to_zh` 判定意思。
- [口說練習](apps/body-parts-speaking/README.md)：同一批主題，看圖念出完整句子；可先聽教材再念，也可以直接說。語音辨識會顯示系統聽到的內容。
- [聽音練習](apps/listen-practice/README.md)：與看圖練習同一批主題，聽族語音檔後選出對應圖片或中文意思；音檔由 klokah.tw／web.klokah.tw 直接播放。首頁不列出，網址仍可開啟。
- [問答練習](apps/qa-practice/README.md)：聽國中版對話問句，用打字或錄音自由回答；系統顯示它聽到、懂成的意思，不做考試配分。
- [看圖描述](apps/describe-practice/README.md)：用認證初級看圖說話、中級看圖表達的圖片自由描述；系統顯示它懂成的中文意思。
- [課堂測驗](apps/classroom-quiz/README.md)：意思造句、看圖口說、聽後轉述與接話小考，各一輪 8 題。造句與轉述用 `translate_to_zh` 顯示系統懂成；接話先辨識再判斷有沒有答到。分數只留在當次畫面。
- [初級模擬站](apps/beginner-mock-exam/README.md)：模擬族語認證初級的口說三題型與聽力四題型，共 31 題一卷；音檔由 klokah.tw 直接播放；練習得分依公開配分加總，不宣告正式通過。
- [中級模擬站](apps/intermediate-mock-exam/README.md)：模擬族語認證中級的口說三題型（單句朗讀、問答題、看圖表達）與聽力四題型（是非題、選擇題一二三），同樣 31 題一卷；單句朗讀依詞語重疊程度給 0–3 分，不做整句字面比對。

## 素材與授權

介面插圖由 HTML/CSS 幾何圖形與專案內生成美術組成，沒有外部字型或未授權素材。原始碼依 repository 所附授權條款使用；族語 E 樂園教材另依下列授權使用。

### 族語 E 樂園教材資料

第一個應用的基礎資料位於 `data/body-parts/`，內容是「族語 E 樂園」句型篇國中版／看圖識字／身體部位：42 個方言別、每語 10 筆，共 420 筆族語與中文文字，以及 10 張共用圖片。

這批教材不是本專案原始碼授權的一部分，須另依 [CC BY-NC-SA 4.0](data/body-parts/LICENSE.md) 使用：必須標示來源、不得商業使用，改作及衍生內容須以相同授權散布。

重新取得及驗證資料：

```powershell
node scripts/download-body-parts.mjs
```

### 初級認證題型語料

「初級模擬站」的資料位於 `data/klokah-junior/`，內容是「族語 E 樂園」句型篇國中版的六種題型：
42 個方言別、共 7768 筆語料與 180 張共用圖片，同樣依
[CC BY-NC-SA 4.0](data/klokah-junior/LICENSE.md) 使用。

**音檔不入庫**：每筆資料只帶 `audioUrl`，執行時由 `klokah.tw` 直接播放。
這代表使用者播放時該網站會看到其 IP 位址，應用頁面已揭露這件事。

重新取得及驗證資料：

```powershell
node scripts/download-klokah-junior.mjs
```

### 中級認證題型語料

「中級模擬站」的資料位於 `data/klokah-senior/`，內容是「族語 E 樂園」句型篇高中版中，
中級考卷用得到的七種題型：42 個方言別、共 10540 筆語料與 154 張共用圖片，同樣依
[CC BY-NC-SA 4.0](data/klokah-senior/LICENSE.md) 使用。

高中版另有「基本詞彙」與「生活百句」兩個題型，中級考卷用不到，因此不入庫。
選擇題(三) 的教材圖片也不收錄——官方該題型的選項是拼寫文字，顯示圖片等於給正式測驗沒有的提示。

**音檔不入庫**：每筆資料只帶 `audioUrl`，執行時由 `klokah.tw` 直接播放；看圖表達的圖片同樣熱連結。

重新取得及驗證資料：

```powershell
node scripts/download-klokah-senior.mjs
```

### 教學模組初級／職業

「看圖練習」、「口說練習」與「聽音練習」的職業主題位於 `data/elementary-jobs/`，內容是「族語 E 樂園」教學模組初級的職業主題：
42 個方言別、每語 6 筆，共 252 筆文字與 7 張共用圖片，同樣依
[CC BY-NC-SA 4.0](data/elementary-jobs/LICENSE.md) 使用。

**音檔不入庫**：每筆資料只帶 `audioUrl`，執行時由 `web.klokah.tw` 直接播放。

重新取得及驗證資料：

```powershell
node scripts/download-elementary-jobs.mjs
```
