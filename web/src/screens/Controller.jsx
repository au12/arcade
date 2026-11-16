// The controller test bench: every button lights up as you press it, the
// plunger shows how far it's pulled, nudges register, and the marquee LEDs
// can be tried out. Handy while wiring the cabinet.

import { useEffect, useState } from 'preact/hooks';
import { controller, setTesting, calibrate, fx, connect, useProfileFor } from '../lib/serial.js';
import { ControlPanel, inputName } from '../components/game.jsx';
import { games, go, toast } from '../state.js';
import { useActions } from '../lib/nav.js';
import { profileLine } from '../lib/hid.js';

const FX = [
  ['attract', 'Attract'],
  ['idle', 'Idle'],
  ['game', 'Game color'],
  ['record', 'New record'],
  ['coin', 'Coin'],
  ['off', 'Off'],
];

export function ControllerTest() {
  const c = controller.value;
  const [step, setStep] = useState(null);
  const [view, setView] = useState(null);
  useEffect(() => {
    if (c.connected) setTesting(true);
    return () => {
      if (controller.value.connected) setTesting(false);
    };
  }, [c.connected]);
  // While testing, every button is ours, except holding Start and Coin to leave.
  useActions((a) => {
    if (a === 'back' || a === 'home') {
      go('/settings');
      return true;
    }
    return false;
  }, []);

  if (!c.connected) {
    return (
      <div class="bench">
        <h1 class="signage">Controller</h1>
        <p>Connect the controller to test it.</p>
        <button type="button" class="btn btn--play" onClick={() => connect().catch(() => {})}>
          Connect the controller
        </button>
      </div>
    );
  }
  const pressed = Object.fromEntries(Object.entries(c.inputs).filter(([, v]) => v));
  const g = view && games.value.find((x) => x.id === view);
  return (
    <div class="bench">
      <h1 class="signage">Controller</h1>
      <p class="note">
        Firmware {c.fw || '?'} on {c.board || 'RP2040'}. Press anything. Escape or the menu button goes back.
      </p>
      <div class="bench__grid">
        <div>
          <ControlPanel pressed={{ ...pressed, NUDGE_L: pressed.NUDGE_L, NUDGE_R: pressed.NUDGE_R }} plunger={c.plunger} hints={[]} />
          <p class="bench__pressed" aria-live="polite">
            {Object.keys(pressed).length ? Object.keys(pressed).map(inputName).join(', ') : 'Nothing pressed'}
          </p>
        </div>
        <div class="bench__side">
          <div class="meter">
            <span class="meter__label">Plunger</span>
            <span class="meter__bar">
              <i style={{ width: `${Math.round(c.plunger * 100)}%` }} />
            </span>
            <span class="meter__n">{Math.round(c.plunger * 100)}%</span>
          </div>
          <div class="cal">
            {step === null && (
              <button type="button" class="btn" onClick={() => setStep('rest')}>
                Calibrate the plunger
              </button>
            )}
            {step === 'rest' && (
              <>
                <p>Let the plunger rest, then press Next.</p>
                <button type="button" class="btn btn--play" data-autofocus onClick={() => (calibrate('REST'), setStep('max'))}>
                  Next
                </button>
              </>
            )}
            {step === 'max' && (
              <>
                <p>Pull it all the way back and hold it, then press Save.</p>
                <button
                  type="button"
                  class="btn btn--play"
                  data-autofocus
                  onClick={async () => {
                    await calibrate('MAX');
                    await calibrate('SAVE');
                    setStep(null);
                    toast('Plunger calibrated.');
                  }}
                >
                  Save
                </button>
              </>
            )}
          </div>
          <div class="meter">
            <span class="meter__label">Nudge</span>
            <span class="nudge-dot">
              <i style={{ transform: `translate(${Math.max(-1, Math.min(1, c.nudge[0] / 1500)) * 28}px, ${Math.max(-1, Math.min(1, c.nudge[1] / 1500)) * 28}px)` }} />
            </span>
          </div>
          <div>
            <p class="meter__label">Marquee lights</p>
            <div class="row row--wrap">
              {FX.map(([id, label]) => (
                <button type="button" key={id} class="btn btn--small" onClick={() => fx(id, '#ff8a24')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p class="meter__label">What a game sends</p>
            <select
              class="input"
              value={view || ''}
              onChange={(e) => {
                const id = e.currentTarget.value || null;
                setView(id);
                const game = id && games.value.find((x) => x.id === id);
                useProfileFor(game || null);
              }}
            >
              <option value="">The arcade's menus</option>
              {games.value.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <code class="profile-line">{g ? profileLine(g.id, g.cabinet) : 'PROFILE arcade …'}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
