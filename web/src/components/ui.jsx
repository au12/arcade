// Small shared pieces: critters, ticket counts, modals, toasts, QR codes.

import { useEffect, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import { critterSvg } from '../lib/critter.js';
import { iconSvg } from '../lib/icons.js';
import { num } from '../lib/format.js';
import { toasts } from '../state.js';
import { focusFirst, useActions } from '../lib/nav.js';

export function Critter({ player, size = 48, overrides, class: cls = '', frame = true, title }) {
  if (!player) return <span class={`critter critter--empty ${cls}`} style={{ '--s': `${size}px` }} aria-hidden="true" />;
  const svg = critterSvg({ avatar: player.avatar, color: player.color, equipped: player.equipped }, overrides);
  const f = frame ? (overrides?.frame ?? player.equipped?.frame) : null;
  return (
    <span
      class={`critter ${f ? `frame-${f}` : ''} ${cls}`}
      style={{ '--s': `${size}px`, '--pc': player.color }}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function Tickets({ n, class: cls = '', label = true }) {
  return (
    <span class={`tickets ${cls}`} aria-label={`${num(n)} tickets`}>
      <svg viewBox="0 0 28 18" class="tickets__stub" aria-hidden="true">
        <path d="M2 2h24v4a3 3 0 0 0 0 6v4H2v-4a3 3 0 0 0 0-6z" />
        <path d="M9 4v10" class="perf" />
      </svg>
      <span class="tickets__n">{num(n)}</span>
      {label && <span class="sr-only"> tickets</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, class: cls = '', wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    setTimeout(() => ref.current && focusFirst(ref.current), 30);
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  useActions((a) => {
    if (a === 'back') {
      onClose?.();
      return true;
    }
    return false;
  }, [onClose]);
  return (
    <div class="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} class={`modal ${wide ? 'modal--wide' : ''} ${cls}`} role="dialog" aria-modal="true" aria-label={title} data-modal>
        {title && <h2 class="modal__title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast--${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Qr({ text, size = 160 }) {
  const svg = (() => {
    try {
      const q = qrcode(0, 'M');
      q.addData(String(text));
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      return '';
    }
  })();
  // eslint-disable-next-line react/no-danger
  return <span class="qr" style={{ '--s': `${size}px` }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A segmented choice (tabs for boards, periods, prize slots). */
export function Segments({ value, options, onChange, label }) {
  return (
    <div class="segments" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="tab"
          key={o.value}
          aria-selected={o.value === value}
          class={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Counts up to `to` when it changes (tickets, scores). */
export function CountUp({ to, ms = 900, format = num }) {
  const [v, setV] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      setV(Math.round(a + (to - a) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) setV(to);
    else raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{format(v)}</>;
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span class="spinner" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div class="empty">
      <p class="empty__title">{title}</p>
      {children && <p class="empty__body">{children}</p>}
      {action}
    </div>
  );
}

/** An achievement medallion with its pixel icon. */
export function BadgeIcon({ icon, got = true }) {
  // eslint-disable-next-line react/no-danger
  return <span class={`badge-icon ${got ? 'is-got' : ''}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(icon) }} />;
}
