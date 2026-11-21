import type { DriveAuthChallenge } from './types';
import { isNativeAndroid, native } from '../native';

interface CodeResponse { code?: string; error?: string }
interface PopupError { type?: string }
interface GoogleOAuth {
  initCodeClient(config: {
    client_id: string; scope: string; ux_mode: 'popup'; include_granted_scopes: boolean;
    prompt: 'consent';
    callback: (response: CodeResponse) => void; error_callback: (error: PopupError) => void;
  }): { requestCode(): void };
}

let loading: Promise<GoogleOAuth> | undefined;
const oauth = () => (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;

export function loadDriveOAuth(): Promise<GoogleOAuth | undefined> {
  if (isNativeAndroid()) return Promise.resolve(undefined);
  if (oauth()) return Promise.resolve(oauth()!);
  if (!loading) {
    loading = new Promise<GoogleOAuth>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timeout = window.setTimeout(fail, 15_000);
      function fail() {
        window.clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new Error('Google 연결 화면을 불러오지 못했습니다.'));
      }
      script.onerror = fail;
      script.onload = () => {
        window.clearTimeout(timeout);
        if (!oauth()) { fail(); return; }
        resolve(oauth()!);
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Call synchronously from a click, after loading the script and server challenge. */
export function requestDriveCode(challenge: DriveAuthChallenge, signal: AbortSignal): Promise<string> {
  if (isNativeAndroid()) {
    signal.throwIfAborted();
    return native.authorizeDrive({ clientId: challenge.clientId }).then(result => {
      signal.throwIfAborted();
      return result.code;
    });
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const api = oauth();
    if (!api) { reject(new Error('Google 연결 화면을 준비 중입니다.')); return; }
    let settled = false;
    const finish = (code?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (code) resolve(code); else reject(error || new Error('Drive 연결이 취소되었습니다.'));
    };
    const abort = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    const timeout = window.setTimeout(() => finish(undefined, new Error('연결 시간이 초과됐습니다. 다시 시도해 주세요.')), 240_000);
    signal.addEventListener('abort', abort, { once: true });
    try {
      api.initCodeClient({
        client_id: challenge.clientId,
        scope: 'openid email https://www.googleapis.com/auth/drive.file',
        // The backend needs a refresh token for uploads and reconciliation
        // after this popup has closed. Google may omit it for an account that
        // granted this client before unless consent is requested explicitly.
        prompt: 'consent',
        include_granted_scopes: false, ux_mode: 'popup',
        callback: response => finish(response.error ? undefined : response.code,
          response.error ? new Error(`Google Drive 권한 요청 실패 (${response.error.replace(/[^a-z_]/gi, '').slice(0, 60) || 'unknown'})`) : undefined),
        error_callback: error => finish(undefined, new Error(`Google Drive 팝업을 완료하지 못했습니다 (${(error.type || 'unknown').replace(/[^a-z_]/gi, '').slice(0, 60)}).`)),
      }).requestCode();
    } catch { finish(); }
  });
}

export function startDriveRedirect(challenge: DriveAuthChallenge, uid: string) {
  sessionStorage.setItem('lecturebag-drive-oauth', JSON.stringify({ state: challenge.state, uid }));
  const params = new URLSearchParams({ client_id: challenge.clientId, redirect_uri: `${location.origin}/drive-auth-callback`,
    response_type: 'code', scope: 'openid email https://www.googleapis.com/auth/drive.file',
    access_type: 'offline', prompt: 'consent', state: challenge.state });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
