// src/components/ErrorToast.tsx
import { AlertCircle, X } from 'lucide-react';
import { useEffect } from 'react';

interface ErrorToastProps {
  message: string;
  onClose: () => void;
  duration?: number; // ms
}

export function ErrorToast({ message, onClose, duration = 5000 }: ErrorToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);
  
  return (
    <div className="error-toast">
      <div className="error-toast-content">
        <AlertCircle size={20} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{message}</span>
        <button
          onClick={onClose}
          className="error-toast-close"
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
