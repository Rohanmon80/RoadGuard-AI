import React from 'react';
import { Bus, Camera, Navigation, Radio } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { FLEET_BUSES, statusLabel } from '../data/fleet';
import { useSystem } from '../context/SystemContext';

function statusColor(status) {
  if (status === 'live') return 'var(--ok)';
  if (status === 'idle') return 'var(--warn)';
  return 'var(--text-muted)';
}

export default function Fleet() {
  const { busId, setBusId } = useSystem();
  const live = FLEET_BUSES.filter((b) => b.status === 'live').length;
  const cameras = FLEET_BUSES.filter((b) => b.camera === 'active').length;
  const detections = FLEET_BUSES.reduce((sum, b) => sum + b.detectionsToday, 0);

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Fleet"
        badge="EDGE NODES"
        description="Bus-mounted cameras acting as a moving urban sensor network."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard title="Active Buses" value={live} icon={Bus} color="emerald" subtitle={`${FLEET_BUSES.length} in network`} />
        <StatCard title="Cameras Live" value={cameras} icon={Camera} color="cyan" subtitle="YOLOv8 edge inference" />
        <StatCard title="Detections Today" value={detections} icon={Radio} color="blue" subtitle="Fleet-wide objects" />
        <StatCard title="Selected Node" value={busId} icon={Navigation} color="amber" subtitle="Command-center focus" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {FLEET_BUSES.map((bus) => {
          const selected = bus.id === busId;
          const tone = statusColor(bus.status);
          return (
            <button
              key={bus.id}
              type="button"
              onClick={() => setBusId(bus.id)}
              className="card p-4 text-left"
              style={{
                borderColor: selected ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'var(--border)',
                outline: selected ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{bus.id}</div>
                  <div className="text-sm font-semibold mt-0.5">{bus.route}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{bus.corridor}</div>
                </div>
                <span
                  className="chip"
                  style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
                  {statusLabel(bus.status)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-[11px]">
                <div>
                  <div style={{ color: 'var(--text-subtle)' }}>Speed</div>
                  <div className="font-mono font-semibold">{bus.speedKph} km/h</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-subtle)' }}>Occupancy</div>
                  <div className="font-mono font-semibold">{bus.occupancy}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-subtle)' }}>Camera</div>
                  <div className="font-semibold capitalize">{bus.camera}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <span>{bus.lat.toFixed(4)}, {bus.lng.toFixed(4)}</span>
                <span>{bus.lastPing}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)' }}>
          Fleet roster
        </div>
        <div className="table-shell" style={{ border: 'none', borderRadius: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Bus</th>
                <th>Route</th>
                <th>Status</th>
                <th>Camera</th>
                <th>Speed</th>
                <th>Detections</th>
                <th>Last ping</th>
              </tr>
            </thead>
            <tbody>
              {FLEET_BUSES.map((bus) => (
                <tr key={bus.id} onClick={() => setBusId(bus.id)} className="cursor-pointer">
                  <td className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{bus.id}</td>
                  <td>{bus.route}</td>
                  <td style={{ color: statusColor(bus.status) }}>{statusLabel(bus.status)}</td>
                  <td className="capitalize">{bus.camera}</td>
                  <td className="font-mono">{bus.speedKph}</td>
                  <td className="font-mono">{bus.detectionsToday}</td>
                  <td className="font-mono" style={{ color: 'var(--text-muted)' }}>{bus.lastPing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
