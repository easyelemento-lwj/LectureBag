import { useRef, useState } from 'react';
import { Check, MessageSquare, Star } from 'lucide-react';
import { feedbackRequest } from '../services/feedback';

const button = 'min-h-11 rounded-full bg-[#EFEFEF] px-5 py-3 text-sm font-medium text-neutral-700 hover:bg-[#E2E2E2] active:scale-95 transition disabled:opacity-50';

export function FeedbackPanel() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ id: string; content: string } | null>(null);
  const submitting = useRef(false);

  return <div className="space-y-4">
    <section className="rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3"><span className="rounded-2xl bg-neutral-100 p-3"><MessageSquare className="h-5 w-5" /></span><div><h4 className="font-semibold">LectureBag은 어떠셨나요?</h4><p className="mt-1 text-xs text-neutral-500">짧은 의견도 다음 개선에 도움이 됩니다.</p></div></div>
      {sent ? <div role="status" className="py-6 text-center"><Check className="mx-auto mb-3 h-8 w-8 text-blue-600" /><p className="font-semibold">의견을 보내주셔서 감사합니다.</p><p className="mt-2 text-sm text-neutral-500">운영자가 확인하고 개선에 참고하겠습니다.</p><button className={`${button} mt-5`} onClick={() => { setSent(false); setRating(0); setComment(''); request.current = null; }}>새 의견 남기기</button></div>
        : <form onSubmit={async event => {
          event.preventDefault();
          if (submitting.current || !rating || !comment.trim()) return;
          submitting.current = true; setBusy(true); setError('');
          const content = JSON.stringify([rating, comment.trim()]);
          if (request.current?.content !== content) request.current = { id: crypto.randomUUID(), content };
          try { await feedbackRequest('', { requestId: request.current.id, rating, comment: comment.trim() }); setSent(true); }
          catch (e) { setError(e instanceof Error ? e.message : '제출하지 못했습니다. 다시 시도해 주세요.'); }
          finally { submitting.current = false; setBusy(false); }
        }} className="space-y-5">
          <fieldset disabled={busy}><legend className="mb-2 text-sm font-medium">별점</legend><div className="flex gap-1">{[1, 2, 3, 4, 5].map(value => <label key={value} className="relative cursor-pointer rounded-xl p-2 focus-within:ring-2 focus-within:ring-blue-400"><input className="sr-only" type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} aria-label={`${value}점`} required /><Star aria-hidden="true" className={`h-7 w-7 ${value <= rating ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}`} /></label>)}</div><p className="mt-1 text-xs text-neutral-500">{rating ? `${rating} / 5점` : '별점을 선택해 주세요.'}</p></fieldset>
          <div><label htmlFor="beta-comment" className="mb-2 block text-sm font-medium">한줄평</label><textarea id="beta-comment" required maxLength={500} rows={4} disabled={busy} value={comment} onChange={event => setComment(event.target.value)} placeholder="좋았던 점이나 불편했던 점을 자유롭게 남겨주세요." className="w-full resize-y rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm outline-none focus:border-blue-400 disabled:opacity-50" /><p className="mt-1 text-right text-xs text-neutral-400">{comment.length} / 500</p></div>
          <p className="text-xs leading-relaxed text-neutral-500">별점·의견·작성 시각은 서비스 개선을 위해 운영자에게 전달됩니다. 의견에 개인정보를 적지 마세요. 사진·녹음·이메일은 첨부하지 않습니다.</p>
          {error && <p role="alert" className="rounded-2xl bg-orange-50 p-3 text-sm text-orange-700">{error}</p>}
          <button type="submit" disabled={busy || !rating || !comment.trim()} className={`${button} w-full`}>{busy ? '보내는 중…' : '의견 보내기'}</button>
        </form>}
    </section>
  </div>;
}
