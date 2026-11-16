// A stand-in for the Pico core's Wire, with a fake LSM6DSOX at 0x6A.
#pragma once
#include "Arduino.h"

namespace fake {
extern int16_t accel[3]; // raw counts
}

class TwoWire {
 public:
  bool setSDA(pin_size_t) { return true; }
  bool setSCL(pin_size_t) { return true; }
  void begin() {}
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t address) {
    address_ = address;
    first_ = true;
  }
  size_t write(uint8_t b) {
    if (first_) reg_ = b;
    first_ = false;
    return 1;
  }
  uint8_t endTransmission(bool stop = true) {
    (void)stop;
    return address_ == 0x6A ? 0 : 2;
  }
  size_t requestFrom(uint8_t address, size_t quantity, bool stop = true) {
    (void)stop;
    if (address != 0x6A) return 0;
    left_ = quantity;
    return quantity;
  }
  int read() {
    if (!left_) return -1;
    left_--;
    if (reg_ == 0x0F) return 0x6C;
    int index = reg_ - 0x28;
    reg_++;
    if (index < 0 || index > 5) return 0;
    int16_t v = fake::accel[index / 2];
    return index % 2 ? (v >> 8) & 0xFF : v & 0xFF;
  }

 private:
  uint8_t address_ = 0, reg_ = 0;
  bool first_ = false;
  size_t left_ = 0;
};
extern TwoWire Wire;
