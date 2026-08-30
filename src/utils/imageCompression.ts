/**
 * imageCompression.ts
 *
 * Provides a highly optimized image compression strategy.
 * Detects if the browser supports WebP encoding via Canvas.
 * - If supported (Chrome/Android/PC): Uses WebP at 0.75 quality (~55% reduction).
 * - If not supported (Safari/iOS): Falls back to JPEG at 0.75 quality (~25% reduction).
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
  const quality = 0.75;
  
  if (isWebPEncodingSupported()) {
    // Highest compression, safe to use WebP
    return canvas.toDataURL('image/webp', quality);
  } else {
    // iOS Safari / App Store WebView fallback
    // Prevents massive PNG inflations, saves ~25% over 0.92 JPEG
    return canvas.toDataURL('image/jpeg', quality);
  }
}
