import React from 'react';
import { Moon, Sun, Bus, Bell, Cpu, Satellite } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useTheme } from '../context/ThemeContext';
import { useSystem } from '../context/SystemContext';
import { FLEET_BUSES } from '../data/fleet';

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { busId, setBusId, notificationsEnabled, setNotify, wsConnected, gpsLocked } = useSystem();

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Settings"
        badge="OPERATOR"
        description="Theme, focused bus node and demo operator preferences. Stored locally in this browser."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            Appearance
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Dark mode is the default command-center look. Light mode is fully supported with the same contrast rules.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {['dark', 'light'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTheme(mode)}
                className="p-4 rounded-xl text-left"
                style={{
                  background: 'var(--bg-elevated)',
                  border: theme === mode
                    ? '1px solid color-mix(in srgb, var(--accent) 50%, transparent)'
                    : '1px solid var(--border)',
                }}
              >
                <div className="font-semibold capitalize">{mode} mode</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {mode === 'dark' ? 'Charcoal command center' : 'High-contrast daylight'}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Bus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            Focused bus
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            The selected bus ID is shown in the top bar and persisted in localStorage.
          </p>
          <select value={busId} onChange={(e) => setBusId(e.target.value)} className="field p-2.5 text-sm">
            {FLEET_BUSES.map((b) => (
              <option key={b.id} value={b.id}>{b.id} — {b.route}</option>
            ))}
          </select>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </h2>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Show live incident ticker and alerts</span>
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => setNotify(e.target.checked)}
            />
          </label>
        </div>

        <div className="card p-5 space-y-3 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Cpu className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            System
          </h2>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>WebSocket</span>
            <span className="font-mono" style={{ color: wsConnected ? 'var(--ok)' : 'var(--warn)' }}>
              {wsConnected ? 'Online' : 'Reconnecting'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              <Satellite className="w-3.5 h-3.5" /> GPS
            </span>
            <span className="font-mono" style={{ color: gpsLocked ? 'var(--ok)' : 'var(--warn)' }}>
              {gpsLocked ? 'Lock' : 'Seek'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Model</span>
            <span className="font-mono">YOLOv8n</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Operator</span>
            <span>Demo Operator · SIH 2026</span>
          </div>
        </div>
      </div>
    </div>
  );
}
