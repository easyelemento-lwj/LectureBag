import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Camera, CalendarDays, FolderOpen, Loader2, AlertCircle } from 'lucide-react';

interface AuthGateProps {
  children: React.ReactNode;
}

const features = [
  { icon: Camera, title: '강의 순간을 기록하세요', description: '판서 사진과 강의 녹음을 한곳에 모아요.' },
  { icon: CalendarDays, title: '시간표에 맞춰 정리해요', description: '강의 시간에 맞는 과목 폴더로 자동 분류해요.' },
  { icon: FolderOpen, title: '필요한 기록을 쉽게 찾아요', description: '과목별, 날짜별로 모아둔 기록을 확인해요.' },
];

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { user, loading, isConfigured, signInWithGoogle } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-neutral-50 text-neutral-900">
        <img src="/lecturebag-logo.png" alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-2xl object-contain" />
        <p className="text-xl font-bold tracking-tight">LectureBag</p>
        <div role="status" className="flex items-center gap-2 text-xs font-medium text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>로그인 상태를 확인하고 있어요...</span>
        </div>
      </div>
    );
  }

  if (user) return <>{children}</>;

  const handleGoogleLogin = async () => {
    try {
      setIsSigningIn(true);
      setErrorMessage(null);
      const res = await signInWithGoogle();
      if (res.error) setErrorMessage(res.error);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <main
      className="fixed inset-0 z-50 overflow-y-auto bg-neutral-50 px-4 text-neutral-900 sm:px-8 lg:px-12"
      style={{ paddingTop: 'max(clamp(20px, 4dvh, 48px), env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: 'max(clamp(16px, 4vw, 48px), env(safe-area-inset-left))', paddingRight: 'max(clamp(16px, 4vw, 48px), env(safe-area-inset-right))' }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col md:max-w-xl lg:max-w-5xl">
        <header className="flex items-center gap-2.5">
          <img src="/lecturebag-logo.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl object-contain md:h-12 md:w-12" />
          <span className="text-base font-bold tracking-tight">LectureBag</span>
        </header>

        <div className="flex flex-1 flex-col justify-center py-[clamp(24px,6dvh,64px)] lg:grid lg:grid-cols-2 lg:content-center lg:gap-x-12 lg:gap-y-6 xl:gap-x-20">
        <div className="flex flex-col lg:contents">
          <section aria-labelledby="login-heading" className="mb-6 md:mb-8 lg:row-span-2 lg:mb-0 lg:self-center">
            <p className="mb-3 text-xs font-semibold text-neutral-500">나의 강의 아카이브</p>
            <h1 id="login-heading" className="text-[clamp(1.5rem,5vw,2.25rem)] font-bold leading-tight tracking-tight lg:text-4xl xl:text-5xl">
              강의의 모든 기록,<br />한 가방에 담아요.
            </h1>
            <p className="mt-4 text-sm md:text-base leading-relaxed text-neutral-500">
              사진부터 녹음까지, 수업에 필요한 기록을<br className="hidden sm:block" /> LectureBag으로 간편하게 정리하세요.
            </p>
          </section>

          <section aria-label="LectureBag 주요 기능" className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs">
            {features.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-center gap-3 border-b border-neutral-100 p-4 md:gap-4 md:p-5 last:border-b-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-neutral-900 md:text-sm">{title}</h2>
                  <p className="mt-1 text-[11px] md:text-xs leading-relaxed text-neutral-500">{description}</p>
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="mt-6 space-y-4 md:mt-8 lg:col-start-2 lg:mt-0">
          {errorMessage && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}
          {!isConfigured && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="leading-relaxed">지금은 로그인 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isSigningIn || !isConfigured}
            aria-busy={isSigningIn}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-4 text-sm font-bold text-neutral-900 shadow-2xs transition-colors hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {isSigningIn ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span role="status">로그인 진행 중...</span>
              </>
            ) : (
              <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
                <span>Google 계정으로 시작하기</span>
              </>
            )}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-neutral-500">
            Google 계정으로 로그인하고 시작하세요.
          </p>
        </div>
        </div>
      </div>
    </main>
  );
};
