import { useEffect, useState, useRef } from 'preact/hooks';

export function useMedia(query) {
  const [hit, setHit] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setHit(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return hit;
}

export const BIG = '(min-width: 960px) and (min-height: 540px)';

/** Loads something async; re-runs when deps change. Keeps the last value while reloading. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const gen = useRef(0);
  useEffect(() => {
    const n = ++gen.current;
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve()
      .then(fn)
      .then(
        (data) => n === gen.current && setState({ data, error: null, loading: false }),
        (error) => n === gen.current && setState((s) => ({ data: s.data, error, loading: false })),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useInterval(fn, ms) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!ms) return undefined;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
