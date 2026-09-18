import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeWebSocket } from '../api';

const BUS_KEY = 'bussense-bus-id';
const NOTIFY_KEY = 'bussense-notify';
const SystemContext = createContext(null);

export function getStoredBusId() {
  try {
    return localStorage.getItem(BUS_KEY) || 'BUS-07';
  } catch {
    return 'BUS-07';
  }
}

export function SystemProvider({ children }) {
  const [wsConnected, setWsConnected] = useState(false);
  const [busId, setBusIdState] = useState(() => getStoredBusId());
  const [gpsLocked, setGpsLocked] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [alerts, setAlerts] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeWebSocket((msg) => {
      if (msg.event === 'connection') {
        const online = msg.data.status === 'connected';
        setWsConnected(online);
        setGpsLocked(online);
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

  const setBusId = useCallback((id) => {
    const next = (id || 'BUS-07').toUpperCase();
    setBusIdState(next);
    try {
      localStorage.setItem(BUS_KEY, next);
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

  const unreadCount = alerts.filter((a) => !a.read).length;

  const markAllRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const value = useMemo(
    () => ({
      wsConnected,
      busId,
      setBusId,
      gpsLocked,
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
