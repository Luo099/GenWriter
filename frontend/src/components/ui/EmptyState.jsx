export default function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="panel-empty">
      {Icon && <Icon size={32} strokeWidth={1.5} className="panel-empty-icon" />}
      <p>{title}</p>
      {hint && <span>{hint}</span>}
      {action}
    </div>
  );
}
