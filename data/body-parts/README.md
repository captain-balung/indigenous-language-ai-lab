# 看圖識字：身體部位資料集

本目錄保存「族語 E 樂園」句型篇國中版／看圖識字／身體部位的 42 個方言別資料，共 420 筆文字紀錄及 10 張共用圖片。

- `dataset.json`：應用程式使用的正規化資料。
- `raw/*.xml`：官方來源 XML，共 42 份。
- `images/*.png`：官方共用圖片，共 10 張。
- `manifest.json`：來源 URL、檔案大小及 SHA-256。
- `LICENSE.md`：授權、標示與使用限制。

重新下載：`node scripts/download-body-parts.mjs`。下載程式會要求每個方言恰有 10 筆，否則停止。
