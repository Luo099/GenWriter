import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { formatVersionTime, getDocumentSourceLabel } from '../utils/version';

const sortVersions = (documents) => [...documents].sort((left, right) =>
  (right.version || 0) - (left.version || 0)
  || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());

export default function VersionNavigator({ documents, selectedId, dirty, loading, onSelect }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef(null);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const versions = useMemo(() => sortVersions(documents), [documents]);
  const selectedIndex = Math.max(0, versions.findIndex((entry) => entry.id === selectedId));
  const selectedDocument = versions[selectedIndex];

  useEffect(() => {
    if (!historyOpen) return undefined;
    const trigger = triggerRef.current;
    closeButtonRef.current?.focus();
    return () => trigger?.focus();
  }, [historyOpen]);

  const closeHistory = () => setHistoryOpen(false);

  const handleDrawerKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeHistory();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = drawerRef.current?.querySelectorAll('button:not(:disabled)');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (loading || !selectedDocument) return null;

  return <div className="version-compact">
    <button className="workspace-action version-trigger" type="button" ref={triggerRef} aria-haspopup="dialog"
      aria-expanded={historyOpen} aria-keyshortcuts="ArrowLeft ArrowRight"
      aria-label={`版本历史，当前查看 V${selectedDocument.version}`}
      title={versions.length > 1 ? '版本历史 · ← 较早版本 / → 较新版本' : '版本历史'}
      onClick={() => setHistoryOpen(true)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const adjacent = versions[selectedIndex + (event.key === 'ArrowLeft' ? 1 : -1)];
        if (adjacent) onSelect(adjacent);
      }}>
      <span>V{selectedDocument.version}</span><ChevronDown size={13} />
    </button>

    {historyOpen && <div className="version-drawer-layer" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeHistory();
    }}>
      <div ref={drawerRef} className="version-history-drawer" role="dialog" aria-modal="true"
        aria-labelledby={titleId} onKeyDown={handleDrawerKeyDown}>
        <header className="version-history-header">
          <div><h3 id={titleId}>版本历史</h3>{dirty && <p className="workspace-muted">当前正文有未保存修改</p>}</div>
          <button ref={closeButtonRef} className="version-icon-action" type="button" aria-label="关闭版本历史"
            onClick={closeHistory}><X size={18} /></button>
        </header>
        <div className="version-history-list">
          {versions.map((entry, index) => <button className={`version-history-item${index === selectedIndex ? ' active' : ''}`}
            type="button" key={entry.id} aria-current={index === selectedIndex ? 'true' : undefined}
            onClick={() => { closeHistory(); onSelect(entry); }}>
            <span className="version-history-number">V{entry.version}</span>
            <span className="version-history-copy">
              <span className="version-history-title" title={entry.title || '未命名文稿'}>{entry.title || '未命名文稿'}</span>
              <small>{getDocumentSourceLabel(entry)} · {formatVersionTime(entry.updatedAt)}</small>
            </span>
            {index === 0 && <span className="version-badge latest">最新</span>}
          </button>)}
        </div>
      </div>
    </div>}
  </div>;
}
