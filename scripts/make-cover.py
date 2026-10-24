#!/usr/bin/env python3
"""Turn a picture into a DSH theme cover (1180x604, file size + mean RGB).

    python3 make-cover.py poster.jpg cover.jpg --crop 150,90,1536,1090 --vignette 0.45
    python3 make-cover.py keyart.png cover.jpg --duotone cold --vignette 0.4

The app paints the cover behind a scrim, so the useful knobs are: how much of
the source to keep (--crop), how dark the edges go (--vignette) and, for an
existing key art that needs to belong to another palette, --duotone.
"""
import argparse
import colorsys
import os
import sys

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

TARGET = (1180, 604)  # Cover aspect ratio is approximately 1.954:1.
COLD = [
    (0, (4, 8, 16)),
    (60, (12, 26, 54)),
    (130, (32, 86, 170)),
    (195, (120, 180, 245)),
    (255, (240, 249, 255)),
]
WARM = [
    (0, (7, 4, 4)),
    (70, (34, 16, 10)),
    (140, (120, 44, 18)),
    (200, (226, 120, 62)),
    (255, (255, 236, 224)),
]


def gradient_lut(stops):
    lut = []
    for value in range(256):
        for i in range(len(stops) - 1):
            lo, clo = stops[i]
            hi, chi = stops[i + 1]
            if lo <= value <= hi:
                t = (value - lo) / (hi - lo)
                lut.append(tuple(round(clo[k] + (chi[k] - clo[k]) * t) for k in range(3)))
                break
        else:
            lut.append(stops[-1][1])
    return lut


def duotone(image, stops):
    grey = ImageOps.grayscale(image)
    grey = ImageEnhance.Contrast(grey).enhance(1.10).filter(ImageFilter.SMOOTH_MORE)
    # lift midtones: the UI scrim eats roughly a quarter of the luminance
    grey = grey.point(lambda v: min(255, int(255 * (v / 255) ** 0.84 + 6)))
    lut = gradient_lut(stops)
    out = Image.new("RGB", grey.size)
    out.putdata([lut[p] for p in grey.getdata()])
    return out


def vignette(image, strength):
    if strength <= 0:
        return image
    w, h = image.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([-w * 0.55, -h * 0.65, w * 1.55, h * 1.65], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(160))
    darkest = Image.blend(image, Image.new("RGB", (w, h), (5, 8, 14)), strength)
    return Image.composite(image, darkest, mask)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("output")
    ap.add_argument("--crop", help="x0,y0,x1,y1 in source pixels (default: full frame)")
    ap.add_argument("--duotone", choices=["cold", "warm"], help="re-map luminance onto a palette")
    ap.add_argument("--vignette", type=float, default=0.4, help="0..1 edge darkening (default 0.4)")
    ap.add_argument("--saturation", type=float, default=0.95)
    ap.add_argument("--quality", type=int, default=78)
    args = ap.parse_args()

    if not 0 <= args.vignette <= 1:
        ap.error("--vignette must be between 0 and 1")
    if not 1 <= args.quality <= 100:
        ap.error("--quality must be between 1 and 100")
    with Image.open(args.source) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if args.crop:
        box = tuple(int(v) for v in args.crop.split(","))
        if len(box) != 4:
            sys.exit("--crop wants x0,y0,x1,y1")
        image = image.crop(box)

    ratio = TARGET[0] / TARGET[1]
    width, height = image.size
    if width / height > ratio:
        keep = int(height * ratio)
        image = image.crop(((width - keep) // 2, 0, (width + keep) // 2, height))
    else:
        keep = int(width / ratio)
        image = image.crop((0, 0, width, keep))

    image = image.resize(TARGET, Image.LANCZOS)
    if args.duotone:
        image = duotone(image, COLD if args.duotone == "cold" else WARM)
    image = ImageEnhance.Color(image).enhance(args.saturation)
    image = image.filter(ImageFilter.UnsharpMask(radius=2, percent=45, threshold=3))
    image = vignette(image, args.vignette)
    image.save(args.output, quality=args.quality, optimize=True, progressive=True)

    mean = sum(sum(p) for p in image.resize((48, 48)).getdata()) / (3 * 48 * 48)
    print("wrote %s (%d KB, mean RGB %.0f)" % (args.output, os.path.getsize(args.output) // 1024, mean))
    print("  aim for mean 70-110: brighter art needs a denser --dsw-alias-bg-base alpha,")
    print("  darker art needs a looser one (see SKILL.md, '首页图').")


if __name__ == "__main__":
    main()
