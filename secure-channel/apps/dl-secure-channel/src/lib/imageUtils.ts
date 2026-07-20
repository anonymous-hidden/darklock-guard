/**
 * imageUtils — Shared image processing helpers.
 * Centre-crop, resize, and compress images via canvas.
 */

/** Centre-crop and resize a file to targetW × targetH, returns a JPEG data URL. */
export function resizeImage(
  file: File,
  targetW: number,
  targetH?: number,
  quality = 0.85,
): Promise<string> {
  const h = targetH ?? targetW; // square if height omitted
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        const srcRatio = img.width / img.height;
        const dstRatio = targetW / h;
        let sx = 0,
          sy = 0,
          sw = img.width,
          sh = img.height;
        if (srcRatio > dstRatio) {
          sw = img.height * dstRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / dstRatio;
          sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/** Validate an image file for type + size. Returns error string or null. */
export function validateImageFile(
  file: File,
  maxMb = 8,
): string | null {
  if (!file.type.startsWith("image/")) {
    return "File is not a valid image";
  }
  if (file.size > maxMb * 1024 * 1024) {
    return `Image too large (max ${maxMb} MB)`;
  }
  return null;
}

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
