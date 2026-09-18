import React, { useState, useEffect } from 'react';
import { Filter, RefreshCw, Navigation, Compass, MapPin } from 'lucide-react';
import MapView from '../components/MapView';
import { fetchIncidents, updateIncident, subscribeWebSocket } from '../api';

export default function MapPage() {
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const loadIncidents = async () => {
    try {
      setLoading(true);
      const data = await fetchIncidents({ limit: 200 });
      setIncidents(data);
    } catch (err) {
      console.error('Failed to load incidents for map:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
    const unsubscribe = subscribeWebSocket((msg) => {
      if (msg.event === 'new_incident') {
        setIncidents((prev) => [msg.data, ...prev]);
      } else if (msg.event === 'incident_updated') {
        setIncidents((prev) => prev.map((i) => (i.id === msg.data.id ? msg.data : i)));
      } else if (msg.event === 'incident_deleted') {
        setIncidents((prev) => prev.filter((i) => i.id !== msg.data.id));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let result = incidents;
    if (severityFilter !== 'ALL') result = result.filter((i) => (i.severity || '').toUpperCase() === severityFilter);
    if (typeFilter !== 'ALL') result = result.filter((i) => (i.type || '').toLowerCase() === typeFilter.toLowerCase());
    if (statusFilter !== 'ALL') result = result.filter((i) => (i.status || '').toLowerCase() === statusFilter.toLowerCase());
    setFilteredIncidents(result);
  }, [incidents, severityFilter, typeFilter, statusFilter]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      const updated = await updateIncident(id, { status: newStatus });
      setIncidents((prev) => prev.map((i) => (i.id === id ? updated : i)));
      if (selectedIncident && selectedIncident.id === id) setSelectedIncident(updated);
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const severityTone = (sev) => {
    if (sev === 'CRITICAL') return 'var(--crit)';
    if (sev === 'HIGH') return '#f97316';
    return 'var(--warn)';
  };

  return (
    <div className="h-[calc(100vh-7.5rem)] flex flex-col space-y-4 pb-2">
      <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="font-bold uppercase tracking-wider">GIS Map Filters</span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ({filteredIncidents.length} shown of {incidents.length})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="field px-2.5 py-1.5">
            <option value="ALL">Severity: All</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field px-2.5 py-1.5">
            <option value="ALL">Type: All</option>
            <option value="pothole">Pothole</option>
            <option value="road_damage">Road Damage</option>
            <option value="pedestrian">Pedestrian</option>
            <option value="car">Car</option>
            <option value="truck">Truck</option>
            <option value="bus">Bus</option>
            <option value="bike">Bike</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="field px-2.5 py-1.5">
            <option value="ALL">Status: All</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={loadIncidents} className="btn-secondary p-1.5" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        <div className="lg:col-span-3 h-full rounded-xl overflow-hidden relative min-h-[360px]">
          <MapView
            incidents={filteredIncidents}
            selectedIncident={selectedIncident}
            onMarkerClick={(inc) => setSelectedIncident(inc)}
            height="100%"
            zoom={13}
          />
        </div>

        <div className="card p-4 flex flex-col justify-between overflow-y-auto space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                Selected Telemetry
              </h2>
              {selectedIncident && (
                <button onClick={() => setSelectedIncident(null)} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Clear
                </button>
              )}
            </div>

            {selectedIncident ? (
              <div className="space-y-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm" style={{ color: 'var(--accent)' }}>#{selectedIncident.id}</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border"
                    style={{
                      color: severityTone(selectedIncident.severity),
                      background: `color-mix(in srgb, ${severityTone(selectedIncident.severity)} 14%, transparent)`,
                      borderColor: `color-mix(in srgb, ${severityTone(selectedIncident.severity)} 40%, transparent)`,
                    }}
                  >
                    {selectedIncident.severity}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Anomaly Type</span>
                  <div className="font-bold capitalize text-sm">{selectedIncident.type.replace('_', ' ')}</div>
                </div>
                <div>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Description</span>
                  <p className="text-xs mt-0.5 p-2 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    {selectedIncident.description || 'No description attached.'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>GPS Coordinates</span>
                  <div className="p-2 rounded font-mono text-[11px] flex items-center gap-1.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--accent)' }}>
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span>{selectedIncident.lat.toFixed(5)}, {selectedIncident.lng.toFixed(5)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Confidence</span>
                    <div className="font-mono font-bold" style={{ color: 'var(--ok)' }}>
                      {Math.round((selectedIncident.confidence || 1) * 100)}%
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Video Ref</span>
                    <div className="font-mono">{selectedIncident.video_id ? `#${selectedIncident.video_id}` : 'Manual'}</div>
                  </div>
                </div>
                <div className="space-y-1 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Resolution Status</span>
                  <select value={selectedIncident.status} onChange={(e) => handleStatusChange(selectedIncident.id, e.target.value)} className="field p-2 text-xs">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 space-y-2" style={{ color: 'var(--text-subtle)' }}>
                <Compass className="w-8 h-8 mx-auto opacity-40" />
                <p className="text-xs">Click any map marker to view detailed telemetry</p>
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg text-[11px] space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Severity Legend</span>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--crit)' }} />CRITICAL</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f97316' }} />HIGH</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--warn)' }} />MEDIUM</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent-2)' }} />LOW</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
