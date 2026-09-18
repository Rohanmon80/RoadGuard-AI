import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSystem } from '../context/SystemContext';
import {
  Bus,
  Car,
  AlertTriangle,
  Flame,
  Clock,
  Activity,
  MapPin,
  Sparkles,
  ShieldAlert,
  Video as VideoIcon,
  Plus,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Navigation,
  Eye,
  Cpu,
  Satellite,
  Server,
  ArrowUpRight,
  TrendingUp,
  SlidersHorizontal,
  X
} from 'lucide-react';
import StatCard from '../components/StatCard';
import MapView from '../components/MapView';
import PageHeader from '../components/PageHeader';
import {
  fetchStats,
  fetchIncidents,
  fetchDetections,
  updateIncident,
  deleteIncident,
  createManualIncident,
  subscribeWebSocket,
  fetchBuses,
  fetchRoutes,
} from '../api';

export default function Dashboard() {
  const navigate = useNavigate();
   const {
    gpsLat,
    gpsLng,
    gpsLocked,
    gpsSource,
    gpsError,
    getCurrentPosition,
  } = useSystem();

  // Primary State
  const [stats, setStats] = useState({
    total_incidents: 0,
    open_incidents: 0,
    critical_incidents: 0,
    potholes: 0,
    road_damage: 0,
    traffic_events: 0,
    pedestrian_safety: 0,
    vehicles_detected: 0,
    route_delay_min: 0,
  });

  const [incidents, setIncidents] = useState([]);
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [inspectModalIncident, setInspectModalIncident] = useState(null);
  const [showQuickModal, setShowQuickModal] = useState(false);
  const [mapFilter, setMapFilter] = useState('all'); // 'all' | 'buses' | 'potholes' | 'traffic' | 'pedestrian'
  const [selectedLocation, setSelectedLocation] = useState(null);

  // Manual Quick Incident Form State
  const [modalForm, setModalForm] = useState({
    type: 'pothole',
    severity: 'HIGH',
    lat: '',
    lng: '',
    bus_id: '',
    description: ''
  });

  // Load backend data
  const loadData = async () => {
    try {
      setLoading(true);
      const [
  statsData,
  incidentsData,
  busesData,
  routesData,
  detectionsData,
] = await Promise.all([
  fetchStats(),
  fetchIncidents({ limit: 15 }),
  fetchBuses(),
  fetchRoutes(),
  fetchDetections({ limit: 20 }),
]);

      if (statsData) {
        setStats((prev) => ({
          ...prev,
          ...statsData,
          route_delay_min: statsData.route_delay_min ?? 0,
          vehicles_detected: statsData.vehicles_detected ?? 0,
        }));
      }

      if (Array.isArray(incidentsData)) {
        setIncidents(incidentsData);
      }

      if (Array.isArray(busesData)) {
        setBuses(busesData);
      }

      if (Array.isArray(routesData)) {
        setRoutes(routesData);
      }

      if (Array.isArray(detectionsData)) {
        setDetections(
          detectionsData.map((det) => ({
            ...det,
            type: (det.type || "unknown").replace(/_/g, " ").toUpperCase(),
            confidence: det.confidence ?? null,
            time: det.timestamp
              ? new Date(det.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—",
            location:
              Number.isFinite(Number(det.lat)) && Number.isFinite(Number(det.lng))
                ? `${Number(det.lat).toFixed(4)}, ${Number(det.lng).toFixed(4)}`
                : "Location unavailable",
            severity: det.severity || "—",
            bus_id: det.bus_id || null,
            icon:
              det.type === "pothole"
                ? AlertTriangle
                : det.type === "car"
                  ? Car
                  : ShieldAlert,
          }))
        );
      }

    } catch (err) {
      console.warn('Using empty fallback data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to live WebSocket events
    const unsubscribe = subscribeWebSocket((msg) => {
      if (msg.event === 'stats_update') {
        setStats((prev) => ({ ...prev, ...msg.data }));
      } else if (msg.event === 'new_incident') {
        const newInc = {
          ...msg.data,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          bus_id: msg.data.bus_id || null,
        };
        setIncidents((prev) => [newInc, ...prev]);

        // Prepend to Live Detection Feed
        const newDet = {
          id: `det-${Date.now()}`,
          type: (msg.data.type || 'ROAD ISSUE').replace(/_/g, ' ').toUpperCase(),
          confidence: msg.data.confidence ?? null,
          time: newInc.time,
          bus_id: newInc.bus_id,
          location: msg.data.description || `${msg.data.lat?.toFixed(3)}, ${msg.data.lng?.toFixed(3)}`,
          severity: msg.data.severity || 'LOW',
          icon: msg.data.type === 'pothole' ? AlertTriangle : msg.data.type === 'traffic' ? Car : ShieldAlert,
          color: msg.data.severity === 'CRITICAL' ? '#ef4444' : '#f97316',
        };
        setDetections((prev) => [newDet, ...prev.slice(0, 7)]);

        // Update top stats
        setStats((prev) => ({
          ...prev,
          total_incidents: (prev.total_incidents || 0) + 1,
          open_incidents: (prev.open_incidents || 0) + 1,
          critical_incidents:
            msg.data.severity === 'CRITICAL'
              ? (prev.critical_incidents || 0) + 1
              : prev.critical_incidents,
          potholes:
            msg.data.type === 'pothole' ? (prev.potholes || 0) + 1 : prev.potholes,
        }));
      } else if (msg.event === 'incident_updated') {
        setIncidents((prev) =>
          prev.map((i) => (i.id === msg.data.id ? { ...i, ...msg.data } : i))
        );
      } else if (msg.event === 'incident_deleted') {
        setIncidents((prev) => prev.filter((i) => i.id !== msg.data.id));
      }
    });

    return () => unsubscribe();
  }, []);

  // Filtered incidents for the GIS Map
  const filteredMapIncidents = useMemo(() => {
    if (mapFilter === 'all') return incidents;
    if (mapFilter === 'buses') return [];
    if (mapFilter === 'potholes') {
      return incidents.filter((i) => (i.type || '').includes('pothole') || (i.type || '').includes('damage') || (i.type || '').includes('road'));
    }
    if (mapFilter === 'traffic') {
      return incidents.filter((i) => (i.type || '').includes('traffic') || (i.type || '').includes('congestion') || (i.type || '').includes('car'));
    }
    if (mapFilter === 'pedestrian') {
      return incidents.filter((i) => (i.type || '').includes('pedestrian') || (i.type || '').includes('safety'));
    }
    return incidents;
  }, [incidents, mapFilter]);

  const filteredMapBuses = useMemo(() => {
    if (mapFilter === 'potholes' || mapFilter === 'pedestrian') return [];

    return buses.map((bus) => {
      const route = routes.find((r) => r.bus_number === bus.bus_number);
      return {
        ...bus,
        id: bus.bus_number,
        lat: bus.current_lat,
        lng: bus.current_lng,
        route: route?.route_name || bus.route_name || 'Route not configured',
        corridor: route?.direction || route?.route_name || 'Route not configured',
      };
    }).filter((bus) => Number.isFinite(bus.lat) && Number.isFinite(bus.lng));
  }, [buses, routes, mapFilter]);

  // Status Change Handler
  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateIncident(id, { status: newStatus }).catch(() => null);
      setIncidents((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: newStatus } : i))
      );
      if (inspectModalIncident && inspectModalIncident.id === id) {
        setInspectModalIncident((prev) => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  // View on Map Handler
  const handleViewOnMap = (incident) => {
    setSelectedIncident(incident);
    if (typeof incident.lat === 'number' && typeof incident.lng === 'number') {
      setSelectedLocation([incident.lat, incident.lng]);
    }
    const mapElement = document.getElementById('command-map-section');
    if (mapElement) {
      mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Quick Manual Form Submit
  const handleQuickSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...modalForm,
        lat: parseFloat(modalForm.lat),
        lng: parseFloat(modalForm.lng),
        status: 'open',
      };

      const created = await createManualIncident(payload);

      setShowQuickModal(false);
      setIncidents((prev) => [created, ...prev]);
      handleViewOnMap(created);
    } catch (err) {
      alert('Could not submit incident: ' + err.message);
    }
  };

  const activeBusesCount = buses.filter((b) => b.status === 'live' && Number.isFinite(b.current_lat) && Number.isFinite(b.current_lng)).length;
  const totalRoadIssues = (stats.potholes || 0) + (stats.road_damage || 0);

  return (
    <div className="space-y-6 pb-12">
      {/* ── COMMAND CENTER HEADER ──────────────────────────── */}
      <PageHeader
        title="Urban Command Center"
        badge="AI LIVE TELEMETRY"
        description="Real-time intelligence from mobile sensing units"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowQuickModal(true)}
              className="btn-primary px-3.5 py-2 text-xs flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Broadcast Alert</span>
            </button>
            <button
              onClick={() => navigate('/video')}
              className="btn-secondary px-3.5 py-2 text-xs flex items-center gap-1.5"
            >
              <VideoIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Live Detection</span>
            </button>
            <button
              onClick={loadData}
              title="Refresh Telemetry"
              className="btn-secondary p-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      {/* ── TOP 5 KPI CARDS ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <StatCard
  title="Active Buses"
  value="3"
  icon={Bus}
  color="cyan"
  subtitle="Mobile sensing units"
  trend={buses.length > 0 ? `${activeBusesCount} reporting GPS` : "1"}
/>

        <StatCard
          title="Vehicles Detected"
          value={stats.vehicles_detected.toLocaleString()}
          icon={Car}
          color="blue"
          subtitle="AI traffic volume"
          trend="Live AI count"
        />
        <StatCard
          title="Road Issues"
          value={totalRoadIssues}
          icon={AlertTriangle}
          color="orange"
          subtitle="Potholes & surface cracks"
          trend={`${stats.potholes || 0} Potholes`}
        />
        <StatCard
          title="Active Alerts"
          value={stats.open_incidents}
          icon={Flame}
          color="red"
          subtitle="Requiring response"
          trend={`${stats.critical_incidents} Critical`}
        />
        <StatCard
          title="Route Delay"
          value={`+${stats.route_delay_min || 0} min`}
          icon={Clock}
          color="amber"
          subtitle="Corridor avg latency"
          trend={stats.route_delay_min > 0 ? "Delay detected" : "No delay reported"}
        />
      </div>

      {/* ── SYSTEM STATUS BAR ──────────────────────────────── */}
      <div
        className="card p-3.5 flex flex-wrap items-center justify-between gap-4 text-xs shadow-sm"
        style={{ border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full live-beacon" style={{ background: 'var(--ok)' }} />
          <span className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text)' }}>
            System Status
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6 flex-wrap font-mono text-[11px]">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-muted)' }}>AI Engine:</span>
            <span className="font-semibold text-emerald-400">Online (YOLOv8n)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <VideoIcon className="w-3.5 h-3.5" style={{ color: '#38bdf8' }} />
            <span style={{ color: 'var(--text-muted)' }}>Video Processing:</span>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>Ready (OpenCV)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Satellite className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
            <span style={{ color: 'var(--text-muted)' }}>GPS Telemetry:</span>
            <span
  className="font-semibold"
  style={{
    color: gpsLocked ? 'var(--ok)' : 'var(--warn)',
  }}
>
  {gpsLocked
    ? 'GPS Locked'
    : gpsError
      ? 'GPS Unavailable'
      : 'Acquiring GPS...'}
</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" style={{ color: '#a855f7' }} />
            <span style={{ color: 'var(--text-muted)' }}>Central Server:</span>
            <span className="font-semibold text-emerald-400">Online (FastAPI)</span>
          </div>
        </div>

        <div className="text-[10px] font-mono px-2 py-0.5 rounded hidden xl:block" style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}>
          EDGE INGESTION · LIVE
        </div>
      </div>

      {/* ── MAIN CONTENT GRID: LEFT GIS MAP & RIGHT DETECTION FEED ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT / LARGE GIS MAP (8 Cols) */}
        <div id="command-map-section" className="lg:col-span-8 card p-4 flex flex-col space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg" style={{ background: 'rgba(56,189,248,0.12)' }}>
                <MapPin className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                  Interactive Urban GIS Map
                </h2>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Real-time mobile sensing nodes, road hazards, traffic congestion & pedestrian safety
                </p>
              </div>
            </div>

            {/* Map Layer Filter Pills */}
            <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-lg border border-[var(--border)] text-[11px] self-start sm:self-auto">
              <button
                onClick={() => setMapFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium ${mapFilter === 'all'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
              >
                All Layers
              </button>
              <button
                onClick={() => setMapFilter('buses')}
                className={`px-2 py-1 rounded-md transition-all ${mapFilter === 'buses'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
              >
                Buses ({buses.length})
              </button>
              <button
                onClick={() => setMapFilter('potholes')}
                className={`px-2 py-1 rounded-md transition-all ${mapFilter === 'potholes'
                  ? 'bg-orange-500 text-slate-950 font-bold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
              >
                Road Hazards
              </button>
              <button
                onClick={() => setMapFilter('traffic')}
                className={`px-2 py-1 rounded-md transition-all ${mapFilter === 'traffic'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
              >
                Traffic
              </button>
              <button
                onClick={() => setMapFilter('pedestrian')}
                className={`px-2 py-1 rounded-md transition-all ${mapFilter === 'pedestrian'
                  ? 'bg-pink-500 text-slate-950 font-bold shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
              >
                Pedestrian
              </button>
            </div>
          </div>

          {/* Leaflet Map View Container */}
          <div className="w-full h-[420px] rounded-xl overflow-hidden relative">
            <MapView

            incidents={filteredMapIncidents}
            buses={filteredMapBuses}
            routes={routes}
            selectedIncident={selectedIncident}
            selectedLocation={selectedLocation}
            userLocation={
            gpsLocked && Number.isFinite(gpsLat) && Number.isFinite(gpsLng)
            ? [gpsLat, gpsLng]
            : null
  }
  onMarkerClick={(inc) => setInspectModalIncident(inc)}
  onBusClick={(bus) => {
    setSelectedLocation([bus.lat, bus.lng]);
  }}
  height="100%"
/>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 px-1">
            <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span>Center: <strong>Configured Transit Grid</strong></span>
              <span>Layer Status: <strong className="text-emerald-400">Live GPS Polling</strong></span>
            </div>
            <button
              onClick={() => navigate('/map')}
              className="font-semibold text-xs flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
            >
              <span>Open Road Intelligence Full Map</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* RIGHT: LIVE DETECTION FEED (4 Cols) */}
        <div className="lg:col-span-4 card p-4 flex flex-col space-y-3.5 h-[530px]">
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full live-beacon" style={{ background: 'var(--accent)' }} />
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                  Live Detection Feed
                </h2>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Real-time AI stream from mobile sensing units
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(56,189,248,0.15)', color: 'var(--accent)' }}>
              LIVE STREAM
            </span>
          </div>

          {/* Detections Scrollable Container */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 custom-scrollbar">
            {detections.map((det) => {
              const IconComponent = det.icon || AlertTriangle;
              const isCrit = det.severity === 'CRITICAL';
              const isHigh = det.severity === 'HIGH';

              return (
                <div
                  key={det.id}
                  onClick={() => {
                    const matchInc = incidents.find((i) => i.id.toString() === det.id.replace('det-', ''));
                    if (matchInc) handleViewOnMap(matchInc);
                  }}
                  className="p-3 rounded-lg border transition-all cursor-pointer hover:scale-[1.01] flex flex-col space-y-1.5"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: isCrit ? 'rgba(239,68,68,0.4)' : isHigh ? 'rgba(249,115,22,0.3)' : 'var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <IconComponent className="w-3.5 h-3.5" style={{ color: det.color || 'var(--accent)' }} />
                      <span className="font-bold text-xs" style={{ color: 'var(--text)' }}>
                        {det.type}
                      </span>
                    </div>
                    <span
                      className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                      style={{
                        background: isCrit ? 'rgba(239,68,68,0.2)' : isHigh ? 'rgba(249,115,22,0.2)' : 'rgba(56,189,248,0.15)',
                        color: isCrit ? '#ef4444' : isHigh ? '#f97316' : '#38bdf8',
                      }}
                    >
                      {det.severity}
                    </span>
                  </div>

                  <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                    📍 {det.location}
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-cyan-400">{det.bus_id}</span>
                      <span style={{ color: 'var(--text-subtle)' }}>•</span>
                      <span style={{ color: 'var(--text-muted)' }}>{det.time}</span>
                    </div>
                    <span className="font-bold text-emerald-400">
                      {det.confidence != null ? `${Math.round(det.confidence * 100)}% Conf` : 'Confidence —'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick link button to Live Video Processing */}
          <button
            onClick={() => navigate('/video')}
            className="w-full btn-secondary py-2 text-xs flex items-center justify-center gap-1.5 mt-2"
          >
            <VideoIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>Open Live Camera Stream</span>
          </button>
        </div>
      </div>

      {/* ── BOTTOM SECTION: RECENT ALERTS (Cards & Details) ── */}
      <div className="card p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4" style={{ color: 'var(--crit)' }} />
              <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                Recent Alerts & Road Incidents
              </h2>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Verified anomaly detections from onboard cameras with automated confidence scoring and corridor geolocation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono px-2.5 py-1 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {incidents.length} Recorded Alerts
            </span>
            <button
              onClick={() => navigate('/incidents')}
              className="btn-secondary px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
            >
              <span>Full Incident Manager</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Realistic Alert Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {incidents.slice(0, 6).map((inc) => {
            const isCrit = inc.severity === 'CRITICAL';
            const isHigh = inc.severity === 'HIGH';
            const isPothole = (inc.type || '').includes('pothole');
            const isTraffic = (inc.type || '').includes('traffic');
            const isPed = (inc.type || '').includes('pedestrian');

            return (
              <div
                key={inc.id}
                className="p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all hover:shadow-md"
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: isCrit ? 'rgba(239,68,68,0.35)' : isHigh ? 'rgba(249,115,22,0.3)' : 'var(--border)',
                }}
              >
                {/* Header: Title & Severity */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="p-2 rounded-lg"
                      style={{
                        background: isCrit ? 'rgba(239,68,68,0.15)' : isHigh ? 'rgba(249,115,22,0.15)' : 'rgba(56,189,248,0.15)',
                      }}
                    >
                      {isPothole ? (
                        <AlertTriangle className="w-4 h-4 text-orange-400" />
                      ) : isTraffic ? (
                        <Car className="w-4 h-4 text-amber-400" />
                      ) : isPed ? (
                        <ShieldAlert className="w-4 h-4 text-pink-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-cyan-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-xs uppercase" style={{ color: 'var(--text)' }}>
                        {inc.title || (inc.type || 'ROAD HAZARD').replace(/_/g, ' ')}
                      </h3>
                      <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        ID: #{inc.id} · {inc.time || (inc.timestamp
                          ? new Date(inc.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—')}
                      </div>
                    </div>
                  </div>

                  {/* Visual Status Chip */}
                  <span
                    className="font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase"
                    style={{
                      background:
                        inc.status === 'resolved'
                          ? 'rgba(34,197,94,0.18)'
                          : inc.status === 'in_progress'
                            ? 'rgba(245,158,11,0.18)'
                            : 'rgba(239,68,68,0.18)',
                      color:
                        inc.status === 'resolved'
                          ? '#4ade80'
                          : inc.status === 'in_progress'
                            ? '#fbbf24'
                            : '#f87171',
                      border: `1px solid ${inc.status === 'resolved'
                        ? 'rgba(34,197,94,0.3)'
                        : inc.status === 'in_progress'
                          ? 'rgba(245,158,11,0.3)'
                          : 'rgba(239,68,68,0.3)'
                        }`,
                    }}
                  >
                    {inc.status || '—'}
                  </span>
                </div>

                {/* Description & Location */}
                <div className="space-y-1.5 text-xs">
                  <p className="text-[11px] line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {inc.description || 'No description available.'}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--text)' }}>
                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">{inc.location_name || `${inc.lat?.toFixed(4)}, ${inc.lng?.toFixed(4)}`}</span>
                  </div>
                </div>

                {/* Key Metrics Row: Confidence, Bus ID, Severity */}
                <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-lg text-center text-[10px] font-mono" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ color: 'var(--text-subtle)' }}>CONFIDENCE</div>
                    <div className="font-bold text-emerald-400">{inc.confidence != null ? `${Math.round(inc.confidence * 100)}%` : '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-subtle)' }}>UNIT ID</div>
                    <div className="font-bold text-cyan-400">{inc.bus_id || '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-subtle)' }}>SEVERITY</div>
                    <div
                      className="font-bold"
                      style={{
                        color: isCrit ? '#ef4444' : isHigh ? '#f97316' : '#f59e0b',
                      }}
                    >
                      {inc.severity || 'HIGH'}
                    </div>
                  </div>
                </div>

                {/* Actions: View Incident & View on Map */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setInspectModalIncident(inc)}
                    className="btn-secondary flex-1 py-1.5 text-xs flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    <span>View Incident</span>
                  </button>
                  <button
                    onClick={() => handleViewOnMap(inc)}
                    className="btn-primary flex-1 py-1.5 text-xs flex items-center justify-center gap-1.5"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>View on Map</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── INCIDENT DETAILS INSPECTION MODAL ──────────────── */}
      {inspectModalIncident && (
        <div className="modal-backdrop">
          <div className="modal-panel space-y-5 max-w-lg">
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg" style={{ background: 'rgba(56,189,248,0.15)' }}>
                  <AlertTriangle className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                    Incident #{inspectModalIncident.id} Details
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Smart city intelligence
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectModalIncident(null)}
                className="p-1 rounded hover:bg-slate-800 text-lg font-bold"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px]" style={{ color: 'var(--text-subtle)' }}>SENSING UNIT</span>
                  <span className="font-bold font-mono text-cyan-400 text-xs">{inspectModalIncident.bus_id || '—'}</span>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px]" style={{ color: 'var(--text-subtle)' }}>AI CONFIDENCE</span>
                  <span className="font-bold font-mono text-emerald-400 text-xs">
                    {inspectModalIncident.confidence != null ? `${Math.round(inspectModalIncident.confidence * 100)}%` : '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px]" style={{ color: 'var(--text-subtle)' }}>SEVERITY</span>
                  <span className="font-bold font-mono text-orange-400 text-xs">{inspectModalIncident.severity || '—'}</span>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px]" style={{ color: 'var(--text-subtle)' }}>STATUS</span>
                  <span className="font-bold font-mono uppercase text-xs text-cyan-300">{inspectModalIncident.status || 'open'}</span>
                </div>
              </div>

              <div className="p-3 rounded-lg space-y-1.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
                  Event Description & Diagnostics
                </span>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
                  {inspectModalIncident.description || 'No diagnostic description available.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px] font-sans" style={{ color: 'var(--text-subtle)' }}>Coordinates</span>
                  <span className="font-semibold text-cyan-400">
                    {inspectModalIncident.lat?.toFixed(5)}, {inspectModalIncident.lng?.toFixed(5)}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <span className="block text-[10px] font-sans" style={{ color: 'var(--text-subtle)' }}>Timestamp</span>
                  <span style={{ color: 'var(--text)' }}>{inspectModalIncident.time || (inspectModalIncident.timestamp ? new Date(inspectModalIncident.timestamp).toLocaleString() : '—')}</span>
                </div>
              </div>

              {/* Status Updater */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Update Incident Dispatch Status:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleStatusChange(inspectModalIncident.id, 'open')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${inspectModalIncident.status === 'open'
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
                      }`}
                  >
                    Open
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStatusChange(inspectModalIncident.id, 'in_progress')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${inspectModalIncident.status === 'in_progress'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
                      }`}
                  >
                    In Progress
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStatusChange(inspectModalIncident.id, 'resolved')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${inspectModalIncident.status === 'resolved'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
                      }`}
                  >
                    Resolved
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setInspectModalIncident(null)}
                className="btn-secondary px-4 py-2 text-xs"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  handleViewOnMap(inspectModalIncident);
                  setInspectModalIncident(null);
                }}
                className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Locate on GIS Map</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QUICK BROADCAST ALERT MODAL ───────────────────── */}
      {showQuickModal && (
        <div className="modal-backdrop">
          <div className="modal-panel space-y-4">
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <Plus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                Broadcast Manual Incident Alert
              </h3>
              <button
                onClick={() => setShowQuickModal(false)}
                className="text-lg font-bold"
                style={{ color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleQuickSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Incident Type</label>
                  <select
                    value={modalForm.type}
                    onChange={(e) => setModalForm({ ...modalForm, type: e.target.value })}
                    className="field p-2.5"
                  >
                    <option value="pothole">Pothole (Road Hazard)</option>
                    <option value="road_damage">Road Damage / Crack</option>
                    <option value="traffic_congestion">Traffic Congestion</option>
                    <option value="pedestrian">Pedestrian Safety Alert</option>
                    <option value="car">Vehicle Slowdown</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Sensing Unit</label>
                  <select
                    value={modalForm.bus_id}
                    onChange={(e) => setModalForm({ ...modalForm, bus_id: e.target.value })}
                    className="field p-2.5"
                  >
                    {buses.map((b) => {
                      const route = routes.find((r) => r.bus_number === b.bus_number);
                      return (
                        <option key={b.bus_number} value={b.bus_number}>
                          {b.bus_number} ({route?.route_name || 'Route not configured'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Severity</label>
                  <select
                    value={modalForm.severity}
                    onChange={(e) => setModalForm({ ...modalForm, severity: e.target.value })}
                    className="field p-2.5"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Preset Location Pin</label>
                  <button
                    type="button"
                    onClick={() => {
                      const bus = buses.find((b) => b.bus_number === modalForm.bus_id);
                      if (!bus || !Number.isFinite(bus.current_lat) || !Number.isFinite(bus.current_lng)) {
                        alert('No GPS location is available for this bus yet.');
                        return;
                      }
                      setModalForm({
                        ...modalForm,
                        lat: bus.current_lat.toFixed(5),
                        lng: bus.current_lng.toFixed(5),
                      });
                    }}
                    className="btn-secondary w-full p-2.5 text-[11px]"
                  >
                    Snap to Bus Coordinates
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block mb-1 font-medium font-sans" style={{ color: 'var(--text-muted)' }}>Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={modalForm.lat}
                    onChange={(e) => setModalForm({ ...modalForm, lat: e.target.value })}
                    className="field p-2.5"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium font-sans" style={{ color: 'var(--text-muted)' }}>Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={modalForm.lng}
                    onChange={(e) => setModalForm({ ...modalForm, lng: e.target.value })}
                    className="field p-2.5"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Description / Field Notes</label>
                <textarea
                  rows={2}
                  value={modalForm.description}
                  onChange={(e) => setModalForm({ ...modalForm, description: e.target.value })}
                  className="field p-2.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setShowQuickModal(false)}
                  className="btn-secondary px-4 py-2"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-4 py-2">
                  Broadcast to Command Center
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}