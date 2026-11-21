import { LastChecked } from "./LastChecked";
import { useEffect, useRef, useState } from 'react';
import { syncActionMessage } from '../utils/syncActionMessage';
import { AlertCircle, ChevronDown, Cloud, FileAudio, Loader2 } from 'lucide-react';

// Temporary, isolated visual fixture. Never connect these controls to live providers.
const examples = {
  normal: { name: '정상', detail: '모든 자료의 동기화가 완료되었습니다.' },
  disconnected: { name: '연결 필요', detail: '자동 업로드와 삭제·복원 동기화가 멈춰 있습니다.' },
  syncing: { name: '동기화 중', detail: '자료와 삭제·복원 상태를 최신으로 맞추고 있습니다.' },
  deleting: { name: '삭제 중', detail: '휴지통 이동을 다른 기기에 반영하고 있습니다.' },
  restoring: { name: '복원 중', detail: '자료 복원을 다른 기기에 반영하고 있습니다.' },
  offline: { name: '인터넷 연결 끊김', detail: '오프라인 · 사진과 저장된 녹음은 기기에 보관됩니다.' },
  failed: { name: '업로드 실패', detail: '기기 원본은 보존되어 있습니다. 다시 시도를 눌러 주세요.' },
  quota: { name: '저장 공간 부족', detail: 'Drive 저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도해 주세요.' },
  permission: { name: '권한 확인 필요', detail: 'Google Drive 파일 접근 권한을 허용해 주세요.' },
  unavailable: { name: '원본 접근 불가', detail: '접근할 수 없는 Drive 원본이 있습니다. 권한과 원본 상태를 확인해 주세요.' },
  trashFailed: { name: '삭제·복원 실패', detail: '삭제·복원 상태를 반영하지 못했습니다. 앱 센터의 Google Drive에서 다시 시도해 주세요.' },
  retrying: { name: '다시 시도 중', detail: '연결을 확인하고 남은 동기화를 이어갑니다.' },
} as const;
type Example = keyof typeof examples;

export function SyncMessagePreview() {
  const [selected, setSelected] = useState<Example>('normal');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const select = (value: Example) => { clearTimeout(timer.current); setSelected(value); };
  const retry = () => { select('retrying'); timer.current = setTimeout(() => setSelected('normal'), 1800); };
  const sample = examples[selected];
  const busy = ['syncing', 'deleting', 'restoring', 'retrying'].includes(selected);
  const warning = selected !== 'normal' && !busy;
  const disconnected = selected === 'disconnected';
  const failed = selected === 'failed';
  const status = disconnected ? '연결 필요' : warning ? '확인 필요' : busy ? '동기화 중' : '연결됨';
  const icon = warning ? <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" /> : <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />;
  return <div className="mx-auto max-w-xl space-y-6 pb-6">
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-4">
      <p className="text-sm font-semibold">안내 메시지 미리보기 · 임시</p>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">예시 데이터입니다. 실제 파일·Drive 연결은 변경되지 않습니다. 상태를 고른 뒤 아래 세 화면을 확인하세요.</p>
      <label className="mt-4 block text-xs font-medium" htmlFor="sync-message-example">표시할 상태</label>
      <select id="sync-message-example" value={selected} onChange={e => select(e.target.value as Example)} className="mt-2 min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-base">
        {Object.entries(examples).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}
      </select>
      <p role="status" className="mt-3 text-xs text-neutral-500">현재 예시: {sample.name}</p>
    </div>

    <section aria-label="파일 탐색기 안내 예시">
      <h4 className="mb-3 px-1 text-xs font-semibold text-neutral-500">파일 탐색기 상단</h4>
      <div className="rounded-3xl border border-neutral-200/70 bg-white py-3">
        <p className="px-5 py-2 text-sm font-semibold">내 자료</p>
        {(warning || busy) && <details key={selected} className="group mx-5 my-2 rounded-2xl bg-neutral-100/80 text-xs text-neutral-500">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">{icon}<span className={warning ? 'text-amber-700' : ''}>{disconnected ? '연결 필요' : warning ? '동기화 확인 필요' : '동기화 중'}</span><ChevronDown className="ml-auto h-3.5 w-3.5 group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="grid grid-cols-1 gap-1 border-t border-neutral-200/70 px-4 py-3 leading-snug"><LastChecked preview />{warning && <p className="m-0 min-w-0 px-[13px] text-left">{syncActionMessage(sample.detail, [], disconnected)}</p>}</div>
        </details>}
        <div className="mx-5 flex items-center gap-3 py-4"><FileAudio className="h-5 w-5 text-neutral-400" aria-hidden="true" /><div><p className="text-xs font-medium">강의 녹음.m4a</p><p className="mt-1 text-[11px] text-neutral-400">오늘 · 24분 18초 · 예시 파일</p></div></div>
      </div>
      {selected === 'normal' && <p className="mt-2 px-1 text-xs text-neutral-400">정상 상태에서는 상단 안내가 숨겨집니다.</p>}
    </section>

    <section aria-label="Google Drive 버블 예시">
      <h4 className="mb-3 px-1 text-xs font-semibold text-neutral-500">앱 센터 · Google Drive</h4>
      <div className="rounded-3xl border border-neutral-200/70 bg-white p-5 text-neutral-900 shadow-2xs">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-100"><Cloud className="h-6 w-6 text-neutral-600" aria-hidden="true" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-sm font-semibold">Google Drive</h3><span className={'shrink-0 rounded-full px-2.5 py-1 text-[11px] ' + (warning ? failed ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700' : status === '연결됨' ? 'bg-blue-50 text-blue-700' : 'bg-neutral-100 text-neutral-500')}>{status}</span></div><p className="mt-1 break-all text-xs text-neutral-500">{disconnected ? '자료를 모든 기기에서 함께 보관하세요' : 'preview@example.com'}</p></div></div>
        {warning && <div className="mt-4 rounded-2xl bg-neutral-50 p-4"><p className={'flex items-center gap-2 text-xs font-medium ' + (failed ? 'text-red-700' : 'text-amber-700')}><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{syncActionMessage(sample.detail, [], disconnected).replace('Google Drive 버블에서 ', '')}</p><button type="button" onClick={retry} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-xs font-semibold shadow-2xs">다시 시도</button></div>}
        {disconnected && <button type="button" onClick={retry} className="mt-4 min-h-11 rounded-full bg-neutral-900 px-5 text-xs font-semibold text-white">Google Drive 연결 (시연)</button>}
        <div className="mt-4 border-t border-neutral-100 pt-1"><LastChecked preview plain /></div>
      </div>
    </section>

    <section aria-label="쓰레기통 파일 상태 예시">
      <h4 className="mb-3 px-1 text-xs font-semibold text-neutral-500">쓰레기통 · 파일별 상태</h4>
      <div className="flex gap-3 rounded-2xl border border-neutral-200/80 bg-white p-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><FileAudio className="h-5 w-5 text-neutral-500" aria-hidden="true" /></div><div className="min-w-0"><p className="text-xs font-bold">강의 녹음.m4a</p><p className="mt-1 text-[11px] text-neutral-400">녹음 · 예시 파일</p><p className={'mt-1 text-[11px] ' + (selected === 'trashFailed' || selected === 'unavailable' ? 'text-amber-700' : 'text-neutral-500')}>{selected === 'trashFailed' ? '다시 시도 필요' : selected === 'deleting' ? '삭제 중' : selected === 'restoring' ? '복원 중' : selected === 'unavailable' ? '원본 확인 필요' : 'Drive 휴지통에 보관됨'}</p>{selected === 'trashFailed' && <p className="mt-2 break-words text-xs leading-snug text-neutral-500">{sample.detail}</p>}</div></div>
    </section>
  </div>;
}
