#!/usr/bin/env python3
"""Turn the fly image into the sizes the listings and the X account want, keeping its transparency.

    pip install pillow
    python3 make_assets.py fly.png

Writes into ./assets:
    naff_logo_512.png      square logo, transparent background (Blockscout / DexScreener / CoinGecko)
    naff_logo_512_dark.png the same on black, for forms that reject transparency
    naff_logo_256.png      smaller square logo
    naff_x_avatar_400.png  tighter crop on the fly for the X profile picture, on black
    naff_x_banner.png      1500x500 X header: fly on the right, text on the left
    naff_og_1200x630.png   share card for the site link
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

NAME = "NOT A FRUIT FLY"
TICKER = "$NOTAFRUITFLY"
LINE = "flybrain is a fruit fly. this is not."
CHAIN = "Robinhood Chain  ·  bondli.fun"
GREEN = (120, 255, 90)


def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                 "C:/Windows/Fonts/arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def fit_square(im, size, pad=0.08, bg=None):
    """The whole fly, centred in a square with a margin, on a transparent or solid ground."""
    w, h = im.size
    s = int(size * (1 - 2 * pad))
    scale = min(s / w, s / h)
    fly = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    out.paste(fly, ((size - fly.size[0]) // 2, (size - fly.size[1]) // 2), fly)
    return out


def main(src):
    os.makedirs("assets", exist_ok=True)
    im = Image.open(src).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    fit_square(im, 512).save("assets/naff_logo_512.png", optimize=True)
    fit_square(im, 512, bg=(0, 0, 0, 255)).convert("RGB").save("assets/naff_logo_512_dark.png", optimize=True)
    fit_square(im, 256).save("assets/naff_logo_256.png", optimize=True)
    # avatar: the head end of the fly, larger, on black
    w, h = im.size
    head = im.crop((int(w * 0.30), 0, w, int(h * 0.85)))
    fit_square(head, 400, pad=0.04, bg=(0, 0, 0, 255)).convert("RGB").save("assets/naff_x_avatar_400.png", optimize=True)
    # banner 1500x500
    banner = Image.new("RGBA", (1500, 500), (0, 0, 0, 255))
    banner.paste(fit_square(im, 480, pad=0.05), (1000, 10), fit_square(im, 480, pad=0.05))
    d = ImageDraw.Draw(banner)
    d.text((70, 120), NAME, font=font(80), fill=(255, 255, 255))
    d.text((70, 225), TICKER, font=font(66), fill=GREEN)
    d.text((70, 330), LINE, font=font(34), fill=(200, 200, 200))
    d.text((70, 395), CHAIN, font=font(28), fill=(140, 140, 140))
    banner.convert("RGB").save("assets/naff_x_banner.png", optimize=True)
    # share card 1200x630
    og = Image.new("RGBA", (1200, 630), (20, 20, 22, 255))
    og.paste(fit_square(im, 560, pad=0.05), (620, 35), fit_square(im, 560, pad=0.05))
    d = ImageDraw.Draw(og)
    d.text((60, 170), "NOT A", font=font(96), fill=(255, 255, 255))
    d.text((60, 275), "FRUIT FLY", font=font(96), fill=(255, 255, 255))
    d.text((60, 400), TICKER, font=font(44), fill=GREEN)
    d.text((60, 470), CHAIN, font=font(28), fill=(140, 140, 140))
    og.convert("RGB").save("assets/naff_og_1200x630.png", optimize=True)
    print("wrote assets/: naff_logo_512.png, naff_logo_512_dark.png, naff_logo_256.png, naff_x_avatar_400.png, naff_x_banner.png, naff_og_1200x630.png")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 make_assets.py <source image>")
    main(sys.argv[1])
