import { useEffect, useState } from 'react';
import { VerifiedAudioPlayer } from './VerifiedAudioPlayer';
import { transcript } from '../services/transcription';
import { RECORDING_ENABLED } from '../utils/featureFlags';

/** Local recordings may be data URLs; the verified player owns playback, not storage. */
export function InlineRecordingPlayer({ source, fileName, fileId }: { source?: string; fileName?: string; fileId?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [textNotice, setTextNotice] = useState('');
  useEffect(() => { setText(null); setTextNotice(''); }, [fileId]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let ownedUrl = '';
    setUrl(''); setError(false);
    if (source?.startsWith('blob:')) setUrl(source);
    else if (source?.startsWith('data:')) {
      void fetch(source, { signal: controller.signal }).then(response => response.blob()).then(blob => {
        if (controller.signal.aborted) return;
        ownedUrl = URL.createObjectURL(blob); setUrl(ownedUrl);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    } else if (source) setError(true);
    return () => { controller.abort(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
  }, [source]);
  return <div className="w-full min-w-0 px-2 pb-2 pt-2" aria-label="녹음 플레이어">
    {error ? <p role="alert" className="text-xs text-red-700">녹음을 열지 못했습니다. 파일을 다시 눌러 주세요.</p>
      : url ? <VerifiedAudioPlayer key={url} url={url} fileName={fileName} compact onError={() => setError(true)} onTranscript={RECORDING_ENABLED && fileId ? () => {
        setTextNotice('텍스트를 불러오는 중입니다…');
        void transcript(fileId).then(value => { setText(value); setTextNotice(value ? '' : '아직 변환된 텍스트가 없습니다. 녹음을 선택한 뒤 텍스트 변환을 눌러 주세요.'); }).catch(error => setTextNotice(error.message));
      } : undefined} />
        : <p role="status" className="text-xs text-neutral-500">녹음 원본을 준비 중입니다…</p>}
    {textNotice && <p role="status" className="p-3 text-sm">{textNotice}</p>}
    {text !== null && <section aria-label="녹음 원문 텍스트" className="rounded-2xl border bg-white p-4"><button type="button" onClick={() => setText(null)} className="float-right p-2">닫기</button><h3 className="font-semibold">{fileName} · 원문</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words py-4 font-sans text-sm">{text}</pre></section>}
  </div>;
}
