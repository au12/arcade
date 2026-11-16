// The controller's logic, with no hardware in it: which keys the buttons
// press for the game that's on, the plunger, nudges, the volume knob, the
// marquee's effect, and the text protocol the arcade speaks over USB serial.
// The sketch feeds it debounced inputs and sends the HID reports it asks
// for; controller/test/ runs it on a PC.
//
// Protocol (lines of text; the arcade's side is web/src/lib/serial.js):
//   → HELLO                         ← HELLO au12-arcade-controller <fw> <board>
//   → PROFILE <name> STICK=KEYS|MOUSE <INPUT>=<binding> … [PAD=ON|OFF]
//        binding: x (nothing), k<hex usage>[:hold|:prop], m<mouse buttons 1|2|4>
//                                   ← OK PROFILE <name>
//   → FX attract|idle|game|record|coin|off [rrggbb]
//   → TEST ON|OFF                   ← OK TEST …, then IN <INPUT> <0|1>,
//                                     PLG <0-1000>, NUD <x mg> <y mg>
//   → CAL PLUNGER REST|MAX|SAVE     ← OK CAL … or ERR CAL …
//   → STATUS / RESET                ← STATUS … / OK RESET
//   ← BTN HOME|COIN|START <0|1>     always, so the arcade hears the menu button
//   ← ACT                           someone is playing (at most every 2 s)
//
// Until the arcade sends a profile (and again if it goes away) the
// controller uses the universal profile: arrows, Enter, Escape, Space,
// Shift flippers, Space plunger, 5 for coin and F9 for the menu.

#pragma once

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef FW_VERSION
#define FW_VERSION "dev"
#endif

namespace arcade {

enum Input : uint8_t {
  UP, DOWN, LEFT, RIGHT,
  B1, B2, B3, B4, B5, B6,
  START, COIN, HOME,
  LFLIP, RFLIP, LAUNCH, PLUNGER,
  NUDGE_UP, NUDGE_L, NUDGE_R,
  KNOB,
  INPUT_COUNT
};

// The same names, in the same order, as INPUTS in web/src/lib/hid.js.
static const char* const INPUT_NAMES[INPUT_COUNT] = {
  "UP", "DOWN", "LEFT", "RIGHT",
  "B1", "B2", "B3", "B4", "B5", "B6",
  "START", "COIN", "HOME",
  "LFLIP", "RFLIP", "LAUNCH", "PLUNGER",
  "NUDGE_UP", "NUDGE_L", "NUDGE_R",
  "KNOB",
};

enum Kind : uint8_t { NONE = 0, KEY = 1, MOUSE = 2 };
enum Mode : uint8_t { FOLLOW = 0, PROP = 1 }; // PROP only means something for the plunger

struct Binding {
  uint8_t kind;
  uint8_t code; // HID keyboard usage, or mouse button bits
  uint8_t mode;
};

struct Profile {
  char name[25];
  bool mouseStick;
  bool pad;
  Binding map[INPUT_COUNT];
  void clear() { memset(this, 0, sizeof(*this)); }
};

// HID keyboard usages the universal profile uses.
namespace usage {
constexpr uint8_t C = 0x06, T = 0x17, X = 0x1B, Z = 0x1D, D5 = 0x22;
constexpr uint8_t ENTER = 0x28, ESCAPE = 0x29, SPACE = 0x2C, PERIOD = 0x37, F9 = 0x42;
constexpr uint8_t ARROW_RIGHT = 0x4F, ARROW_LEFT = 0x50, ARROW_DOWN = 0x51, ARROW_UP = 0x52;
constexpr uint8_t SHIFT_LEFT = 0xE1, SHIFT_RIGHT = 0xE5;
constexpr uint16_t VOLUME_UP = 0x00E9, VOLUME_DOWN = 0x00EA, MUTE = 0x00E2; // consumer page
} // namespace usage

inline void universalProfile(Profile& p) {
  p.clear();
  strcpy(p.name, "universal");
  const struct { Input in; uint8_t key; } keys[] = {
    {UP, usage::ARROW_UP}, {DOWN, usage::ARROW_DOWN}, {LEFT, usage::ARROW_LEFT}, {RIGHT, usage::ARROW_RIGHT},
    {B1, usage::ENTER}, {B2, usage::ESCAPE}, {B3, usage::SPACE}, {B4, usage::Z}, {B5, usage::X}, {B6, usage::C},
    {START, usage::ENTER}, {COIN, usage::D5}, {HOME, usage::F9},
    {LFLIP, usage::SHIFT_LEFT}, {RFLIP, usage::SHIFT_RIGHT}, {LAUNCH, usage::SPACE}, {PLUNGER, usage::SPACE},
    {NUDGE_UP, usage::T}, {NUDGE_L, usage::X}, {NUDGE_R, usage::PERIOD},
  };
  for (const auto& k : keys) p.map[k.in] = Binding{KEY, k.key, FOLLOW};
}

inline int findInput(const char* s, size_t n) {
  for (int i = 0; i < INPUT_COUNT; i++) {
    if (strlen(INPUT_NAMES[i]) == n && strncmp(INPUT_NAMES[i], s, n) == 0) return i;
  }
  return -1;
}

/** "x", "k2c", "k2c:hold", "k2c:prop", "m1". */
inline bool parseBinding(const char* v, size_t n, Binding& b) {
  b = Binding{NONE, 0, FOLLOW};
  if (n == 0 || (n == 1 && v[0] == 'x')) return true;
  if (n >= 16 || (v[0] != 'k' && v[0] != 'm')) return false;
  char buf[16];
  memcpy(buf, v, n);
  buf[n] = 0;
  char* colon = strchr(buf, ':');
  const char* mode = nullptr;
  if (colon) {
    *colon = 0;
    mode = colon + 1;
  }
  char* end = nullptr;
  long code = strtol(buf + 1, &end, buf[0] == 'k' ? 16 : 10);
  if (end == buf + 1 || *end || code <= 0 || code > 255) return false;
  if (buf[0] == 'm' && code > 7) return false;
  b.kind = buf[0] == 'k' ? KEY : MOUSE;
  b.code = static_cast<uint8_t>(code);
  if (mode) {
    if (strcmp(mode, "prop") == 0) b.mode = PROP;
    else if (strcmp(mode, "hold") != 0) return false;
  }
  return true;
}

/** "PROFILE <name> STICK=KEYS|MOUSE <INPUT>=<binding> … [PAD=ON]". Inputs not named do nothing. */
inline bool parseProfile(const char* line, Profile& out) {
  if (strncmp(line, "PROFILE ", 8) != 0) return false;
  Profile p;
  p.clear();
  const char* s = line + 8;
  while (*s == ' ') s++;
  size_t n = strcspn(s, " ");
  if (n == 0) return false;
  size_t keep = n < sizeof(p.name) - 1 ? n : sizeof(p.name) - 1;
  memcpy(p.name, s, keep);
  p.name[keep] = 0;
  s += n;
  while (*s) {
    while (*s == ' ') s++;
    if (!*s) break;
    size_t len = strcspn(s, " ");
    const char* eq = static_cast<const char*>(memchr(s, '=', len));
    if (eq) {
      size_t kl = static_cast<size_t>(eq - s);
      const char* v = eq + 1;
      size_t vl = len - kl - 1;
      if (kl == 5 && strncmp(s, "STICK", 5) == 0) {
        p.mouseStick = vl == 5 && strncmp(v, "MOUSE", 5) == 0;
      } else if (kl == 3 && strncmp(s, "PAD", 3) == 0) {
        p.pad = vl == 2 && strncmp(v, "ON", 2) == 0;
      } else {
        int i = findInput(s, kl);
        Binding b;
        if (i >= 0 && parseBinding(v, vl, b)) p.map[i] = b;
      }
    }
    s += len;
  }
  out = p;
  return true;
}

struct KeyReport {
  uint8_t mods;
  uint8_t keys[6];
  bool operator==(const KeyReport& o) const { return mods == o.mods && memcmp(keys, o.keys, 6) == 0; }
  bool operator!=(const KeyReport& o) const { return !(*this == o); }
  bool empty() const {
    static const uint8_t none[6] = {0, 0, 0, 0, 0, 0};
    return mods == 0 && memcmp(keys, none, 6) == 0;
  }
};

struct PadReport {
  int8_t x, y, z, rx, ry;
  uint32_t buttons;
};

enum FxMode : uint8_t { FX_ATTRACT, FX_IDLE, FX_GAME, FX_RECORD, FX_COIN, FX_OFF };
static const char* const FX_NAMES[] = {"attract", "idle", "game", "record", "coin", "off"};

struct Fx {
  uint8_t mode;
  uint32_t color;
  uint16_t seq; // changes whenever the effect does, so the animation can restart
};

struct Settings {
  uint16_t plungerPull = 120, plungerRelease = 60, propFullMs = 900;
  uint16_t nudgeThresholdMg = 350, nudgeTapMs = 80, nudgeQuietMs = 350;
  uint16_t comboMs = 1500, actEveryMs = 2000, revertMs = 3000;
  uint8_t mouseMin = 1, mouseMax = 14;
  uint16_t mouseRampMs = 700;
};

class Controller {
 public:
  typedef void (*Emit)(const char* line);

  explicit Controller(Emit emit, const char* board = "pico", Settings s = Settings()) : emit_(emit), board_(board), s_(s) {
    universalProfile(profile_);
    steady_ = Fx{FX_IDLE, 0xFF8A24, 1};
  }

  /** Plunger calibration from storage (raw ADC readings at rest and fully pulled). */
  void begin(uint16_t rest, uint16_t max) {
    calRest_ = rest;
    calMax_ = max;
  }

  // ───────────── what the hardware tells it ─────────────

  /** A debounced button (or the knob's push switch, as KNOB). */
  void setInput(Input i, bool down, uint32_t now) {
    if (i >= INPUT_COUNT || i == PLUNGER || i == NUDGE_UP || i == NUDGE_L || i == NUDGE_R) return;
    if (phys_[i] == down) return;
    phys_[i] = down;
    if (i == START || i == COIN) say("BTN %s %d", INPUT_NAMES[i], down ? 1 : 0);
    if (i == KNOB && down) mutes_++;
    compute(now);
  }

  /** The plunger's filtered ADC reading. */
  void setPlunger(uint16_t raw, uint32_t now) {
    raw_ = raw;
    if (calibrating_ && dist(raw, calRest_) > dist(calFar_, calRest_)) calFar_ = raw;
    int span = static_cast<int>(calMax_) - static_cast<int>(calRest_);
    long pos = 0;
    if (span > 40 || span < -40) pos = (static_cast<long>(raw) - calRest_) * 1000L / span;
    pos_ = static_cast<uint16_t>(pos < 0 ? 0 : pos > 1000 ? 1000 : pos);
    compute(now);
  }

  /** Acceleration in mg: across the cabinet (+ = pushed from the left) and forward (+ = pushed away). */
  void setAccel(int16_t across, int16_t forward, uint32_t now) {
    if (!accelSeen_) {
      baseA_ = across * 256L;
      baseF_ = forward * 256L;
      accelSeen_ = true;
    }
    dA_ = static_cast<int16_t>(across - baseA_ / 256);
    dF_ = static_cast<int16_t>(forward - baseF_ / 256);
    // The baseline follows tilt and drift slowly, but not the bumps themselves.
    if (abs(dA_) < s_.nudgeThresholdMg / 2) baseA_ += (across * 256L - baseA_) / 128;
    if (abs(dF_) < s_.nudgeThresholdMg / 2) baseF_ += (forward * 256L - baseF_) / 128;
    if (now >= quietUntil_) {
      int t = s_.nudgeThresholdMg;
      int which = dA_ >= t ? NUDGE_L : dA_ <= -t ? NUDGE_R : dF_ >= t ? NUDGE_UP : -1;
      if (which >= 0) {
        nudgeUntil_[which - NUDGE_UP] = now + s_.nudgeTapMs;
        quietUntil_ = now + s_.nudgeQuietMs;
      }
    }
    compute(now);
  }

  /** Clicks of the volume knob since last time (+ = louder). */
  void turnKnob(int8_t detents, uint32_t now) {
    if (!detents) return;
    volume_ += detents;
    knobPulse_ = now + 120;
    compute(now);
  }

  /** Whether the arcade has the serial port open (DTR). */
  void setHost(bool open, uint32_t now) {
    if (open == host_) return;
    host_ = open;
    hostLostAt_ = open ? 0 : (now ? now : 1);
  }

  /** One line from the arcade, without its newline. */
  void command(const char* line, uint32_t now) {
    while (*line == ' ') line++;
    if (!*line) return;
    if (strcmp(line, "HELLO") == 0) {
      say("HELLO au12-arcade-controller %s %s", FW_VERSION, board_);
    } else if (strncmp(line, "PROFILE ", 8) == 0) {
      Profile p;
      if (!parseProfile(line, p)) return say("ERR PROFILE");
      apply(p, now);
      say("OK PROFILE %s", profile_.name);
    } else if (strncmp(line, "FX ", 3) == 0) {
      fxCommand(line + 3, now);
    } else if (strcmp(line, "TEST ON") == 0 || strcmp(line, "TEST OFF") == 0) {
      test_ = line[6] == 'N';
      for (int i = 0; i < INPUT_COUNT; i++) told_[i] = false;
      lastPlg_ = 0;
      plgSaid_ = 0xFFFF;
      say("OK TEST %s", test_ ? "ON" : "OFF");
      compute(now);
    } else if (strncmp(line, "CAL PLUNGER ", 12) == 0) {
      calCommand(line + 12);
    } else if (strcmp(line, "STATUS") == 0) {
      say("STATUS %s stick=%s pad=%s test=%s plunger=%u rest=%u max=%u host=%d", profile_.name, profile_.mouseStick ? "mouse" : "keys",
          profile_.pad ? "on" : "off", test_ ? "on" : "off", pos_, calRest_, calMax_, host_ ? 1 : 0);
    } else if (strcmp(line, "RESET") == 0) {
      Profile p;
      universalProfile(p);
      apply(p, now);
      say("OK RESET");
    } else {
      char word[16];
      size_t n = strcspn(line, " ");
      if (n > sizeof(word) - 1) n = sizeof(word) - 1;
      memcpy(word, line, n);
      word[n] = 0;
      say("ERR unknown %s", word);
    }
  }

  /** Timers: nudge taps ending, the plunger's replay, test streaming, the host going away. */
  void tick(uint32_t now) {
    if (!host_ && hostLostAt_ && now - hostLostAt_ >= s_.revertMs) {
      hostLostAt_ = 0;
      test_ = false;
      if (strcmp(profile_.name, "universal") != 0) {
        Profile p;
        universalProfile(p);
        apply(p, now);
      }
      setSteady(Fx{FX_IDLE, 0xFF8A24, 0});
    }
    compute(now);
    if (test_) stream(now);
  }

  // ───────────── what the hardware should send ─────────────

  KeyReport keyboard() const {
    KeyReport r = {0, {0, 0, 0, 0, 0, 0}};
    if (test_) return r;
    int n = 0;
    for (int i = 0; i < INPUT_COUNT; i++) {
      if (!out(i) || (profile_.mouseStick && i <= RIGHT)) continue;
      const Binding& b = profile_.map[i];
      if (b.kind != KEY) continue;
      if (b.code >= 0xE0 && b.code <= 0xE7) {
        r.mods |= static_cast<uint8_t>(1u << (b.code - 0xE0));
        continue;
      }
      bool dup = false;
      for (int k = 0; k < n; k++) dup = dup || r.keys[k] == b.code;
      if (!dup && n < 6) r.keys[n++] = b.code;
    }
    return r;
  }

  uint8_t mouseButtons() const {
    if (test_) return 0;
    uint8_t m = 0;
    for (int i = 0; i < INPUT_COUNT; i++) {
      if (out(i) && profile_.map[i].kind == MOUSE && !(profile_.mouseStick && i <= RIGHT)) m |= profile_.map[i].code;
    }
    return m;
  }

  /** The stick as a mouse: how far to move in this report (call every few ms). */
  void mouseMotion(uint32_t now, int8_t& dx, int8_t& dy) {
    dx = dy = 0;
    if (!profile_.mouseStick || test_) {
      stickSince_ = 0;
      return;
    }
    int x = (out(RIGHT) ? 1 : 0) - (out(LEFT) ? 1 : 0);
    int y = (out(DOWN) ? 1 : 0) - (out(UP) ? 1 : 0);
    if (!x && !y) {
      stickSince_ = 0;
      accX_ = accY_ = 0;
      return;
    }
    if (!stickSince_) stickSince_ = now ? now : 1;
    uint32_t held = now - stickSince_;
    float t = held >= s_.mouseRampMs ? 1.0f : static_cast<float>(held) / s_.mouseRampMs;
    float v = s_.mouseMin + (s_.mouseMax - s_.mouseMin) * t * t;
    if (x && y) v *= 0.7071f;
    accX_ += x * v;
    accY_ += y * v;
    int ix = static_cast<int>(accX_), iy = static_cast<int>(accY_);
    if (held == 0) { // a tap moves at least a pixel
      if (x && !ix) ix = x;
      if (y && !iy) iy = y;
    }
    accX_ -= ix;
    accY_ -= iy;
    dx = static_cast<int8_t>(ix);
    dy = static_cast<int8_t>(iy);
  }

  bool padEnabled() const { return profile_.pad && !test_; }

  PadReport pad() const {
    PadReport p = {0, 0, 0, 0, 0, 0};
    if (!padEnabled()) return p;
    p.x = out(RIGHT) ? 127 : out(LEFT) ? -127 : 0;
    p.y = out(DOWN) ? 127 : out(UP) ? -127 : 0;
    p.z = static_cast<int8_t>(pos_ * 127L / 1000);
    p.rx = clamp8(dA_ / 8);
    p.ry = clamp8(dF_ / 8);
    for (int i = 0; i < INPUT_COUNT; i++) if (out(i)) p.buttons |= 1ul << i;
    return p;
  }

  /** Volume clicks to send as consumer reports (+ up, - down). */
  int takeVolume() {
    int v = volume_;
    volume_ = 0;
    return v;
  }
  int takeMutes() {
    int m = mutes_;
    mutes_ = 0;
    return m;
  }

  /** The marquee's effect right now: a one-shot (record, coin) while it lasts, else the steady one. */
  Fx fx(uint32_t now) const { return oneShotUntil_ && now < oneShotUntil_ ? oneShot_ : steady_; }

  /** True once after CAL PLUNGER SAVE: store rest and max. */
  bool takeCalibration(uint16_t& rest, uint16_t& max) {
    if (!calSave_) return false;
    calSave_ = false;
    rest = calRest_;
    max = calMax_;
    return true;
  }

  const Profile& profile() const { return profile_; }
  bool testing() const { return test_; }
  uint16_t plunger() const { return pos_; }
  bool active(Input i) const { return active_[i]; }

 private:
  Emit emit_;
  const char* board_;
  Settings s_;
  Profile profile_;
  bool phys_[INPUT_COUNT] = {};
  bool active_[INPUT_COUNT] = {}; // what is pressed (the test bench shows this)
  bool masked_[INPUT_COUNT] = {}; // held through a profile change: ignored until let go
  bool told_[INPUT_COUNT] = {};   // test mode: what the bench was last told
  bool plungerOut_ = false;
  bool pulled_ = false;
  uint16_t peak_ = 0, pos_ = 0, raw_ = 0;
  uint32_t propUntil_ = 0;
  uint16_t calRest_ = 0, calMax_ = 4095, calFar_ = 0, prevRest_ = 0, prevMax_ = 0;
  bool calibrating_ = false, calSave_ = false;
  bool accelSeen_ = false;
  long baseA_ = 0, baseF_ = 0;
  int16_t dA_ = 0, dF_ = 0;
  uint32_t nudgeUntil_[3] = {0, 0, 0}, quietUntil_ = 0;
  int volume_ = 0, mutes_ = 0;
  uint32_t knobPulse_ = 0;
  uint32_t comboSince_ = 0;
  bool comboHome_ = false, homeSaid_ = false;
  bool host_ = false;
  uint32_t hostLostAt_ = 0;
  bool test_ = false;
  uint32_t lastPlg_ = 0, lastNud_ = 0, lastAct_ = 0;
  uint16_t plgSaid_ = 0xFFFF;
  uint32_t stickSince_ = 0;
  float accX_ = 0, accY_ = 0;
  Fx steady_, oneShot_ = {FX_OFF, 0, 0};
  uint32_t oneShotUntil_ = 0;
  uint16_t fxSeq_ = 1;

  static int dist(int a, int b) { return a > b ? a - b : b - a; }
  static int8_t clamp8(long v) { return static_cast<int8_t>(v > 127 ? 127 : v < -127 ? -127 : v); }

  [[gnu::format(printf, 2, 3)]] void say(const char* fmt, ...) {
    char buf[200];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (emit_) emit_(buf);
  }

  bool out(int i) const {
    if (masked_[i]) return false;
    return i == PLUNGER ? plungerOut_ : active_[i];
  }

  void apply(const Profile& p, uint32_t now) {
    profile_ = p;
    // Whatever is held right now keeps quiet until it's let go, so a held
    // button doesn't suddenly press the new game's key.
    for (int i = 0; i < INPUT_COUNT; i++) masked_[i] = i == PLUNGER ? (pulled_ || plungerOut_) : active_[i];
    propUntil_ = 0;
    stickSince_ = 0;
    compute(now);
  }

  void compute(uint32_t now) {
    bool before[INPUT_COUNT];
    memcpy(before, active_, sizeof before);

    // Holding Start and Coin together stands in for the menu button.
    if (phys_[START] && phys_[COIN]) {
      if (!comboSince_) comboSince_ = now ? now : 1;
      if (!comboHome_ && now - comboSince_ >= s_.comboMs) {
        comboHome_ = true;
        masked_[START] = masked_[COIN] = true;
      }
    } else {
      comboSince_ = 0;
      comboHome_ = false;
    }

    // The plunger: pulled past the threshold, with hysteresis; "prop" replays the pull on release.
    bool pulled = pulled_ ? pos_ > s_.plungerRelease : pos_ > s_.plungerPull;
    if (pulled && !pulled_) peak_ = 0;
    if (pulled && pos_ > peak_) peak_ = pos_;
    if (!pulled && pulled_ && profile_.map[PLUNGER].mode == PROP) propUntil_ = now + static_cast<uint32_t>(peak_) * s_.propFullMs / 1000;
    pulled_ = pulled;
    plungerOut_ = profile_.map[PLUNGER].mode == PROP ? propUntil_ && now < propUntil_ : pulled_;
    if (propUntil_ && now >= propUntil_) propUntil_ = 0;

    for (int i = 0; i < INPUT_COUNT; i++) active_[i] = phys_[i];
    active_[HOME] = phys_[HOME] || comboHome_;
    active_[PLUNGER] = pulled_;
    for (int k = 0; k < 3; k++) active_[NUDGE_UP + k] = nudgeUntil_[k] && now < nudgeUntil_[k];
    active_[KNOB] = phys_[KNOB] || (knobPulse_ && now < knobPulse_);

    for (int i = 0; i < INPUT_COUNT; i++) {
      bool live = i == PLUNGER ? (pulled_ || plungerOut_) : active_[i];
      if (masked_[i] && !live) masked_[i] = false;
    }

    if (active_[HOME] != homeSaid_) {
      homeSaid_ = active_[HOME];
      say("BTN HOME %d", homeSaid_ ? 1 : 0);
    }
    bool changed = memcmp(before, active_, sizeof before) != 0;
    if (changed && (!lastAct_ || now - lastAct_ >= s_.actEveryMs)) {
      lastAct_ = now ? now : 1;
      say("ACT");
    }
  }

  void stream(uint32_t now) {
    for (int i = 0; i < INPUT_COUNT; i++) {
      if (active_[i] != told_[i]) {
        told_[i] = active_[i];
        say("IN %s %d", INPUT_NAMES[i], told_[i] ? 1 : 0);
      }
    }
    if ((plgSaid_ == 0xFFFF || dist(pos_, plgSaid_) >= 4) && (!lastPlg_ || now - lastPlg_ >= 25)) {
      plgSaid_ = pos_;
      lastPlg_ = now ? now : 1;
      say("PLG %u", pos_);
    }
    if (!lastNud_ || now - lastNud_ >= 50) {
      lastNud_ = now ? now : 1;
      say("NUD %d %d", dA_, dF_);
    }
  }

  void setSteady(Fx f) {
    f.seq = ++fxSeq_;
    steady_ = f;
  }

  void fxCommand(const char* args, uint32_t now) {
    char name[12];
    size_t n = strcspn(args, " ");
    if (n == 0 || n >= sizeof name) return say("ERR FX");
    memcpy(name, args, n);
    name[n] = 0;
    int mode = -1;
    for (int i = 0; i < 6; i++) if (strcmp(name, FX_NAMES[i]) == 0) mode = i;
    if (mode < 0) return say("ERR FX %s", name);
    const char* hex = args + n;
    while (*hex == ' ') hex++;
    uint32_t color = 0;
    bool hasColor = strlen(hex) == 6 && strspn(hex, "0123456789abcdefABCDEF") == 6;
    if (hasColor) color = static_cast<uint32_t>(strtoul(hex, nullptr, 16));
    if (mode == FX_RECORD || mode == FX_COIN) {
      oneShot_ = Fx{static_cast<uint8_t>(mode), hasColor ? color : (mode == FX_RECORD ? 0xFFD23Fu : 0xFFFFFFu), ++fxSeq_};
      oneShotUntil_ = (now ? now : 1) + (mode == FX_RECORD ? 4000 : 700);
    } else {
      setSteady(Fx{static_cast<uint8_t>(mode), hasColor ? color : 0xFF8A24u, 0});
    }
  }

  void calCommand(const char* step) {
    if (strcmp(step, "REST") == 0) {
      prevRest_ = calRest_;
      prevMax_ = calMax_;
      calRest_ = raw_;
      calFar_ = raw_;
      calibrating_ = true;
      say("OK CAL REST %u", calRest_);
    } else if (strcmp(step, "MAX") == 0) {
      if (!calibrating_) return say("ERR CAL send REST first");
      uint16_t far = dist(raw_, calRest_) > dist(calFar_, calRest_) ? raw_ : calFar_;
      if (dist(far, calRest_) < 200) {
        calibrating_ = false;
        calRest_ = prevRest_;
        calMax_ = prevMax_;
        return say("ERR CAL the plunger barely moved");
      }
      calMax_ = far;
      say("OK CAL MAX %u", calMax_);
    } else if (strcmp(step, "SAVE") == 0) {
      if (!calibrating_) return say("ERR CAL nothing to save");
      calibrating_ = false;
      calSave_ = true;
      say("OK CAL SAVE %u %u", calRest_, calMax_);
    } else {
      say("ERR CAL %s", step);
    }
  }
};

} // namespace arcade
