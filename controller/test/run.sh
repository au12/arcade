#!/bin/sh
# Tests the controller firmware on this computer: the logic (core.h, fx.h)
# against the profile lines the arcade really sends, then the whole sketch
# against stand-in hardware. Needs a C++17 compiler and Node.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
fw="$here/../firmware/au12-arcade-controller"
CXX=${CXX:-g++}
flags="-std=c++17 -Wall -Wextra -Werror -Wno-unused-parameter"

node "$here/profiles.mjs" > "$out/profiles.txt"
$CXX $flags -I"$fw" -include "$fw/config.h" "$here/core_test.cpp" -o "$out/core_test"
"$out/core_test" "$out/profiles.txt"

$CXX $flags -Wno-unused-function -I"$here/stubs" -I"$fw" -x c++ "$here/sketch_test.cpp" -o "$out/sketch_test"
"$out/sketch_test"
