import { useEffect, useRef, useState } from 'react';
import { useDriveSync } from '../context/DriveSyncContext';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { openPhoto } from '../services/drive/photoTrial';
import type { UploadJob, UploadState } from '../services/drive/uploadQueue';

const labels: Record<UploadState, string> = {
  queued: '업로드 대기', uploading: '업로드 중', verifying: '원본 검증 중', registering: '목록 등록 중',
  synced: 'Drive에 저장 완료', offline: '인터넷 연결 대기', needs_auth: 'Drive 권한 확인 필요',
  quota_full: 'Drive 저장 공간 부족', retry_wait: '잠시 후 재시도', failed: '실패 · 다시 시도 필요',
  paused: '일시 중지', cancelled: '기기 삭제로 업로드 중단',
};

export function DriveCaptureStatus({ catalog, connectionId }: { catalog: CloudCatalog; connectionId: string; key?: string }) {
  const sync = useDriveSync();
  const active = useRef<AbortController>(null);
  const [preview, setPreview] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); active.current = controller;
    return () => controller.abort(); }, [catalog, connectionId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  if (!sync.enabled) return null;
  const jobs = sync.connection?.connectionId === connectionId ? sync.jobs : [];
  const pending = jobs.filter(job => !['synced', 'cancelled'].includes(job.state)).length;
  const finished = jobs.filter(job => job.state === 'synced').length;
  async function open(job: UploadJob) {
    if (!active.current) return;
    const signal = active.current.signal;
    setOpening(true); setError('');
    try {
      let cursor: string | undefined;
      do {
        const page = await catalog.list(job.logicalFolderId, cursor, signal);
        const file = page.files.find(item => item.id === job.fileId);
        if (file) {
          const blob = await openPhoto(catalog, connectionId, file, signal);
          signal.throwIfAborted(); setPreview(URL.createObjectURL(blob)); return;
        }
        cursor = page.nextCursor || undefined;
      } while (cursor);
      throw new Error('등록된 원본을 찾을 수 없습니다.');
    } catch { if (!signal.aborted) setError('원본을 열지 못했습니다. 연결과 Drive 파일 상태를 확인해 주세요.'); }
    finally { if (!signal.aborted) setOpening(false); }
  }
  return <section aria-label="촬영 사진 자동 업로드" className="border-t border-neutral-200 pt-3 space-y-2 text-xs">
    <h4 className="font-bold text-sm">촬영 사진 자동 업로드</h4>
    <p>새로 촬영한 사진을 기기에 먼저 저장한 뒤 Drive로 올립니다. 기존 자료·녹음은 이 시험에 포함되지 않습니다.</p>
    <p>저장 위치: LectureBag / 연도 / 상하반기 또는 학기·과목 / 월 / 일</p>
    <p role="status">{sync.busy ? '자동 업로드 중 · ' : ''}대기 {pending + sync.waiting}개 · Drive에 저장 완료 {finished}개</p>
    {sync.error && <p role="alert" className="text-red-700">{sync.error}</p>}
    {sync.previousConnection > 0 && <p>이전 Drive 연결에 속한 촬영 기록 {sync.previousConnection}개는 새 연결로 자동 이전하지 않습니다.</p>}
    <button type="button" disabled={sync.busy} onClick={sync.retry} className="rounded-xl bg-neutral-100 px-3 py-2 disabled:opacity-40">자동 업로드 다시 시도</button>
    <ul className="space-y-2">
      {[...jobs].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 10).map(job => <li key={job.fileId} className="break-all">
        {job.name} · {labels[job.state]}{job.state === 'uploading' ? ` ${Math.round(job.confirmedBytes / job.sizeBytes * 100)}%` : ''}
        {job.state === 'synced' && <button type="button" disabled={opening} onClick={() => void open(job)} className="ml-2 underline disabled:opacity-40">원본 열기</button>}
      </li>)}
    </ul>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {preview && <div><button type="button" onClick={() => setPreview('')} className="mb-2 underline">사진 닫기</button>
      <img src={preview} alt="Drive에서 검증한 촬영 사진" className="max-h-80 rounded-xl object-contain" /></div>}
    <p className="text-neutral-500">앱 종료 중 업로드는 보장하지 않습니다. 현재 앱의 휴지통은 기기 자료에만 적용되며 이미 업로드한 Drive 원본은 유지됩니다.</p>
  </section>;
}
