import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Download } from 'lucide-react';
import IncidentTable from '../components/IncidentTable';
import PageHeader from '../components/PageHeader';
import {
  fetchIncidents,
  createManualIncident,
  updateIncident,
  deleteIncident,
  subscribeWebSocket
} from '../api';

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: 'pothole',
    severity: 'HIGH',
    lat: 22.5726,
    lng: 88.3639,
    description: '',
  });

  const loadIncidents = async () => {
    try {
      setLoading(true);
      const data = await fetchIncidents({ limit: 300 });
      setIncidents(data);
    } catch (err) {
      console.error('Failed to load incidents:', err);
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
    if (statusFilter !== 'ALL') result = result.filter((i) => i.status === statusFilter);
    if (severityFilter !== 'ALL') result = result.filter((i) => (i.severity || '').toUpperCase() === severityFilter);
    if (typeFilter !== 'ALL') result = result.filter((i) => i.type === typeFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (i) =>
          i.type.toLowerCase().includes(q) ||
          (i.description && i.description.toLowerCase().includes(q)) ||
          String(i.id).includes(q)
      );
    }
    setFilteredIncidents(result);
  }, [incidents, statusFilter, severityFilter, typeFilter, searchTerm]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateIncident(id, { status: newStatus });
      setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, status: newStatus } : i)));
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(`Delete incident #${id}?`)) return;
    try {
      await deleteIncident(id);
      setIncidents((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error('Failed to delete incident:', err);
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      await createManualIncident({
        ...createForm,
        lat: parseFloat(createForm.lat),
        lng: parseFloat(createForm.lng),
      });
      setShowCreateModal(false);
      setCreateForm({ type: 'pothole', severity: 'HIGH', lat: 22.5726, lng: 88.3639, description: '' });
    } catch (err) {
      alert('Failed to create incident: ' + err.message);
    }
  };

  const exportCSV = () => {
    if (filteredIncidents.length === 0) return;
    const headers = ['ID', 'Type', 'Severity', 'Status', 'Confidence', 'Latitude', 'Longitude', 'Timestamp', 'Description'];
    const rows = filteredIncidents.map((i) => [
      i.id, i.type, i.severity, i.status, i.confidence, i.lat, i.lng, i.timestamp,
      `"${(i.description || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `bussense_incidents_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Incidents"
        badge="CRUD // SYNC"
        description="Browse, manage, filter and audit road hazards, potholes and traffic safety events."
        actions={
          <>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary px-3 py-2 text-xs">
              <Plus className="w-3.5 h-3.5" />
              Create Incident
            </button>
            <button onClick={exportCSV} className="btn-secondary px-3 py-2 text-xs">
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button onClick={loadIncidents} className="btn-secondary p-2" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <input
            type="text"
            placeholder="Search by ID, type, or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="field px-3 py-2"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="field px-3 py-2">
            <option value="ALL">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="field px-3 py-2">
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field px-3 py-2">
            <option value="ALL">All Hazard Types</option>
            <option value="pothole">Pothole</option>
            <option value="road_damage">Road Damage</option>
            <option value="pedestrian">Pedestrian Alert</option>
            <option value="car">Car (Traffic)</option>
            <option value="truck">Truck (Heavy Vehicle)</option>
            <option value="bus">Bus</option>
            <option value="bike">Bike</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Showing {filteredIncidents.length} of {incidents.length} incidents</span>
          <span className="font-mono text-[11px]">Database: SQLite Async</span>
        </div>
        <IncidentTable incidents={filteredIncidents} onStatusChange={handleStatusChange} onDelete={handleDelete} />
      </div>

      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-panel space-y-4">
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                Create New Road Incident
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-lg font-bold" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Hazard / Event Type</label>
                <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })} className="field p-2.5">
                  <option value="pothole">Pothole (Road Defect)</option>
                  <option value="road_damage">Road Surface Crack / Damage</option>
                  <option value="pedestrian">Pedestrian Crossing Safety Alert</option>
                  <option value="car">Vehicle / Traffic Density Event</option>
                  <option value="truck">Heavy Vehicle Restriction Violation</option>
                  <option value="bike">Two-Wheeler Traffic Event</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Severity Level</label>
                <select value={createForm.severity} onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value })} className="field p-2.5">
                  <option value="LOW">LOW — Informational</option>
                  <option value="MEDIUM">MEDIUM — Moderate Hazard</option>
                  <option value="HIGH">HIGH — Severe Impact Risk</option>
                  <option value="CRITICAL">CRITICAL — Immediate Danger</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block mb-1 font-medium font-sans" style={{ color: 'var(--text-muted)' }}>Latitude</label>
                  <input type="number" step="0.0001" required value={createForm.lat} onChange={(e) => setCreateForm({ ...createForm, lat: e.target.value })} className="field p-2" />
                </div>
                <div>
                  <label className="block mb-1 font-medium font-sans" style={{ color: 'var(--text-muted)' }}>Longitude</label>
                  <input type="number" step="0.0001" required value={createForm.lng} onChange={(e) => setCreateForm({ ...createForm, lng: e.target.value })} className="field p-2" />
                </div>
              </div>
              <div>
                <label className="block mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Incident Description / Notes</label>
                <textarea rows={2} placeholder="e.g. 1.2m wide pothole near pedestrian crossing" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} className="field p-2" />
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary px-4 py-2">Cancel</button>
                <button type="submit" className="btn-primary px-4 py-2">Save Incident</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
