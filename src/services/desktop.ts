export interface DesktopPreferences { runInBackground: boolean; platform: string }
declare global {
  interface Window {
    lecturebagDesktop?: {
      version: number;
      signIn(): Promise<string>;
      cancelSignIn(): Promise<void>;
      onLoginCode(callback: (code: string) => void): () => void;
      openWeb(): Promise<void>;
      preferences(): Promise<DesktopPreferences>;
      setBackground(enabled: boolean): Promise<DesktopPreferences>;
      onPreferences(callback: (value: DesktopPreferences) => void): () => void;
      onWake(callback: () => void): () => void;
      isBackground(): boolean;
    };
  }
}
export const desktopBridge = () => typeof window === 'undefined' ? undefined : window.lecturebagDesktop;

export interface DesktopHandoff { port: number; state: string; challenge: string }
export function parseDesktopHandoff(hash: string): DesktopHandoff | undefined {
  if (!hash.startsWith('#desktop-login?') || hash.length > 512) return undefined;
  const query = new URLSearchParams(hash.slice('#desktop-login?'.length));
  if (['port', 'state', 'challenge'].some(key => query.getAll(key).length !== 1) || [...query.keys()].length !== 3) return undefined;
  const portText = query.get('port') || '', port = Number(portText);
  const state = query.get('state') || '', challenge = query.get('challenge') || '';
  if (!/^\d{4,5}$/.test(portText) || port < 1024 || port > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return undefined;
  return { port, state, challenge };
}
export function desktopCallback(handoff: DesktopHandoff, code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('로그인 응답을 확인하지 못했습니다.');
  return `http://127.0.0.1:${handoff.port}/callback?${new URLSearchParams({ state: handoff.state, code })}`;
}
export async function desktopVerificationCode(state: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)));
  return [...hash.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}
