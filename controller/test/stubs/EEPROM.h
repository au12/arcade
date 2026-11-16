// A stand-in for the Pico core's EEPROM (flash-backed, needs commit()).
#pragma once
#include "Arduino.h"

class EEPROMClass {
 public:
  void begin(size_t) {}
  template <typename T>
  T& get(int address, T& t) {
    memcpy(&t, bytes_ + address, sizeof(T));
    return t;
  }
  template <typename T>
  const T& put(int address, const T& t) {
    memcpy(bytes_ + address, &t, sizeof(T));
    return t;
  }
  bool commit() {
    commits_++;
    return true;
  }
  int commits() const { return commits_; }

 private:
  uint8_t bytes_[4096] = {};
  int commits_ = 0;
};
extern EEPROMClass EEPROM;
