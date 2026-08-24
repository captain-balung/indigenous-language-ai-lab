# 句型篇高中版：中級認證題型語料

本目錄保存「族語 E 樂園」句型篇高中版 42 個方言別的七種題型語料，供「中級模擬站」出卷使用。

- `dataset.json`：索引、來源、類別表與完整性數字。**不含題目本身。**
- `dialects/{dialectId}.json`：42 個方言分片，頁面只載入使用者選的那一個。
- `raw/{dialectId}/{classId}.xml`：官方來源 XML，共 924 份（不含看圖說話）。
- `images/`：官方共用圖片，共 154 張（recognize／choiceOne）。
- `manifest.json`：來源 URL、檔案大小及 SHA-256。
- `LICENSE.md`：授權、標示與使用限制。

## 收錄範圍

只收中級考卷用得到的七個題型：`recognize`（是非題）、`choiceOne`（選擇題一）、
`choiceTwo`（選擇題二）、`choiceThree`（選擇題三）、`oralReading`（單句朗讀）、
`dialogue`（問答題）、`pictureTalk`（看圖表達）。
高中版另有 typeId 1 基本詞彙與 typeId 2 生活百句，中級考卷用不到，因此不入庫。

## 與國中版（初級）的結構差異

- `choiceOne` 是「一張圖 + 一段對話錄音」，不是國中版的三選項各自有圖有音。
- `choiceThree` 是高中版才有的題型（國中版對應位置是配合題），純文字 + 音檔。
- `pictureTalk` 每題只有 1 張圖，且 order 1、2 都有效（國中版只有 order 1）。
- `oralReading` 每題有 5 個獨立句子（A–E），各自有音檔。

## 為什麼分片

全部 10540 筆若內嵌在 `dataset.json` 會讓每次開頁都得下載整包。
因此改用 `recordLayout: "sharded"`，`dataset.json` 只留索引與完整性表。

## 音檔

**音檔不入庫。** 每筆資料帶有 `audioUrl`，執行時由 `klokah.tw` 直接播放。
這代表使用者播放時，該網站會看到使用者的 IP 位址；應用頁面必須揭露這件事。
klokah 不送 CORS 標頭，所以只能用 `<audio src>` 播放，不能 `fetch()`、不能加 `crossorigin`。

## 圖片政策

- `recognize`／`choiceOne` 的圖入庫（是非題與選擇題(一) 一定要看圖作答）。
- `pictureTalk` 的圖熱連結，不入庫。
- `choiceThree` **不收圖**：官方中級該題型的選項是拼寫文字，顯示圖片等於給正式測驗沒有的提示。

## 重新下載

```
node scripts/download-klokah-senior.mjs
```

下載程式會要求每個方言的每個類別題數與 `dataset.json` 的 `classes` 完全相符，否則中止。
**全部驗證通過才會寫檔**，失敗時本目錄保持原狀。

klokah 在併發過高時會回傳 HTTP 200 但空的 body，所以下載程式併發上限為 3，
且以位元組長度與檔案 magic 驗證每一次回應，而不是只看狀態碼。

其他參數：`--dry-run --dialects=1,5,42`（不寫檔的抽驗）、`--verify-audio`（HEAD 抽驗音檔）、
`--verify-audio=all`（完整掃描，很慢）。
