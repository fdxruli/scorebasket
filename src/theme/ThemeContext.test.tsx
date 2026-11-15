// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeSelector } from '../components/common/ThemeSelector';
import { ThemeProvider, THEME_STORAGE_KEY, useTheme } from './ThemeContext';

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

function createMediaQuery(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matches; },
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    setMatches(next: boolean) {
      matches = next;
      const event = new Event('change') as MediaQueryListEvent;
      Object.defineProperty(event, 'matches', { value: next });
      listeners.forEach(listener => listener(event));
    }
  } as unknown as MediaQueryList & { setMatches: (next: boolean) => void };

  return media;
}

function ThemeHarness({ onMount }: { onMount?: () => void }) {
  const { theme } = useTheme();
  useEffect(() => onMount?.(), [onMount]);

  return (
    <>
      <ThemeSelector />
      <span data-testid="effective-theme">{theme}</span>
    </>
  );
}

const renderTheme = (onMount?: () => void) => render(
  <ThemeProvider>
    <ThemeHarness onMount={onMount} />
  </ThemeProvider>
);

describe('theme preference', () => {
  let media: ReturnType<typeof createMediaQuery>;

  beforeEach(() => {
    window.localStorage.clear();
    media = createMediaQuery(false);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media)
    });
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (localStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', localStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'localStorage');
    }
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to Automatic and resolves it from the device preference', () => {
    act(() => media.setMatches(true));
    renderTheme();

    expect((screen.getByRole('combobox', { name: 'Tema de apariencia' }) as HTMLSelectElement).value).toBe('auto');
    expect(screen.getByTestId('effective-theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies and persists a manual light or dark choice', () => {
    renderTheme();
    const selector = screen.getByRole('combobox', { name: 'Tema de apariencia' });

    fireEvent.change(selector, { target: { value: 'light' } });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    fireEvent.change(selector, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('restores the saved preference after remounting the application', () => {
    const firstRender = renderTheme();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tema de apariencia' }), {
      target: { value: 'dark' }
    });
    firstRender.unmount();

    renderTheme();
    expect((screen.getByRole('combobox', { name: 'Tema de apariencia' }) as HTMLSelectElement).value).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows system changes in Automatic mode', () => {
    renderTheme();
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => media.setMatches(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps a manual choice when the system preference changes', () => {
    renderTheme();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tema de apariencia' }), {
      target: { value: 'light' }
    });

    act(() => media.setMatches(true));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still applies a session choice when localStorage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage is unavailable', 'SecurityError'); }
    });

    renderTheme();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tema de apariencia' }), {
      target: { value: 'dark' }
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('does not remount live children when the theme changes', () => {
    const onMount = vi.fn();
    renderTheme(onMount);
    expect(onMount).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Tema de apariencia' }), {
      target: { value: 'dark' }
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
