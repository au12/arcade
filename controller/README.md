# The cabinet controller

One Raspberry Pi Pico runs everything you touch on the cabinet: the stick, eleven buttons, the flipper buttons, the plunger, the nudge sensor, the volume knob and the marquee lights. To the PC it is a single USB device: a keyboard, a mouse, a gamepad, media keys and a serial port.

The arcade talks to it over that serial port (Web Serial in Chromium). When a game starts, the arcade sends that game's button map, so the same red button is Space in one game and a mouse click in the next, and the plunger is a held Space bar for the pinball tables. The menu button never reaches a game: it goes straight to the arcade, which opens its menu on top of whatever is running.

Without the arcade (a different PC, or before the page has loaded), the controller types a sensible universal map: arrows, Enter, Escape, Space, Shift flippers, Space plunger, 5 for coin and F9 for the arcade's menu.

## Parts

| Part | Notes |
| --- | --- |
| Raspberry Pi Pico (RP2040) or Pico 2 | A screw-terminal carrier board makes the wiring painless. |
| 8-way joystick | Sanwa JLF or a Zippy clone, with microswitches. |
| 6 × 30 mm arcade buttons | B1–B6 (the player buttons). |
| 3 × 24 mm arcade buttons | Start, Coin, and the menu button. |
| 2 × flipper buttons | 28–30 mm, in the cabinet's sides. |
| 1 × 30 mm button | Launch, front left (red). |
| Pinball plunger + 60 mm slide potentiometer | Bourns PTA6043 (10 kΩ linear) or similar. The rod pushes the slider through a printed or laser-cut coupler. |
| LSM6DSOX breakout | Adafruit 4438 (STEMMA QT). Screwed flat to the cabinet floor. |
| EC11 rotary encoder with push switch | The volume knob. |
| WS2812B strip, 60 LED/m | 1 m, cut into two rows of 27 on the LED board behind the marquee, wired as one snaking strip. |
| 74AHCT125 | Lifts the LED data line to 5 V. Plus a 330 Ω resistor and a 1000 µF capacitor. |
| 5 V 4 A power supply | For the LEDs. The Pico is powered over USB by the PC; join the grounds. |
| 2.8 mm (.110") quick-disconnects, 22 AWG wire | One ground daisy-chained through every switch. |

## Wiring

Every switch goes between its pin and ground; the Pico's own pull-ups do the rest. Change any of these in [`config.h`](firmware/au12-arcade-controller/config.h).

| Pico pin | Connects to | | Pico pin | Connects to |
| --- | --- | --- | --- | --- |
| GP0 | Stick up | | GP12 | Start |
| GP1 | Stick down | | GP13 | Coin |
| GP2 | Stick left | | GP14 | Menu (HOME) |
| GP3 | Stick right | | GP15 | Left flipper |
| GP4 | Accelerometer SDA | | GP16 | Right flipper |
| GP5 | Accelerometer SCL | | GP17 | Launch |
| GP6 | B1 | | GP18 | Knob A |
| GP7 | B2 | | GP19 | Knob B |
| GP8 | B3 | | GP20 | Knob push |
| GP9 | B4 | | GP22 | LED data (through the 74AHCT125, then 330 Ω) |
| GP10 | B5 | | GP26 (ADC0) | Plunger pot wiper (ends to 3V3 and AGND) |
| GP11 | B6 | | 3V3, GND | Accelerometer power |

The cabinet's [assembly guide](../cabinet/README.md#wiring) has a drawing of the same.

## Flashing

1. Download `au12-arcade-controller-pico.uf2` (or `-pico2`) from the [releases](https://github.com/au12/arcade/releases), or from the latest **Controller firmware** run on the Actions tab.
2. Hold the Pico's BOOTSEL button while plugging it into USB. It shows up as a drive.
3. Copy the `.uf2` onto it. The Pico restarts as **au12 Arcade Controller**.

To build it yourself: install the [Raspberry Pi Pico core](https://github.com/earlephilhower/arduino-pico) and the Adafruit NeoPixel library, pick **Raspberry Pi Pico**, set **Tools → USB Stack** to **Adafruit TinyUSB**, and upload `firmware/au12-arcade-controller`. With arduino-cli:

```sh
arduino-cli compile --fqbn rp2040:rp2040:rpipico:usbstack=tinyusb controller/firmware/au12-arcade-controller
```

## Setting it up

Open the arcade's **Settings → Controller** on the cabinet. Every button lights up on the drawing as you press it, which is the quickest way to find a crossed wire.

- **Plunger**: press *Calibrate the plunger*, let it rest, *Next*, pull it all the way back a couple of times, *Save*. The calibration lives in the Pico's flash.
- **Nudge**: bump the cabinet and watch the dot. If a bump from the left moves it the wrong way, flip `NUDGE_SIGN_ACROSS` (or `NUDGE_AXIS_ACROSS` if the board is turned 90°) in `config.h`.
- **Lights**: try the effects. If the strip's colors are wrong, it isn't GRB: change `NEO_GRB` in the sketch.

Holding **Start and Coin** for a second and a half also opens the arcade's menu, for builds without a menu button.

## How it behaves

- **Plunger**: in `hold` mode (the pinball tables) the key is held while the plunger is pulled past 12% of its travel, and let go when it springs back, so the longer you hold it back the harder the shot, as on a keyboard. In `prop` mode a pull is replayed on release as a hold of matching length, for games where the hold time sets the strength.
- **Nudge**: a bump harder than 0.35 g taps the game's nudge key once (left, right or forward). Slow tilts and the cabinet's wobble afterwards are ignored.
- **Stick as a mouse**: for pointer games the stick moves the mouse pointer, slowly at first and faster the longer you hold it; a tap moves one pixel.
- **Volume**: the knob sends the PC's volume keys; pushing it mutes.
- **A game change while you hold a button** doesn't press the new game's key: that button is ignored until you let go.
- **The arcade closing the port** (the browser restarting) puts the controller back on the universal map after three seconds.

## The serial protocol

Lines of text over USB serial (any baud rate). The arcade's side is [`web/src/lib/serial.js`](../web/src/lib/serial.js); the controller's is [`core.h`](firmware/au12-arcade-controller/core.h).

| Arcade sends | Controller answers |
| --- | --- |
| `HELLO` | `HELLO au12-arcade-controller <firmware> <board>` |
| `PROFILE <name> STICK=KEYS\|MOUSE <INPUT>=<binding> …` | `OK PROFILE <name>` |
| `FX attract\|idle\|game\|record\|coin\|off [rrggbb]` | |
| `TEST ON\|OFF` | `OK TEST …`, then `IN <INPUT> 0\|1`, `PLG <0–1000>`, `NUD <x mg> <y mg>` while on |
| `CAL PLUNGER REST\|MAX\|SAVE` | `OK CAL …` or `ERR CAL …` |
| `STATUS`, `RESET` | for poking at it from a terminal |

Bindings: `x` (nothing), `k<hex>` (a key, by its USB HID usage), `k<hex>:hold` or `k<hex>:prop` (the plunger), `m1`/`m2`/`m4` (mouse buttons). `PAD=ON` in a profile turns on the gamepad (off by default, so games that read both keys and gamepads don't see every press twice).

Unasked, the controller sends `BTN HOME|COIN|START 0|1` whenever those change, and `ACT` (at most every two seconds) while someone is playing, so the arcade's idle timer knows even when a game has the keyboard.

## Tests

```sh
controller/test/run.sh
```

Runs the logic against every profile line the arcade really builds (from `web/src/lib/hid.js` and the catalog), then compiles the whole sketch against stand-in hardware and drives it: debouncing, profiles, the plunger, a nudge, calibration saved to flash, the marquee and the knob. CI then builds it with the real Pico core.
