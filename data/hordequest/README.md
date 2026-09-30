# 互動模組中級：溝通式教學法情境對話

本目錄保存「族語 E 樂園」[互動模組／中級：溝通式教學法](https://web.klokah.tw/interact/hordequest/) 42 個方言別的三個生活情境對話，供情境應用的角色扮演使用。

- `dataset.json`：索引、來源與完整性數字。**不含對話本身。**
- `dialects/{dialectId}.json`：每方言三個主題，每個主題 1 段開場白加上固定輪數的交替發話，
  含說話者、族語、中文、音檔 URL 與場景圖。**換方言別時只載入這一個檔案。**
- `raw/{theme}/{dialectId}.json`：官方原始 JSON。
- `manifest.json`：來源 URL、檔案大小及 SHA-256。
- `LICENSE.md`：授權、標示與使用限制。

| 主題 | 每方言輪數 | 角色 |
| --- | --- | --- |
| 上課用語（`lesson`） | 9 | — |
| 尋找物品（`find`） | 8 | — |
| 戶外活動（`outside`） | 7 | — |

角色由官方說話者圖檔辨識：`boy.png` 與 `boy-1.png` 是主角，`boy-2.png` 是哥哥，`girl.png` 是同學，`mom.png` 是媽媽。
上課用語與尋找物品是兩人對話，戶外活動是三人，逐輪交替發話。

**音檔與圖片都不入庫。** 每輪帶 `audioUrl` 與 `imageUrl`，執行時由 `web.klokah.tw` 直接播放與熱連結。

茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，整份無法解析；下載時補上逗號，
分片的 `sanitized` 陣列對應到主題順序，只有 `lesson` 為 `true`，phase1 的對話文字沒有改動。

上游的小不一致：上課用語與尋找物品的主題名在 `theme` 欄位，戶外活動在 `name` 欄位。

## 收錄範圍

三個主題都只收 `phase1` 的對話。官方另有 `phase2` 的互動關卡（問周圍的人要找什麼、辨認特徵、把東西放進購物籃），
玩法與對話不同，本單元尚未收錄；要實作時再擴充，屆時在 `THEMES` 之外加一段解析即可。

## 重新下載

```
node scripts/download-hordequest.mjs
```

其他參數：`--dry-run --dialects=1,31,42`、`--verify-audio`、`--verify-audio=all`。
