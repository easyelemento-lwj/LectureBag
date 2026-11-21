/** Android's bundled UI does not load scripts, frames or workers from the network. */
export function androidSecurityPolicy(backend: string): string {
  const url = new URL(backend);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Android API 주소는 인증 정보 없는 HTTPS URL이어야 합니다.');
  }
  return [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com", "font-src 'self' data:",
    "media-src 'self' blob: data:", "object-src 'none'", "base-uri 'none'",
    "frame-src 'none'", "child-src 'none'", "worker-src 'none'", "form-action 'none'",
    `connect-src 'self' ${url.origin} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com`,
  ].join('; ');
}
