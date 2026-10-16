import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, AlertTriangle, LayoutDashboard, Network } from 'lucide-react';
import { useLive } from './live';
import Overview from './pages/Overview';
import Incidents from './pages/Incidents';
import Pipeline from './pages/Pipeline';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, title: 'Service health overview' },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle, title: 'SLA incidents' },
  { to: '/pipeline', label: 'Pipeline', icon: Network, title: 'Pipeline status' },
];

const CONN_LABEL = { connecting: 'Connecting', live: 'Live', waiting: 'Waiting for Spark', offline: 'API offline' };

export default function App() {
  const { conn, services } = useLive();
  const { pathname } = useLocation();
  const page = NAV.find((n) => n.to === pathname) ?? NAV[0];
  const breaches = services.filter((s) => s.breached).length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={20} />
          <div>
            <div className="brand-name">TraceMesh</div>
            <div className="brand-sub">SRE observability</div>
          </div>
        </div>
        <nav>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'nav is-active' : 'nav')}>
              <Icon size={17} />
              <span>{label}</span>
              {to === '/incidents' && breaches > 0 && <span className="nav-count">{breaches}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Kafka → Spark → API / HDFS → Hive</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{page.title}</h1>
          <div className={`conn conn-${conn}`}>
            <span className="dot" />
            {CONN_LABEL[conn]}
          </div>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="*" element={<Overview />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
