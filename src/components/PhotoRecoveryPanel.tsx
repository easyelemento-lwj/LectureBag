import { useEffect, useRef, useState } from 'react';
import { RECORDING_ENABLED } from '../utils/featureFlags';
import { useDriveSync } from '../context/DriveSyncContext';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { inspectPhotoRecovery, repairMissingPhotos, recheckAudioRecovery, type PhotoRecoveryReport, type PhotoRecoveryStatus } from '../services/drive/photoRecovery';
import type { DriveIdentity } from '../services/drive/types';

const labels: Record<PhotoRecoveryStatus, string> = {
  registered: '서버 등록됨', missing: '업로드 기록 누락', pending: '기존 업로드 확인 필요',
  previous: '이전 Drive 연결 · 복구 제외', deleted: '서버에서 삭제됨 · 복구 제외',
  review: '기존 기록 확인 필요 · 재업로드 안 함', invalid: '원본 또는 파일 ID 확인 필요',
  audio_review: '녹음 길이 확인 필요 · 업로드 보류',
};
const lengthLabel = (ms?: number) => Number.isFinite(ms) && ms! > 0
  ? `${Math.floor(ms! / 60000)}분 ${Math.floor(ms! / 1000) % 60}초` : '기록 없음';
const button = 'min-h-11 rounded-full bg-[#EFEFEF] px-4 py-2 text-neutral-700 enabled:hover:bg-[#E2E2E2] enabled:active:bg-[#E2E2E2] disabled:opacity-50 transition-colors';

export function PhotoRecoveryPanel({ identity, catalog }: { identity: DriveIdentity; catalog: CloudCatalog; key?: string }) {
  const sync = useDriveSync();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PhotoRecoveryReport>();
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const recheck = async (id: string) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setMessage('저장된 원본으로 녹음 길이를 다시 검사하고 있습니다.');
    try {
      const result = await recheckAudioRecovery(identity, id, catalog, current.signal);
      if (current.signal.aborted) return;
      // Reflect the saved local result even if refreshing remote inventory fails.
      setReport(previous => previous && ({ ...previous, rows: previous.rows.map(row => row.id === id ? {
        ...row, audioCheck: { ...row.audioCheck!, mediaDurationMs: result.mediaDurationMs, checkedAt: result.checkedAt,
          description: result.status === 'duration_checked' ? '녹음 길이 대조 통과' : '길이 재검사 미통과 · 점검 결과 새로고침 필요' },
      } : row) }));
      const fresh = await inspectPhotoRecovery(identity, catalog, current.signal);
      if (current.signal.aborted) return;
      setReport({ rows: fresh.rows, checkedAt: fresh.checkedAt });
      setMessage(result.status === 'duration_checked'
        ? '녹음 길이 대조를 통과했습니다. 복구 가능으로 표시되면 누락 파일 복구를 눌러 주세요. 아직 업로드하지 않았습니다.'
        : '재검사 결과를 저장했습니다. 아래 파일별 사유를 확인해 주세요. 원본은 그대로 보관되며 업로드하지 않았습니다.');
    } catch (error) {
      if (!current.signal.aborted) setMessage(error instanceof Error ? error.message : '재검사를 완료하지 못했습니다.');
    } finally { if (!current.signal.aborted) setBusy(false); }
  };
  const run = async (repair = false) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setMessage('');
    try {
      if (repair) {
        if (!navigator.locks) throw new Error('안전한 복구를 위해 최신 브라우저에서 다시 시도해 주세요.');
        const selected = report?.rows.filter(row => row.status === 'missing').map(row => row.id) || [];
        if (!selected.length) return;
        const result = await navigator.locks.request(`lecturebag-capture-sync:${identity.ownerUid}`, { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('기존 업로드가 진행 중입니다. 잠시 후 복구를 눌러 주세요.');
          return repairMissingPhotos(identity, selected, catalog, current.signal);
        });
        if (current.signal.aborted) return;
        setReport(undefined);
        setMessage(result.count ? `${result.count}개 파일을 업로드 대기 목록에 추가했습니다. 완료될 때까지 앱을 열어 두세요. 이후 다시 점검해 주세요.`
          : '추가할 파일이 없습니다. 파일 상태가 바뀌었을 수 있으니 다시 점검해 주세요.');
        sync.wake();
      } else {
        setReport(undefined);
        const result = await inspectPhotoRecovery(identity, catalog, current.signal);
        if (!current.signal.aborted) setReport({ rows: result.rows, checkedAt: result.checkedAt });
      }
    } catch (error) {
      if (!current.signal.aborted) setMessage(error instanceof Error ? error.message : '점검하지 못했습니다. 다시 시도해 주세요.');
    } finally { if (!current.signal.aborted) setBusy(false); }
  };
  const missing = report?.rows.filter(row => row.status === 'missing').length || 0;
  const registered = report?.rows.filter(row => row.status === 'registered').length || 0;
  const pending = report?.rows.some(row => row.status === 'pending');
  return <div className="mt-4 border-t border-neutral-100 pt-4 text-xs text-neutral-500" aria-label={RECORDING_ENABLED ? "사진·녹음 동기화 복구" : "사진 동기화 복구"}>
    <p className="font-medium text-neutral-700">{RECORDING_ENABLED ? '사진·녹음 동기화 점검' : '사진 동기화 점검'}</p>
    <p className="mt-1 leading-relaxed">{RECORDING_ENABLED ? '이 기기에서 촬영한 사진과 저장된 녹음을' : '이 기기에서 촬영한 사진을'} 서버 기록과 비교합니다. 점검만으로 파일을 업로드하거나 삭제하지 않습니다.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || !sync.enabled} onClick={() => void run()}>{busy ? '확인 중…' : RECORDING_ENABLED ? '사진·녹음 동기화 점검' : '사진 동기화 점검'}</button>
      {missing > 0 && <button type="button" className={button} disabled={busy || !sync.enabled} onClick={() => void run(true)}>누락 파일 {missing}개 복구</button>}
      {pending && <button type="button" className={button} disabled={busy || sync.busy} onClick={() => { sync.retry(); setMessage('기존 업로드를 다시 시도합니다. 잠시 후 동기화를 다시 점검해 주세요.'); }}>기존 업로드 다시 시도</button>}
    </div>
    {!sync.enabled && <p className="mt-2">이 앱 버전에서는 자동 업로드가 활성화되지 않았습니다. 업데이트된 테스트 앱에서 확인해 주세요.</p>}
    {message && <p role="status" className="mt-3 leading-relaxed">{message}</p>}
    {report && <div className="mt-3 rounded-2xl bg-neutral-50 p-3" role="status">
      <p>기기 파일 {report.rows.length}개 · 서버 등록 {registered}개 · 복구 가능 {missing}개</p>
      {(RECORDING_ENABLED ? ['photo', 'audio'] as const : ['photo'] as const).map(kind => <p key={kind} className="mt-1">{kind === 'photo' ? '사진' : '녹음'} {report.rows.filter(row => row.kind === kind).length}개 · 복구 가능 {report.rows.filter(row => row.kind === kind && row.status === 'missing').length}개</p>)}
      <p className="mt-1 text-[11px]">점검 시각 {new Date(report.checkedAt).toLocaleTimeString('ko-KR')} · 가져온 파일은 제외</p>
      <details className="mt-2"><summary className="cursor-pointer py-2">파일별 점검 결과</summary>
        <ul className="mt-1 max-h-64 space-y-2 overflow-auto">{report.rows.map(row => <li key={row.id} className="break-words border-t border-neutral-200/70 pt-2">
          <p>{row.kind === 'photo' ? '사진' : '녹음'} · {row.name}</p><p className={row.status === 'registered' ? 'text-neutral-500' : 'text-amber-700'}>{labels[row.status]}</p>
          {row.audioCheck && <div className="mt-1 space-y-1 text-[11px]">
            <p>{row.audioCheck.description}</p>
            <p>녹음 시간: {lengthLabel(row.audioCheck.elapsedMs)} · 파일 길이: {lengthLabel(row.audioCheck.mediaDurationMs)}</p>
            {row.audioCheck.checkedAt && <p>길이 검사: {new Date(row.audioCheck.checkedAt).toLocaleString('ko-KR')}</p>}
          </div>}
          {row.status === 'audio_review' && <>
            <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void recheck(row.id)}>녹음 길이 재검사</button>
            <p className="mt-1 text-[11px]">녹음 시간과 파일 길이만 비교하며, 무음·내용 누락 여부는 보장하지 않습니다. 비교할 시간 기록이 없으면 통과 처리하지 않습니다.</p>
          </>}
        </li>)}</ul>
      </details>
    </div>}
  </div>;
}
