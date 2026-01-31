// src/features/match-creation/hooks/useMatchConfig.ts
import { useState, useCallback } from 'react';
import type { MatchConfig, GameMode } from '../../../db/models';
import { getDefaultConfig, validateMatchConfig } from '../../../config/validations';

export function useMatchConfig(initialMode: GameMode = 'traditional') {
  const [config, setConfig] = useState<MatchConfig>(() => getDefaultConfig(initialMode));

  // Cambiar modo de juego
  const changeMode = useCallback((mode: GameMode) => {
    setConfig(getDefaultConfig(mode));
  }, []);

  // Actualizar configuración tradicional
  const updateTraditional = useCallback((updates: Partial<MatchConfig['traditional']>) => {
    setConfig(prev => {
      if (prev.mode !== 'traditional' || !prev.traditional) return prev;
      return {
        ...prev,
        traditional: { ...prev.traditional, ...updates }
      };
    });
  }, []);

  // Actualizar configuración race
  const updateRace = useCallback((updates: Partial<MatchConfig['race']>) => {
    setConfig(prev => {
      if (prev.mode !== 'race' || !prev.race) return prev;
      return {
        ...prev,
        race: { ...prev.race, ...updates }
      };
    });
  }, []);

  // Actualizar configuración best-of
  const updateBestOf = useCallback((updates: Partial<MatchConfig['bestOf']>) => {
    setConfig(prev => {
      if (prev.mode !== 'best-of-series' || !prev.bestOf) return prev;
      return {
        ...prev,
        bestOf: { ...prev.bestOf, ...updates }
      };
    });
  }, []);

  // Validar configuración actual
  const validation = validateMatchConfig(config);

  return {
    config,
    changeMode,
    updateTraditional,
    updateRace,
    updateBestOf,
    validation,
    isValid: validation.isValid
  };
}