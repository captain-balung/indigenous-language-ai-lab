# 互動模組中級：溝通式教學法情境對話

本目錄保存「族語 E 樂園」[互動模組／中級：溝通式教學法](https://web.klokah.tw/interact/hordequest/) 42 個方言別的三個生活情境對話，供情境應用的角色扮演使用。

- `dataset.json`：索引、來源與完整性數字。**不含對話本身。**
- `dialects/{dialectId}.json`：每方言三個主題，每個主題 1 段開場白加上固定輪數的交替發話，
  含說話者、族語、中文、音檔 URL 與場景圖。**換方言別時只載入這一個檔案。**
- `raw/{theme}/{dialectId}.json`：官方原始 JSON。
- `raw/setup/{theme}.json`：官方共用的任務說明檔（phase2 的文案來源）。
- `manifest.json`：來源 URL、檔案大小及 SHA-256。
- `LICENSE.md`：授權、標示與使用限制。

| 主題 | 每方言輪數 | 每方言任務關卡 |
| --- | --- | --- |
| 上課用語（`lesson`） | 9 | 5 |
| 尋找物品（`find`） | 8 | 5 |
| 戶外活動（`outside`） | 7 | 4 |

角色由官方說話者圖檔辨識：`boy.png` 與 `boy-1.png` 是主角，`boy-2.png` 是哥哥，`girl.png` 是同學，`mom.png` 是媽媽。
上課用語與尋找物品是兩人對話，戶外活動是三人，逐輪交替發話。

## 任務關卡（官方 phase2）

官方互動模組的 phase2 是「拖詞卡拼句子 → 選對象 → 提問／在場景裡挑東西」：詞卡直接送出了
答案的詞彙與順序。三個主題的 phase2 都收（`themes[].quests`），詞卡只留作提示（`hintWords`，不給順序），
句子改由錄音或打字產生，判定比對 `lines[].indigenousText`。

上課用語是拖名牌與問對的人；另外兩個主題是「問人拿線索 → 挑出正確的東西」，過關條件有
`select`／`take`／`click`／`selectAndSpeak`／`end` 五種。
圖檔索引是**關卡序號 + 1**（官方寫法），照關卡序號組網址會全部 404。

每關的結構：

| 欄位 | 說明 |
| --- | --- |
| `quest` / `tips` | 任務說明與提示，取自共用的 `json/setup/{theme}.json` |
| `hintWords` | 官方詞卡，只在按下「看提示」時出現，不含順序 |
| `targets` | 在場的人，附可點範圍（`box`，百分比）與立像網址 |
| `lines[]` | 對每個對象要說的句子：族語、帶標點的顯示用文字、中文、音檔、
以及對方的回應（`reply`）。`onlyTargetId` 表示這句只能對某個人說 |
| `goal` | 過關條件：`nameTags`（問完兩個人後把名牌放對桌）或 `askRightPerson`（問對的人） |

`goal.kind === "nameTags"` 的 `answers` 是每位同學的正確名牌，`choices` 是五張候選名牌。
`goal.kind === "askRightPerson"` 的 `reward` 是過關後出現在桌上的物件（筆／橡皮擦／掃把）與其百分比座標。

尋找物品與戶外活動另有 `sceneUrl`（每關自己的背景圖）、`props`（要疊上去的圖層）、
`goal.options`（候選物件與座標）、`goal.lock`／`goal.unlock`（要先問對人才拿得到的東西）、
`goal.prompt`（要學者自己說的那句話）與 `buylist`（購物清單）。

**音檔與圖片都不入庫。** 每輪帶 `audioUrl` 與 `imageUrl`，執行時由 `web.klokah.tw` 直接播放與熱連結。

茂林魯凱語（31）上課用語的官方 JSON 在 phase2 少一個逗號，整份無法解析；下載時補上逗號，
分片的 `sanitized` 陣列對應到主題順序，只有 `lesson` 為 `true`，phase1 的對話文字沒有改動。

上游的小不一致：上課用語與尋找物品的主題名在 `theme` 欄位，戶外活動在 `name` 欄位。

## 收錄範圍

三個主題都收 `phase1` 的對話，也都收 `phase2` 的任務關卡（見上）。

## 重新下載

```
node scripts/download-hordequest.mjs
```

其他參數：`--dry-run --dialects=1,31,42`、`--verify-audio`、`--verify-audio=all`。
