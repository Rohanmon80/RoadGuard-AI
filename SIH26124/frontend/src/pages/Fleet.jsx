import React, { useEffect, useState } from 'react';
import { Bus, Camera, Navigation, Radio } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

import { fetchBuses, fetchRoutes } from '../api';
import { useSystem } from '../context/SystemContext';

function statusColor(status) {
  if (status === 'live') return 'var(--ok)';
  if (status === 'idle') return 'var(--warn)';
  return 'var(--text-muted)';
}

export default function Fleet() {
  const { busId, setBusId } = useSystem();
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);

  useEffect(() => {
    fetchBuses().then(setBuses).catch(() => setBuses([]));
    fetchRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, []);

  const live = buses.filter((b) => b.status === 'live').length;
  const activeWithGps = buses.filter((b) => b.current_lat != null && b.current_lng != null).length;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Fleet"
        badge="EDGE NODES"
        description="Bus-mounted cameras acting as a moving urban sensor network."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard title="Active Buses" value={live} icon={Bus} color="emerald" subtitle={`${buses.length} in network`} />
        <StatCard title="GPS Available" value={activeWithGps} icon={Navigation} color="cyan" subtitle="Real-time location" />
        <StatCard title="Selected Node" value={busId || 'None'} icon={Navigation} color="amber" subtitle="Command-center focus" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {buses.map((bus) => {
          const route = routes.find((r) => r.bus_number === bus.bus_number);
          const selected = bus.bus_number === busId;
          const tone = statusColor(bus.status);
          return (
            <button
              key={bus.bus_number}
              type="button"
              onClick={() => setBusId(bus.bus_number)}
              className="card p-4 text-left"
              style={{
                borderColor: selected ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'var(--border)',
                outline: selected ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{bus.bus_number}</div>
                  <div className="text-sm font-semibold mt-0.5">
                    {route?.route_name || 'Not configured'}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {route?.direction || 'Not configured'}
                  </div>
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
                  <div className="font-mono font-semibold">N/A</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-subtle)' }}>Occupancy</div>
                  <div className="font-mono font-semibold">N/A</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-subtle)' }}>Camera</div>
                  <div className="font-semibold capitalize">Not reported</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <span>
                  {bus.current_lat !== null && bus.current_lng !== null
                    ? `${bus.current_lat.toFixed(4)}, ${bus.current_lng.toFixed(4)}`
                    : 'Location unavailable'}
                </span>
                <span>
                  {bus.last_updated ? new Date(bus.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '---'}
                </span>
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
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {buses.map((bus) => {
                const route = routes.find((r) => r.bus_number === bus.bus_number);
                return (
                  <tr key={bus.bus_number} onClick={() => setBusId(bus.bus_number)} className="cursor-pointer">
                    <td className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{bus.bus_number}</td>
                    <td>{route?.route_name || 'Not configured'}</td>
                    <td style={{ color: statusColor(bus.status) }}>{statusLabel(bus.status)}</td>
                    <td className="capitalize">Not reported</td>
                    <td className="font-mono">N/A</td>
                    <td className="font-mono" style={{ color: 'var(--text-muted)' }}>
                      {bus.last_updated ? new Date(bus.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '---'}
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
