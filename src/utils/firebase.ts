/**
 * firebase.ts — Firebase 초기화 및 Auth 인스턴스 설정
 *
 * 보안 설계 원칙:
 *  1. API Key는 VITE_ 환경변수로만 주입 — 소스코드에 하드코딩 금지.
 *  2. Google Cloud Console에서 이 API Key에 HTTP Referrer 도메인 제한 필수 설정.
 *  3. Firebase Authentication 콘솔에서 Authorized Domains 화이트리스트 유지.
 *  4. ID Token은 Firebase SDK 내부 스토리지(IndexedDB)에서 안전하게 관리됨.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Firebase 설정값이 모두 유효하게 채워져 있는지 확인합니다.
 * 하나라도 비어있으면 로그인 버튼을 비활성화하고 가이드를 안내합니다.
 */
export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (v) => typeof v === 'string' && v.length > 0
);

// 이미 초기화된 앱이 있으면 재사용 (HMR 및 React StrictMode 중복 방지)
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export const auth: Auth = getAuth(app);

// 브라우저 재시작 후에도 로그인 세션 유지 (Local Persistence)
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('[Firebase] Failed to set persistence:', err);
});

// Google 로그인 제공자 설정
export const googleProvider = new GoogleAuthProvider();
// 매번 계정 선택 화면 표시 (계정 전환 지원)
googleProvider.setCustomParameters({ prompt: 'select_account' });
