// A stand-in for the parts of Adafruit TinyUSB the sketch uses (same names
// and argument types), recording the reports it would send.
#pragma once
#include "Arduino.h"
#include <vector>

#define HID_REPORT_ID(x) 0x85, x
#define TUD_HID_REPORT_DESC_KEYBOARD(...) 0x05, 0x01, __VA_ARGS__
#define TUD_HID_REPORT_DESC_MOUSE(...) 0x05, 0x01, __VA_ARGS__
#define TUD_HID_REPORT_DESC_CONSUMER(...) 0x05, 0x0C, __VA_ARGS__
#define TUD_HID_REPORT_DESC_GAMEPAD(...) 0x05, 0x01, __VA_ARGS__

typedef struct {
  int8_t x, y, z, rz, rx, ry;
  uint8_t hat;
  uint32_t buttons;
} hid_gamepad_report_t;

struct SentReport {
  uint8_t id;
  std::vector<uint8_t> bytes;
};

namespace fake {
extern std::vector<SentReport> reports;
}

class Adafruit_USBD_Device_Fake {
 public:
  void setManufacturerDescriptor(const char*) {}
  void setProductDescriptor(const char*) {}
  bool mounted() { return true; }
  bool suspended() { return false; }
  bool remoteWakeup() { return true; }
  bool detach() { return true; }
  bool attach() { return true; }
  void task() {}
};
extern Adafruit_USBD_Device_Fake TinyUSBDevice;

class Adafruit_USBD_HID {
 public:
  void setPollInterval(uint8_t) {}
  void setReportDescriptor(uint8_t const* desc, uint16_t len) { (void)desc, (void)len; }
  bool begin() { return true; }
  bool ready() { return true; }
  bool sendReport(uint8_t id, void const* report, uint8_t len) {
    const uint8_t* p = static_cast<const uint8_t*>(report);
    fake::reports.push_back({id, std::vector<uint8_t>(p, p + len)});
    return true;
  }
  bool sendReport16(uint8_t id, uint16_t value) { return sendReport(id, &value, 2); }
  bool keyboardReport(uint8_t id, uint8_t modifier, uint8_t keycode[6]) {
    uint8_t r[8] = {modifier, 0, keycode[0], keycode[1], keycode[2], keycode[3], keycode[4], keycode[5]};
    return sendReport(id, r, 8);
  }
  bool mouseReport(uint8_t id, uint8_t buttons, int8_t x, int8_t y, int8_t vertical, int8_t horizontal) {
    uint8_t r[5] = {buttons, static_cast<uint8_t>(x), static_cast<uint8_t>(y), static_cast<uint8_t>(vertical), static_cast<uint8_t>(horizontal)};
    return sendReport(id, r, 5);
  }
};
