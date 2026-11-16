// This device: cabinet mode, sound, the controller, installing the app.

import { useEffect, useState } from 'preact/hooks';
import { kiosk, setKiosk, soundOn, setSound, config, me, go, signOut, toast } from '../state.js';
import { controller, connect, disconnect } from '../lib/serial.js';
import { sfx } from '../lib/sound.js';

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});

function Toggle({ on, onChange, label, hint }) {
  return (
    <label class="toggle">
      <span class="toggle__text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="toggle__track" aria-hidden="true">
        <i />
      </span>
    </label>
  );
}

export function Settings() {
  const c = controller.value;
  const [canInstall, setCanInstall] = useState(Boolean(installEvent));
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  return (
    <div class="settings">
      <h1 class="signage">Settings</h1>

      <section class="panel">
        <h2 class="section-title">This device</h2>
        <Toggle
          on={kiosk.value}
          onChange={(v) => {
            setKiosk(v);
            toast(v ? 'This is the cabinet now: attract mode, big buttons, controller.' : 'Cabinet mode is off.');
          }}
          label="This is the cabinet"
          hint="Runs the attract loop when idle, forgets who's playing when it does, and talks to the controller."
        />
        <Toggle on={soundOn.value} onChange={(v) => (setSound(v), v && sfx.select())} label="Arcade sounds" hint="Blips, coin drops and the ticket counter. Games keep their own sound." />
        {document.fullscreenEnabled && (
          <button type="button" class="btn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
            {document.fullscreenElement ? 'Leave full screen' : 'Full screen'}
          </button>
        )}
      </section>

      <section class="panel">
        <h2 class="section-title">Cabinet controller</h2>
        {!c.supported ? (
          <p class="note">This browser can't talk to the controller. The cabinet runs Chromium, which can; the buttons still work as a keyboard here.</p>
        ) : c.connected ? (
          <>
            <p class="status status--ok">
              Connected{c.fw ? `, firmware ${c.fw}` : ''}
              {c.profile ? `. Buttons are set for ${c.profile === 'arcade' ? 'the arcade menus' : c.profile}.` : '.'}
            </p>
            <div class="row">
              <button type="button" class="btn btn--play" onClick={() => go('/controller')}>
                Test the buttons
              </button>
              <button type="button" class="btn btn--quiet" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p class="status">Not connected. Plug the controller in, then connect it once; the browser remembers it.</p>
            <button
              type="button"
              class="btn btn--play"
              onClick={async () => {
                try {
                  if (await connect()) toast('Controller connected.');
                } catch {
                  /* cancelled */
                }
              }}
            >
              Connect the controller
            </button>
          </>
        )}
      </section>

      <section class="panel">
        <h2 class="section-title">Players</h2>
        <p>
          {me.value ? `${me.value.name} is playing on this device.` : 'Nobody is playing on this device.'}
          {kiosk.value ? ' On the cabinet, players sign out when the attract loop starts.' : ''}
        </p>
        <div class="row">
          <button type="button" class="btn" onClick={() => go('/players')}>
            Who's playing?
          </button>
          {me.value && (
            <button type="button" class="btn btn--quiet" onClick={() => signOut().then(() => toast('Signed out.'))}>
              Sign out
            </button>
          )}
        </div>
      </section>

      {!standalone && (
        <section class="panel">
          <h2 class="section-title">Put the arcade on your home screen</h2>
          {canInstall ? (
            <button
              type="button"
              class="btn btn--play"
              onClick={async () => {
                installEvent?.prompt();
                await installEvent?.userChoice;
                installEvent = null;
                setCanInstall(false);
              }}
            >
              Install the arcade
            </button>
          ) : ios ? (
            <p>In Safari, tap Share, then Add to Home Screen.</p>
          ) : (
            <p>In your browser's menu, choose Install app (or Add to Home screen).</p>
          )}
        </section>
      )}

      <section class="panel">
        <h2 class="section-title">About</h2>
        <p>
          {config.value?.name || 'au12 Arcade'} {config.value?.version}. Open source at{' '}
          <a href="https://github.com/au12/arcade" target="_blank" rel="noopener">
            github.com/au12/arcade
          </a>
          , with the cabinet plans and controller firmware.
        </p>
        {config.value?.admin && (
          <p>
            <a href="/admin">Admin page</a>
          </p>
        )}
      </section>
    </div>
  );
}
