/** Same-origin /api — Vite dev proxy forwards to Hono API_PORT. */
export const API_BASE = "/api";

export function apiPath(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
