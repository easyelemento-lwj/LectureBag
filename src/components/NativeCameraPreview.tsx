import { useEffect, useRef } from 'react';
import { native } from '../services/native';

export function NativeCameraPreview({ facing, flash, onStatus }: {
  facing: string; flash: string; onStatus: (status: 'loading' | 'live' | 'denied' | 'unavailable') => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current; if (!element) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (cancelled) return;
        const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        onStatus('loading');
        void native.cameraStart({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          viewportWidth: window.innerWidth, facing, flash }).then(() => { if (!cancelled) onStatus('live'); })
          .catch(() => { if (!cancelled) onStatus('unavailable'); });
      }, 60);
    };
    document.documentElement.classList.add('native-camera');
    const observer = new ResizeObserver(start); observer.observe(element); start();
    window.addEventListener('resize', start);
    return () => {
      cancelled = true; clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', start);
      document.documentElement.classList.remove('native-camera'); void native.cameraStop().catch(() => {});
    };
  }, [facing, flash, onStatus]);
  return <div ref={frame} className="absolute inset-0" style={{ boxShadow: '0 0 0 100vmax black' }} />;
}
