
const API_BASE = '/api';

// ============================================================
// RESPONSE HELPERS
// ============================================================

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return await response.text();
}

async function handleResponse(response) {
  const data = await parseResponse(response);

  if (!response.ok) {
    const message =
      typeof data === 'object' && data?.detail
        ? Array.isArray(data.detail)
          ? data.detail
              .map((item) => item?.msg || JSON.stringify(item))
              .join(', ')
          : data.detail
        : typeof data === 'string' && data
          ? data
          : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return data;
}

// ============================================================
// VIDEO APIs
// ============================================================

export async function uploadVideo(fileOrFormData, metadata = {}) {
  /*
   * VideoProcess.jsx already creates FormData:
   *
   * const formData = new FormData();
   * formData.append('file', videoFile);
   *
   * Therefore, if FormData is supplied, use it directly.
   */

  let formData;

  if (fileOrFormData instanceof FormData) {
    formData = fileOrFormData;
  } else {
    formData = new FormData();

    if (!fileOrFormData) {
      throw new Error('No video file supplied for upload.');
    }

    formData.append('file', fileOrFormData);

    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });
  }

  /*
   * IMPORTANT:
   * Do NOT manually set Content-Type here.
   * The browser automatically adds:
   *
   * multipart/form-data; boundary=...
   */

  const response = await fetch(
    `${API_BASE}/videos/upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  return await handleResponse(response);
}

export async function startProcessingVideo(videoId) {
  const id =
    typeof videoId === 'object' && videoId !== null
      ? videoId.id ??
        videoId.video_id ??
        videoId._id
      : videoId;

  if (
    id === undefined ||
    id === null ||
    id === ''
  ) {
    throw new Error(
      'Invalid video ID supplied for processing'
    );
  }

  const response = await fetch(
    `${API_BASE}/videos/${encodeURIComponent(id)}/process`,
    {
      method: 'POST',
    }
  );

  return await handleResponse(response);
}

export async function fetchVideoStatus(videoId) {
  const id =
    typeof videoId === 'object' && videoId !== null
      ? videoId.id ??
        videoId.video_id ??
        videoId._id
      : videoId;

  if (
    id === undefined ||
    id === null ||
    id === ''
  ) {
    throw new Error(
      'Invalid video ID supplied for status'
    );
  }

  const response = await fetch(
    `${API_BASE}/videos/${encodeURIComponent(id)}/status`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchVideoResult(videoId) {
  const id =
    typeof videoId === 'object' && videoId !== null
      ? videoId.id ??
        videoId.video_id ??
        videoId._id
      : videoId;

  if (
    id === undefined ||
    id === null ||
    id === ''
  ) {
    throw new Error(
      'Invalid video ID supplied for result'
    );
  }

  const response = await fetch(
    `${API_BASE}/videos/${encodeURIComponent(id)}/result`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchVideos() {
  const response = await fetch(
    `${API_BASE}/videos`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// DETECTIONS
// ============================================================

// Detection records are no longer stored individually.
// Counts come from video processing / live detection.
export async function fetchDetections(videoId = null) {
  return [];
}

// ============================================================
// LIVE AI DETECTION
// ============================================================

export async function detectLiveFrame(blob) {
  if (!blob) {
    throw new Error('No camera frame supplied.');
  }

  const formData = new FormData();

  const file = new File(
    [blob],
    'live_frame.jpg',
    {
      type: blob.type || 'image/jpeg',
    }
  );

  formData.append('file', file);

  const response = await fetch(
    `${API_BASE}/live/detect`,
    {
      method: 'POST',
      body: formData,
    }
  );

  if (!response.ok) {
    return await handleResponse(response);
  }

  const imageBlob = await response.blob();

  let counts = {};
  let total = 0;

  const countsHeader =
    response.headers.get(
      'X-Detection-Counts'
    );

  const totalHeader =
    response.headers.get(
      'X-Detection-Total'
    );

  if (countsHeader) {
    try {
      counts = JSON.parse(countsHeader);
    } catch (error) {
      console.warn(
        'Could not parse X-Detection-Counts header:',
        error
      );
    }
  }

  if (totalHeader) {
    total = Number(totalHeader) || 0;
  }

  /*
   * Return an object so VideoProcess.jsx can use:
   *
   * result.blob
   * result.counts
   * result.total
   */

  return {
    blob: imageBlob,
    counts,
    total,
  };
}

export async function detectLiveFrameJson(blob) {
  if (!blob) {
    throw new Error('No camera frame supplied.');
  }

  const formData = new FormData();

  const file = new File(
    [blob],
    'live_frame.jpg',
    {
      type: blob.type || 'image/jpeg',
    }
  );

  formData.append('file', file);

  const response = await fetch(
    `${API_BASE}/live/detect/json`,
    {
      method: 'POST',
      body: formData,
    }
  );

  return await handleResponse(response);
}

// ============================================================
// BUS APIs
// ============================================================

export async function fetchBuses() {
  const response = await fetch(
    `${API_BASE}/buses`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchBus(busId) {
  const response = await fetch(
    `${API_BASE}/buses/${encodeURIComponent(busId)}`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function createBus(busData) {
  const response = await fetch(
    `${API_BASE}/buses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(busData),
    }
  );

  return await handleResponse(response);
}

export async function updateBus(busId, busData) {
  const response = await fetch(
    `${API_BASE}/buses/${encodeURIComponent(busId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(busData),
    }
  );

  return await handleResponse(response);
}

export async function deleteBus(busId) {
  const response = await fetch(
    `${API_BASE}/buses/${encodeURIComponent(busId)}`,
    {
      method: 'DELETE',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// ROUTE APIs
// ============================================================

export async function fetchRoutes() {
  const response = await fetch(
    `${API_BASE}/routes`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchRoute(routeId) {
  const response = await fetch(
    `${API_BASE}/routes/${encodeURIComponent(routeId)}`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function createRoute(routeData) {
  const response = await fetch(
    `${API_BASE}/routes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(routeData),
    }
  );

  return await handleResponse(response);
}

export async function updateRoute(routeId, routeData) {
  const response = await fetch(
    `${API_BASE}/routes/${encodeURIComponent(routeId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(routeData),
    }
  );

  return await handleResponse(response);
}

export async function deleteRoute(routeId) {
  const response = await fetch(
    `${API_BASE}/routes/${encodeURIComponent(routeId)}`,
    {
      method: 'DELETE',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// INCIDENT APIs
// ============================================================

export async function fetchIncidents(limit = 15) {
  /*
   * Prevent:
   *
   * /incidents?limit=[object Object]
   *
   * from being generated accidentally.
   */

  let safeLimit = limit;

  if (
    typeof limit === 'object' &&
    limit !== null
  ) {
    safeLimit =
      limit.limit ??
      limit.count ??
      15;
  }

  safeLimit = Number(safeLimit);

  if (!Number.isFinite(safeLimit)) {
    safeLimit = 15;
  }

  const response = await fetch(
    `${API_BASE}/incidents?limit=${encodeURIComponent(
      safeLimit
    )}`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchIncident(incidentId) {
  const response = await fetch(
    `${API_BASE}/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function createIncident(incidentData) {
  const response = await fetch(
    `${API_BASE}/incidents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(incidentData),
    }
  );

  return await handleResponse(response);
}

export async function updateIncident(
  incidentId,
  incidentData
) {
  const response = await fetch(
    `${API_BASE}/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(incidentData),
    }
  );

  return await handleResponse(response);
}

export async function deleteIncident(
  incidentId
) {
  const response = await fetch(
    `${API_BASE}/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: 'DELETE',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// MANUAL INCIDENT API
// ============================================================

export async function createManualIncident(
  incidentData
) {
  const response = await fetch(
    `${API_BASE}/incidents/manual`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(incidentData),
    }
  );

  return await handleResponse(response);
}

// ============================================================
// STATISTICS
// ============================================================

export async function fetchStats() {
  const response = await fetch(
    `${API_BASE}/stats`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// HEALTH / SYSTEM
// ============================================================

export async function fetchHealth() {
  const response = await fetch(
    `${API_BASE}/health`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

export async function fetchSystemStatus() {
  const response = await fetch(
    `${API_BASE}/status`,
    {
      method: 'GET',
    }
  );

  return await handleResponse(response);
}

// ============================================================
// WEBSOCKET
// ============================================================

let socket = null;
let reconnectTimer = null;
let manuallyClosed = false;

const listeners = new Set();

function getWebSocketUrl(path = '/ws') {
  const protocol =
    window.location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';

  const host = window.location.host;

  let cleanPath = path || '/ws';

  if (!cleanPath.startsWith('/')) {
    cleanPath = `/${cleanPath}`;
  }

  /*
   * Backend endpoint:
   *
   * /ws
   *
   * NOT:
   *
   * /api/ws
   */

  if (cleanPath.startsWith('/api/')) {
    cleanPath =
      cleanPath.replace(/^\/api/, '');
  }

  return `${protocol}//${host}${cleanPath}`;
}

// ============================================================
// CREATE WEBSOCKET
// ============================================================

export function createWebSocket(path = '/ws') {
  const url = getWebSocketUrl(path);

  console.log(
    'Creating WebSocket:',
    url
  );

  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log(
      'WebSocket connected'
    );
  };

  ws.onmessage = (event) => {
    try {
      const data =
        JSON.parse(event.data);

      listeners.forEach(
        (callback) => {
          try {
            callback(data);
          } catch (error) {
            console.error(
              'WebSocket listener error:',
              error
            );
          }
        }
      );
    } catch (error) {
      console.warn(
        'WebSocket message is not valid JSON:',
        event.data
      );

      listeners.forEach(
        (callback) => {
          try {
            callback(event.data);
          } catch (listenerError) {
            console.error(
              'WebSocket listener error:',
              listenerError
            );
          }
        }
      );
    }
  };

  ws.onerror = (error) => {
    console.error(
      'WebSocket error:',
      error
    );
  };

  ws.onclose = () => {
    console.log(
      'WebSocket closed'
    );
  };

  return ws;
}

// ============================================================
// CONNECT WEBSOCKET
// ============================================================

export function connectWebSocket(
  path = '/ws'
) {
  manuallyClosed = false;

  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return socket;
  }

  const url =
    getWebSocketUrl(path);

  console.log(
    'Connecting to WebSocket:',
    url
  );

  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log(
      'WebSocket connected'
    );

    if (reconnectTimer) {
      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    let data = event.data;

    try {
      data = JSON.parse(
        event.data
      );
    } catch {
      // Keep raw message.
    }

    notifyListeners(data);
  };

  socket.onerror = (error) => {
    console.error(
      'WebSocket error:',
      error
    );

    listeners.forEach(
      (callback) => {
        try {
          callback({
            type:
              'websocket_error',
            error,
          });
        } catch (callbackError) {
          console.error(
            'WebSocket error listener failed:',
            callbackError
          );
        }
      }
    );
  };

  socket.onclose = () => {
    console.log(
      'WebSocket disconnected'
    );

    socket = null;

    if (
      !manuallyClosed &&
      listeners.size > 0
    ) {
      console.log(
        'Attempting WebSocket reconnect in 3 seconds...'
      );

      reconnectTimer =
        setTimeout(() => {
          connectWebSocket(path);
        }, 3000);
    }
  };

  return socket;
}

// ============================================================
// SUBSCRIBE WEBSOCKET
// ============================================================

export function subscribeWebSocket(
  callback
) {
  if (
    typeof callback !==
    'function'
  ) {
    console.warn(
      'subscribeWebSocket expects a function'
    );

    return () => {};
  }

  listeners.add(callback);

  if (
    !socket ||
    socket.readyState ===
      WebSocket.CLOSED
  ) {
    connectWebSocket('/ws');
  }

  return () => {
    listeners.delete(
      callback
    );

    if (
      listeners.size === 0
    ) {
      disconnectWebSocket();
    }
  };
}

// ============================================================
// SEND WEBSOCKET MESSAGE
// ============================================================

export function sendWebSocketMessage(
  message
) {
  if (
    socket &&
    socket.readyState ===
      WebSocket.OPEN
  ) {
    const payload =
      typeof message ===
      'string'
        ? message
        : JSON.stringify(message);

    socket.send(payload);

    return true;
  }

  console.warn(
    'Cannot send WebSocket message: socket is not connected'
  );

  return false;
}

// ============================================================
// DISCONNECT WEBSOCKET
// ============================================================

export function disconnectWebSocket() {
  manuallyClosed = true;

  if (reconnectTimer) {
    clearTimeout(
      reconnectTimer
    );

    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.close();
    } catch (error) {
      console.warn(
        'Error closing WebSocket:',
        error
      );
    }

    socket = null;
  }
}

// ============================================================
// NOTIFY WEBSOCKET LISTENERS
// ============================================================

function notifyListeners(data) {
  listeners.forEach(
    (callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          'WebSocket listener error:',
          error
        );
      }
    }
  );
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default {
  // Video
  uploadVideo,
  startProcessingVideo,
  fetchVideoStatus,
  fetchVideoResult,
  fetchVideos,

  // Detection
  fetchDetections,
  detectLiveFrame,
  detectLiveFrameJson,

  // Bus
  fetchBuses,
  fetchBus,
  createBus,
  updateBus,
  deleteBus,

  // Routes
  fetchRoutes,
  fetchRoute,
  createRoute,
  updateRoute,
  deleteRoute,

  // Incidents
  fetchIncidents,
  fetchIncident,
  createIncident,
  createManualIncident,
  updateIncident,
  deleteIncident,

  // Stats / System
  fetchStats,
  fetchHealth,
  fetchSystemStatus,

  // WebSocket
  createWebSocket,
  connectWebSocket,
  subscribeWebSocket,
  sendWebSocketMessage,
  disconnectWebSocket,
};
