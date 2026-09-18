import React from 'react';

export default function StatCard({
  title,
  value,
  icon: Icon,
  color = 'cyan',
  subtitle,
  trend,
  onClick
}) {
  const colorMap = {
    cyan: { fg: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
    amber: { fg: 'var(--warn)', bg: 'color-mix(in srgb, var(--warn) 14%, transparent)' },
    red: { fg: 'var(--crit)', bg: 'color-mix(in srgb, var(--crit) 14%, transparent)' },
    emerald: { fg: 'var(--ok)', bg: 'color-mix(in srgb, var(--ok) 14%, transparent)' },
    purple: { fg: 'var(--accent-2)', bg: 'color-mix(in srgb, var(--accent-2) 14%, transparent)' },
    rose: { fg: 'var(--crit)', bg: 'color-mix(in srgb, var(--crit) 12%, transparent)' },
    blue: { fg: 'var(--accent-2)', bg: 'color-mix(in srgb, var(--accent-2) 14%, transparent)' },
    orange: { fg: 'var(--warn)', bg: 'color-mix(in srgb, var(--warn) 16%, transparent)' },
  };

  const tone = colorMap[color] || colorMap.cyan;

  return (
    <div
      onClick={onClick}
      className={`card p-4 relative overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
        {Icon && (
          <div
            className="p-2 rounded-lg"
            style={{ background: tone.bg, color: tone.fg, border: `1px solid color-mix(in srgb, ${tone.fg} 28%, transparent)` }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-2xl lg:text-3xl font-bold tracking-tight font-mono" style={{ color: 'var(--text)' }}>
          {typeof value === 'number' ? value.toLocaleString() : value ?? '0'}
        </span>
        {trend && (
          <span className="text-xs font-mono" style={{ color: 'var(--ok)' }}>
            {trend}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
