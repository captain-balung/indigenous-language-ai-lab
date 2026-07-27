# 任務圖示

本目錄的 20 枚任務圖示由 OpenAI 內建 ImageGen 產生，再以 `remove_chroma_key.py` 去除洋紅背景，最後由 `crop_atlas.py` 裁切為一致的 256×256 lossless WebP。

## 最終生成提示摘要

- 20 個族語學習任務物件，依序涵蓋基礎學習、課堂測驗、認證模擬、情境應用與學習互動。
- 溫暖手繪兒童冒險遊戲風格、深藍粗輪廓、圓潤厚實造型。
- 珊瑚紅、薄荷綠、芥末黃與天空藍的統一色盤。
- 無人物、文字、浮水印、文化專屬或神聖紋樣。
- 純 `#ff00ff` 去背背景；不可呈現為 emoji、寫實 3D、pixel art 或細線圖示。

原始生成檔為 `task-icons-chroma.png`，去背圖集為 `task-icons-atlas.png`。網站實際載入各個 `.webp` 圖示。
