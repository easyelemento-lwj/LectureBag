/**
 * useAuth.ts — 인증 관련 커스텀 훅 모음
 * 
 * 보안 설계:
 *  - 컴포넌트 레벨에서 인증 상태(user, isConfigured 등)를 손쉽게 구독.
 *  - 향후 인증 필수 페이지(Protected Route) 구현 시 확장 용이.
 */
import { useAuth as useAuthContext } from '../context/AuthContext';

export function useAuth() {
  return useAuthContext();
}
