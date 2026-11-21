/**
 * imageCompression.ts
 *
 * Preserve lecture text with high-quality WebP, or JPEG where unavailable.
 */

let _webpSupportCache: boolean | null = null;

/**
 * Checks if the current browser supports encoding 'image/webp' from a canvas.
 * iOS Safari/WKWebView silently falls back to PNG when requesting WebP.
 * We can detect this by checking the prefix of the returned Data URL.
 */
function isWebPEncodingSupported(): boolean {
  if (_webpSupportCache !== null) return _webpSupportCache;
  
  if (typeof document === 'undefined') {
    return false; // Server-side rendering safeguard
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const dataUrl = canvas.toDataURL('image/webp');
  
  _webpSupportCache = dataUrl.startsWith('data:image/webp');
  return _webpSupportCache;
}

/**
 * Compresses a canvas into a highly optimized base64 data URL.
 * Safely handles iOS WebP-to-PNG fallback bugs.
 */
export function compressImage(canvas: HTMLCanvasElement): string {
  const quality = 0.92;
  
  if (isWebPEncodingSupported()) {
    // Keep text edges readable while retaining browser-supported compression.
    return canvas.toDataURL('image/webp', quality);
  } else {
    // iOS Safari / App Store WebView fallback
    // Avoid the implicit PNG fallback on unsupported browsers.
    return canvas.toDataURL('image/jpeg', quality);
  }
}
