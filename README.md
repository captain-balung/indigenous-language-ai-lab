# 族語e樂園 AI 實驗室

族語學習 AI 應用的公開入口網站。首頁分為「基礎學習、課堂測驗、認證模擬、情境應用、學習互動」五大類，每類四張卡片，共 20 項任務。

## 本機預覽

本專案是無建置步驟的純 HTML、CSS 與 JavaScript 網站：

```powershell
python -m http.server 4173
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
- 純本地資源，不需 CDN、第三方套件、登入、Cookie 或 API。
- 支援鍵盤焦點、語意化標題、跳至主要內容與 `prefers-reduced-motion`。
- 視覺延續《部落好心人》第二版的明亮配色、厚邊框、大圓角、卡片層次與輕量遊戲動效，但不使用其角色、文字、題目或素材。

## 部署

根目錄即為可部署的靜態網站，可直接匯入 Vercel；Framework Preset 選擇 `Other`，不需 Build Command。

## 素材與授權

介面插圖皆由 HTML/CSS 幾何圖形及 Unicode emoji 組成，沒有外部圖片、字型或未授權素材。原始碼依 repository 所附授權條款使用。
