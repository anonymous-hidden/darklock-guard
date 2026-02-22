#!/usr/bin/env python3
"""
Generate all Tauri icon variants from a source PNG.
Usage: python3 scripts/generate-icons.py /path/to/source.png
"""
import sys
import os
import struct
import zlib
import shutil
from pathlib import Path
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/home/cayden/Pictures/darklock.png"
ICONS_DIR = Path(__file__).parent.parent / "guard-v2/desktop/src-tauri/icons"

def resize(img: Image.Image, size: int, square=True) -> Image.Image:
    """Resize to square canvas, centering the image with transparent padding."""
    img = img.convert("RGBA")
    if square:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # Fit inside the square preserving aspect ratio
        img.thumbnail((size, size), Image.LANCZOS)
        offset = ((size - img.width) // 2, (size - img.height) // 2)
        canvas.paste(img, offset, img)
        return canvas
    else:
        img.thumbnail((size, size), Image.LANCZOS)
        return img

def save_png(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(path), "PNG", optimize=True)
    print(f"  ✓ {path.relative_to(ICONS_DIR.parent.parent.parent)}")

def make_ico(src_img: Image.Image, path: Path):
    """Build a multi-resolution .ico file manually."""
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = []
    for s in sizes:
        pil = resize(src_img, s)
        import io
        buf = io.BytesIO()
        pil.save(buf, "PNG")
        images.append(buf.getvalue())

    # ICO header: ICONDIR
    num = len(images)
    ico_data = struct.pack("<HHH", 0, 1, num)  # reserved, type=1(ico), count
    # Each ICONDIRENTRY is 16 bytes
    offset = 6 + num * 16
    entries = b""
    for i, (s, data) in enumerate(zip(sizes, images)):
        w = s if s < 256 else 0
        h = s if s < 256 else 0
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path), "wb") as f:
        f.write(ico_data + entries + b"".join(images))
    print(f"  ✓ {path.name}")

def make_icns(src_img: Image.Image, path: Path):
    """Build a minimal .icns file using available sizes."""
    # icns type codes and sizes
    icons = [
        (b'icp4', 16),
        (b'icp5', 32),
        (b'icp6', 64),
        (b'ic07', 128),
        (b'ic08', 256),
        (b'ic09', 512),
        (b'ic10', 1024),
    ]
    import io
    chunks = b""
    for type_code, size in icons:
        pil = resize(src_img, size)
        buf = io.BytesIO()
        pil.save(buf, "PNG")
        data = buf.getvalue()
        chunk_len = 8 + len(data)
        chunks += type_code + struct.pack(">I", chunk_len) + data

    total = 8 + len(chunks)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path), "wb") as f:
        f.write(b"icns" + struct.pack(">I", total) + chunks)
    print(f"  ✓ {path.name}")

def make_android_icons(src_img: Image.Image, base: Path):
    """Generate Android mipmap icons."""
    densities = {
        "mipmap-mdpi":    48,
        "mipmap-hdpi":    72,
        "mipmap-xhdpi":   96,
        "mipmap-xxhdpi":  144,
        "mipmap-xxxhdpi": 192,
        "mipmap-anydpi-v26": 108,
    }
    for density, size in densities.items():
        folder = base / density
        save_png(resize(src_img, size), folder / "ic_launcher.png")
        save_png(resize(src_img, size), folder / "ic_launcher_round.png")
        if density == "mipmap-anydpi-v26":
            save_png(resize(src_img, size), folder / "ic_launcher_foreground.png")

def make_ios_icons(src_img: Image.Image, base: Path):
    """Generate iOS AppIcon set."""
    configs = [
        ("AppIcon-20x20@1x.png",    20),
        ("AppIcon-20x20@2x.png",    40),
        ("AppIcon-20x20@2x-1.png",  40),
        ("AppIcon-20x20@3x.png",    60),
        ("AppIcon-29x29@1x.png",    29),
        ("AppIcon-29x29@2x.png",    58),
        ("AppIcon-29x29@2x-1.png",  58),
        ("AppIcon-29x29@3x.png",    87),
        ("AppIcon-40x40@1x.png",    40),
        ("AppIcon-40x40@2x.png",    80),
        ("AppIcon-40x40@2x-1.png",  80),
        ("AppIcon-40x40@3x.png",   120),
        ("AppIcon-512@2x.png",    1024),
        ("AppIcon-60x60@2x.png",   120),
        ("AppIcon-60x60@3x.png",   180),
        ("AppIcon-76x76@1x.png",    76),
        ("AppIcon-76x76@2x.png",   152),
        ("AppIcon-83.5x83.5@2x.png", 167),
    ]
    for filename, size in configs:
        save_png(resize(src_img, size), base / filename)

def main():
    print(f"\n🎨 Generating Darklock icons from: {SRC}")
    print(f"   Target: {ICONS_DIR}\n")

    src = Image.open(SRC).convert("RGBA")

    # --- Standard PNG sizes ---
    standard = [
        ("32x32.png",       32),
        ("128x128.png",    128),
        ("128x128@2x.png", 256),
        ("icon.png",       512),
        ("512x512.png",    512),
        ("256x256.png",    256),
        ("64x64.png",       64),
        ("48x48.png",       48),
        ("32x32.png",       32),
        ("24x24.png",       24),
        ("16x16.png",       16),
        ("icon-master.png", 512),
    ]
    for filename, size in standard:
        save_png(resize(src, size), ICONS_DIR / filename)

    # --- Windows Square logos ---
    square_logos = {
        "Square30x30Logo.png":   30,
        "Square44x44Logo.png":   44,
        "Square71x71Logo.png":   71,
        "Square89x89Logo.png":   89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png":          50,
    }
    for filename, size in square_logos.items():
        save_png(resize(src, size), ICONS_DIR / filename)

    # --- ICO (Windows) ---
    print("\n  Building icon.ico...")
    make_ico(src, ICONS_DIR / "icon.ico")

    # --- ICNS (macOS) ---
    print("  Building icon.icns...")
    make_icns(src, ICONS_DIR / "icon.icns")

    # --- Android ---
    print("\n  Building Android icons...")
    make_android_icons(src, ICONS_DIR / "android")

    # --- iOS ---
    print("\n  Building iOS icons...")
    make_ios_icons(src, ICONS_DIR / "ios")

    print("\n✅ All icons generated successfully!\n")

if __name__ == "__main__":
    main()
