// A stand-in for Adafruit NeoPixel: keeps the colors it was given.
#pragma once
#include "Arduino.h"

#define NEO_GRB 0x52
#define NEO_KHZ800 0x0000

class Adafruit_NeoPixel {
 public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin, uint16_t type) : n_(n) { (void)pin, (void)type; }
  void begin() {}
  void setBrightness(uint8_t b) { brightness_ = b; }
  void clear() { memset(px_, 0, sizeof px_); }
  void show() { shows_++; }
  void setPixelColor(uint16_t i, uint8_t r, uint8_t g, uint8_t b) {
    if (i < n_ && i < 256) px_[i] = static_cast<uint32_t>(r) << 16 | static_cast<uint32_t>(g) << 8 | b;
  }
  uint32_t getPixelColor(uint16_t i) const { return i < 256 ? px_[i] : 0; }
  uint16_t numPixels() const { return n_; }
  int shows() const { return shows_; }

 private:
  uint16_t n_;
  uint8_t brightness_ = 255;
  uint32_t px_[256] = {};
  int shows_ = 0;
};
