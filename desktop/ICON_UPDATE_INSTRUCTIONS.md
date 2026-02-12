# Tauri Icon Update Instructions

## Current Status
The Darklock Guard desktop app logo component has been updated in the source code:
- ✅ Created `/guard-v2/desktop/src/components/DarklockLogo.tsx`
- ✅ Updated `Layout.tsx` to use the new logo component
- ⚠️ Tauri app icons (PNG) need manual conversion

## Icon Files to Update

The following PNG icon files in `/guard-v2/desktop/src-tauri/icons/` need to be regenerated:
- `icon.png` (default)
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`

## How to Generate Icons

### Option 1: Using Tauri Icon Command (Recommended)
```bash
cd guard-v2/desktop
npm install -g @tauri-apps/cli
tauri icon path/to/source-icon.png
```

### Option 2: Manual Conversion
Use the master SVG at `/assets/brand/darklock-logo.svg` and convert to PNG at required sizes using:
- Online tool: https://cloudconvert.com/svg-to-png
- Inkscape: File → Export PNG Image
- GIMP: Open SVG, scale, export as PNG

### Required Sizes
- 32x32px - Small icon
- 128x128px - Standard icon
- 256x256px - High DPI icon (saved as 128x128@2x.png)
- 512x512px or 1024x1024px - Source icon (icon.png)

## Alternative: SVG-to-PNG Script
If you have ImageMagick installed:
```bash
convert -background none -density 300 assets/brand/darklock-logo.svg -resize 32x32 guard-v2/desktop/src-tauri/icons/32x32.png
convert -background none -density 300 assets/brand/darklock-logo.svg -resize 128x128 guard-v2/desktop/src-tauri/icons/128x128.png
convert -background none -density 300 assets/brand/darklock-logo.svg -resize 256x256 guard-v2/desktop/src-tauri/icons/128x128@2x.png
convert -background none -density 300 assets/brand/darklock-logo.svg -resize 512x512 guard-v2/desktop/src-tauri/icons/icon.png
```

## Verification
After updating icons:
1. Rebuild the Tauri app: `npm run tauri build`
2. Check system tray icon
3. Check window icon
4. Check installer icon (Windows/Mac)
