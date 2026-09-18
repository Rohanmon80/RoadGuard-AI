import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeWebSocket } from '../api';

const BUS_KEY = 'bussense-bus-id';
const NOTIFY_KEY = 'bussense-notify';
const GPS_MANUAL_KEY = 'bussense-gps-manual';

// No hardcoded demo coordinates

const SystemContext = createContext(null);

export function getStoredBusId() {
  try {
    return localStorage.getItem(BUS_KEY) || null;
  } catch {
    return null;
  }
}

function loadManualGps() {
  try {
    const raw = localStorage.getItem(GPS_MANUAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function SystemProvider({ children }) {
  const [wsConnected, setWsConnected] = useState(false);
  const [busId, setBusIdState] = useState(() => getStoredBusId());
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [alerts, setAlerts] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);

  // Real GPS state (browser geolocation + manual/demo fallback)
  const [gpsLat, setGpsLat] = useState(null);
  const [gpsLng, setGpsLng] = useState(null);
  const [gpsSource, setGpsSource] = useState('seeking'); // browser | manual | seeking | denied | unavailable
  const [gpsError, setGpsError] = useState(null);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [manualOverride, setManualOverride] = useState(() => loadManualGps());

  useEffect(() => {
    const unsubscribe = subscribeWebSocket((msg) => {
      if (msg.event === 'connection') {
        setWsConnected(msg.data.status === 'connected');
      } else if (msg.event === 'new_incident') {
        const text = `New incident #${msg.data.id}: ${msg.data.type}`;
        setLastEvent(text);
        setAlerts((prev) => [
          {
            id: `${Date.now()}-${msg.data.id}`,
            text,
            severity: msg.data.severity || 'MEDIUM',
            ts: new Date().toISOString(),
            read: false,
          },
          ...prev.slice(0, 19),
        ]);
        setTimeout(() => setLastEvent(null), 4000);
      }
    });
    return () => unsubscribe();
  }, []);

  // Apply manual override when set
  useEffect(() => {
    if (manualOverride) {
      setGpsLat(manualOverride.lat);
      setGpsLng(manualOverride.lng);
      setGpsSource(manualOverride ? 'manual' : 'seeking');
      setGpsLocked(true);
      setGpsError(null);
      try {
        localStorage.setItem(GPS_MANUAL_KEY, JSON.stringify(manualOverride));
      } catch {
        /* ignore */
      }
    }
  }, [manualOverride]);

  // Browser geolocation (skipped while manual/demo override is active)
  useEffect(() => {
    if (manualOverride) return undefined;

    if (!navigator.geolocation) {
      setGpsSource('unavailable');
      setGpsError('Geolocation not supported in this browser');
      setGpsLat(null);
      setGpsLng(null);
      setGpsLocked(false);
      return undefined;
    }

    setGpsSource('seeking');
    setGpsError(null);

    const onSuccess = (pos) => {
      setGpsLat(pos.coords.latitude);
      setGpsLng(pos.coords.longitude);
      setGpsSource('browser');
      setGpsLocked(true);
      setGpsError(null);
    };

    const onError = (err) => {
      const denied = err?.code === 1;
      setGpsError(
        denied
          ? 'Location permission denied — please allow GPS access'
          : 'GPS unavailable — please try again'
      );
      setGpsSource(denied ? 'denied' : 'unavailable');
      setGpsLocked(false);
      // Do NOT silently switch to demo coordinates
      // Keep previous real coords if any; do not overwrite with demo
      // Leave gpsLat and gpsLng as they are (null if not set, or last known)
    };

    const watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000,
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [manualOverride]);

  const setBusId = useCallback((id) => {
  const next = id ? id.toUpperCase() : null;
  setBusIdState(next);

  try {
    if (next) {
      localStorage.setItem(BUS_KEY, next);
    } else {
      localStorage.removeItem(BUS_KEY);
    }
  } catch {
    /* ignore */
  }
}, []);

  const setNotify = useCallback((enabled) => {
    setNotificationsEnabled(enabled);
    try {
      localStorage.setItem(NOTIFY_KEY, enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);

  const setManualGps = useCallback((lat, lng, { demo = false } = {}) => {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (Number.isNaN(latN) || Number.isNaN(lngN)) return;
    setManualOverride({ lat: latN, lng: lngN, demo });
  }, []);

  
  const clearManualGps = useCallback(() => {
    setManualOverride(null);
    try {
      localStorage.removeItem(GPS_MANUAL_KEY);
    } catch {
      /* ignore */
    }
    setGpsLat(null);
    setGpsLng(null);
    setGpsLocked(false);
    setGpsSource('seeking');
    setGpsError(null);
  }, []);

  const getCurrentPosition = useCallback(async () => {
    setGpsError(null);
    setGpsSource('seeking');
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported in this browser');
      return;
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsLat(pos.coords.latitude);
          setGpsLng(pos.coords.longitude);
          setGpsSource('browser');
          setGpsLocked(true);
          setGpsError(null);
          resolve(pos);
        },
        (err) => {
          const denied = err?.code === 1;
          setGpsError(
            denied
              ? 'Location permission denied — please allow GPS access'
              : 'GPS unavailable — please try again'
          );
          setGpsSource(denied ? 'denied' : 'unavailable');
          setGpsLocked(false);
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }, []);

  const unreadCount = alerts.filter((a) => !a.read).length;

  const markAllRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const gpsModeLabel = useMemo(() => {
    switch (gpsSource) {
      case 'browser':
        return 'Browser GPS';
      case 'manual':
        return 'Manual';
      case 'demo':
        return 'Demo Fallback';
      case 'denied':
        return 'Denied';
      case 'unavailable':
        return 'Unavailable';
      default:
        return 'Seeking';
    }
  }, [gpsSource]);

  const value = useMemo(
  () => ({

    wsConnected,
    busId,
    setBusId,
    gpsLocked,
    gpsLat,
    gpsLng,
    gpsSource,
    gpsError,
    gpsModeLabel,
      setManualGps,
      clearManualGps,
      getCurrentPosition,
      notificationsEnabled,
      setNotify,
      alerts,
      lastEvent: notificationsEnabled ? lastEvent : null,
      unreadCount,
      markAllRead,
    }),
    [
  wsConnected,
  busId,
  setBusId,
  gpsLocked,
  gpsLat,
  gpsLng,
  gpsSource,
  gpsError,
  gpsModeLabel,
  setManualGps,
  clearManualGps,
  getCurrentPosition,
  notificationsEnabled,
  setNotify,
  alerts,
  lastEvent,
  unreadCount,
  markAllRead,
]
  );

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystem() {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used within SystemProvider');
  return ctx;
}
