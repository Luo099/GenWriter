import { useEffect, useRef } from 'react';
import '../styles/global.css';

/**
 * A reusable confirmation dialog with animated overlay and keyboard support.
 *
 * Usage: set `confirmState` to `{ open: true, title, message, onConfirm, confirmText? }`
 * to show the dialog. Set `{ open: false }` to hide it.
 */
const ConfirmDialog = ({ state, onClose }) => {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (state.open) {
      dialogRef.current?.focus();
    }
  }, [state.open]);

  useEffect(() => {
    if (state.open) {
      const handler = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [state.open, onClose]);

  if (!state.open) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') {
      state.onConfirm?.();
      onClose();
    }
  };

  const confirmText = state.confirmText || '确认';
  const cancelText = state.cancelText || '取消';
  const variant = state.variant || 'danger'; // 'danger' | 'warning' | 'info'

  const variantClasses = {
    danger: 'confirm-dialog-btn--danger',
    warning: 'confirm-dialog-btn--warning',
    info: 'confirm-dialog-btn--info',
  };

  return (
    <div
      className="confirm-dialog-overlay confirm-dialog-overlay--open"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="confirm-dialog confirm-dialog--open" ref={dialogRef} tabIndex={-1}>
        <div className="confirm-dialog-icon">
          {variant === 'danger' && (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          )}
          {variant === 'warning' && (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          )}
          {variant === 'info' && (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          )}
        </div>
        {state.title && <h3 className="confirm-dialog-title">{state.title}</h3>}
        <p className="confirm-dialog-message">{state.message}</p>
        <div className="confirm-dialog-footer">
          <button className="confirm-dialog-btn" onClick={onClose}>
            {cancelText}
          </button>
          <button
            className={`confirm-dialog-btn ${variantClasses[variant]}`}
            onClick={() => {
              state.onConfirm?.();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
