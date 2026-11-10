#!/usr/bin/env python3
"""按站内实际用到的字裁剪字体。改了文案或作品标题之后重跑一次，否则新字会掉回系统字体。

用法：
    python tools/subset-fonts.py <NotoSerifSC[wght].ttf> <bodoni-moda-latin-wght-italic.woff2>

源字体不放进仓库：
  - 思源宋体可变字体：https://github.com/google/fonts/tree/main/ofl/notoserifsc
  - Bodoni Moda 斜体：npm 包 @fontsource-variable/bodoni-moda 的 files/ 目录
依赖：pip install fonttools brotli
"""
import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts"

# 用宋体排的元素（见 css/style.css 里的 var(--serif)）
SERIF_CLASSES = {
    "title", "cover-line", "mv-name", "plain-h", "lead", "prose", "p-name", "mark",
    "gate-title", "gate-note", "resolved-big", "foot-list", "band",
}
SERIF_TAGS_IN = {"band": {"dt"}, "foot-list": {"a"}}
DISPLAY_CLASSES = {"title", "mv-name", "plain-h", "gate-title", "resolved-big"}
ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT = "，。、；：？！“”‘’（）《》〈〉【】…—·×°√π"


class Collect(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []  # (tag, classes)
        self.text = set()
        self.display = set()

    def handle_starttag(self, tag, attrs):
        cls = set((dict(attrs).get("class") or "").split())
        self.stack.append((tag, cls))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        serif = display = False
        for i, (tag, cls) in enumerate(self.stack):
            hit = cls & SERIF_CLASSES
            for c in hit:
                need = SERIF_TAGS_IN.get(c)
                if need is None or any(t in need for t, _ in self.stack[i:]):
                    serif = True
            if cls & DISPLAY_CLASSES:
                display = True
        if serif:
            self.text.update(data)
        if display:
            self.display.update(data)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    serif_src, italic_src = Path(sys.argv[1]), Path(sys.argv[2])
    OUT.mkdir(exist_ok=True)

    c = Collect()
    c.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    text, display = set(c.text), set(c.display)

    # 作品标题在 js/data.js 里；脚本里动态写进页面的宋体字也算上
    data = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    arr = json.loads(data[data.index("["): data.index("];") + 1])
    for w in arr:
        text.update(w["t"])
    text.update("基音对上了。")
    display.update("对上了。")

    text = {ch for ch in text if ch.strip()} | set(ASCII) | set(PUNCT)
    display = {ch for ch in display if ch.strip()}
    han = [ch for ch in text if "一" <= ch <= "鿿"]
    print(f"正文字重：{len(text)} 个字符（其中汉字 {len(han)}）；标题字重：{len(display)} 个字符")

    def cut(chars, wght, name):
        font = TTFont(serif_src)
        opts = subset.Options()
        opts.flavor = None
        opts.layout_features = ["kern", "liga", "vert", "vrt2", "palt", "locl"]
        opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(text="".join(sorted(chars)))
        sub.subset(font)
        font = instancer.instantiateVariableFont(font, {"wght": wght})
        font.flavor = "woff2"
        path = OUT / name
        font.save(path)
        print(f"  {name}: {path.stat().st_size / 1024:.0f} KB")

    cut(display, 900, "ResonanceSerif-Display.woff2")
    cut(text, (500, 700), "ResonanceSerif-Text.woff2")
    shutil.copyfile(italic_src, OUT / "ResonanceItalic.woff2")
    print(f"  ResonanceItalic.woff2: {(OUT / 'ResonanceItalic.woff2').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
