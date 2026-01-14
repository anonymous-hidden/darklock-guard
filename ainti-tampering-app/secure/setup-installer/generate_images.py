"""
Generate Darklock-branded images for Inno Setup installer.
Creates wizard sidebar and header images with dark purple theme.
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Darklock colors
BG_DARK = (10, 10, 15)          # #0a0a0f
BG_CARD = (22, 22, 31)          # #16161f
PURPLE = (124, 58, 237)         # #7c3aed
PURPLE_LIGHT = (167, 139, 250)  # #a78bfa
TEXT_WHITE = (255, 255, 255)
TEXT_MUTED = (160, 160, 176)

def create_wizard_image():
    """Create the large sidebar image (164x314 pixels)."""
    width, height = 164, 314
    img = Image.new('RGB', (width, height), BG_DARK)
    draw = ImageDraw.Draw(img)
    
    # Purple gradient stripe on left
    for i in range(8):
        alpha = int(255 * (1 - i/8))
        color = (
            int(PURPLE[0] * alpha / 255),
            int(PURPLE[1] * alpha / 255),
            int(PURPLE[2] * alpha / 255)
        )
        draw.line([(i, 0), (i, height)], fill=color)
    
    # Diamond icon
    cx, cy = width // 2, 60
    size = 20
    diamond = [
        (cx, cy - size),      # top
        (cx + size, cy),      # right
        (cx, cy + size),      # bottom
        (cx - size, cy)       # left
    ]
    draw.polygon(diamond, fill=PURPLE)
    
    # Inner diamond (highlight)
    inner_size = 10
    inner_diamond = [
        (cx, cy - inner_size),
        (cx + inner_size, cy),
        (cx, cy + inner_size),
        (cx - inner_size, cy)
    ]
    draw.polygon(inner_diamond, fill=PURPLE_LIGHT)
    
    # Text - Darklock
    try:
        font_large = ImageFont.truetype("segoeui.ttf", 18)
        font_small = ImageFont.truetype("segoeui.ttf", 11)
    except:
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()
    
    draw.text((width//2, 100), "DARKLOCK", fill=TEXT_WHITE, font=font_large, anchor="mm")
    
    # Tagline
    draw.text((width//2, 130), "Security Suite", fill=TEXT_MUTED, font=font_small, anchor="mm")
    
    # Decorative lines
    draw.line([(30, 160), (width-30, 160)], fill=PURPLE, width=1)
    
    # Version info at bottom
    draw.text((width//2, height-40), "v2.0.0", fill=TEXT_MUTED, font=font_small, anchor="mm")
    draw.text((width//2, height-20), "Enterprise Edition", fill=PURPLE_LIGHT, font=font_small, anchor="mm")
    
    return img

def create_small_wizard_image():
    """Create the small header image (55x55 pixels)."""
    size = 55
    img = Image.new('RGB', (size, size), BG_DARK)
    draw = ImageDraw.Draw(img)
    
    # Diamond icon centered
    cx, cy = size // 2, size // 2
    d_size = 18
    diamond = [
        (cx, cy - d_size),
        (cx + d_size, cy),
        (cx, cy + d_size),
        (cx - d_size, cy)
    ]
    draw.polygon(diamond, fill=PURPLE)
    
    # Inner highlight
    inner = 9
    inner_diamond = [
        (cx, cy - inner),
        (cx + inner, cy),
        (cx, cy + inner),
        (cx - inner, cy)
    ]
    draw.polygon(inner_diamond, fill=PURPLE_LIGHT)
    
    return img

def main():
    output_dir = "assets"
    os.makedirs(output_dir, exist_ok=True)
    
    # Create wizard image (sidebar)
    wizard_img = create_wizard_image()
    wizard_img.save(os.path.join(output_dir, "wizard_image.bmp"), "BMP")
    print(f"Created: {output_dir}/wizard_image.bmp (164x314)")
    
    # Create small wizard image (header)
    small_img = create_small_wizard_image()
    small_img.save(os.path.join(output_dir, "wizard_small.bmp"), "BMP")
    print(f"Created: {output_dir}/wizard_small.bmp (55x55)")
    
    print("\nDarklock installer images generated!")

if __name__ == "__main__":
    main()
