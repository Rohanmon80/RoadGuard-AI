import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileBarChart, RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { fetchIncidents, fetchStats, fetchVideos } from '../api';

export default function Reports() {
  const [stats, setStats] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [s, i, v] = await Promise.all([
        fetchStats(),
        fetchIncidents({ limit: 300 }),
        fetchVideos(),
      ]);
      setStats(s);
      setIncidents(i);
      setVideos(v);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const completedVideos = videos.filter((v) => v.status === 'completed').length;
  const resolved = incidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length;
  const resolutionRate = incidents.length ? Math.round((resolved / incidents.length) * 100) : 0;

  const summaryRows = useMemo(() => ([
    { metric: 'Total incidents', value: stats?.total_incidents ?? incidents.length },
    { metric: 'Open incidents', value: stats?.open_incidents ?? 0 },
    { metric: 'Critical alerts', value: stats?.critical_incidents ?? 0 },
    { metric: 'Potholes', value: stats?.potholes ?? 0 },
    { metric: 'Road damage', value: stats?.road_damage ?? 0 },
    { metric: 'Traffic events', value: stats?.traffic_events ?? 0 },
    { metric: 'Pedestrian safety', value: stats?.pedestrian_safety ?? 0 },
    { metric: 'Vehicles detected', value: stats?.vehicles_detected ?? 0 },
    { metric: 'Videos processed', value: completedVideos },
    { metric: 'Resolution rate', value: `${resolutionRate}%` },
  ]), [stats, incidents.length, completedVideos, resolutionRate]);

  const exportCSV = () => {
    const headers = ['Metric', 'Value'];
    const rows = summaryRows.map((r) => [r.metric, r.value]);
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `bussense_ops_report_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Reports"
        badge="OPS BRIEF"
        description="Exportable operations snapshot for municipal review and SIH demo walkthroughs."
        actions={
          <>
            <button onClick={exportCSV} className="btn-primary px-3 py-2 text-xs">
              <Download className="w-3.5 h-3.5" />
              Export summary
            </button>
            <button onClick={load} className="btn-secondary p-2" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard title="Videos Processed" value={completedVideos} icon={FileBarChart} color="cyan" subtitle={`${videos.length} uploaded`} />
        <StatCard title="Resolution Rate" value={`${resolutionRate}%`} icon={FileBarChart} color="emerald" subtitle="Closed + resolved" />
        <StatCard title="Open Queue" value={stats?.open_incidents ?? 0} icon={FileBarChart} color="amber" subtitle="Awaiting action" />
        <StatCard title="Critical Queue" value={stats?.critical_incidents ?? 0} icon={FileBarChart} color="red" subtitle="Priority hazards" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)' }}>
            Operations summary
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.metric}>
                  <td>{row.metric}</td>
                  <td className="font-mono font-semibold">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)' }}>
            Recent footage jobs
          </div>
          {videos.length === 0 ? (
            <p className="p-6 text-xs" style={{ color: 'var(--text-subtle)' }}>No footage jobs yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>File</th>
                  <th>Status</th>
                  <th>Frames</th>
                </tr>
              </thead>
              <tbody>
                {videos.slice(0, 8).map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono" style={{ color: 'var(--accent)' }}>#{v.id}</td>
                    <td className="truncate max-w-[180px]">{v.original_name || v.filename}</td>
                    <td className="uppercase text-[11px]">{v.status}</td>
                    <td className="font-mono">{v.total_frames || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
