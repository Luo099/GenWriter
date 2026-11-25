import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Button from './Button';
import DialogSurface from '../DialogSurface';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { title = '确认操作', confirmText = '确定', cancelText = '取消', danger = false } = {}) => {
    setState({ message, title, confirmText, cancelText, danger });
    return new Promise((resolve) => {
      resolveRef.current?.(false);
      resolveRef.current = resolve;
    });
  }, []);

  const handleClose = useCallback((result) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={() => handleClose(false)}>
          <DialogSurface className="confirm-dialog" label={state.title} onClose={() => handleClose(false)}>
            <h3 className="confirm-title">{state.title}</h3>
            <p className="confirm-message">{state.message}</p>
            <div className="confirm-actions">
              <Button variant="ghost" onClick={() => handleClose(false)}>
                {state.cancelText}
              </Button>
              <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => handleClose(true)}>
                {state.confirmText}
              </Button>
            </div>
          </DialogSurface>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
