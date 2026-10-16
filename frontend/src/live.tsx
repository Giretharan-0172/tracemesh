import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, windowTime, type AnomalyState, type MetricWindow } from './api';

// Polls GET /api/metrics (the windows Spark pushes to the API) and derives everything the
// pages show from them: the latest window per service, the P99 history and SLA incidents.

export const SLA_THRESHOLD_MS = 1000; // matches 01_detect_sla_violations.sql
const POLL_MS = 5000;
const MAX_WINDOWS = 1500; // ~25 min of history for 5 services at a 5s slide

export type ConnState = 'connecting' | 'live' | 'waiting' | 'offline';

export interface ServiceStatus extends MetricWindow {
  breached: boolean;
}

export interface Incident {
  id: string;
  serviceName: string;
  startedAt: number;
  resolvedAt: number | null;
  peakP99Ms: number;
  breachedWindows: number;
  active: boolean;
}

export type HistoryPoint = { time: number } & Record<string, number>;

interface LiveData {
  conn: ConnState;
  error: string | null;
  anomaly: AnomalyState | null;
  setAnomaly: (a: AnomalyState) => void;
  services: ServiceStatus[];
  history: HistoryPoint[];
  incidents: Incident[];
  latestWindowAt: number | null;
  lastPollAt: number | null;
}

const LiveContext = createContext<LiveData | null>(null);

const key = (w: MetricWindow) => `${w.serviceName}|${w.windowStart}`;

export function LiveProvider({ children }: { children: ReactNode }) {
  // The API only returns the 50 newest windows, so accumulate them client-side for history.
  const [windows, setWindows] = useState<Map<string, MetricWindow>>(new Map());
  const [anomaly, setAnomaly] = useState<AnomalyState | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const [metrics, status] = await Promise.all([api.metrics(), api.anomalyStatus()]);
      setAnomaly((prev) => ({ ...prev, ...status }));
      setWindows((prev) => {
        const next = new Map(prev);
        // Spark may replay a batch; the newest copy of a window wins, as on the API side.
        for (const w of metrics) next.set(key(w), w);
        if (next.size <= MAX_WINDOWS) return next;
        const sorted = [...next.entries()].sort((a, b) => windowTime(a[1].windowStart) - windowTime(b[1].windowStart));
        return new Map(sorted.slice(-MAX_WINDOWS));
      });
      setConn(metrics.length ? 'live' : 'waiting');
      setError(null);
    } catch (e) {
      setConn('offline');
      setError((e as Error).message);
    } finally {
      setLastPollAt(Date.now());
    }
  }, []);

  useEffect(() => {
    poll();
    const t = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(t);
  }, [poll]);

  const derived = useMemo(() => derive([...windows.values()]), [windows]);

  return (
    <LiveContext.Provider value={{ conn, error, anomaly, setAnomaly, lastPollAt, ...derived }}>
      {children}
    </LiveContext.Provider>
  );
}

function derive(all: MetricWindow[]) {
  const sorted = [...all].sort((a, b) => windowTime(a.windowStart) - windowTime(b.windowStart));

  const latest = new Map<string, MetricWindow>();
  const byTime = new Map<number, HistoryPoint>();
  const byService = new Map<string, MetricWindow[]>();
  for (const w of sorted) {
    latest.set(w.serviceName, w);
    const t = windowTime(w.windowStart);
    const point = byTime.get(t) ?? ({ time: t } as HistoryPoint);
    point[w.serviceName] = Number(w.p99LatencyMs);
    byTime.set(t, point);
    byService.set(w.serviceName, [...(byService.get(w.serviceName) ?? []), w]);
  }

  const services: ServiceStatus[] = [...latest.values()]
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName))
    .map((w) => ({ ...w, breached: Number(w.p99LatencyMs) > SLA_THRESHOLD_MS }));

  // An incident is a run of consecutive breaching windows for one service.
  const incidents: Incident[] = [];
  for (const [service, list] of byService) {
    let open: Incident | null = null;
    for (const w of list) {
      const t = windowTime(w.windowStart);
      const p99 = Number(w.p99LatencyMs);
      if (p99 > SLA_THRESHOLD_MS) {
        if (!open) {
          open = { id: `${service}-${t}`, serviceName: service, startedAt: t, resolvedAt: null, peakP99Ms: p99, breachedWindows: 0, active: true };
          incidents.push(open);
        }
        open.peakP99Ms = Math.max(open.peakP99Ms, p99);
        open.breachedWindows++;
      } else if (open) {
        open.resolvedAt = t;
        open.active = false;
        open = null;
      }
    }
  }
  incidents.sort((a, b) => b.startedAt - a.startedAt);

  const history = [...byTime.values()].slice(-120);
  const latestWindowAt = sorted.length ? windowTime(sorted[sorted.length - 1].windowStart) : null;
  return { services, history, incidents, latestWindowAt };
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside LiveProvider');
  return ctx;
}
