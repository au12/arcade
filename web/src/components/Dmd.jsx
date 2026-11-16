import { useEffect, useRef } from 'preact/hooks';
import { Dmd as Engine } from '../lib/dmd.js';
import { attach } from '../lib/dmdbus.js';

/**
 * A dot-matrix display. `loop` is the list of scenes it cycles through;
 * the main display (`main`) also receives announcements from anywhere.
 */
export function Dmd({ loop = [], rows = 32, main = false, class: cls = '', label = '', onScene }) {
  const ref = useRef(null);
  const engine = useRef(null);
  const sceneCb = useRef(onScene);
  sceneCb.current = onScene;

  useEffect(() => {
    const d = new Engine(ref.current, { rows });
    d.onScene = (sc) => sceneCb.current?.(sc);
    engine.current = d;
    d.start();
    const detach = main ? attach(d) : () => {};
    const vis = () => (document.hidden ? d.stop() : d.start());
    document.addEventListener('visibilitychange', vis);
    return () => {
      detach();
      document.removeEventListener('visibilitychange', vis);
      d.destroy();
    };
  }, [rows, main]);

  const key = JSON.stringify(loop);
  useEffect(() => {
    engine.current?.setLoop(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <canvas ref={ref} class={`dmd ${cls}`} role="img" aria-label={label || 'Dot-matrix display'} />;
}
