// src/hooks/useErrorHandler.ts
import { useState, useCallback } from 'react';

interface ErrorState {
  message: string;
  timestamp: number;
}

export function useErrorHandler() {
  const [error, setError] = useState<ErrorState | null>(null);
  
  const handleError = useCallback((err: unknown, fallbackMessage = 'Ocurrió un error inesperado') => {
    let message: string;
    
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === 'string') {
      message = err;
    } else {
      message = fallbackMessage;
    }
    
    setError({
      message,
      timestamp: Date.now()
    });
    
    // Log para debugging
    console.error('🔴 Error capturado:', err);
    
    // Auto-clear después de 5 segundos
    setTimeout(() => {
      setError(prev => {
        // Solo limpiar si es el mismo error
        if (prev?.timestamp === Date.now() - 5000) {
          return null;
        }
        return prev;
      });
    }, 5000);
  }, []);
  
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  return {
    error: error?.message ?? null,
    hasError: error !== null,
    handleError,
    clearError
  };
}

// Wrapper para funciones async con manejo automático de errores
export function withErrorHandler<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  onError: (err: unknown) => void
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (err) {
      onError(err);
      throw err; // Re-lanzar para que el caller pueda manejar si quiere
    }
  }) as T;
}