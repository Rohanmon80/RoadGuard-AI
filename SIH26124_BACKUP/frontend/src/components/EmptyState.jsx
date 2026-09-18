import React from 'react';

export default function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>
      {Icon && <Icon className="w-8 h-8 mx-auto mb-2 opacity-50" />}
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{title}</p>
      {description && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{description}</p>}
    </div>
  );
}
