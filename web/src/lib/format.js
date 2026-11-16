// Numbers, times and names, the way the arcade says them.

const nf = new Intl.NumberFormat('en-US');

export function formatValue(v, format = 'int') {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (format === 'time') {
    const s = Math.max(0, n);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}:${sec.toFixed(sec % 1 ? 2 : 0).padStart(sec % 1 ? 5 : 2, '0')}`;
  }
  if (format === 'decimal') return n.toFixed(2);
  return nf.format(Math.round(n));
}

export const num = (n) => nf.format(Math.round(Number(n) || 0));

export function ago(t, now = Date.now()) {
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export function duration(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** "Grandma", "Grandma and Dad", "Grandma, Dad and Sprout" */
export const names = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
