import { ArrowLeft } from 'lucide-react';

export default function PageHeading({ title, description, count, actions, onBack }) {
  return <header className="page-heading">
    <div className="page-heading-copy">
      <div className="page-title-row">{onBack && <button type="button" className="page-back" onClick={onBack} aria-label="返回写作空间"><ArrowLeft size={18} /></button>}<h1>{title}</h1>{count != null && <span className="page-count">{count}</span>}</div>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-heading-actions">{actions}</div>}
  </header>;
}
