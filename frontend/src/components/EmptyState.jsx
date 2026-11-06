import { BookOpen, ArrowUpRight, Search } from 'lucide-react';

export default function EmptyState({ title, action, onAction, filtered = false }) {
  return <div className="designed-empty" role="status">
    <div className="empty-illustration" aria-hidden="true"><span className="empty-sheet" /><span className="empty-sheet front">{filtered ? <Search size={28} /> : <BookOpen size={28} />}<i /><i /><i /></span></div>
    <p className="empty-title">{title}</p>
    {action && <button type="button" className="workspace-primary" onClick={onAction}>{action}<ArrowUpRight size={15} /></button>}
  </div>;
}
