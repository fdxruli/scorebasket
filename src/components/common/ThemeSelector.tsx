import { useEffect, useId, useRef, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useOptionalTheme, type ThemePreference } from '../../theme/ThemeContext';

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Oscuro', Icon: Moon },
  { value: 'auto', label: 'Automático', Icon: Laptop }
];

const preferenceLabels: Record<ThemePreference, string> = {
  light: 'Claro',
  dark: 'Oscuro',
  auto: 'Automático'
};

interface ThemeSelectorProps {
  compact?: boolean;
}

export function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const context = useOptionalTheme();
  const [isOpen, setIsOpen] = useState(false);
  const optionsId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const preference = context?.preference ?? 'auto';
  const setPreference = context?.setPreference ?? (() => undefined);
  const CurrentIcon = options.find(option => option.value === preference)?.Icon ?? Laptop;

  useEffect(() => {
    if (!compact || !isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [compact, isOpen]);

  if (!context) return null;

  if (!compact) {
    return (
      <label className="theme-selector">
        <Sun size={17} aria-hidden="true" />
        <span>Apariencia</span>
        <select
          aria-label="Tema de apariencia"
          value={preference}
          onChange={event => setPreference(event.target.value as ThemePreference)}
        >
          <option value="light">Claro</option>
          <option value="dark">Oscuro</option>
          <option value="auto">Automático</option>
        </select>
      </label>
    );
  }

  return (
    <div className="theme-selector-compact" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-selector-trigger"
        aria-label={`Cambiar tema de apariencia. Actual: ${preferenceLabels[preference]}`}
        aria-expanded={isOpen}
        aria-controls={optionsId}
        title={`Tema: ${preferenceLabels[preference]}`}
        onClick={() => setIsOpen(open => !open)}
      >
        <CurrentIcon size={19} aria-hidden="true" />
      </button>
      {isOpen && (
        <div id={optionsId} className="theme-selector-menu" role="group" aria-label="Elegir apariencia">
          {options.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="theme-selector-option"
              aria-pressed={preference === value}
              onClick={() => {
                setPreference(value);
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
