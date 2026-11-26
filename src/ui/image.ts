import { MAX_IMAGE_CHARS } from "@/core/protocol";

/**
 * Shrinks a pasted or picked image into a data URL that fits one chat message: at most 1280 px on
 * the long side, re-encoded as WebP (JPEG where WebP isn't supported), stepping quality and size
 * down until it fits. Animated GIFs become a still frame.
 */
export async function shrinkImage(file: Blob, maxChars = MAX_IMAGE_CHARS): Promise<{ data: string; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be attached");
  const bitmap = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images");
  let side = 1280;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    // Transparent areas would turn black in JPEG: paint white underneath.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      let data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= maxChars) return { data, width: canvas.width, height: canvas.height };
    }
    side = Math.round(side * 0.75);
  }
  throw new Error("This image is too large to send");
}

async function loadBitmap(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The first image in a paste or drop, if any. */
export function imageFrom(items: DataTransferItemList | null | undefined): File | null {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
