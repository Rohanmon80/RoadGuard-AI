import React, { useEffect, useMemo, useState } from 'react';
import { Car, AlertTriangle, Activity, Gauge } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { fetchIncidents, fetchStats, subscribeWebSocket } from '../api';

const HOURS = ['06', '08', '10', '12', '14', '16', '18', '20', '22'];

function hourBucket(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const nearest = HOURS.reduce((best, cur) => (
    Math.abs(Number(cur) - h) < Math.abs(Number(best) - h) ? cur : best
  ), HOURS[0]);
  return nearest;
}

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [incidents, setIncidents] = useState([]);

  const load = async () => {
    try {
      const [s, i] = await Promise.all([fetchStats(), fetchIncidents({ limit: 300 })]);
      setStats(s);
      setIncidents(i);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  };

  useEffect(() => {
    load();
    const unsub = subscribeWebSocket((msg) => {
      if (msg.event === 'stats_update') setStats(msg.data);
      if (msg.event === 'new_incident') setIncidents((prev) => [msg.data, ...prev]);
    });
    return () => unsub();
  }, []);

  const typeCounts = useMemo(() => {
    const map = {};
    incidents.forEach((inc) => {
      const key = (inc.type || 'other').replace('_', ' ');
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [incidents]);

  const hourly = useMemo(() => {
    const buckets = Object.fromEntries(HOURS.map((h) => [h, 0]));
    incidents.forEach((inc) => {
      const b = hourBucket(inc.timestamp);
      if (b) buckets[b] += 1;
    });
    return HOURS.map((h) => ({ hour: `${h}:00`, count: buckets[h] }));
  }, [incidents]);

  const maxHour = Math.max(1, ...hourly.map((h) => h.count));
  const maxType = Math.max(1, ...typeCounts.map(([, n]) => n));
  const openRate = stats?.total_incidents
    ? Math.round((stats.open_incidents / stats.total_incidents) * 100)
    : 0;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Traffic Analytics"
        badge="CORRIDOR INSIGHTS"
        description="Volume, hazard mix and peak-hour pressure from bus-mounted computer vision."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard title="Traffic Events" value={stats?.traffic_events ?? 0} icon={Car} color="blue" subtitle="Logged vehicle events" />
        <StatCard title="Vehicles Detected" value={stats?.vehicles_detected ?? 0} icon={Activity} color="emerald" subtitle="AI object counts" />
        <StatCard title="Open Hazard Rate" value={`${openRate}%`} icon={AlertTriangle} color="amber" subtitle="Open vs total incidents" />
        <StatCard title="Peak Hour Load" value={hourly.reduce((a, b) => (b.count > a.count ? b : a), hourly[0]).hour} icon={Gauge} color="cyan" subtitle="Highest incident window" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider">Incident volume by hour</h2>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-subtle)' }}>n = {incidents.length}</span>
          </div>
          <div className="flex items-end gap-2 h-48">
            {hourly.map((h) => {
              const height = Math.max(4, Math.round((h.count / maxHour) * 100));
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{h.count}</span>
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${height}%`, background: 'var(--accent-2)', minHeight: '4px' }}
                    title={`${h.hour}: ${h.count} incidents`}
                  />
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-subtle)' }}>{h.hour.replace(':00', '')}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider">Hazard mix</h2>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-subtle)' }}>Top classes</span>
          </div>
          {typeCounts.length === 0 ? (
            <p className="text-xs py-10 text-center" style={{ color: 'var(--text-subtle)' }}>No detections yet.</p>
          ) : (
            <div className="space-y-3">
              {typeCounts.map(([label, count], idx) => {
                const pct = Math.round((count / maxType) * 100);
                const colors = ['var(--accent-2)', 'var(--accent)', 'var(--ok)', 'var(--warn)'];
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{label}</span>
                      <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{count}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[idx] || 'var(--accent-2)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)' }}>
          Corridor snapshot
        </div>
        <div className="table-shell" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Corridor</th>
                <th>Incidents</th>
                <th>Critical</th>
                <th>Open</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Zone N (lat>22.5)', match: (i) => i.lat > 22.5 },
                { name: 'Zone S (lat<=22.5)', match: (i) => i.lat <= 22.5 },
                { name: 'Zone E (lng>88.3)', match: (i) => i.lng > 88.3 },
                { name: 'Zone W (lng<=88.3)', match: (i) => i.lng <= 88.3 },
              ].map((row) => {
                const rows = incidents.filter(row.match);
                const crit = rows.filter((i) => i.severity === 'CRITICAL').length;
                const open = rows.filter((i) => i.status === 'open').length;
                return (
                  <tr key={row.name}>
                    <td className="font-semibold">{row.name}</td>
                    <td className="font-mono">{rows.length}</td>
                    <td className="font-mono" style={{ color: crit ? 'var(--crit)' : 'var(--text-muted)' }}>{crit}</td>
                    <td className="font-mono">{open}</td>
                    <td>
                      <span className="chip" style={{ color: open > 3 ? 'var(--warn)' : 'var(--ok)', borderColor: 'currentColor' }}>
                        {open > 3 ? 'Congested' : 'Stable'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
