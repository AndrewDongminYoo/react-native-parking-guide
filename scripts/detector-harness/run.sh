#!/bin/sh
# Builds the macOS harness for ios/ParkingGuideDetector.mm and checks it against fixtures/detector.
# Usage, from the repository root: sh scripts/detector-harness/run.sh
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

clang++ -std=c++17 -fobjc-arc -Wall -Werror -I"$root/ios" \
  "$root/scripts/detector-harness/main.mm" "$root/ios/ParkingGuideDetector.mm" \
  -framework Foundation -framework CoreML -framework CoreGraphics -framework ImageIO \
  -o "$out/harness"

status=0
for layout in nhwc nchw; do
  result=$("$out/harness" "$root/fixtures/detector/solid.png" "$root/fixtures/detector/detector-$layout.mlpackage") || {
    echo "FAIL $layout: $result"
    status=1
    continue
  }
  # Row 0 score is the mean red value, 0.8 within 1e-3; see scripts/make-fixture-models.py.
  if printf '%s' "$result" | /usr/bin/python3 -c '
import json, sys
o = json.load(sys.stdin)
expected = [0.1, 0.2, 0.6, 0.9, 0, 0, 0, 0]
assert len(o["boxes"]) == 8 and all(abs(a - b) < 1e-6 for a, b in zip(o["boxes"], expected)), o
assert abs(o["scores"][0] - 0.8) < 1e-3 and o["scores"][1] == 0, o
assert o["classes"] == [0, 3], o
'; then
    echo "PASS $layout: $result"
  else
    echo "FAIL $layout: $result"
    status=1
  fi
done

# A precompiled .mlmodelc, the form an app bundle ships, loads without compiling and is not deleted by reset.
xcrun coremlcompiler compile "$root/fixtures/detector/detector-nhwc.mlpackage" "$out" > /dev/null
if "$out/harness" "$root/fixtures/detector/solid.png" "$out/detector-nhwc.mlmodelc" | grep -q '"scores":\[0.7999' &&
  test -d "$out/detector-nhwc.mlmodelc"; then
  echo "PASS precompiled .mlmodelc"
else
  echo "FAIL precompiled .mlmodelc"
  status=1
fi

# A model that does not follow the contract (a TFLite file) must fail with E_MODEL_LOAD, not crash.
if "$out/harness" "$root/fixtures/detector/solid.png" "$root/fixtures/detector/detector-nhwc.tflite" | grep -q E_MODEL_LOAD; then
  echo "PASS unsupported model file"
else
  echo "FAIL unsupported model file"
  status=1
fi
exit $status
