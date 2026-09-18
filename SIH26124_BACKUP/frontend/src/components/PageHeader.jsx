import React from 'react';

export default function PageHeader({ title, badge, description, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="page-title flex flex-wrap items-center gap-2">
          {title}
          {badge && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-mono font-medium border"
              style={{
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                borderColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
              }}
            >
              {badge}
            </span>
          )}
        </h1>
        {description && <p className="page-kicker">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
