# 族語e樂園 AI 實驗室

族語學習 AI 應用的公開入口網站。首頁分為「基礎學習、課堂測驗、認證模擬、情境應用、學習互動」五大類，每類四張卡片，共 20 項任務。

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
- 入口頁使用純本地資源，不需 CDN、第三方套件、登入或 Cookie；身體部位練習另使用公開 Formosan AI 翻譯 API，錯誤時保留教材本地比對功能。
- 支援鍵盤焦點、語意化標題、跳至主要內容與 `prefers-reduced-motion`。
- 視覺延續《部落好心人》第二版的明亮配色、厚邊框、大圓角、卡片層次與輕量遊戲動效，但不使用其角色、文字、題目或素材。
- 20 枚任務圖示採統一手繪遊戲美術，不使用平台相依的 emoji；生成與去背紀錄見 `assets/icons/README.md`。
- 首頁使用四位原創校園學生與 AI 小夥伴的漫畫式主視覺，營造放學後組隊解任務的氣氛；舊作角色與校園素材只作風格參考，沒有直接重用。

## 部署

根目錄即為可部署的靜態網站，可直接匯入 Vercel；Framework Preset 選擇 `Other`，不需 Build Command。

## 已上線應用

- [身體部位練習](apps/body-parts-practice/README.md)：42 個方言別、420 筆教材；先做教材整句比對，再以 Formosan AI `translate_to_zh` 及受控中文同義詞輔助判定。
- [身體部位口說練習](apps/body-parts-speaking/README.md)：與打字版同一批教材、同樣的判定方式，改用錄音作答，經 Formosan AI `asr_transcribe` 取得族語文字。
- [初級模擬站](apps/beginner-mock-exam/README.md)：模擬族語認證初級的聽力四題型與口說兩題型，共 30 題一卷；音檔由 klokah.tw 直接播放，不換算成正式分數。

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
