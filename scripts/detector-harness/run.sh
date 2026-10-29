#!/bin/sh
# Builds the macOS harness for ios/ParkingGuideDetector.mm and checks it against fixtures/detector.
# Usage, from the repository root: sh scripts/detector-harness/run.sh
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

clang++ -std=c++17 -fobjc-arc -Wall -Werror -I"${root}/ios" \
	"${root}/scripts/detector-harness/main.mm" "${root}/ios/ParkingGuideDetector.mm" \
	-framework Foundation -framework CoreML -framework CoreGraphics -framework ImageIO -framework CoreImage -framework CoreVideo \
	-o "${out}/harness"

status=0
for layout in nhwc nchw; do
	result=$("${out}/harness" "${root}/fixtures/detector/solid.png" "${root}/fixtures/detector/detector-${layout}.mlpackage") || {
		echo "FAIL ${layout}: ${result}"
		status=1
		continue
	}
	# Row 0 score is the mean red value, 0.8 within 1e-3; see scripts/make-fixture-models.py.
	if printf '%s' "${result}" | /usr/bin/python3 -c '
import json, sys
o = json.load(sys.stdin)
expected = [0.1, 0.2, 0.6, 0.9, 0, 0, 0, 0]
assert len(o["boxes"]) == 8 and all(abs(a - b) < 1e-6 for a, b in zip(o["boxes"], expected)), o
assert abs(o["scores"][0] - 0.8) < 1e-3 and o["scores"][1] == 0, o
assert o["classes"] == [0, 3], o
'; then
		echo "PASS ${layout}: ${result}"
	else
		echo "FAIL ${layout}: ${result}"
		status=1
	fi
done

# The camera-frame path: a solid (204, 102, 51) 640 x 480 YUV pixel buffer, oriented with a CGImagePropertyOrientation
# (1 up, 6 right, 5 left-mirrored), must give the same mean-red score as the photo and the upright frame size.
for layout in nhwc nchw; do
	for orientation in 1 6 5; do
		result=$("${out}/harness" --pixel-buffer 204 102 51 "${orientation}" \
			"${root}/fixtures/detector/detector-${layout}.mlpackage") || {
			echo "FAIL pixel buffer ${layout}/${orientation}: ${result}"
			status=1
			continue
		}
		if printf '%s' "${result}" | ORIENTATION=${orientation} /usr/bin/python3 -c '
import json, os, sys
o = json.load(sys.stdin)
size = (640, 480) if os.environ["ORIENTATION"] == "1" else (480, 640)
assert abs(o["scores"][0] - 0.8) < 2e-2 and o["scores"][1] == 0, o
assert (o["frameWidth"], o["frameHeight"]) == size, o
'; then
			echo "PASS pixel buffer ${layout}/${orientation}: scores=$(printf '%s' "${result}" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["scores"])')"
		else
			echo "FAIL pixel buffer ${layout}/${orientation}: ${result}"
			status=1
		fi
	done
done

# VisionCamera's iOS Frame.orientation is the frame's own orientation, the reverse of the upright transform (its
# snapshot code applies Orientation.portrait.relativeTo(frame orientation)), so Left and Right swap.
expected='{"0":1,"1":3,"2":6,"3":8,"4":1,"5":3,"6":6,"7":8,"m0":2,"m1":4,"m2":7,"m3":5}'
table=$("${out}/harness" --orientation-table)
if [ "${table}" = "${expected}" ]; then
	echo "PASS orientation table"
else
	echo "FAIL orientation table: ${table}"
	status=1
fi

# Content check: a buffer whose left half is red and right half blue. Applying orientation 6 (rotate 90 degrees
# clockwise to display) puts the red half on top; 8 (counterclockwise) puts it at the bottom; 1 keeps it on the left.
for case in "1 red blue red" "6 red red blue" "8 blue blue red"; do
	set -- ${case}
	probe=$("${out}/harness" --probe "$1")
	if [ "${probe}" = "$2 $3 $4" ]; then
		echo "PASS probe orientation $1"
	else
		echo "FAIL probe orientation $1: got '${probe}', want '$2 $3 $4' (top-left top-right bottom-left)"
		status=1
	fi
done

# A precompiled .mlmodelc, the form an app bundle ships, loads without compiling and is not deleted by reset.
xcrun coremlcompiler compile "${root}/fixtures/detector/detector-nhwc.mlpackage" "${out}" >/dev/null
if "${out}/harness" "${root}/fixtures/detector/solid.png" "${out}/detector-nhwc.mlmodelc" | grep -q '"scores":\[0.7999' &&
	test -d "${out}/detector-nhwc.mlmodelc"; then
	echo "PASS precompiled .mlmodelc"
else
	echo "FAIL precompiled .mlmodelc"
	status=1
fi

# The output limit: at most 1000 detections, so 4000 box values and 1000 scores or classes. This checks the predicate
# that runWithModelURL applies before copying; no fixture model produces an output that large.
for case in "boxes 4000 within" "boxes 4001 over" "scores 1000 within" "scores 1001 over" "classes 1001 over"; do
	set -- ${case}
	limit=$("${out}/harness" --output-limit "$1" "$2")
	if [ "${limit}" = "$3" ]; then
		echo "PASS output limit $1 $2"
	else
		echo "FAIL output limit $1 $2: got '${limit}', want '$3'"
		status=1
	fi
done

# A photo file above the 64 MiB read limit must fail with E_PHOTO_READ before it is decoded. The sparse file starts
# with the fixture PNG, so only its size differs from a photo that decodes.
cp "${root}/fixtures/detector/solid.png" "${out}/large.png"
truncate -s 67108865 "${out}/large.png"
if "${out}/harness" "${out}/large.png" "${root}/fixtures/detector/detector-nhwc.mlpackage" | grep -q E_PHOTO_READ; then
	echo "PASS photo above the size limit"
else
	echo "FAIL photo above the size limit"
	status=1
fi

# A model that does not follow the contract (a TFLite file) must fail with E_MODEL_LOAD, not crash.
if "${out}/harness" "${root}/fixtures/detector/solid.png" "${root}/fixtures/detector/detector-nhwc.tflite" | grep -q E_MODEL_LOAD; then
	echo "PASS unsupported model file"
else
	echo "FAIL unsupported model file"
	status=1
fi
exit "${status}"
