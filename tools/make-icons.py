#!/usr/bin/env python3
"""Draw the FZER0 toolbar icons.

The mark is the instrument: a dark dial face with the red needle resting
where a comfortable speaking level sits. At 16px almost nothing survives —
the arc and the needle do, because they are the only two shapes.

Run from the repo root:  python3 tools/make-icons.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
SIZES = (16, 32, 48, 128)

# Drawn at 8x and downsampled — the cheapest way to get clean curves without
# antialiasing support in ImageDraw.
SUPERSAMPLE = 8

FACE = (32, 36, 41, 255)      # near-black, the dial's ground
SCALE = (233, 236, 240, 255)  # the printed arc and ticks
NEEDLE = (211, 47, 47, 255)   # the same red as the panel's needle
TRANSPARENT = (0, 0, 0, 0)

# Where the needle points: just left of centre, the way a VU meter sits at a
# comfortable level rather than pinned or dead.
NEEDLE_DEGREES = 118


def draw_icon(size: int) -> Image.Image:
    s = size * SUPERSAMPLE
    image = Image.new("RGBA", (s, s), TRANSPARENT)
    draw = ImageDraw.Draw(image)

    # A rounded square, not a circle: it reads as an app tile at 16px and
    # keeps its silhouette against Chrome's toolbar.
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=FACE)

    cx, cy = s / 2, s * 0.70
    radius = s * 0.34
    width = max(1, int(s * 0.035))

    # The scale: a half-circle arc with a tick at each end and one at the top.
    draw.arc(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        start=180,
        end=360,
        fill=SCALE,
        width=width,
    )
    for degrees in (180, 270, 360):
        angle = math.radians(degrees)
        inner = radius * 0.74
        draw.line(
            [
                cx + inner * math.cos(angle),
                cy + inner * math.sin(angle),
                cx + radius * math.cos(angle),
                cy + radius * math.sin(angle),
            ],
            fill=SCALE,
            width=width,
        )

    # The needle, from the hub out past the scale.
    angle = math.radians(180 + NEEDLE_DEGREES)
    draw.line(
        [cx, cy, cx + radius * 1.02 * math.cos(angle), cy + radius * 1.02 * math.sin(angle)],
        fill=NEEDLE,
        width=max(1, int(s * 0.05)),
    )
    hub = s * 0.045
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=NEEDLE)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}.png"
        draw_icon(size).save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(OUT.parent.parent)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
