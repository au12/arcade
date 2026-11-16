// au12 Arcade controller: the cabinet's buttons, stick, plunger, nudge
// sensor, volume knob and marquee lights, as one USB device.
//
// To the PC it is a keyboard, a mouse, a gamepad (off unless a profile asks
// for it), media keys for the volume, and a serial port the arcade talks to.
// The logic is in core.h; this file reads the hardware and sends the reports.
//
// Build: Arduino IDE or arduino-cli with the Raspberry Pi Pico core by Earle
// Philhower (https://github.com/earlephilhower/arduino-pico), board
// "Raspberry Pi Pico", Tools > USB Stack: "Adafruit TinyUSB", and the
// "Adafruit NeoPixel" library. FQBN: rp2040:rp2040:rpipico:usbstack=tinyusb
// Or take the .uf2 from the repository's releases and drop it on the Pico.

#include <Adafruit_TinyUSB.h>
#include <Adafruit_NeoPixel.h>
#include <EEPROM.h>
#include <Wire.h>

#include "config.h"
#include "core.h"
#include "fx.h"

using namespace arcade;

// ───────────── USB ─────────────

enum { RID_KEYBOARD = 1, RID_MOUSE, RID_CONSUMER, RID_GAMEPAD };

static const uint8_t hidReportDescriptor[] = {
  TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(RID_KEYBOARD)),
  TUD_HID_REPORT_DESC_MOUSE(HID_REPORT_ID(RID_MOUSE)),
  TUD_HID_REPORT_DESC_CONSUMER(HID_REPORT_ID(RID_CONSUMER)),
  TUD_HID_REPORT_DESC_GAMEPAD(HID_REPORT_ID(RID_GAMEPAD)),
};

Adafruit_USBD_HID hid;

static void emitLine(const char* line) {
  if (Serial) Serial.println(line);
}

Controller ctl(emitLine, BOARD_NAME, [] {
  Settings s;
  s.plungerPull = PLUNGER_PULL;
  s.plungerRelease = PLUNGER_RELEASE;
  s.propFullMs = PLUNGER_PROP_MS;
  s.nudgeThresholdMg = NUDGE_THRESHOLD_MG;
  s.nudgeTapMs = NUDGE_TAP_MS;
  s.nudgeQuietMs = NUDGE_QUIET_MS;
  s.comboMs = COMBO_HOME_MS;
  s.revertMs = HOST_REVERT_MS;
  s.mouseMin = MOUSE_MIN_SPEED;
  s.mouseMax = MOUSE_MAX_SPEED;
  s.mouseRampMs = MOUSE_RAMP_MS;
  return s;
}());

// ───────────── buttons ─────────────

struct Button {
  Input input;
  uint8_t pin;
  uint8_t count; // debounce integrator, 0..DEBOUNCE_MS
  bool down;
};

static Button buttons[] = {
  {UP, PIN_UP, 0, false}, {DOWN, PIN_DOWN, 0, false}, {LEFT, PIN_LEFT, 0, false}, {RIGHT, PIN_RIGHT, 0, false},
  {B1, PIN_B1, 0, false}, {B2, PIN_B2, 0, false}, {B3, PIN_B3, 0, false},
  {B4, PIN_B4, 0, false}, {B5, PIN_B5, 0, false}, {B6, PIN_B6, 0, false},
  {START, PIN_START, 0, false}, {COIN, PIN_COIN, 0, false}, {HOME, PIN_HOME, 0, false},
  {LFLIP, PIN_LFLIP, 0, false}, {RFLIP, PIN_RFLIP, 0, false}, {LAUNCH, PIN_LAUNCH, 0, false},
  {KNOB, PIN_KNOB_SW, 0, false},
};

static void scanButtons(uint32_t now) {
  for (Button& b : buttons) {
    bool raw = digitalRead(b.pin) == LOW;
    if (raw && b.count < DEBOUNCE_MS) b.count++;
    if (!raw && b.count > 0) b.count--;
    bool down = b.down ? b.count > 0 : b.count >= DEBOUNCE_MS;
    if (down != b.down) {
      b.down = down;
      ctl.setInput(b.input, down, now);
    }
  }
}

// ───────────── volume knob ─────────────

static volatile int16_t knobSteps = 0;
static volatile uint8_t knobState = 0;

static void knobChanged() {
  static const int8_t table[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  knobState = static_cast<uint8_t>(((knobState << 2) | (digitalRead(PIN_KNOB_A) << 1) | digitalRead(PIN_KNOB_B)) & 0x0F);
  knobSteps += table[knobState];
}

static void readKnob(uint32_t now) {
  noInterrupts();
  int16_t steps = knobSteps;
  int16_t detents = steps / KNOB_STEPS_PER_DETENT;
  knobSteps = static_cast<int16_t>(steps - detents * KNOB_STEPS_PER_DETENT);
  interrupts();
  if (detents) ctl.turnKnob(static_cast<int8_t>(KNOB_REVERSE ? -detents : detents), now);
}

// ───────────── plunger ─────────────

struct Calibration {
  uint32_t magic;
  uint16_t rest, max;
};
static const uint32_t CAL_MAGIC = 0xA12CA1u;
static float plungerFiltered = 0;

static uint16_t readPlungerRaw() {
  uint32_t sum = 0;
  for (int k = 0; k < 4; k++) sum += analogRead(PIN_PLUNGER);
  return static_cast<uint16_t>(sum / 4);
}

static void readPlunger(uint32_t now) {
  plungerFiltered += (readPlungerRaw() - plungerFiltered) * 0.35f;
  ctl.setPlunger(static_cast<uint16_t>(plungerFiltered + 0.5f), now);
}

// ───────────── nudge (LSM6DSOX, raw registers) ─────────────

static uint8_t accelAddress = 0;

static bool accelWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(accelAddress);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

static int accelReadByte(uint8_t address, uint8_t reg) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(address, static_cast<uint8_t>(1)) != 1) return -1;
  return Wire.read();
}

static void accelBegin() {
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin();
  Wire.setClock(400000);
  for (uint8_t address : {static_cast<uint8_t>(0x6A), static_cast<uint8_t>(0x6B)}) {
    if (accelReadByte(address, 0x0F) == 0x6C) { // WHO_AM_I
      accelAddress = address;
      break;
    }
  }
  if (!accelAddress) return;
  accelWrite(0x12, 0x44); // CTRL3_C: block data update, auto-increment
  accelWrite(0x10, 0x68); // CTRL1_XL: 416 Hz, ±4 g
}

static void readAccel(uint32_t now) {
  if (!accelAddress) return;
  Wire.beginTransmission(accelAddress);
  Wire.write(0x28); // OUTX_L_A
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom(accelAddress, static_cast<uint8_t>(6)) != 6) return;
  int16_t v[3];
  for (int k = 0; k < 3; k++) {
    uint8_t lo = Wire.read(), hi = Wire.read();
    v[k] = static_cast<int16_t>(static_cast<int16_t>(hi << 8 | lo) * 0.122f); // mg at ±4 g
  }
  int across = v[NUDGE_AXIS_ACROSS] * NUDGE_SIGN_ACROSS;
  int forward = v[1 - NUDGE_AXIS_ACROSS] * NUDGE_SIGN_FORWARD;
  ctl.setAccel(static_cast<int16_t>(across), static_cast<int16_t>(forward), now);
}

// ───────────── serial lines from the arcade ─────────────

static char line[640];
static size_t lineLength = 0;
static bool lineTooLong = false;

static void readSerial(uint32_t now) {
  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c < 0) break;
    if (c == '\n' || c == '\r') {
      if (lineLength && !lineTooLong) {
        line[lineLength] = 0;
        ctl.command(line, now);
      }
      lineLength = 0;
      lineTooLong = false;
    } else if (lineLength < sizeof(line) - 1) {
      line[lineLength++] = static_cast<char>(c);
    } else {
      lineTooLong = true;
    }
  }
}

// ───────────── HID reports ─────────────

static KeyReport sentKeys = {0, {0, 0, 0, 0, 0, 0}};
static uint8_t sentButtons = 0;
static int16_t pendingX = 0, pendingY = 0;
static PadReport sentPad = {0, 0, 0, 0, 0, 0};
static bool padDirty = false;
static int consumerQueue = 0;  // volume clicks waiting (+ up, - down)
static int muteQueue = 0;
static bool consumerDown = false;
static uint32_t lastMouseAt = 0;

static bool samePad(const PadReport& a, const PadReport& b) {
  return a.x == b.x && a.y == b.y && a.z == b.z && a.rx == b.rx && a.ry == b.ry && a.buttons == b.buttons;
}

/** One report per call, most urgent first: the HID endpoint takes one at a time. */
static void sendReports(uint32_t now) {
  if (now - lastMouseAt >= MOUSE_EVERY_MS) {
    lastMouseAt = now;
    int8_t dx, dy;
    ctl.mouseMotion(now, dx, dy);
    pendingX += dx;
    pendingY += dy;
  }
  consumerQueue += ctl.takeVolume();
  muteQueue += ctl.takeMutes();
  PadReport pad = ctl.pad();
  if (!samePad(pad, sentPad)) padDirty = true;

  if (!TinyUSBDevice.mounted() || !hid.ready()) return;

  KeyReport keys = ctl.keyboard();
  if (keys != sentKeys) {
    hid.keyboardReport(RID_KEYBOARD, keys.mods, keys.keys);
    sentKeys = keys;
    return;
  }
  uint8_t mouse = ctl.mouseButtons();
  if (mouse != sentButtons || pendingX || pendingY) {
    int8_t dx = static_cast<int8_t>(pendingX > 127 ? 127 : pendingX < -127 ? -127 : pendingX);
    int8_t dy = static_cast<int8_t>(pendingY > 127 ? 127 : pendingY < -127 ? -127 : pendingY);
    hid.mouseReport(RID_MOUSE, mouse, dx, dy, 0, 0);
    pendingX -= dx;
    pendingY -= dy;
    sentButtons = mouse;
    return;
  }
  if (consumerDown) {
    hid.sendReport16(RID_CONSUMER, 0);
    consumerDown = false;
    return;
  }
  if (muteQueue > 0 || consumerQueue != 0) {
    uint16_t usageId;
    if (muteQueue > 0) {
      usageId = usage::MUTE;
      muteQueue--;
    } else if (consumerQueue > 0) {
      usageId = usage::VOLUME_UP;
      consumerQueue--;
    } else {
      usageId = usage::VOLUME_DOWN;
      consumerQueue++;
    }
    hid.sendReport16(RID_CONSUMER, usageId);
    consumerDown = true;
    return;
  }
  if (padDirty && (ctl.padEnabled() || sentPad.buttons || sentPad.x || sentPad.y)) {
    hid_gamepad_report_t report = {};
    report.x = pad.x;
    report.y = pad.y;
    report.z = pad.z;
    report.rx = pad.rx;
    report.ry = pad.ry;
    report.buttons = pad.buttons;
    hid.sendReport(RID_GAMEPAD, &report, sizeof(report));
    sentPad = pad;
    padDirty = false;
  } else {
    padDirty = false;
  }
}

// ───────────── core 0: inputs and USB ─────────────

void setup() {
  TinyUSBDevice.setManufacturerDescriptor("au12");
  TinyUSBDevice.setProductDescriptor("au12 Arcade Controller");
  hid.setPollInterval(1);
  hid.setReportDescriptor(hidReportDescriptor, sizeof(hidReportDescriptor));
  hid.begin();
  Serial.begin(115200);
  // The core may have enumerated before the HID interface existed: do it again.
  if (TinyUSBDevice.mounted()) {
    TinyUSBDevice.detach();
    delay(10);
    TinyUSBDevice.attach();
  }

  for (Button& b : buttons) pinMode(b.pin, INPUT_PULLUP);
  pinMode(PIN_KNOB_A, INPUT_PULLUP);
  pinMode(PIN_KNOB_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_KNOB_A), knobChanged, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_KNOB_B), knobChanged, CHANGE);

  analogReadResolution(12);
  plungerFiltered = readPlungerRaw();
  EEPROM.begin(256);
  Calibration cal;
  EEPROM.get(0, cal);
  if (cal.magic == CAL_MAGIC && cal.rest != cal.max) {
    ctl.begin(cal.rest, cal.max);
  } else {
    // Not calibrated yet: wherever it rests now is rest, full travel the other way.
    uint16_t rest = static_cast<uint16_t>(plungerFiltered);
    ctl.begin(rest, rest < 2048 ? 4095 : 0);
  }

  accelBegin();
}

void loop() {
#ifdef TINYUSB_NEED_POLLING_TASK
  TinyUSBDevice.task();
#endif
  static uint32_t lastScan = 0, lastAccel = 0;
  uint32_t now = millis();
  ctl.setHost(static_cast<bool>(Serial), now);
  readSerial(now);
  if (now != lastScan) { // once a millisecond
    lastScan = now;
    scanButtons(now);
    readKnob(now);
    readPlunger(now);
    if (now - lastAccel >= 5) {
      lastAccel = now;
      readAccel(now);
    }
    ctl.tick(now);
    uint16_t rest, max;
    if (ctl.takeCalibration(rest, max)) {
      Calibration cal = {CAL_MAGIC, rest, max};
      EEPROM.put(0, cal);
      EEPROM.commit();
    }
  }
  sendReports(now);
}

// ───────────── core 1: the marquee ─────────────

Adafruit_NeoPixel strip(LED_COUNT, PIN_LEDS, NEO_GRB + NEO_KHZ800);

void setup1() {
  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();
}

void loop1() {
  static uint16_t seq = 0;
  static uint32_t startedAt = 0, lastFrame = 0;
  uint32_t now = millis();
  if (now - lastFrame < 16) return; // about 60 frames a second
  lastFrame = now;
  Fx fx = ctl.fx(now); // a few plain fields, read from the other core: at worst one frame is off
  if (fx.seq != seq) {
    seq = fx.seq;
    startedAt = now;
  }
  uint32_t t = now - startedAt;
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    Rgb c = fxPixel(fx, t, i, LED_COUNT);
    strip.setPixelColor(i, c.r, c.g, c.b);
  }
  strip.show();
}
