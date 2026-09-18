import React from 'react';
import { AlertTriangle, MapPin, Eye, Trash2 } from 'lucide-react';
import EmptyState from './EmptyState';

export default function IncidentTable({
  incidents = [],
  onStatusChange,
  onDelete,
  onSelectIncident,
  compact = false
}) {
  const getSeverityBadge = (sev) => {
    const s = (sev || '').toUpperCase();
    if (s === 'CRITICAL') return { color: 'var(--crit)', pulse: true };
    if (s === 'HIGH') return { color: 'var(--warn)', pulse: false };
    if (s === 'MEDIUM') return { color: 'var(--warn)', pulse: false };
    return { color: 'var(--accent-2)', pulse: false };
  };

  const getStatusColor = (status) => {
    if (status === 'open') return 'var(--crit)';
    if (status === 'in_progress') return 'var(--warn)';
    if (status === 'resolved') return 'var(--ok)';
    return 'var(--text-muted)';
  };

  const formatTime = (ts) => {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  if (incidents.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No incidents recorded yet"
        description="Upload a video or report a manual incident to see records populate in real time."
      />
    );
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Severity</th>
            <th>Location (Lat, Lng)</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>Time</th>
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((inc) => {
            const sev = getSeverityBadge(inc.severity);
            const statusColor = getStatusColor(inc.status);
            return (
              <tr
                key={inc.id}
                className="cursor-pointer"
                onClick={() => onSelectIncident && onSelectIncident(inc)}
              >
                <td className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
                  #{inc.id}
                </td>
                <td>
                  <div className="font-semibold capitalize flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--accent)' }} />
                    {(inc.type || '').replace('_', ' ')}
                  </div>
                  {inc.description && !compact && (
                    <div className="text-[10px] truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                      {inc.description}
                    </div>
                  )}
                </td>
                <td>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border ${sev.pulse ? 'live-beacon' : ''}`}
                    style={{
                      color: sev.color,
                      background: `color-mix(in srgb, ${sev.color} 14%, transparent)`,
                      borderColor: `color-mix(in srgb, ${sev.color} 40%, transparent)`,
                    }}
                  >
                    {inc.severity}
                  </span>
                </td>
                <td className="font-mono text-[11px]">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />
                    <span>{inc.lat?.toFixed(4)}, {inc.lng?.toFixed(4)}</span>
                  </div>
                </td>
                <td className="font-mono text-[11px]">
                  {inc.confidence ? `${Math.round(inc.confidence * 100)}%` : '100%'}
                </td>
                <td>
                  {onStatusChange ? (
                    <select
                      value={inc.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onStatusChange(inc.id, e.target.value)}
                      className="field text-[11px] font-medium px-2 py-0.5"
                      style={{ color: statusColor }}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  ) : (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
                      style={{
                        color: statusColor,
                        background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
                        borderColor: `color-mix(in srgb, ${statusColor} 35%, transparent)`,
                      }}
                    >
                      {inc.status}
                    </span>
                  )}
                </td>
                <td className="font-mono text-[11px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                  {formatTime(inc.timestamp)}
                </td>
                <td className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {onSelectIncident && (
                      <button
                        onClick={() => onSelectIncident(inc)}
                        title="View on Map"
                        className="p-1 rounded"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(inc.id)}
                        title="Delete Incident"
                        className="p-1 rounded"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
