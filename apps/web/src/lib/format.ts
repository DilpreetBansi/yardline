import { formatCents } from '@yardline/core';

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : formatCents(cents));

export const pct = (bp: number) => `${(bp / 100).toLocaleString('en-CA', { maximumFractionDigits: 2 })}%`;

export function relTime(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const t = new Date(value).getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d} d ago`;
  return new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export const dateLong = (value: string | Date | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

export const dateTime = (value: string | Date | null | undefined) =>
  value ? new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export const minutes = (m: number | null | undefined) => {
  if (m === null || m === undefined) return '—';
  if (m < 90) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
};

export const uomLabel = (uom: string, qty = 2) => {
  const map: Record<string, [string, string]> = {
    piece: ['pc', 'pcs'], sheet: ['sheet', 'sheets'], box: ['box', 'boxes'], bag: ['bag', 'bags'],
    roll: ['roll', 'rolls'], tube: ['tube', 'tubes'], each: ['ea', 'ea'],
  };
  const [one, many] = map[uom] ?? [uom, uom];
  return qty === 1 ? one : many;
};

export function newKey(prefix: string) {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
