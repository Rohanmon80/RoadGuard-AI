import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

/**
 * Custom SVG DivIcon generator for BusSense AI Command Center
 */
function createMarkerIcon(item, isBus = false) {
  if (isBus) {
    const isLive = item.status === 'live';
    const borderColor = isLive ? '#06b6d4' : '#64748b';
    const pulseHtml = isLive
      ? `<div style="position: absolute; inset: -4px; border-radius: 9999px; background: #06b6d4; opacity: 0.35; animation: radar-pulse 2s infinite;"></div>`
      : '';

    const html = `
      <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        ${pulseHtml}
        <div style="width: 28px; height: 28px; border-radius: 8px; background: #0f172a; border: 2px solid ${borderColor}; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(6,182,212,0.45); z-index: 2;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${borderColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6v12"/><path d="M16 6v12"/><path d="M4 10h16"/><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
          </svg>
        </div>
        <div style="position: absolute; bottom: -14px; background: rgba(15,23,42,0.9); border: 1px solid ${borderColor}; color: #e2e8f0; font-family: monospace; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 4px; white-space: nowrap; pointer-events: none; z-index: 3;">
          ${item.id || 'BUS'}
        </div>
      </div>
    `;

    return L.divIcon({
      html,
      className: 'custom-bus-marker',
      iconSize: [34, 48],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
    });
  }

  // Incident marker styling based on type and severity
  const type = (item.type || '').toLowerCase();
  const severity = (item.severity || 'MEDIUM').toUpperCase();

  let color = '#38bdf8';
  let glyph = '●';
  let pulse = severity === 'CRITICAL';

  if (type.includes('pothole')) {
    color = severity === 'CRITICAL' ? '#ef4444' : '#f97316';
    glyph = '🕳️';
  } else if (type.includes('traffic') || type.includes('congestion')) {
    color = '#f59e0b';
    glyph = '🚗';
  } else if (type.includes('pedestrian') || type.includes('safety') || type.includes('jaywalking')) {
    color = '#ec4899';
    glyph = '🚶';
  } else if (type.includes('crack') || type.includes('damage') || type.includes('road')) {
    color = '#fb923c';
    glyph = '⚠️';
  } else {
    if (severity === 'CRITICAL') color = '#ef4444';
    else if (severity === 'HIGH') color = '#f97316';
    else if (severity === 'MEDIUM') color = '#f59e0b';
    else color = '#38bdf8';
  }

  const pulseDiv = pulse
    ? `<div style="position: absolute; inset: -5px; border-radius: 50%; background: ${color}; opacity: 0.45; animation: radar-pulse 1.6s infinite;"></div>`
    : '';

  const html = `
    <div style="position: relative; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
      ${pulseDiv}
      <div style="width: 22px; height: 22px; border-radius: 50%; background: #0f172a; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px ${color}99; z-index: 2;">
        <span style="font-size: 10px; line-height: 1;">${glyph}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-incident-marker',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

export default function MapView({
  incidents = [],
  buses = [],
  center = [22.5726, 88.3639],
  zoom = 13,
  selectedIncident = null,
  selectedLocation = null,
  onMarkerClick,
  onBusClick,
  height = '100%',
  showControls = true,
  interactive = true,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const busesLayerRef = useRef(null);
  const markerMapRef = useRef(new Map());

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center,
      zoom,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors | BusSense AI',
      maxZoom: 19,
    }).addTo(map);

    if (showControls) {
      L.control.zoom({ position: 'bottomright' }).addTo(map);
    }

    markersLayerRef.current = L.layerGroup().addTo(map);
    busesLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Incidents Layer
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    markerMapRef.current.clear();

    incidents.forEach((inc) => {
      if (typeof inc.lat !== 'number' || typeof inc.lng !== 'number') return;

      const icon = createMarkerIcon(inc, false);
      const marker = L.marker([inc.lat, inc.lng], { icon });

      const typeLabel = (inc.type || 'ROAD ISSUE').replace(/_/g, ' ').toUpperCase();
      const severityColor =
        inc.severity === 'CRITICAL' ? '#ef4444' : inc.severity === 'HIGH' ? '#f97316' : '#f59e0b';

      const popupHtml = `
        <div style="font-family: Inter, sans-serif; font-size: 12px; line-height: 1.4; padding: 4px; min-width: 180px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #f8fafc; font-size: 11px;">#${inc.id || 'INC'} ${typeLabel}</span>
            <span style="font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${severityColor}; color: #fff; text-transform: uppercase;">
              ${inc.severity || 'MEDIUM'}
            </span>
          </div>
          <div style="font-size: 11px; margin-bottom: 6px; color: #cbd5e1;">
            ${inc.description || 'Automated mobile edge detection.'}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; font-family: monospace; font-size: 10px; color: #38bdf8; margin-bottom: 6px; background: rgba(56,189,248,0.1); padding: 3px 6px; border-radius: 4px;">
            <span>📍 ${inc.lat.toFixed(4)}, ${inc.lng.toFixed(4)}</span>
            <span>Bus: <strong>${inc.bus_id || inc.busId || 'BUS-102'}</strong></span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; border-top: 1px solid rgba(148,163,184,0.2); padding-top: 5px;">
            <span>Status: <strong style="color: #e2e8f0;">${inc.status || 'open'}</strong></span>
            <span>Conf: <strong style="color: #38bdf8;">${Math.round((inc.confidence || 0.9) * 100)}%</strong></span>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        if (onMarkerClick) onMarkerClick(inc);
      });

      markersLayerRef.current.addLayer(marker);
      if (inc.id) {
        markerMapRef.current.set(`inc-${inc.id}`, marker);
      }
    });
  }, [incidents, onMarkerClick]);

  // Update Fleet Buses Layer
  useEffect(() => {
    if (!mapInstanceRef.current || !busesLayerRef.current) return;

    busesLayerRef.current.clearLayers();

    buses.forEach((bus) => {
      if (typeof bus.lat !== 'number' || typeof bus.lng !== 'number') return;

      const icon = createMarkerIcon(bus, true);
      const marker = L.marker([bus.lat, bus.lng], { icon });

      const popupHtml = `
        <div style="font-family: Inter, sans-serif; font-size: 12px; line-height: 1.4; padding: 4px; min-width: 190px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 800; font-size: 13px; color: #38bdf8;">${bus.id}</span>
              <span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(34,197,94,0.2); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); font-weight: 600;">
                ${bus.status === 'live' ? 'ONLINE' : 'DEPOT'}
              </span>
            </div>
            <span style="font-family: monospace; font-size: 10px; color: #94a3b8;">${bus.speedKph || 0} km/h</span>
          </div>
          <div style="font-size: 11px; font-weight: 500; color: #f1f5f9; margin-bottom: 2px;">
            ${bus.route || 'Urban Express Line'}
          </div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px;">
            Corridor: <strong style="color: #e2e8f0;">${bus.corridor || 'Central'}</strong>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px; background: rgba(15,23,42,0.6); padding: 5px; border-radius: 4px; border: 1px solid rgba(148,163,184,0.15); margin-bottom: 4px;">
            <div>Cam: <strong style="color: #38bdf8;">${bus.camera || 'Active'}</strong></div>
            <div>Occupancy: <strong style="color: #f59e0b;">${bus.occupancy || 0}%</strong></div>
            <div>Driver: <span style="color: #cbd5e1;">${bus.driver || 'N/A'}</span></div>
            <div>Detections: <strong style="color: #4ade80;">${bus.detectionsToday || 0}</strong></div>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        if (onBusClick) onBusClick(bus);
      });

      busesLayerRef.current.addLayer(marker);
      if (bus.id) {
        markerMapRef.current.set(`bus-${bus.id}`, marker);
      }
    });
  }, [buses, onBusClick]);

  // Handle FlyTo on Selected Incident or Location
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (selectedIncident && typeof selectedIncident.lat === 'number' && typeof selectedIncident.lng === 'number') {
      mapInstanceRef.current.flyTo([selectedIncident.lat, selectedIncident.lng], 16, {
        duration: 1.2,
      });
      const marker = markerMapRef.current.get(`inc-${selectedIncident.id}`);
      if (marker) {
        setTimeout(() => marker.openPopup(), 400);
      }
    } else if (selectedLocation && Array.isArray(selectedLocation) && selectedLocation.length === 2) {
      mapInstanceRef.current.flyTo(selectedLocation, 16, {
        duration: 1.2,
      });
    }
  }, [selectedIncident, selectedLocation]);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height }} />

      {/* Top Left GIS Badge */}
      <div
        className="absolute top-3 left-3 z-[1000] px-3 py-1.5 rounded-lg flex items-center gap-2.5 text-xs shadow-md backdrop-blur-md"
        style={{ background: 'var(--map-overlay)', border: '1px solid var(--border)' }}
      >
        <span className="w-2 h-2 rounded-full live-beacon" style={{ background: 'var(--ok)' }} />
        <span className="font-semibold text-xs" style={{ color: 'var(--text)' }}>Urban GIS Network</span>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(56,189,248,0.15)', color: 'var(--accent)' }}>
          {buses.length} Buses · {incidents.length} Hazards
        </span>
      </div>

      {/* Bottom Left Quick Filter Legend */}
      <div
        className="absolute bottom-3 left-3 z-[1000] px-2.5 py-1.5 rounded-lg flex items-center gap-3 text-[11px] shadow-md backdrop-blur-md hidden sm:flex"
        style={{ background: 'var(--map-overlay)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block"></span>
          <span style={{ color: 'var(--text-muted)' }}>Bus Unit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
          <span style={{ color: 'var(--text-muted)' }}>Pothole</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
          <span style={{ color: 'var(--text-muted)' }}>Traffic</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-500 inline-block"></span>
          <span style={{ color: 'var(--text-muted)' }}>Pedestrian</span>
        </div>
      </div>
    </div>
  );
}
