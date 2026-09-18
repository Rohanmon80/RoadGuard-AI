import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Video,
  Map,
  BarChart3,
  AlertOctagon,
  Bus,
  FileBarChart,
  Settings,
  Cpu,
  Radio,
  Activity,
  Menu,
  X,
  Bell,
  Sun,
  Moon,
  Satellite,
  User,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useSystem } from '../context/SystemContext';

const NAV_ITEMS = [
  { name: 'Command Center', path: '/', icon: LayoutDashboard },
  { name: 'Live Detection', path: '/video', icon: Video },
  { name: 'Road Intelligence', path: '/map', icon: Map },
  { name: 'Traffic Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'Incidents', path: '/incidents', icon: AlertOctagon },
  { name: 'Fleet', path: '/fleet', icon: Bus },
  { name: 'Reports', path: '/reports', icon: FileBarChart },
  { name: 'Settings', path: '/settings', icon: Settings },
];

const PAGE_TITLES = {
  '/': 'Command Center',
  '/video': 'Live Detection',
  '/map': 'Road Intelligence',
  '/analytics': 'Traffic Analytics',
  '/incidents': 'Incidents',
  '/fleet': 'Fleet',
  '/reports': 'Reports',
  '/settings': 'Settings',
};

function BrandMark({ compact = false }) {
  return (
    <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'color-mix(in srgb, var(--accent) 18%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}
      >
        <Bus className="w-5 h-5" style={{ color: 'var(--accent)' }} />
      </div>
      {!compact && (
        <div className="min-w-0">
          <h1 className="font-extrabold tracking-tight text-sm leading-tight" style={{ color: 'var(--text)' }}>
            BUSSENSE <span style={{ color: 'var(--accent)' }}>AI</span>
          </h1>
          <p className="text-[10px] font-medium truncate" style={{ color: 'var(--text-muted)' }}>
            Mobile Urban Intelligence
          </p>
        </div>
      )}
    </div>
  );
}

function NavList({ onNavigate }) {
  return (
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{item.name}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export default function Layout({ children }) {
  const { theme, toggleTheme } = useTheme();
  const {
    wsConnected,
    busId,
    gpsLocked,
    lastEvent,
    alerts,
    unreadCount,
    markAllRead,
  } = useSystem();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const location = useLocation();
  const pageTitle = PAGE_TITLES[location.pathname] || 'BusSense AI';

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-app)', color: 'var(--text)' }}>
      <aside
        className="hidden md:flex flex-col w-64 shrink-0 z-30"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}
      >
        <div className="h-16 flex items-center px-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <BrandMark />
        </div>

        <NavList />

        <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="p-3 rounded-lg text-[11px] space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                AI Model
              </span>
              <span className="font-mono font-medium" style={{ color: 'var(--accent)' }}>YOLOv8n</span>
            </div>
            <div className="flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                GPS Mode
              </span>
              <span className="font-mono font-medium" style={{ color: 'var(--ok)' }}>Software Emu</span>
            </div>
            <div className="flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent-2)' }} />
                Telemetry
              </span>
              <span className="font-mono font-medium" style={{ color: wsConnected ? 'var(--ok)' : 'var(--warn)' }}>
                {wsConnected ? 'Active' : 'Standby'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          className="h-16 px-4 sm:px-6 flex items-center justify-between z-20 gap-3"
          style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="md:hidden">
              <BrandMark compact />
            </div>

            <div className="hidden md:block min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-subtle)' }}>
                BusSense AI
              </p>
              <p className="text-sm font-bold truncate">{pageTitle}</p>
            </div>

            {lastEvent && (
              <div
                className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--crit) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--crit) 35%, transparent)',
                  color: 'var(--crit)',
                }}
              >
                <span className="w-2 h-2 rounded-full live-beacon" style={{ background: 'var(--crit)' }} />
                <span>{lastEvent}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'live-beacon' : ''}`}
                style={{ background: wsConnected ? 'var(--ok)' : 'var(--warn)' }}
              />
              <span className="font-semibold" style={{ color: 'var(--text)' }}>
                {wsConnected ? 'System Online' : 'Reconnecting'}
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <Bus className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {busId}
            </div>

            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <Satellite className="w-3.5 h-3.5" style={{ color: gpsLocked ? 'var(--ok)' : 'var(--warn)' }} />
              <span className="font-medium" style={{ color: 'var(--text-muted)' }}>
                GPS {gpsLocked ? 'Lock' : 'Seek'}
              </span>
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setNotifyOpen((v) => !v);
                  markAllRead();
                }}
                className="relative p-2 rounded-lg"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                    style={{ background: 'var(--crit)' }}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifyOpen && (
                <div
                  className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden z-50"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
                >
                  <div className="px-3 py-2 text-xs font-bold" style={{ borderBottom: '1px solid var(--border)' }}>
                    Incident alerts
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {alerts.length === 0 ? (
                      <p className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>No alerts yet.</p>
                    ) : (
                      alerts.map((a) => (
                        <div key={a.id} className="px-3 py-2.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                          <div className="font-medium">{a.text}</div>
                          <div className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>
                            {a.severity} · {new Date(a.ts).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div
              className="hidden sm:flex items-center gap-2 pl-1 pr-2 py-1 rounded-full"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
              >
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="pr-1 leading-tight">
                <div className="text-[11px] font-bold">Demo Operator</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>SIH 2026</div>
              </div>
            </div>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="md:hidden p-3 z-30" style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)' }}>
            <NavList onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-7xl mx-auto h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
