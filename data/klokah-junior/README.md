# 句型篇國中版：初級認證題型語料

本目錄保存「族語 E 樂園」句型篇國中版 42 個方言別的六種題型語料，供「初級模擬站」出卷使用。

- `dataset.json`：索引、來源、類別表與完整性數字。**不含題目本身。**
- `dialects/{dialectId}.json`：42 個方言分片，頁面只載入使用者選的那一個。
- `raw/{dialectId}/{classId}.xml`：官方來源 XML，共 1008 份。
- `images/`：官方共用圖片，共 180 張（recognize／choiceOne／match）。
- `manifest.json`：來源 URL、檔案大小及 SHA-256。
- `LICENSE.md`：授權、標示與使用限制。

## 為什麼分片

全部 7768 筆若內嵌在 `dataset.json` 約 4 MB，等於每次開頁都要下載 4 MB。
因此改用 `recordLayout: "sharded"`，`dataset.json` 只留索引與完整性表。

## 音檔

**音檔不入庫。** 每筆資料帶有 `audioUrl`，執行時由 `klokah.tw` 直接播放。
這代表使用者播放時，該網站會看到使用者的 IP 位址；應用頁面必須揭露這件事。
klokah 不送 CORS 標頭，所以只能用 `<audio src>` 播放，不能 `fetch()`、不能加 `crossorigin`。

## 重新下載

```
node scripts/download-klokah-junior.mjs
```

下載程式會要求每個方言的每個類別題數與 `dataset.json` 的 `classes` 完全相符，否則中止。
**全部驗證通過才會寫檔**，失敗時本目錄保持原狀。

klokah 在併發過高時會回傳 HTTP 200 但空的 body，所以下載程式併發上限為 3，
且以位元組長度與檔案 magic 驗證每一次回應，而不是只看狀態碼。

其他參數：`--dry-run --dialects=1,20`（不寫檔的抽驗）、`--verify-audio`（HEAD 抽驗音檔）、
`--verify-audio=all`（完整掃描，很慢）。
