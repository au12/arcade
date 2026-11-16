// Pins and tunables for the au12 Arcade controller. Everything you might
// want to change for your own wiring is here.
//
// Board: Raspberry Pi Pico (RP2040) or any RP2040/RP2350 board with the same
// GPIO numbers. Buttons connect between their pin and ground (the internal
// pull-ups are used), so a button reads LOW when pressed.

#pragma once

#define FW_VERSION "1.0.0"
#if defined(ARDUINO_RASPBERRY_PI_PICO_2)
#define BOARD_NAME "pico2"
#else
#define BOARD_NAME "pico"
#endif

// ── Digital inputs (to ground) ──────────────────────────────────
#define PIN_UP 0
#define PIN_DOWN 1
#define PIN_LEFT 2
#define PIN_RIGHT 3
// GP4/GP5 are the accelerometer's I2C pins (below).
#define PIN_B1 6
#define PIN_B2 7
#define PIN_B3 8
#define PIN_B4 9
#define PIN_B5 10
#define PIN_B6 11
#define PIN_START 12
#define PIN_COIN 13
#define PIN_HOME 14
#define PIN_LFLIP 15
#define PIN_RFLIP 16
#define PIN_LAUNCH 17

// ── Volume knob (EC11 rotary encoder with push switch) ───────────
#define PIN_KNOB_A 18
#define PIN_KNOB_B 19
#define PIN_KNOB_SW 20
#define KNOB_STEPS_PER_DETENT 4 // EC11 encoders: 4 transitions per click
#define KNOB_REVERSE 0          // 1 if turning clockwise turns the volume down

// ── Marquee lights (WS2812B, through a 74AHCT125 to 5 V) ─────────
#define PIN_LEDS 22
#define LED_COUNT 36       // 60 LED/m strip across a 560 mm marquee
#define LED_BRIGHTNESS 110 // 0-255; caps the strip's current (36 LEDs at 110 is under 1 A)

// ── Plunger (slide potentiometer, wiper to GP26/ADC0) ────────────
#define PIN_PLUNGER 26
#define PLUNGER_PULL 120    // per mille of travel that counts as pulled
#define PLUNGER_RELEASE 60  // and drops back to rest (hysteresis)
#define PLUNGER_PROP_MS 900 // "prop" mode: a full pull replays as a hold this long

// ── Nudge (LSM6DSOX accelerometer on I2C0) ───────────────────────
#define PIN_SDA 4
#define PIN_SCL 5
// Which accelerometer axis points across the cabinet (0 = X, 1 = Y), and
// the signs that make "pushed from the left" and "pushed forward" positive.
// Mount the board flat and check with the arcade's Controller screen.
#define NUDGE_AXIS_ACROSS 0
#define NUDGE_SIGN_ACROSS 1
#define NUDGE_SIGN_FORWARD 1
#define NUDGE_THRESHOLD_MG 350 // how hard a bump has to be
#define NUDGE_TAP_MS 80        // how long a nudge holds its key
#define NUDGE_QUIET_MS 350     // ignore the cabinet's wobble after a nudge

// ── Behaviour ────────────────────────────────────────────────────
#define DEBOUNCE_MS 5
#define COMBO_HOME_MS 1500    // hold Start + Coin this long for the menu
#define HOST_REVERT_MS 3000   // arcade gone this long: back to the universal profile
#define MOUSE_MIN_SPEED 1     // stick-as-mouse: pixels per report when you start
#define MOUSE_MAX_SPEED 14    // and after holding it for MOUSE_RAMP_MS
#define MOUSE_RAMP_MS 700
#define MOUSE_EVERY_MS 8
