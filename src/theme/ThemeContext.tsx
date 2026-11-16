import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type EffectiveTheme = Exclude<ThemePreference, 'auto'>;

export const THEME_STORAGE_KEY = 'scorebasket-theme-preference';

const themeColors: Record<EffectiveTheme, string> = {
  light: '#F3F6FA',
  dark: '#0F172A'
};

interface ThemeContextValue {
  preference: ThemePreference;
  theme: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'auto' || value === 'light' || value === 'dark';

const readPreference = (): ThemePreference => {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
};

const getSystemTheme = (): EffectiveTheme => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const savePreference = (preference: ThemePreference) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The in-memory choice still applies when storage is unavailable.
  }
};

const applyTheme = (theme: EffectiveTheme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = themeColors[theme];
};

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(getSystemTheme);
  const theme = preference === 'auto' ? systemTheme : preference;

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    savePreference(nextPreference);
    setPreferenceState(nextPreference);
  }, []);

  useEffect(() => {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');

      if (media.addEventListener) {
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
      }

      media.addListener(handleChange);
      return () => media.removeListener(handleChange);
    } catch {
      // The initial system-theme read already falls back to light when unavailable.
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const saved = event.newValue;
      setPreferenceState(isThemePreference(saved) ? saved : 'auto');
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme debe utilizarse dentro de ThemeProvider.');
  return context;
}

export function useOptionalTheme() {
  return useContext(ThemeContext);
}
