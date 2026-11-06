import { useEffect, useRef } from 'react';

/** Preserve keyboard focus while a management form is open. */
export default function DialogSurface({ children, className, label, onClose, busy = false }) {
  const surface = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const first = surface.current?.querySelector('input:not(:disabled), textarea:not(:disabled)') || surface.current?.querySelector('button:not(:disabled)');
    (first || surface.current)?.focus();
    return () => previous?.isConnected && previous.focus?.();
  }, []);
  const keyDown = (event) => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const items = [...surface.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={surface} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={keyDown} onClick={(event) => event.stopPropagation()}>{children}</div>;
}
