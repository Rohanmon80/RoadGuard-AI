/**
 * BusSense AI — Frontend API & WebSocket Client
 */

const API_BASE = '/api';

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchIncidents(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.limit) params.set('limit', filters.limit);
  const res = await fetch(`${API_BASE}/incidents?${params.toString()}`);
  if (!res.ok) throw new Error(`Incidents fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchIncident(id) {
  const res = await fetch(`${API_BASE}/incidents/${id}`);
  if (!res.ok) throw new Error(`Incident fetch failed: ${res.status}`);
  return res.json();
}

export async function createManualIncident(data) {
  const res = await fetch(`${API_BASE}/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Create incident failed: ${res.status}`);
  return res.json();
}

export async function updateIncident(id, data) {
  const res = await fetch(`${API_BASE}/incidents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Update incident failed: ${res.status}`);
  return res.json();
}

export async function deleteIncident(id) {
  const res = await fetch(`${API_BASE}/incidents/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Delete incident failed: ${res.status}`);
  return res.json();
}

export async function uploadVideo(formData) {
  const res = await fetch(`${API_BASE}/videos/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Video upload failed: ${res.status}`);
  return res.json();
}

export async function startProcessingVideo(videoId) {
  const res = await fetch(`${API_BASE}/videos/${videoId}/process`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Video processing failed: ${res.status}`);
  return res.json();
}

export async function fetchVideoStatus(videoId) {
  const res = await fetch(`${API_BASE}/videos/${videoId}/status`);
  if (!res.ok) throw new Error(`Video status failed: ${res.status}`);
  return res.json();
}

export async function fetchVideos() {
  const res = await fetch(`${API_BASE}/videos`);
  if (!res.ok) throw new Error(`Fetch videos failed: ${res.status}`);
  return res.json();
}

export async function fetchDetections(videoId = null) {
  const url = videoId ? `${API_BASE}/detections?video_id=${videoId}` : `${API_BASE}/detections`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch detections failed: ${res.status}`);
  return res.json();
}

export async function fetchAIInfo() {
  const res = await fetch(`${API_BASE}/ai/info`);
  if (!res.ok) throw new Error(`Fetch AI info failed: ${res.status}`);
  return res.json();
}

// ── Real-time WebSocket Manager ────────────────────────────────
let socket = null;
const listeners = new Set();
let reconnectTimer = null;

export function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('📡 BusSense AI: WebSocket connected to server');
      notifyListeners({ event: 'connection', data: { status: 'connected' } });
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        notifyListeners(payload);
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    socket.onclose = () => {
      console.warn('BusSense AI: WebSocket disconnected. Reconnecting in 3s...');
      notifyListeners({ event: 'connection', data: { status: 'disconnected' } });
      socket = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      if (socket) socket.close();
    };
  } catch (err) {
    console.error('WebSocket connection attempt failed:', err);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  }
}

export function subscribeWebSocket(callback) {
  listeners.add(callback);
  // Ensure connection is active
  connectWebSocket();
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(payload) {
  listeners.forEach((callback) => {
    try {
      callback(payload);
    } catch (e) {
      console.error('Error in WS subscriber callback:', e);
    }
  });
}
