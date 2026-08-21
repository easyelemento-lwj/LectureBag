import React, { createContext, useContext, useState, useEffect } from 'react';

export interface ColorPreset {
  name: string;
  hex: string;
}

export const PRESET_COLORS: ColorPreset[] = [
  { name: '앰버 옐로우 (기본)', hex: '#F59E0B' },
  { name: '워밍 오렌지', hex: '#F97316' },
  { name: '크림슨 레드', hex: '#EF4444' },
  { name: '로즈 핑크', hex: '#F43F5E' },
  { name: '바이올렛 퍼플', hex: '#8B5CF6' },
  { name: '네온 인디고', hex: '#6366F1' },
  { name: '스카이 블루', hex: '#0EA5E9' },
  { name: '에메랄드 그린', hex: '#10B981' },
  { name: '라임 그린', hex: '#84CC16' },
  { name: '스노우 화이트', hex: '#FFFFFF' },
];

interface AccentColorContextType {
  accentColor: string;
  setAccentColor: (color: string) => void;
  resetAccentColor: () => void;
}

const DEFAULT_COLOR = '#FFFFFF';

const AccentColorContext = createContext<AccentColorContextType>({
  accentColor: DEFAULT_COLOR,
  setAccentColor: () => {},
  resetAccentColor: () => {},
});

export const AccentColorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accentColor, setAccentColorState] = useState<string>(() => {
    try {
      return localStorage.getItem('lecture_snap_accent_color') || DEFAULT_COLOR;
    } catch {
      return DEFAULT_COLOR;
    }
  });

  const setAccentColor = (color: string) => {
    setAccentColorState(color);
    try {
      localStorage.setItem('lecture_snap_accent_color', color);
    } catch {
      // ignore
    }
  };

  const resetAccentColor = () => {
    setAccentColor(DEFAULT_COLOR);
  };

  useEffect(() => {
    // Set CSS custom property on root for easy inline/CSS access
    document.documentElement.style.setProperty('--accent-color', accentColor);
  }, [accentColor]);

  return (
    <AccentColorContext.Provider value={{ accentColor, setAccentColor, resetAccentColor }}>
      {children}
    </AccentColorContext.Provider>
  );
};

export const useAccentColor = () => useContext(AccentColorContext);
