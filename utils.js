// utils.js — Favicon Changer v1.0.0
// Shared utilities for image processing

/**
 * Read a File object and return a base64 data URL, resized to maxSize×maxSize.
 */
function fileToDataUrl(file, maxSize = 64) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch an image from a URL and return a resized data URL.
 */
async function urlToDataUrl(url, maxSize = 64) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return fileToDataUrl(blob, maxSize);
}

/**
 * Truncate a string for display.
 */
function truncate(str, max = 50) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}
