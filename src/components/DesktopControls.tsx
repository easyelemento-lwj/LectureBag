import { useEffect, useState } from 'react';
import { desktopBridge, type DesktopPreferences } from '../services/desktop';

export function DesktopControls() {
  const bridge = desktopBridge();
  const [preferences, setPreferences] = useState<DesktopPreferences>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge.preferences().then(setPreferences).catch(() => setError('앱 설정을 읽지 못했습니다.'));
    return bridge.onPreferences(setPreferences);
  }, [bridge]);
  if (!bridge) return null;
  return <div className="space-y-2 rounded-xl bg-neutral-50 p-3 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" disabled={busy || !preferences} checked={preferences?.runInBackground || false}
      onChange={async e => { setBusy(true); setError(''); try { setPreferences(await bridge.setBackground(e.target.checked)); }
        catch { setError('설정을 저장하지 못했습니다.'); } finally { setBusy(false); } }} />창을 닫아도 PC 자동 동기화 계속하기</label>
    <p className="text-xs text-neutral-500">자동 보관이 켜진 상태에서 작동합니다. 메뉴 막대/트레이에서 완전히 종료하면 멈춥니다. PC 절전·종료 중에는 전송하지 않고 다시 실행하거나 절전에서 깨어나면 확인합니다.</p>
    <p className="text-xs text-neutral-500">사본은 이 앱 전용 저장소에 보관됩니다. Chrome/Safari 저장소와 별개이며, 앱 데이터 삭제나 디스크 장애에 대비한 백업은 아닙니다.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
