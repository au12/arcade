// Runs the controller's logic (core.h, fx.h) on a PC.
//   controller/test/run.sh

#include <cassert>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "core.h"
#include "fx.h"

using namespace arcade;

static std::vector<std::string> said;
static void emit(const char* line) { said.push_back(line); }

static int failures = 0;
#define CHECK(cond)                                                       \
  do {                                                                    \
    if (!(cond)) {                                                        \
      std::fprintf(stderr, "  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); \
      failures++;                                                         \
    }                                                                     \
  } while (0)

static bool saidLine(const std::string& s) {
  for (auto& l : said) if (l == s) return true;
  return false;
}
static int countPrefix(const std::string& p) {
  int n = 0;
  for (auto& l : said) if (l.rfind(p, 0) == 0) n++;
  return n;
}
static bool hasKey(const KeyReport& r, uint8_t k) {
  for (uint8_t x : r.keys) if (x == k) return true;
  return false;
}
static void test(const char* name) { std::printf("• %s\n", name); said.clear(); }

int main(int argc, char** argv) {
  // ── hello and the universal profile ──
  {
    test("hello, and the universal profile before the arcade speaks");
    Controller c(emit, "pico");
    c.begin(100, 3900);
    c.command("HELLO", 0);
    CHECK(saidLine("HELLO au12-arcade-controller " FW_VERSION " pico"));
    CHECK(strcmp(c.profile().name, "universal") == 0);
    c.setInput(B1, true, 10);
    CHECK(hasKey(c.keyboard(), usage::ENTER));
    c.setInput(LFLIP, true, 11);
    CHECK(c.keyboard().mods == 0x02); // left shift
    c.setInput(RFLIP, true, 12);
    CHECK(c.keyboard().mods == 0x22); // and right shift
    c.setInput(HOME, true, 13);
    CHECK(hasKey(c.keyboard(), usage::F9));
    CHECK(saidLine("BTN HOME 1"));
    CHECK(countPrefix("ACT") == 1); // activity, at most every two seconds
  }

  // ── every profile the arcade sends parses ──
  if (argc > 1) {
    test("every profile the arcade builds (from hid.js and the catalog)");
    std::ifstream in(argv[1]);
    std::map<std::string, Profile> parsed;
    std::string row;
    while (std::getline(in, row)) {
      auto tab = row.find('\t');
      if (tab == std::string::npos) continue;
      Profile p;
      bool ok = parseProfile(row.substr(tab + 1).c_str(), p);
      CHECK(ok);
      parsed[row.substr(0, tab)] = p;
    }
    CHECK(parsed.size() >= 9);
    const Profile& nav = parsed["arcade"];
    CHECK(!nav.mouseStick);
    CHECK(nav.map[UP].kind == KEY && nav.map[UP].code == 0x52);
    CHECK(nav.map[B1].code == 0x28 && nav.map[B2].code == 0x29);
    CHECK(nav.map[COIN].code == 0x41);  // F8
    CHECK(nav.map[LFLIP].code == 0x2F); // [
    CHECK(nav.map[HOME].kind == NONE);  // the arcade hears HOME over serial
    const Profile& totem = parsed["totem"];
    CHECK(totem.map[LFLIP].code == 0xE1 && totem.map[RFLIP].code == 0xE5);
    CHECK(totem.map[PLUNGER].kind == KEY && totem.map[PLUNGER].code == 0x2C && totem.map[PLUNGER].mode == FOLLOW);
    CHECK(totem.map[NUDGE_R].code == 0x37);
    CHECK(totem.map[COIN].code == 0x1E); // Digit1
    const Profile& swipe = parsed["swipe"];
    CHECK(swipe.mouseStick);
    CHECK(swipe.map[B1].kind == MOUSE && swipe.map[B1].code == 1);
    CHECK(swipe.map[B2].kind == MOUSE && swipe.map[B2].code == 2);
    const Profile& nanosaur = parsed["nanosaur"];
    CHECK(nanosaur.map[B2].code == 0xE2); // AltLeft
    CHECK(nanosaur.map[COIN].code == 0x2B); // Tab
  }

  // ── profile changes don't press keys under held buttons ──
  {
    test("a button held through a profile change stays quiet until let go");
    Controller c(emit);
    c.setInput(B1, true, 0);
    CHECK(hasKey(c.keyboard(), usage::ENTER));
    c.command("PROFILE game STICK=KEYS B1=k2c B2=x", 5);
    CHECK(saidLine("OK PROFILE game"));
    CHECK(c.keyboard().empty());
    c.setInput(B1, false, 10);
    c.setInput(B1, true, 20);
    CHECK(hasKey(c.keyboard(), usage::SPACE));
    // the same key from two buttons is one key
    c.command("PROFILE dup STICK=KEYS B1=k2c B3=k2c", 30);
    c.setInput(B1, false, 31);
    c.setInput(B1, true, 32);
    c.setInput(B3, true, 33);
    KeyReport r = c.keyboard();
    CHECK(r.keys[0] == 0x2C && r.keys[1] == 0);
    CHECK(!parseProfile("NOPE", const_cast<Profile&>(c.profile())));
    c.command("PROFILE", 40);
    CHECK(saidLine("ERR unknown PROFILE"));
  }

  // ── the plunger ──
  {
    test("plunger: pulled past the threshold holds the key, with hysteresis");
    Controller c(emit);
    c.begin(100, 4100); // 4 raw counts per per-mille
    c.command("PROFILE pin STICK=KEYS PLUNGER=k2c:hold", 0);
    c.setPlunger(100, 1);
    CHECK(c.keyboard().empty());
    c.setPlunger(100 + 4 * 130, 2); // 13%
    CHECK(hasKey(c.keyboard(), 0x2C));
    c.setPlunger(100 + 4 * 90, 3); // 9%: still pulled (release at 6%)
    CHECK(hasKey(c.keyboard(), 0x2C));
    c.setPlunger(100 + 4 * 40, 4);
    CHECK(c.keyboard().empty());
    CHECK(c.plunger() == 40);

    test("plunger: prop replays the pull as a hold of matching length");
    c.command("PROFILE pin STICK=KEYS PLUNGER=k2c:prop", 10);
    c.setPlunger(100 + 4 * 500, 100);
    c.setPlunger(100 + 4 * 1000, 200); // full pull
    CHECK(c.keyboard().empty());       // nothing while pulling
    c.setPlunger(100, 300);            // let go
    CHECK(hasKey(c.keyboard(), 0x2C));
    c.tick(300 + 899);
    CHECK(hasKey(c.keyboard(), 0x2C));
    c.tick(300 + 901);
    CHECK(c.keyboard().empty());

    test("plunger: a reversed pot works too");
    Controller r(emit);
    r.begin(3900, 300);
    r.setPlunger(3900 - 1800, 0);
    CHECK(r.plunger() == 500);
  }

  // ── test bench ──
  {
    test("test mode: the bench hears everything, the PC hears nothing");
    Controller c(emit);
    c.begin(0, 1000);
    c.setInput(B2, true, 0);
    c.command("TEST ON", 1);
    CHECK(saidLine("OK TEST ON"));
    c.tick(2);
    CHECK(saidLine("IN B2 1"));
    CHECK(saidLine("PLG 0"));
    CHECK(countPrefix("NUD ") == 1);
    CHECK(c.keyboard().empty());
    CHECK(c.mouseButtons() == 0);
    c.setInput(B2, false, 3);
    c.tick(4);
    CHECK(saidLine("IN B2 0"));
    c.setPlunger(500, 10);
    c.tick(40);
    CHECK(saidLine("PLG 500"));
    CHECK(saidLine("IN PLUNGER 1"));
    // the menu button still reaches the arcade
    c.setInput(HOME, true, 50);
    CHECK(saidLine("BTN HOME 1"));
    c.command("TEST OFF", 60);
    c.setInput(B1, true, 61);
    CHECK(hasKey(c.keyboard(), usage::ENTER));
  }

  // ── calibration ──
  {
    test("calibration: rest, the farthest pull, save");
    Controller c(emit);
    c.begin(0, 4095);
    c.setPlunger(220, 0);
    c.command("CAL PLUNGER REST", 1);
    CHECK(saidLine("OK CAL REST 220"));
    c.setPlunger(2000, 2);
    c.setPlunger(3700, 3); // the farthest
    c.setPlunger(240, 4);  // let go before pressing Save
    c.command("CAL PLUNGER MAX", 5);
    CHECK(saidLine("OK CAL MAX 3700"));
    c.command("CAL PLUNGER SAVE", 6);
    uint16_t rest = 0, max = 0;
    CHECK(c.takeCalibration(rest, max) && rest == 220 && max == 3700);
    CHECK(!c.takeCalibration(rest, max));

    test("calibration: a plunger that didn't move keeps the old values");
    c.command("CAL PLUNGER REST", 10);
    c.setPlunger(260, 11);
    c.command("CAL PLUNGER MAX", 12);
    CHECK(saidLine("ERR CAL the plunger barely moved"));
    c.command("CAL PLUNGER SAVE", 13);
    CHECK(saidLine("ERR CAL nothing to save"));
    c.setPlunger(220 + 1740, 14);
    CHECK(c.plunger() == 500);
  }

  // ── nudges ──
  {
    test("nudge: a bump taps its key once");
    Controller c(emit);
    c.command("PROFILE pin STICK=KEYS NUDGE_L=k1b NUDGE_R=k37 NUDGE_UP=k17", 0);
    for (uint32_t t = 0; t < 1000; t += 5) c.setAccel(0, 0, t);
    c.setAccel(600, 0, 1000); // pushed from the left
    CHECK(hasKey(c.keyboard(), 0x1B));
    c.setAccel(-500, 0, 1010); // the wobble back is ignored
    CHECK(!hasKey(c.keyboard(), 0x37));
    c.tick(1081);
    CHECK(c.keyboard().empty());
    c.setAccel(0, 0, 1400);
    c.setAccel(0, 700, 1500); // forward
    CHECK(hasKey(c.keyboard(), 0x17));
    // a steady tilt is not a nudge
    Controller tilt(emit);
    tilt.command("PROFILE pin STICK=KEYS NUDGE_L=k1b", 0);
    for (uint32_t t = 0; t < 4000; t += 5) tilt.setAccel(static_cast<int16_t>(t / 20), 0, t); // creeping to 200 mg
    CHECK(tilt.keyboard().empty());
  }

  // ── the menu combo ──
  {
    test("holding Start and Coin is the menu button");
    Controller c(emit);
    c.command("PROFILE g STICK=KEYS START=k28 COIN=k1e", 0);
    c.setInput(START, true, 100);
    c.setInput(COIN, true, 100);
    CHECK(saidLine("BTN START 1") && saidLine("BTN COIN 1"));
    c.tick(1599);
    CHECK(!saidLine("BTN HOME 1"));
    c.tick(1600);
    CHECK(saidLine("BTN HOME 1"));
    CHECK(c.keyboard().empty()); // Start and Coin let go of their keys
    c.setInput(COIN, false, 1700);
    CHECK(saidLine("BTN HOME 0"));
  }

  // ── the arcade going away ──
  {
    test("the arcade closing the port: back to universal after a while");
    Controller c(emit);
    c.setHost(true, 0);
    c.command("PROFILE game STICK=MOUSE B1=m1", 1);
    c.command("TEST ON", 2);
    c.setHost(false, 100);
    c.tick(3000);
    CHECK(strcmp(c.profile().name, "game") == 0);
    c.tick(3100);
    CHECK(strcmp(c.profile().name, "universal") == 0);
    CHECK(!c.testing());
  }

  // ── the stick as a mouse ──
  {
    test("stick as mouse: a tap nudges a pixel, holding speeds up");
    Controller c(emit);
    c.command("PROFILE p STICK=MOUSE UP=k52 B1=m1", 0);
    c.setInput(RIGHT, true, 100);
    int8_t dx, dy;
    c.mouseMotion(100, dx, dy);
    CHECK(dx == 1 && dy == 0);
    CHECK(c.keyboard().empty()); // the stick types nothing in mouse mode
    int total = 0;
    for (uint32_t t = 108; t <= 1100; t += 8) {
      c.mouseMotion(t, dx, dy);
      total += dx;
    }
    c.mouseMotion(1108, dx, dy);
    CHECK(dx == 14);
    CHECK(total > 600 && total < 1400);
    c.setInput(B1, true, 1110);
    CHECK(c.mouseButtons() == 1);
    c.setInput(UP, true, 1120);
    c.mouseMotion(1128, dx, dy);
    CHECK(dy < 0 && dx > 0);
  }

  // ── volume ──
  {
    test("volume knob and mute");
    Controller c(emit);
    c.turnKnob(2, 0);
    c.turnKnob(-1, 1);
    CHECK(c.takeVolume() == 1);
    CHECK(c.takeVolume() == 0);
    c.setInput(KNOB, true, 2);
    CHECK(c.takeMutes() == 1);
  }

  // ── the marquee ──
  {
    test("marquee: record and coin play, then the steady effect comes back");
    Controller c(emit);
    CHECK(c.fx(0).mode == FX_IDLE && c.fx(0).color == 0xFF8A24);
    c.command("FX game 2c56c8", 10);
    Fx game = c.fx(10);
    CHECK(game.mode == FX_GAME && game.color == 0x2C56C8);
    c.command("FX record", 20);
    CHECK(c.fx(21).mode == FX_RECORD && c.fx(21).color == 0xFFD23F);
    CHECK(c.fx(4019).mode == FX_RECORD);
    CHECK(c.fx(4021).mode == FX_GAME && c.fx(4021).seq == game.seq);
    c.command("FX sparkly", 30);
    CHECK(saidLine("ERR FX sparkly"));
    // every effect draws something sensible on every LED
    for (uint8_t m = FX_ATTRACT; m <= FX_OFF; m++) {
      Fx fx = {m, 0xFF8A24, 1};
      for (uint32_t t = 0; t < 5000; t += 37) {
        for (uint16_t i = 0; i < 36; i++) {
          Rgb px = fxPixel(fx, t, i, 36);
          if (m == FX_OFF) CHECK(px.r == 0 && px.g == 0 && px.b == 0);
        }
      }
    }
    Rgb idlePeak = fxPixel(Fx{FX_IDLE, 0xFF8A24, 1}, 2100, 0, 36);
    CHECK(idlePeak.r > 200 && idlePeak.b < 20);
  }

  // ── the gamepad ──
  {
    test("gamepad: off unless a profile asks for it");
    Controller c(emit);
    c.setInput(B1, true, 0);
    CHECK(!c.padEnabled() && c.pad().buttons == 0);
    c.command("PROFILE pad STICK=KEYS PAD=ON B1=x", 1);
    c.setInput(B1, false, 2);
    c.setInput(B1, true, 3);
    c.setInput(LEFT, true, 4);
    PadReport p = c.pad();
    CHECK(p.buttons == (1u << B1 | 1u << LEFT) && p.x == -127);
  }

  // ── odds and ends ──
  {
    test("status, reset and unknown commands");
    Controller c(emit);
    c.command("STATUS", 0);
    CHECK(countPrefix("STATUS universal stick=keys") == 1);
    c.command("PROFILE x STICK=MOUSE", 1);
    c.command("RESET", 2);
    CHECK(saidLine("OK RESET") && !c.profile().mouseStick);
    c.command("FROB", 3);
    CHECK(saidLine("ERR unknown FROB"));
    c.command("", 4);
    Binding b;
    CHECK(!parseBinding("k0", 2, b));
    CHECK(!parseBinding("m9", 2, b));
    CHECK(!parseBinding("k2c:wobble", 10, b));
    CHECK(parseBinding("x", 1, b) && b.kind == NONE);
  }

  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("all good\n");
  return 0;
}
