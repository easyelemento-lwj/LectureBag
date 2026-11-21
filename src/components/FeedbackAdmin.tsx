import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Star } from 'lucide-react';
import { feedbackCsv, feedbackRequest, type FeedbackItem, type FeedbackPage } from '../services/feedback';
import { useAuth } from '../hooks/useAuth';
import { isFeedbackAdminAccount } from '../utils/adminAccess';

const pill = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#EFEFEF] px-4 py-2 text-sm text-neutral-700 hover:bg-[#E2E2E2] active:scale-95 transition disabled:opacity-50';

export function FeedbackAdmin() {
  const { user, signOut } = useAuth();
  const isFeedbackAdmin = isFeedbackAdminAccount(user);
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState('all');
  const [unread, setUnread] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const loading = useRef(false);
  const alive = useRef(true);

  async function load(next?: string, signal?: AbortSignal) {
    if (loading.current) return;
    loading.current = true; setBusy(true); setError('');
    try {
      const page = await feedbackRequest<FeedbackPage>(next ? `?cursor=${encodeURIComponent(next)}` : '', undefined, signal);
      if (!alive.current || signal?.aborted) return;
      setItems(old => next ? [...new Map([...old, ...page.items].map(item => [item.id, item])).values()] : page.items);
      setCursor(page.cursor);
    } catch (e) { if (alive.current && !signal?.aborted) setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.'); }
    finally { loading.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setItems([]); setAccess('loading');
    if (!isFeedbackAdmin) {
      setAccess('denied');
      return () => { alive.current = false; controller.abort(); };
    }
    void feedbackRequest<{ admin: boolean }>('/access', undefined, controller.signal).then(async result => {
      if (controller.signal.aborted) return;
      if (typeof result?.admin !== 'boolean') throw new Error('관리자 권한 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
      setAccess(result.admin ? 'allowed' : 'denied');
      if (result.admin) await load(undefined, controller.signal);
    }).catch(e => { if (!controller.signal.aborted) { setAccess('error'); setError(e.message); } });
    return () => { alive.current = false; controller.abort(); };
  }, [user?.uid, isFeedbackAdmin, accessAttempt]);

  const visible = items.filter(item => (rating === 'all' || item.rating === Number(rating)) && (!unread || !item.read));
  if (!isFeedbackAdmin || access === 'denied' || access === 'error') {
    return <main className="fixed inset-0 flex items-center justify-center bg-[#F7F7F9] p-5 text-neutral-900">
      <section className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-7">
        <h1 className="text-lg font-semibold">{access === 'error' && isFeedbackAdmin ? '관리자 권한을 확인하지 못했습니다.' : '관리자 계정으로 로그인해 주세요.'}</h1>
        <p className="mt-2 text-sm text-neutral-500">피드백 관리는 관리자 계정에서만 열 수 있습니다.</p>
        {access === 'error' && isFeedbackAdmin && <>
          {error && <p role="alert" className="mt-3 text-sm text-orange-700">{error}</p>}
          <button type="button" className={`${pill} mt-4`} onClick={() => { setError(''); setAccessAttempt(n => n + 1); }}>다시 확인</button>
        </>}
        <a href="#" className={`${pill} mt-4`}>앱으로 돌아가기</a>
      </section>
    </main>;
  }
  return <main className="fixed inset-0 overflow-y-auto bg-[#F7F7F9] px-4 py-6 text-neutral-900 sm:px-8">
    <div className="mx-auto max-w-4xl pb-10">
      <header className="mb-7 flex items-center justify-between gap-3 pt-[env(safe-area-inset-top)]">
        <a href="#" aria-label="앱으로 돌아가기" className={`${pill} !h-12 !w-12 !p-0`}><ArrowLeft className="h-5 w-5" /></a>
        <div className="min-w-0 flex-1"><p className="text-xs text-neutral-500">LectureBag · 관리자</p><h1 className="text-xl font-semibold tracking-tight">베타 피드백</h1></div>
        <button className={pill} onClick={() => void signOut()}>로그아웃</button>
      </header>
      {access === 'loading' && <p role="status" className="p-8 text-center text-neutral-500">접근 권한을 확인하고 있습니다…</p>}
      {error && <div role="alert" className="my-4 rounded-2xl bg-orange-50 p-4 text-sm text-orange-700">{error}</div>}
      {access === 'allowed' && <>
        <section className="mb-5 rounded-3xl border border-neutral-200/80 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">테스터들의 이야기</h2><p className="mt-1 text-xs text-neutral-500">불러온 {items.length}개 중 새 의견 {items.filter(item => !item.read).length}개 · 최신순</p></div><button className={pill} disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />새로고침</button></div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-600">별점<select aria-label="별점 필터" value={rating} onChange={e => setRating(e.target.value)} className="min-h-11 rounded-xl border border-neutral-200 bg-neutral-50 px-3"><option value="all">전체</option>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value}점</option>)}</select></label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-neutral-600"><input type="checkbox" checked={unread} onChange={e => setUnread(e.target.checked)} />새 의견만</label>
            <button className={`${pill} sm:ml-auto`} disabled={!visible.length} onClick={() => {
              const url = URL.createObjectURL(new Blob([feedbackCsv(visible)], { type: 'text/csv;charset=utf-8;' }));
              const link = document.createElement('a'); link.href = url; link.download = `lecturebag-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}><Download className="h-4 w-4" />표시된 {visible.length}개 CSV</button>
          </div>
          <p className="mt-3 text-xs text-neutral-400">필터와 CSV 저장은 불러온 의견에 적용됩니다. 이전 의견은 아래에서 더 불러올 수 있습니다.</p>
        </section>
        <div className="space-y-3" aria-live="polite">
          {!busy && !visible.length && <p className="rounded-3xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">{items.length ? '조건에 맞는 의견이 없습니다.' : '아직 도착한 의견이 없습니다.'}</p>}
          {visible.map(item => <article key={item.id} className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex items-center gap-1 text-sm font-medium text-amber-600"><Star className="h-4 w-4 fill-current" />{item.rating}.0</span>{!item.read && <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600">새 의견</span>}</div><time dateTime={item.createdAt} className="text-xs text-neutral-400">{new Date(item.createdAt).toLocaleString('ko-KR')}</time></div>
            <p className="my-4 whitespace-pre-wrap break-words text-sm leading-relaxed select-text">{item.comment}</p>
            <div className="flex justify-end"><button disabled={pending !== null} className={pill} onClick={async () => {
              setPending(item.id); setError('');
              try {
                await feedbackRequest(`/${item.id}/read`, { read: !item.read });
                if (alive.current) setItems(old => old.map(row => row.id === item.id ? { ...row, read: !item.read } : row));
              } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '상태를 변경하지 못했습니다.'); }
              finally { if (alive.current) setPending(null); }
            }}>{pending === item.id ? '저장 중…' : item.read ? '읽지 않음으로 표시' : '읽음으로 표시'}</button></div>
          </article>)}
        </div>
        {busy && <p role="status" className="py-5 text-center text-sm text-neutral-500">의견을 불러오는 중…</p>}
        {cursor && <button disabled={busy} className={`${pill} mt-5 w-full`} onClick={() => void load(cursor)}>이전 의견 더 보기</button>}
      </>}
    </div>
  </main>;
}
