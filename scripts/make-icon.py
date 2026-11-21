#!/usr/bin/env python3
"""Draws build/icon.png (1024x1024), the app icon used for every platform.

electron-builder converts it to .icns (macOS), .ico (Windows) and Linux sizes.
Requires Pillow:  pip install pillow
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SIZE = 1024
SS = 4                      # supersampling for smooth edges
S = SIZE * SS
CORAL, VIOLET = (255, 122, 89), (139, 92, 246)

# Rounded square on a transparent canvas (macOS icon grid: 824 px body, 100 px margin)
inset, radius = 100 * SS, 185 * SS
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((inset, inset, S - inset, S - inset), radius, fill=255)

# Diagonal coral -> violet gradient
grad = Image.linear_gradient("L").resize((S, S)).rotate(-45, expand=False, fillcolor=128)
body = Image.composite(Image.new("RGB", (S, S), VIOLET), Image.new("RGB", (S, S), CORAL), grad)

# Soft glass highlight in the top-left
glow = Image.new("L", (S, S), 0)
ImageDraw.Draw(glow).ellipse((-0.15 * S, -0.35 * S, 0.85 * S, 0.45 * S), fill=70)
glow = glow.filter(ImageFilter.GaussianBlur(60 * SS))
body = Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), body, glow)

icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
icon.paste(body, (0, 0), mask)

# Thin bright rim
rim = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(rim)
d.rounded_rectangle((inset, inset, S - inset, S - inset), radius, outline=150, width=6 * SS)
rim = ImageChops.multiply(rim, mask)
icon.paste((255, 255, 255, 255), (0, 0), rim)

# Timer ring: faint full track + bright 25-of-30-minutes arc + end dot
ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))  # separate layer so alpha blends
draw = ImageDraw.Draw(ring)
c, r, w = S / 2, 250 * SS, 54 * SS
box = (c - r, c - r, c + r, c + r)
draw.ellipse(box, outline=(255, 255, 255, 70), width=w)
start, end = -90, -90 + 360 * 25 / 30
draw.arc(box, start, end, fill=(255, 255, 255, 255), width=w)
import math
for ang in (start, end):  # round caps
    a = math.radians(ang)
    x, y = c + (r - w / 2) * math.cos(a), c + (r - w / 2) * math.sin(a)
    draw.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=(255, 255, 255, 255))
icon = Image.alpha_composite(icon, ring)

out = Path(__file__).resolve().parent.parent / "build" / "icon.png"
out.parent.mkdir(exist_ok=True)
icon.resize((SIZE, SIZE), Image.LANCZOS).save(out)
print(f"wrote {out}")
