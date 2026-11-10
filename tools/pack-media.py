#!/usr/bin/env python3
"""把 tools/capture-media.mjs 录下的帧压成 README 用的动图和截图。依赖：pip install pillow"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "qa" / "out" / "media"
OUT = ROOT / "docs" / "media"
OUT.mkdir(parents=True, exist_ok=True)


def anim(prefix, name, width=800, fps=20, quality=62):
    frames = sorted(SRC.glob(f"{prefix}-*.png"))
    if not frames:
        print("缺少帧：", prefix)
        return
    ims = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        ims.append(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))
    path = OUT / name
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=round(1000 / fps), loop=0, quality=quality, method=6)
    print(f"{name}: {len(ims)} 帧, {path.stat().st_size / 1024:.0f} KB")


def still(src, name, width, quality=84):
    im = Image.open(SRC / src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = OUT / name
    im.save(path, quality=quality, optimize=True, progressive=True)
    print(f"{name}: {im.width}x{im.height}, {path.stat().st_size / 1024:.0f} KB")


anim("hero", "hero.webp")
anim("coda", "resonance.webp")
still("still-hero.png", "hero.jpg", 1600)
still("still-tower.png", "tower.jpg", 1600)
still("still-overtones.png", "overtones.jpg", 1600)
still("still-ensemble.png", "ensemble.jpg", 1600)
still("still-resonance.png", "resonance.jpg", 1600)
still("phone-hero.png", "phone-hero.jpg", 780)
still("phone-tower.png", "phone-tower.jpg", 780)
still("phone-resonance.png", "phone-resonance.jpg", 780)
cover = Image.open(SRC / "still-cover.png").convert("RGB")
cover.save(ROOT / "docs" / "cover.jpg", quality=86, optimize=True, progressive=True)
print(f"cover.jpg: {cover.width}x{cover.height}, {(ROOT / 'docs' / 'cover.jpg').stat().st_size / 1024:.0f} KB")
