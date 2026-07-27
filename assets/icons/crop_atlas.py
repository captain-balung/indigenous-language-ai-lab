"""Crop the generated icon atlas into consistently sized transparent WebP assets."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
ATLAS = Image.open(ROOT / "task-icons-atlas.png").convert("RGBA")

ICONS = {
    "headphones": (35, 20, 270, 235),
    "alphabet-blocks": (345, 30, 590, 235),
    "vocabulary-book": (665, 30, 860, 240),
    "speaking-microphone": (960, 25, 1110, 245),
    "listening-ear": (1170, 35, 1365, 235),
    "matching-puzzle": (190, 270, 455, 455),
    "sentence-blocks": (530, 290, 860, 450),
    "progress-chart": (950, 275, 1225, 455),
    "bronze-medal": (115, 480, 290, 690),
    "silver-medal": (420, 480, 600, 690),
    "studio-microphone": (790, 475, 980, 690),
    "school-backpack": (1060, 480, 1305, 695),
    "village-house": (65, 700, 325, 900),
    "market-basket": (395, 700, 650, 900),
    "travel-bus": (705, 715, 1005, 900),
    "campfire-story": (1050, 695, 1275, 900),
    "treasure-map": (55, 900, 335, 1115),
    "open-storybook": (390, 910, 665, 1115),
    "friendly-robot": (745, 900, 995, 1115),
    "hand-drum": (1065, 900, 1285, 1115),
}

for name, box in ICONS.items():
    icon = ATLAS.crop(box)
    alpha_box = icon.getchannel("A").getbbox()
    if alpha_box:
        icon = icon.crop(alpha_box)
    icon.thumbnail((218, 218), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((256 - icon.width) // 2, (256 - icon.height) // 2))
    canvas.save(ROOT / f"{name}.webp", "WEBP", lossless=True, method=6)

print(f"Wrote {len(ICONS)} icons to {ROOT}")
