import { useEffect, useRef, useState } from 'react';
import { useDriveSync } from '../context/DriveSyncContext';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { MediaResolver } from '../services/drive/mediaResolver';
import { VerifiedAudioPlayer } from './VerifiedAudioPlayer';
import type { UploadJob, UploadState } from '../services/drive/uploadQueue';
import { uploadSource } from '../utils/mediaStorage';
import { useAuth } from '../hooks/useAuth';
import { useDriveLifecycle } from '../context/DriveLifecycleContext';

const labels: Record<UploadState, string> = {
  queued: '업로드 대기', uploading: '업로드 중', verifying: '원본 검증 중', registering: '목록 등록 중',
  synced: 'Drive에 저장 완료', offline: '인터넷 연결 대기', needs_auth: 'Drive 권한 확인 필요',
  quota_full: 'Drive 저장 공간 부족', retry_wait: '잠시 후 재시도', failed: '실패 · 다시 시도 필요',
  paused: '일시 중지', cancelled: '기기 삭제로 업로드 중단',
};

export function DriveCaptureStatus({ catalog, connectionId }: { catalog: CloudCatalog; connectionId: string; key?: string }) {
  const sync = useDriveSync();
  const lifecycle = useDriveLifecycle();
  const { user } = useAuth();
  const [inspect, setInspect] = useState(false);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [checkAttempt, setCheckAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setChecked({});
    if (inspect && user && sync.connection?.connectionId === connectionId) {
      void (async () => {
        for (const job of sync.jobs.filter(job => job.ownerUid === user.uid && job.connectionId === connectionId && job.state === 'synced')) {
          let label: string;
          try { label = await uploadSource(user.uid, job.localFileRef) ? '기기 원본 있음' : '현재 기기 원본 없음 · 휴지통/삭제/저장소 상태 확인 필요'; }
          catch { label = '기기 원본 확인 실패'; }
          if (!alive) return;
          setChecked(prev => ({ ...prev, [job.fileId]: label }));
        }
      })();
    }
    return () => { alive = false; };
  }, [inspect, user?.uid, connectionId, sync.jobs, sync.connection?.connectionId, checkAttempt]);
  const active = useRef<AbortController>(null);
  const [preview, setPreview] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [audio, setAudio] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); active.current = controller;
    return () => controller.abort(); }, [catalog, connectionId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (lifecycle.files.some(f => f.id === previewId && (f.deletedAt || f.driveUnavailable)) ||
      lifecycle.state?.operations.some(op => op.fileId === previewId && op.trashed)) setPreview('');
  }, [previewId, lifecycle.files, lifecycle.state?.operations]);
  if (!sync.enabled) return null;
  const jobs = sync.connection?.connectionId === connectionId ? sync.jobs : [];
  const pending = jobs.filter(job => !['synced', 'cancelled'].includes(job.state)).length;
  const finished = jobs.filter(job => job.state === 'synced').length;
  async function open(job: UploadJob) {
    if (!active.current) return;
    const signal = AbortSignal.any([active.current.signal, AbortSignal.timeout(300_000)]);
    setOpening(true); setError('');
    try {
      let cursor: string | undefined;
      do {
        const page = await catalog.list(job.logicalFolderId, cursor, signal);
        const file = page.files.find(item => item.id === job.fileId);
        if (file) {
          const result = await new MediaResolver(catalog, { ownerUid: file.ownerUid, connectionId }).media(file, signal);
          signal.throwIfAborted(); setPreviewId(file.id); setAudio(file.kind === 'audio'); setPreview(URL.createObjectURL(result.blob)); return;
        }
        cursor = page.nextCursor || undefined;
      } while (cursor);
      throw new Error('등록된 원본을 찾을 수 없습니다.');
    } catch { if (!signal.aborted) setError('원본을 열지 못했습니다. 연결과 Drive 파일 상태를 확인해 주세요.'); }
    finally { if (!signal.aborted) setOpening(false); }
  }
  return <section aria-label="사진·녹음 자동 업로드" className="border-t border-neutral-200 pt-3 space-y-2 text-xs">
    <h4 className="font-bold text-sm">사진·녹음 자동 업로드</h4>
    <p>새 사진과 저장을 마친 녹음(최대 100MB)을 기기에 먼저 저장한 뒤 Drive로 올립니다. 기존 자료는 자동 이전하지 않습니다.</p>
    <p>저장 위치: LectureBag / 연도 / 상하반기 또는 학기·과목 / 월 / 일</p>
    <p role="status">{sync.busy ? '자동 업로드 중 · ' : ''}대기 {pending + sync.waiting}개 · 누적 업로드 완료 {finished}개 (현재 파일 수와 다름)</p>
    <button type="button" aria-expanded={inspect} onClick={() => setInspect(value => !value)} className="rounded-xl border border-neutral-200 px-3 py-2 font-bold">
      {inspect ? '완료 내역 닫기' : `완료 ${finished}건 전체 확인 (임시)`}
    </button>
    {inspect && <div aria-label="업로드 완료 전체 내역" className="space-y-3 rounded-xl bg-neutral-50 p-3">
      <p>이 브라우저·현재 계정·현재 Drive 연결의 완료 작업 기록입니다. Drive 전체 파일 수나 현재 기기 파일 수와는 다를 수 있습니다. 아래 날짜는 촬영/녹음 시각이며, 과거 완료 시각은 기록되어 있지 않습니다.</p>
      <button type="button" onClick={() => setCheckAttempt(n => n + 1)} className="underline">기기 원본 다시 확인</button>
      <ol className="max-h-96 space-y-3 overflow-y-auto">
        {[...jobs].filter(job => job.state === 'synced').sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).map((job, index) => <li key={job.fileId} className="break-all border-b border-neutral-200 pb-2">
          <p className="font-bold">{index + 1}. {job.name}</p>
          <p>{new Date(job.capturedAt).toLocaleString('ko-KR')} · {(job.sizeBytes / 1024 / 1024).toFixed(2)} MB</p>
          <p>{checked[job.fileId] || '기기 원본 확인 중…'}</p>
          <p className="text-neutral-500">파일 ID: {job.fileId}</p>
        </li>)}
      </ol>
      {!finished && <p>현재 연결의 완료 기록이 없습니다.</p>}
      <p>읽기 전용 확인입니다. 파일 삭제·재업로드·Drive 원본 변경은 하지 않습니다.</p>
    </div>}
    {sync.error && <p role="alert" className="text-red-700">{sync.error}</p>}
    {sync.previousConnection > 0 && <p>이전 Drive 연결에 속한 촬영 기록 {sync.previousConnection}개는 새 연결로 자동 이전하지 않습니다.</p>}
    <button type="button" disabled={sync.busy} onClick={sync.retry} className="rounded-xl bg-neutral-100 px-3 py-2 disabled:opacity-40">자동 업로드 다시 시도</button>
    <ul className="space-y-2">
      {[...jobs].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 10).map(job => {
        const remote = lifecycle.files.find(f => f.id === job.fileId);
        const pending = lifecycle.state?.operations.find(op => op.fileId === job.fileId);
        return <li key={job.fileId} className="break-all">
          {job.name} · {pending ? '삭제·복원 동기화 대기' : remote?.deletedAt ? 'Drive 휴지통에 있음'
            : remote?.driveUnavailable ? 'Drive 원본 확인 필요' : labels[job.state]}{job.state === 'uploading' ? ` ${Math.round(job.confirmedBytes / job.sizeBytes * 100)}%` : ''}
          {job.state === 'synced' && !pending && !remote?.deletedAt && !remote?.driveUnavailable && <button type="button" disabled={opening} onClick={() => void open(job)} className="ml-2 underline disabled:opacity-40">원본 열기</button>}
        </li>;
      })}
    </ul>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {preview && <div><button type="button" onClick={() => setPreview('')} className="mb-2 underline">{audio ? '녹음 닫기' : '사진 닫기'}</button>
      {audio ? <VerifiedAudioPlayer key={preview} url={preview} onError={() => setError('이 브라우저에서 녹음 형식을 재생할 수 없습니다. 원본은 유지됩니다.')} />
        : <img src={preview} alt="Drive에서 검증한 촬영 사진" className="max-h-80 rounded-xl object-contain" />}</div>}
    <p className="text-neutral-500">앱 종료 중 업로드·상태 확인은 보장하지 않습니다. 동기화된 파일의 삭제·복원은 Drive 휴지통과 다른 기기에 반영됩니다. 업로드 완료 수는 과거 작업 이력입니다.</p>
  </section>;
}
