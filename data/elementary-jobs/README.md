# 教學模組初級：職業

本目錄保存「族語 E 樂園」[教學模組／初級／職業](https://web.klokah.tw/mode/elementary/index.php) 42 個方言別資料，供看圖練習與口說練習使用。

- `dataset.json`：索引、來源與完整性數字。**不含題目本身。**
- `dialects/{dialectId}.json`：每方言 6 筆族語答句、中文職業名、圖片路徑與音檔 URL。
- `raw/{dialectId}.json`：官方 `feature.json` 原文。
- `images/`：共用職業圖。
- `LICENSE.md`：授權、標示與使用限制。

雅美語第三張是「警察」不是「護士」。丹群布農語官方 JSON 夾了 HTML，分片的 `sanitized: true` 代表下載時有清過。

**音檔不入庫。** 每筆帶 `audioUrl`，執行時由 `web.klokah.tw` 直接播放。

重新下載：

```
node scripts/download-elementary-jobs.mjs
```

其他參數：`--dry-run --dialects=1,20,42`、`--verify-audio`、`--verify-audio=all`。
