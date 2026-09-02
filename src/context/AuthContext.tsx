/**
 * AuthContext.tsx — 전역 인증 상태 관리 Context
 *
 * 보안 설계:
 *  - signInWithGoogle: 구글 팝업 방식 (PKCE + CSRF State 자동 관리)
 *  - getIdToken(forceRefresh=true): 백엔드 API 호출 시 사용. 항상 최신 토큰 보장.
 *  - 로그아웃 시 메모리 상의 사용자 정보 즉시 초기화.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../utils/firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** 현재 로그인한 사용자. null이면 미로그인 상태. */
  user: User | null;
  /** Firebase Auth 상태 초기 복원 중 여부. true 동안은 로그인/미로그인 판단 불가. */
  loading: boolean;
  /** Firebase 환경변수가 올바르게 설정되어 있는지 여부. */
  isConfigured: boolean;
  /** Google 팝업 로그인 실행. 실패 시 에러 메시지 반환. */
  signInWithGoogle: () => Promise<{ error?: string }>;
  /** 로그아웃 */
  signOut: () => Promise<void>;
  /**
   * 백엔드 API 호출 시 사용할 Firebase ID Token (JWT) 반환.
   * 토큰이 만료된 경우 자동으로 갱신하여 반환합니다.
   */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Firebase Auth 상태 리스너 — 새로고침 후 세션 복원 처리
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  /** Google 팝업 로그인 */
  const signInWithGoogle = useCallback(async (): Promise<{ error?: string }> => {
    if (!isFirebaseConfigured) {
      return {
        error:
          'Firebase 설정값이 입력되지 않았습니다.\n' +
          '.env 파일에 VITE_FIREBASE_* 환경변수를 등록해 주세요.',
      };
    }
    try {
      await signInWithPopup(auth, googleProvider);
      return {};
    } catch (err: any) {
      // 사용자가 직접 팝업을 닫은 경우 — 에러 아님
      if (err?.code === 'auth/popup-closed-by-user') return {};
      console.error('[Auth] Google sign-in failed:', err);
      return { error: `로그인에 실패했습니다: ${err?.message ?? '알 수 없는 오류'}` };
    }
  }, []);

  /** 로그아웃 — Firebase 세션 및 메모리 상태 즉시 초기화 */
  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
    } catch (err) {
      console.error('[Auth] Sign-out failed:', err);
    }
  }, []);

  /**
   * 백엔드 요청 시 사용할 최신 ID Token 반환.
   * forceRefresh=true: 캐시된 만료 토큰이 아닌 항상 최신 토큰 요청.
   */
  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    try {
      return await user.getIdToken(/* forceRefresh */ true);
    } catch (err) {
      console.error('[Auth] Failed to get ID token:', err);
      return null;
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{ user, loading, isConfigured: isFirebaseConfigured, signInWithGoogle, signOut, getIdToken }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * AuthContext에서 인증 상태를 가져옵니다.
 * AuthProvider 하위에서만 사용 가능합니다.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used within an <AuthProvider>.');
  }
  return ctx;
}
