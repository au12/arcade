// Compiles the real sketch against stand-in hardware (stubs/) and runs its
// loop: buttons on pins, serial lines in, HID reports and lights out.
//   controller/test/run.sh

#include <cstdio>
#include <string>
#include <vector>

#include "Adafruit_NeoPixel.h"
#include "Adafruit_TinyUSB.h"
#include "Arduino.h"
#include "EEPROM.h"
#include "Wire.h"

namespace fake {
uint32_t now = 0;
int pins[32];
int adc[32];
std::string serialIn, serialOut;
bool serialOpen = false;
std::vector<SentReport> reports;
int16_t accel[3] = {0, 0, 0};
} // namespace fake

FakeSerial Serial;
Adafruit_USBD_Device_Fake TinyUSBDevice;
TwoWire Wire;
EEPROMClass EEPROM;

#include "../firmware/au12-arcade-controller/au12-arcade-controller.ino"

static int failures = 0;
#define CHECK(cond)                                                          \
  do {                                                                       \
    if (!(cond)) {                                                           \
      std::fprintf(stderr, "  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); \
      failures++;                                                            \
    }                                                                        \
  } while (0)

static void run(uint32_t ms) {
  for (uint32_t i = 0; i < ms; i++) {
    fake::now++;
    loop();
    loop(); // a spare pass: one report goes out per pass
    loop1();
  }
}

static const SentReport* lastReport(uint8_t id) {
  for (auto it = fake::reports.rbegin(); it != fake::reports.rend(); ++it) if (it->id == id) return &*it;
  return nullptr;
}

int main() {
  for (int& p : fake::pins) p = 1; // pull-ups: nothing pressed
  fake::adc[PIN_PLUNGER] = 300;
  fake::accel[2] = 8197; // 1 g down, at 0.122 mg a count
  setup();
  setup1();
  run(50);

  std::puts("• the arcade connects and says hello");
  fake::serialOpen = true;
  fake::serialIn = "HELLO\n";
  run(5);
  CHECK(fake::serialOut.find("HELLO au12-arcade-controller 1.0.0 pico\r\n") != std::string::npos);

  std::puts("• universal profile: B1 is Enter, through debouncing");
  fake::pins[PIN_B1] = 0;
  run(2);
  const SentReport* k = lastReport(RID_KEYBOARD);
  CHECK(!k || k->bytes[2] != 0x28); // not yet: still bouncing
  run(10);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[2] == 0x28);
  fake::pins[PIN_B1] = 1;
  run(10);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[2] == 0);

  std::puts("• a game's profile: flippers and the plunger");
  fake::serialIn = "PROFILE totem STICK=KEYS LFLIP=ke1 RFLIP=ke5 PLUNGER=k2c:hold\n";
  run(5);
  CHECK(fake::serialOut.find("OK PROFILE totem") != std::string::npos);
  fake::pins[PIN_LFLIP] = 0;
  run(10);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[0] == 0x02);
  fake::pins[PIN_LFLIP] = 1;
  fake::adc[PIN_PLUNGER] = 3800; // pulled (uncalibrated: rest 300, travel to 4095)
  run(30);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[0] == 0 && k->bytes[2] == 0x2C);
  fake::adc[PIN_PLUNGER] = 300;
  run(30);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[2] == 0);

  std::puts("• the menu button goes to the arcade over serial");
  fake::serialOut.clear();
  fake::pins[PIN_HOME] = 0;
  run(10);
  CHECK(fake::serialOut.find("BTN HOME 1") != std::string::npos);
  fake::pins[PIN_HOME] = 1;
  run(10);

  std::puts("• a nudge from the accelerometer");
  fake::serialIn = "PROFILE pin STICK=KEYS NUDGE_L=k1b\n";
  run(1500); // let the baseline settle
  fake::accel[NUDGE_AXIS_ACROSS] = 5000; // about 0.6 g
  run(6);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[2] == 0x1B);
  fake::accel[NUDGE_AXIS_ACROSS] = 0;
  run(200);
  k = lastReport(RID_KEYBOARD);
  CHECK(k && k->bytes[2] == 0);

  std::puts("• calibrating the plunger is saved");
  fake::serialIn = "CAL PLUNGER REST\n";
  run(5);
  fake::adc[PIN_PLUNGER] = 3000;
  run(30);
  fake::adc[PIN_PLUNGER] = 310;
  run(30);
  fake::serialIn = "CAL PLUNGER MAX\nCAL PLUNGER SAVE\n";
  run(5);
  CHECK(EEPROM.commits() == 1);
  Calibration cal;
  EEPROM.get(0, cal);
  CHECK(cal.magic == CAL_MAGIC && cal.rest == 300 && cal.max > 2900);

  std::puts("• the marquee draws the game's color");
  fake::serialIn = "FX game 2c56c8\n";
  run(40);
  uint32_t px = strip.getPixelColor(0);
  CHECK(px != 0 && (px & 0xFF) > ((px >> 16) & 0xFF)); // blue more than red
  CHECK(strip.shows() > 10);

  std::puts("• the volume knob");
  knobSteps = 4;
  run(5);
  bool up = false;
  for (auto& r : fake::reports) if (r.id == RID_CONSUMER && r.bytes[0] == 0xE9) up = true;
  CHECK(up);

  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::puts("all good");
  return 0;
}
