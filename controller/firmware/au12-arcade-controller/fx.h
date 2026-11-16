// The marquee's light effects, as plain math: the color of LED `i` of `n`
// at `t` milliseconds into an effect. The sketch draws them on core 1.

#pragma once

#include <math.h>
#include <stdint.h>
#include "core.h"

namespace arcade {

struct Rgb {
  uint8_t r, g, b;
};

inline Rgb rgbOf(uint32_t c) { return Rgb{static_cast<uint8_t>(c >> 16), static_cast<uint8_t>(c >> 8), static_cast<uint8_t>(c)}; }

inline Rgb scale(Rgb c, float k) {
  if (k < 0) k = 0;
  if (k > 1) k = 1;
  return Rgb{static_cast<uint8_t>(c.r * k), static_cast<uint8_t>(c.g * k), static_cast<uint8_t>(c.b * k)};
}

inline Rgb mix(Rgb a, Rgb b, float k) {
  if (k < 0) k = 0;
  if (k > 1) k = 1;
  return Rgb{static_cast<uint8_t>(a.r + (b.r - a.r) * k), static_cast<uint8_t>(a.g + (b.g - a.g) * k), static_cast<uint8_t>(a.b + (b.b - a.b) * k)};
}

/** Hue 0-1 at full saturation and value. */
inline Rgb hue(float h) {
  h -= floorf(h);
  float x = h * 6.0f;
  int sector = static_cast<int>(x);
  float f = x - sector;
  uint8_t up = static_cast<uint8_t>(255 * f), down = static_cast<uint8_t>(255 * (1 - f));
  switch (sector % 6) {
    case 0: return Rgb{255, up, 0};
    case 1: return Rgb{down, 255, 0};
    case 2: return Rgb{0, 255, up};
    case 3: return Rgb{0, down, 255};
    case 4: return Rgb{up, 0, 255};
    default: return Rgb{255, 0, down};
  }
}

/** A cheap repeatable hash, for sparkles that don't need a random generator. */
inline uint32_t hash32(uint32_t x) {
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

/** LEDs look linear to the eye after squaring. */
inline Rgb gamma(Rgb c) { return Rgb{static_cast<uint8_t>(c.r * c.r / 255), static_cast<uint8_t>(c.g * c.g / 255), static_cast<uint8_t>(c.b * c.b / 255)}; }

inline Rgb fxPixel(const Fx& fx, uint32_t t, uint16_t i, uint16_t n) {
  const float pi2 = 6.2831853f;
  float u = n > 1 ? static_cast<float>(i) / (n - 1) : 0.0f; // 0 at one end of the marquee, 1 at the other
  Rgb base = rgbOf(fx.color);
  switch (fx.mode) {
    case FX_ATTRACT: {
      // A slow rainbow rolling across, with the odd sparkle.
      Rgb c = scale(hue(u * 0.85f - t / 6000.0f), 0.85f);
      uint32_t slot = t / 90;
      if (hash32(slot * 131 + i) % 97 == 0) c = Rgb{255, 255, 255};
      return gamma(c);
    }
    case FX_IDLE: {
      // Breathing in the arcade's color.
      float k = 0.22f + 0.78f * (0.5f - 0.5f * cosf(pi2 * t / 4200.0f));
      return gamma(scale(base, k));
    }
    case FX_GAME: {
      // The game's color, with a soft shimmer sweeping through every few seconds.
      float band = fmodf(t / 2800.0f, 1.6f) - 0.3f;
      float d = fabsf(u - band);
      float glow = d < 0.18f ? (1.0f - d / 0.18f) : 0.0f;
      return gamma(mix(scale(base, 0.72f), Rgb{255, 255, 255}, glow * 0.45f));
    }
    case FX_RECORD: {
      // A fast marching chase of the record color and white, flashing.
      bool lit = ((i + t / 70) % 4) < 2;
      bool flash = (t / 140) % 2 == 0;
      Rgb c = lit ? base : Rgb{255, 255, 255};
      return gamma(scale(c, flash ? 1.0f : 0.55f));
    }
    case FX_COIN: {
      // A white flash from the middle outwards, fading.
      float k = 1.0f - t / 700.0f;
      float spread = fabsf(u - 0.5f) * 2.0f;
      float front = t / 250.0f;
      float on = spread <= front ? 1.0f : 0.0f;
      return gamma(scale(mix(base, Rgb{255, 255, 255}, 0.6f), k * on));
    }
    default:
      return Rgb{0, 0, 0};
  }
}

} // namespace arcade
