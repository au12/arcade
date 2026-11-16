# The kiosk

The cabinet's PC does one thing: boots straight into the arcade, full screen, and stays there. This folder turns a fresh Debian install into that, with one script.

In kiosk mode (`?kiosk=1` on the arcade's address) the arcade runs its attract loop when nobody's playing, asks "still playing?" after a while without input and goes back to the attract loop, forgets who was playing when it does (a cabinet is a shared machine), and talks to the controller over USB to switch the buttons for each game and light the marquee.

## The PC

Anything that runs Chromium well. An Intel N100 mini PC is the sweet spot: quiet, about 10 W, fast enough for the pinball tables at 1080p, and it fits on the cabinet's floor behind the control box. A Raspberry Pi 5 works too, with a little less headroom for the pinball.

## Setting it up

1. Install Debian 12 (or 13) from the netinst image. At *Software selection*, untick everything except **SSH server** and **standard system utilities**: no desktop.
2. Log in, copy this folder over (or `git clone` the repository), and run:

   ```sh
   sudo sh setup.sh https://arcade.example.com
   ```

3. Plug in the controller (it shows up as **au12 Arcade Controller**) and reboot.

The arcade comes up on its own. The first time, open **Settings → Controller** on the cabinet to check every button and calibrate the plunger.

## What the script does

| | |
| --- | --- |
| Packages | `cage` (a compositor that runs exactly one app, full screen), Chromium, PipeWire for sound, `triggerhappy` for the volume knob |
| A user | `arcade`, which the kiosk runs as. It's in `dialout` so Chromium can open the controller's serial port. |
| Chromium policies | `/etc/chromium/policies/managed/au12-arcade.json`: the controller (USB vendor `0x2E8A`) is allowed for the arcade's address without a prompt, sound plays without a click, and there are no first-run, sign-in, translate or password bubbles |
| The browser | `/usr/local/bin/arcade-browser`: Chromium in kiosk mode on the arcade's address with `?kiosk=1` |
| The volume knob | The controller sends the PC's volume keys; `triggerhappy` hears them and `/usr/local/bin/arcade-volume` turns PipeWire up, down or mute |
| The service | `arcade-kiosk.service` starts cage with the browser on the first screen at boot, and restarts it if it ever closes |

**Ctrl+Alt+F2** gives you a login prompt on the second screen; **Ctrl+Alt+F1** goes back to the arcade. Over SSH, `sudo systemctl restart arcade-kiosk` reloads it.

## Changing the address

Run the script again with the new address. It overwrites its own files and nothing else.

## Undoing it

```sh
sudo systemctl disable --now arcade-kiosk triggerhappy
sudo rm /etc/systemd/system/arcade-kiosk.service /etc/pam.d/arcade-kiosk \
  /etc/chromium/policies/managed/au12-arcade.json /usr/local/bin/arcade-browser \
  /usr/local/bin/arcade-volume /etc/triggerhappy/triggers.d/au12-arcade.conf \
  -r /etc/systemd/system/triggerhappy.service.d
sudo systemctl enable getty@tty1 && sudo userdel -r arcade
```

## When something's wrong

- **A black screen.** `journalctl -u arcade-kiosk -b` says why. Most often the PC's graphics driver: install `firmware-misc-nonfree` (Intel) or `firmware-amd-graphics` from Debian's non-free-firmware, and reboot.
- **The controller isn't found.** `ls /dev/ttyACM*` should list it. In Chromium, `chrome://policy` should show `SerialAllowUsbDevicesForUrls` with the arcade's address, exactly as you open it (https and the same host). The arcade's **Settings → Controller** has a *Connect* button as a fallback.
- **No sound.** `sudo -u arcade XDG_RUNTIME_DIR=/run/user/$(id -u arcade) wpctl status` lists the outputs; `wpctl set-default <id>` picks the right one (HDMI or the headphone jack the amplifier is on).
- **The volume knob does nothing.** `sudo thd --dump /dev/input/event*` and turn the knob: you should see `KEY_VOLUMEUP`.
