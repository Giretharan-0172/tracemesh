import { Link } from 'react-router-dom';
import { AnomalyControl, Badge, Card, Empty, Kpi, LatencyChart, ServiceName } from '../components';
import { ago, duration, ms, num, time } from '../format';
import { SLA_THRESHOLD_MS, useLive } from '../live';

const WINDOW_SECONDS = 10;

export default function Overview() {
  const { services, history, incidents, latestWindowAt, conn, error } = useLive();

  if (conn === 'connecting') return <Empty>Connecting to the metrics API…</Empty>;

  const threshold = SLA_THRESHOLD_MS;
  const names = services.map((s) => s.serviceName);
  const breaches = services.filter((s) => s.breached).length;
  const spans = services.reduce((sum, s) => sum + Number(s.totalRequests), 0);
  const errors = services.reduce((sum, s) => sum + Number(s.errorCount), 0);
  const maxP99 = services.reduce((m, s) => Math.max(m, Number(s.p99LatencyMs)), 0);
  const avg = spans ? services.reduce((sum, s) => sum + Number(s.avgLatencyMs) * Number(s.totalRequests), 0) / spans : 0;
  const errorRate = spans ? (errors / spans) * 100 : 0;

  return (
    <div className="stack">
      <AnomalyControl />

      {conn === 'offline' && <div className="error-box">Metrics API unreachable: {error}</div>}
      {conn === 'waiting' && (
        <div className="info-box">
          The API is up but Spark hasn't delivered any windows yet. Spark emits a window once its 1-minute
          watermark passes, so the first metrics show up about a minute after the pipeline starts.
        </div>
      )}

      <div className="kpis">
        <Kpi label="Max P99 latency" value={services.length ? ms(maxP99) : '—'} tone={breaches ? 'bad' : 'good'}
          hint={breaches ? 'SLA violation in progress' : `Within SLA (${threshold} ms)`} />
        <Kpi label="Avg latency" value={services.length ? ms(avg, 1) : '—'} hint={`Across ${names.length} services`} />
        <Kpi label="Throughput" value={`${num(Math.round(spans / WINDOW_SECONDS))}/s`}
          hint={`${num(spans)} spans in latest ${WINDOW_SECONDS}s windows`} />
        <Kpi label="5xx error rate" value={`${errorRate.toFixed(2)}%`} tone={errorRate > 1 ? 'warn' : 'neutral'}
          hint={`${num(errors)} errors in window`} />
        <Kpi label="Active SLA breaches" value={breaches} tone={breaches ? 'bad' : 'good'} hint={`P99 > ${threshold} ms`} />
      </div>

      <div className="grid-2-1">
        <Card title="P99 latency per service"
          actions={<span className="pill">Latest window {ago(latestWindowAt)}</span>}>
          <LatencyChart history={history} services={names} threshold={threshold} />
        </Card>

        <Card title="SLA breach log" actions={<Link to="/incidents" className="link">View all</Link>}>
          {incidents.length === 0 ? (
            <Empty>No SLA breaches recorded. Inject an anomaly to test detection.</Empty>
          ) : (
            <ul className="incident-list">
              {incidents.slice(0, 6).map((i) => (
                <li key={i.id} className={i.active ? 'is-active' : ''}>
                  <div>
                    <ServiceName name={i.serviceName} />
                    <div className="sub">Peak P99 {ms(i.peakP99Ms)} · {duration(i.startedAt, i.resolvedAt ?? latestWindowAt)}</div>
                  </div>
                  <div className="right">
                    {i.active ? <Badge tone="bad">Active</Badge> : <Badge tone="muted">Resolved</Badge>}
                    <div className="sub mono">{time(i.startedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Service telemetry matrix" actions={<span className="pill">10s window · 5s slide</span>}>
        {services.length === 0 ? <Empty>No windows yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Window start</th>
                  <th className="num">P99</th>
                  <th className="num">Avg</th>
                  <th className="num">Spans</th>
                  <th className="num">5xx</th>
                  <th>P99 vs SLA</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.serviceName}>
                    <td><ServiceName name={s.serviceName} /></td>
                    <td className="mono dim">{s.windowStart}</td>
                    <td className={`num mono ${s.breached ? 'text-bad' : ''}`}>{ms(s.p99LatencyMs)}</td>
                    <td className="num mono">{ms(s.avgLatencyMs, 1)}</td>
                    <td className="num mono">{num(s.totalRequests)}</td>
                    <td className="num mono">{num(s.errorCount)}</td>
                    <td>
                      <div className="meter">
                        <span className={s.breached ? 'bad' : ''}
                          style={{ width: `${Math.min(100, (Number(s.p99LatencyMs) / (threshold * 3)) * 100)}%` }} />
                        <i style={{ left: '33.3%' }} />
                      </div>
                    </td>
                    <td>{s.breached ? <Badge tone="bad">SLA breach</Badge> : <Badge tone="good">Healthy</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
