// Typed client for the trace-producer REST API. All paths are relative (/api/...):
// in dev Vite proxies them to :8081, in Docker nginx proxies them to trace-producer.

/** One processed window as Spark pushes it to POST /api/metrics/ingest and GET /api/metrics returns it. */
export interface MetricWindow {
  serviceName: string;
  windowStart: string;
  p99LatencyMs: number;
  avgLatencyMs: number;
  totalRequests: number;
  errorCount: number;
}

export interface AnomalyState {
  anomalyActive: boolean;
  targetService?: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  tech: string;
  status: 'up' | 'degraded' | 'down';
  detail: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  metrics: () => request<MetricWindow[]>('/api/metrics'),
  anomalyStatus: () => request<AnomalyState>('/api/anomaly/status'),
  toggleAnomaly: (enable: boolean) =>
    request<AnomalyState>(`/api/anomaly/toggle?enable=${enable}`, { method: 'POST' }),
  pipelineHealth: () => request<{ checkedAt: string; stages: PipelineStage[] }>('/api/pipeline/health'),
};

/** Spark casts window starts to strings like "2026-10-16 13:20:05" (UTC, no zone). */
export function windowTime(windowStart: string): number {
  const iso = windowStart.includes('T') ? windowStart : windowStart.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}
