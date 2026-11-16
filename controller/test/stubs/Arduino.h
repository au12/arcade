// Just enough of the Arduino API (as the Raspberry Pi Pico core has it) to
// compile the sketch on a PC and run its loop against fake hardware. Not a
// substitute for building with the real core: that happens in CI.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <initializer_list>
#include <string>

typedef uint8_t pin_size_t;
enum PinStatus { LOW = 0, HIGH = 1, CHANGE = 2, FALLING = 3, RISING = 4 };
enum PinMode { INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2 };
typedef void (*voidFuncPtr)(void);

namespace fake {
extern uint32_t now;
extern int pins[32];
extern int adc[32];
extern std::string serialIn, serialOut;
extern bool serialOpen;
} // namespace fake

inline uint32_t millis() { return fake::now; }
inline uint32_t micros() { return fake::now * 1000; }
inline void delay(uint32_t ms) { fake::now += ms; }
inline void pinMode(pin_size_t, PinMode) {}
inline PinStatus digitalRead(pin_size_t p) { return fake::pins[p] ? HIGH : LOW; }
inline int analogRead(pin_size_t p) { return fake::adc[p]; }
inline void analogReadResolution(int) {}
inline pin_size_t digitalPinToInterrupt(pin_size_t p) { return p; }
inline void attachInterrupt(pin_size_t, voidFuncPtr, PinStatus) {}
inline void noInterrupts() {}
inline void interrupts() {}

class FakeSerial {
 public:
  void begin(unsigned long) {}
  explicit operator bool() const { return fake::serialOpen; }
  int available() { return static_cast<int>(fake::serialIn.size()); }
  int read() {
    if (fake::serialIn.empty()) return -1;
    int c = static_cast<unsigned char>(fake::serialIn[0]);
    fake::serialIn.erase(0, 1);
    return c;
  }
  size_t println(const char* s) {
    fake::serialOut += s;
    fake::serialOut += "\r\n";
    return strlen(s) + 2;
  }
};
extern FakeSerial Serial;
