import { LastChecked } from "./LastChecked";
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useDriveLifecycle } from '../context/DriveLifecycleContext';
import { useDriveSync } from '../context/DriveSyncContext';
import { usePcLibrary } from '../context/PcLibraryContext';
import { syncActionMessage } from '../utils/syncActionMessage';

export function DriveTrashStatus() {
  const life = useDriveLifecycle();
  const sync = useDriveSync();
  const pc = usePcLibrary();
  const operations = life.state?.operations || [];
  const deleting = operations.filter(op => op.trashed && !op.purge).length;
  const purging = operations.filter(op => op.purge).length;
  const restoring = operations.length - deleting - purging;
  const progress = [purging ? `완전 삭제 중 · ${purging}개` : '', deleting ? `삭제 중 · ${deleting}개` : '', restoring ? `복원 중 · ${restoring}개` : ''].filter(Boolean).join(' / ');
  const unavailable = life.files.filter(f => f.driveUnavailable);
  const error = life.error || operations.find(op => op.error)?.error || life.state?.notice || sync.error || pc.error;
  const failed = sync.jobs.some(job => ['failed', 'needs_auth', 'quota_full', 'paused'].includes(job.state));
  const warning = !!error || failed || unavailable.length > 0 || life.connected === false;
  const pending = operations.length > 0 || sync.waiting > 0 || sync.jobs.some(job => !['synced', 'cancelled'].includes(job.state));
  const busy = life.busy || sync.busy || pc.busy || pending;
  if (!life.enabled || (!warning && !busy)) return null;
  return <details className="group mx-5 my-2 rounded-2xl bg-neutral-100/80 text-xs text-neutral-500" aria-label="동기화 상태">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
      {warning ? <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" /> : <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />}
      <span role="status" className={warning ? 'text-amber-700' : ''}>{life.connected === false ? '연결 필요' : warning ? '동기화 확인 필요' : operations.length ? progress : '동기화 중'}</span>
      <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
    </summary>
    <div className="grid grid-cols-1 gap-1 border-t border-neutral-200/70 px-4 py-3 leading-snug">
      <LastChecked checkedAt={life.state?.checkedAt} />
      {warning && <p className="m-0 min-w-0 px-[13px] text-left">{syncActionMessage(error || (unavailable.length ? '원본 접근 확인 필요' : ''), sync.jobs.map(job => job.state), life.connected === false)}</p>}
      {!!operations.length && <details><summary className="min-h-11 cursor-pointer py-3">대기 작업 관리</summary><ul className="space-y-2">{operations.map(op => <li key={op.operationId} className="break-words">
        {life.files.find(f => f.id === op.fileId)?.name || '자료'} · {op.cancelRequested ? '중단 확인 중' : op.error ? '다시 시도 필요' : op.purge && !op.purgeConfirmed ? '삭제 확인 필요' : op.purge ? '완전 삭제 중' : op.trashed ? '삭제 중' : '복원 중'}
        {!op.remote && <button type="button" disabled={op.cancelRequested} className="ml-2 min-h-11 underline disabled:opacity-40" onClick={() => {
          if (window.confirm('아직 완료되지 않은 요청의 추가 시도를 중단합니다. 이미 Drive에 반영된 변경을 되돌리지는 않습니다. 계속할까요?')) life.cancel(op.operationId);
        }}>요청 중단</button>}
      </li>)}</ul></details>}
    </div>
  </details>;
}
