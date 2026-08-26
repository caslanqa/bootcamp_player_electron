"""Turn the supplied artwork into build/icon.png for electron-builder.

The source is a rounded-square icon painted on an opaque white canvas. Left as
is, macOS/Windows would show a white tile behind the artwork, so the white
surround is flood-filled to transparency from the four corners. The fill cannot
reach the interior (the dark rounded rect separates it), so the near-white play
triangle and the cap highlights are safe.
"""

import sys
from PIL import Image, ImageDraw

SRC, DST = sys.argv[1], sys.argv[2]
SIZE = 1024
SENTINEL = (255, 0, 255)  # not present in the artwork
THRESH = 60  # also eats most of the white/dark anti-aliased fringe

img = Image.open(SRC).convert("RGB")
w, h = img.size

for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
    if img.getpixel(corner) != SENTINEL:
        ImageDraw.floodfill(img, corner, SENTINEL, thresh=THRESH)

rgba = img.convert("RGBA")
pixels = rgba.load()
cleared = 0
for y in range(h):
    for x in range(w):
        r, g, b, _ = pixels[x, y]
        if (r, g, b) == SENTINEL:
            # Zero the colour too, so downsampling cannot bleed magenta in.
            pixels[x, y] = (0, 0, 0, 0)
            cleared += 1

out = rgba.resize((SIZE, SIZE), Image.LANCZOS)
out.save(DST, "PNG")

pct = 100 * cleared / (w * h)
alpha = out.getchannel("A")
print(f"source {w}x{h} -> {SIZE}x{SIZE}")
print(f"made transparent: {cleared} px ({pct:.1f}%)")
print(f"alpha range: {alpha.getextrema()}")
print(f"centre pixel: {out.getpixel((SIZE // 2, SIZE // 2))}")
print(f"corner pixel: {out.getpixel((2, 2))}")
