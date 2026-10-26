# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["coremltools==9.0", "tensorflow==2.21.0"]
# ///
"""Generate the synthetic detector fixtures in fixtures/detector/.

Run from the repository root: `uv run scripts/make-fixture-models.py`.

Every detector-{nhwc,nchw} model follows the README "Detector model contract" input and output names and returns two
rows:
- row 0: box [0.1, 0.2, 0.6, 0.9], class 0 (kickboard), score = mean of input channel 0 (red);
- row 1: a zero padding row, box [0, 0, 0, 0], class 3, score 0.

`solid.png` is a 640 x 480 image with RGB (204, 102, 51), so a correct pipeline (stretch to 512 x 512, pixel values
in [0, 1], the model's layout) returns a row-0 score of 0.8 within 1e-3 (float32 summation error). Reading NHWC data
as NCHW gives about 0.467 instead.

`detector-dynamic.tflite` (NHWC) has a variable detection count: it returns row 1 only when the mean red value is
above 0.5. It returns two rows for `solid.png` and one row for `dark.png`, RGB (51, 102, 204).

`tall.png` is a 512 x 60000 image with the `solid.png` color, so a pipeline that caps the decoded long side at 4096
returns the same row-0 score of 0.8 without decoding the full size. `detector-large.tflite` (NHWC) returns 1001 zero
rows (`boxes` [1001, 4], `scores` and `classes` [1001]), one more than the 1000-detection output limit.

`detector-demo.{tflite,mlpackage}` (NHWC) is a color-gated demo for the example app on a device. It returns four rows
with fixed boxes and a score of either 0.9 or 0:
- row 0: kickboard at [0.375, 0.3125, 0.625, 0.5], 0.9 when the mean of that box region is red: red above 0.45 and
  at least 0.2 above both green and blue;
- row 1: crosswalk at [0, 0, 1, 1], 0.9 when at least 30% of the pixels in the ground region
  [0.25, 0.53125, 0.75, 0.78125] below the row-0 box are green: green at least 0.04 above both red and blue (a dark
  green mouse pad measured about 0.06 on an iPhone);
- row 2: sidewalk_block at [0, 0, 1, 1], 0.9 when at least 30% of the ground region pixels are blue by the same margin;
- row 3: parking_zone at [0, 0, 1, 1], 0.9 when neither row 1 nor row 2 is 0.9.

The models do not contain trained weights.
"""

import struct
import zlib
from pathlib import Path

import coremltools as ct
import numpy as np
import tensorflow as tf
from coremltools.converters.mil import Builder as mb

OUT = Path(__file__).resolve().parent.parent / "fixtures" / "detector"
SIZE = 512
BOXES = np.array([[[0.1, 0.2, 0.6, 0.9], [0.0, 0.0, 0.0, 0.0]]], dtype=np.float32)
CLASSES = np.array([[0.0, 3.0]], dtype=np.float32)
SHAPES = {"nhwc": (1, SIZE, SIZE, 3), "nchw": (1, 3, SIZE, SIZE)}
LARGE_ROWS = 1001
DEMO_BOXES = np.array(
    [[[0.375, 0.3125, 0.625, 0.5], [0.0, 0.0, 1.0, 1.0], [0.0, 0.0, 1.0, 1.0], [0.0, 0.0, 1.0, 1.0]]],
    dtype=np.float32,
)
# kickboard, crosswalk, sidewalk_block, parking_zone (indices into DETECTOR_CLASSES).
DEMO_CLASSES = np.array([[0.0, 4.0, 6.0, 7.0]], dtype=np.float32)
DEMO_SCORE = 0.9
# The row-0 box in 512 x 512 input pixels: rows 160..255, columns 192..319.
DEMO_REGION_BEGIN = [0, 160, 192, 0]
DEMO_REGION_END = [1, 256, 320, 3]
# The ground region below the row-0 box: rows 272..399, columns 128..383.
DEMO_GROUND_BEGIN = [0, 272, 128, 0]
DEMO_GROUND_END = [1, 400, 384, 3]
DEMO_RED_MIN = 0.45
DEMO_RED_MARGIN = 0.2
DEMO_PIXEL_MARGIN = 0.04
DEMO_GROUND_SHARE = 0.3


def write_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    row = b"\x00" + bytes(rgb) * width
    raw = row * height

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    )


def red_channel(image: tf.Tensor, layout: str) -> tf.Tensor:
    return image[..., 0] if layout == "nhwc" else image[:, 0]


def make_tflite(layout: str) -> None:
    class Fixture(tf.Module):
        @tf.function(input_signature=[tf.TensorSpec(SHAPES[layout], tf.float32, name="image")])
        def serve(self, image):
            red = tf.reshape(tf.reduce_mean(red_channel(image, layout)), [1, 1])
            zero = red * 0.0
            return {
                "boxes": tf.constant(BOXES) + zero[:, :, None],
                "scores": tf.concat([red, zero], axis=1),
                "classes": tf.constant(CLASSES) + zero,
            }

    module = Fixture()
    converter = tf.lite.TFLiteConverter.from_concrete_functions([module.serve.get_concrete_function()], module)
    (OUT / f"detector-{layout}.tflite").write_bytes(converter.convert())


def make_dynamic_tflite() -> None:
    class Fixture(tf.Module):
        @tf.function(input_signature=[tf.TensorSpec(SHAPES["nhwc"], tf.float32, name="image")])
        def serve(self, image):
            red = tf.reduce_mean(image[..., 0])
            keep = tf.stack([tf.constant(True), red > 0.5])
            scores = tf.stack([red, red * 0.0])
            return {
                "boxes": tf.boolean_mask(tf.constant(BOXES[0]), keep)[None],
                "scores": tf.boolean_mask(scores, keep)[None],
                "classes": tf.boolean_mask(tf.constant(CLASSES[0]), keep)[None],
            }

    module = Fixture()
    converter = tf.lite.TFLiteConverter.from_concrete_functions([module.serve.get_concrete_function()], module)
    (OUT / "detector-dynamic.tflite").write_bytes(converter.convert())


def check_dynamic() -> None:
    runner = tf.lite.Interpreter(model_path=str(OUT / "detector-dynamic.tflite")).get_signature_runner()
    for red, rows in [(0.8, 2), (0.2, 1), (0.8, 2)]:
        image = np.ascontiguousarray(np.broadcast_to(np.array([red, 0.4, 1 - red], np.float32), SHAPES["nhwc"]))
        result = runner(image=image)
        assert result["boxes"].shape == (1, rows, 4), result["boxes"].shape
        assert result["scores"].shape == (1, rows) and result["classes"].shape == (1, rows), result


def make_large_tflite() -> None:
    class Fixture(tf.Module):
        @tf.function(input_signature=[tf.TensorSpec(SHAPES["nhwc"], tf.float32, name="image")])
        def serve(self, image):
            zero = tf.reduce_mean(image) * 0.0
            return {
                "boxes": tf.zeros([LARGE_ROWS, 4]) + zero,
                "scores": tf.zeros([LARGE_ROWS]) + zero,
                "classes": tf.zeros([LARGE_ROWS]) + zero,
            }

    module = Fixture()
    converter = tf.lite.TFLiteConverter.from_concrete_functions([module.serve.get_concrete_function()], module)
    (OUT / "detector-large.tflite").write_bytes(converter.convert())


def check_large() -> None:
    runner = tf.lite.Interpreter(model_path=str(OUT / "detector-large.tflite")).get_signature_runner()
    result = runner(image=np.zeros(SHAPES["nhwc"], np.float32))
    assert result["boxes"].shape == (LARGE_ROWS, 4), result["boxes"].shape
    assert result["scores"].shape == (LARGE_ROWS,) and result["classes"].shape == (LARGE_ROWS,), result


def make_demo_tflite() -> None:
    def dominance(means, channel):
        others = [means[:, c] for c in range(3) if c != channel]
        return means[:, channel] - tf.maximum(others[0], others[1])

    def share(pixels, channel):
        others = [pixels[..., c] for c in range(3) if c != channel]
        lead = pixels[..., channel] - tf.maximum(others[0], others[1]) > DEMO_PIXEL_MARGIN
        return tf.reduce_mean(tf.cast(lead, tf.float32), axis=[1, 2])

    class Fixture(tf.Module):
        @tf.function(input_signature=[tf.TensorSpec(SHAPES["nhwc"], tf.float32, name="image")])
        def serve(self, image):
            (top, left), (bottom, right) = DEMO_REGION_BEGIN[1:3], DEMO_REGION_END[1:3]
            region = tf.reduce_mean(image[:, top:bottom, left:right, :], axis=[1, 2])
            (top, left), (bottom, right) = DEMO_GROUND_BEGIN[1:3], DEMO_GROUND_END[1:3]
            ground = image[:, top:bottom, left:right, :]
            vehicle = tf.logical_and(region[:, 0] > DEMO_RED_MIN, dominance(region, 0) > DEMO_RED_MARGIN)
            green = share(ground, 1) > DEMO_GROUND_SHARE
            blue = share(ground, 2) > DEMO_GROUND_SHARE
            parking = tf.logical_not(tf.logical_or(green, blue))
            scores = DEMO_SCORE * tf.cast(tf.stack([vehicle, green, blue, parking], axis=1), tf.float32)
            zero = tf.reduce_sum(scores) * 0.0
            return {
                "boxes": tf.constant(DEMO_BOXES) + zero,
                "scores": scores,
                "classes": tf.constant(DEMO_CLASSES) + zero,
            }

    module = Fixture()
    converter = tf.lite.TFLiteConverter.from_concrete_functions([module.serve.get_concrete_function()], module)
    (OUT / "detector-demo.tflite").write_bytes(converter.convert())


def make_demo_coreml() -> None:
    def channel(means, index):
        return mb.slice_by_index(x=means, begin=[0, index], end=[1, index + 1])

    def dominance(means, index):
        others = [channel(means, c) for c in range(3) if c != index]
        return mb.sub(x=channel(means, index), y=mb.maximum(x=others[0], y=others[1]))

    def flag(condition):
        return mb.cast(x=condition, dtype="fp32")

    def share(pixels, index):
        end = [DEMO_GROUND_END[0], DEMO_GROUND_END[1] - DEMO_GROUND_BEGIN[1], DEMO_GROUND_END[2] - DEMO_GROUND_BEGIN[2]]

        def plane(c):
            return mb.slice_by_index(x=pixels, begin=[0, 0, 0, c], end=[*end, c + 1])

        others = [plane(c) for c in range(3) if c != index]
        lead = mb.greater(x=mb.sub(x=plane(index), y=mb.maximum(x=others[0], y=others[1])), y=DEMO_PIXEL_MARGIN)
        return mb.reshape(x=mb.reduce_mean(x=flag(lead), axes=[1, 2, 3], keep_dims=False), shape=[1, 1])

    @mb.program(input_specs=[mb.TensorSpec(shape=SHAPES["nhwc"])], opset_version=ct.target.iOS15)
    def program(image):
        region = mb.slice_by_index(x=image, begin=DEMO_REGION_BEGIN, end=DEMO_REGION_END)
        region = mb.reduce_mean(x=region, axes=[1, 2], keep_dims=False)
        ground = mb.slice_by_index(x=image, begin=DEMO_GROUND_BEGIN, end=DEMO_GROUND_END)
        vehicle = mb.logical_and(
            x=mb.greater(x=channel(region, 0), y=DEMO_RED_MIN),
            y=mb.greater(x=dominance(region, 0), y=DEMO_RED_MARGIN),
        )
        green = mb.greater(x=share(ground, 1), y=DEMO_GROUND_SHARE)
        blue = mb.greater(x=share(ground, 2), y=DEMO_GROUND_SHARE)
        parking = mb.logical_not(x=mb.logical_or(x=green, y=blue))
        flags = mb.concat(values=[flag(vehicle), flag(green), flag(blue), flag(parking)], axis=1)
        scores = mb.mul(x=flags, y=DEMO_SCORE, name="scores")
        zero = mb.mul(x=mb.reduce_sum(x=scores, axes=[0, 1], keep_dims=True), y=0.0)
        boxes = mb.add(x=DEMO_BOXES, y=mb.reshape(x=zero, shape=[1, 1, 1]), name="boxes")
        classes = mb.add(x=DEMO_CLASSES, y=zero, name="classes")
        return boxes, scores, classes

    model = ct.convert(
        program,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS15,
        compute_precision=ct.precision.FLOAT32,
    )
    model.save(str(OUT / "detector-demo.mlpackage"))


def check_demo() -> None:
    """Run both demo models on synthetic scenes with a block in the row-0 box and assert the documented scores."""
    red, gray, green = [0.8, 0.1, 0.1], [0.5, 0.5, 0.5], [0.2, 0.6, 0.2]
    # (background, row-0 box block, ground region or None for the background, expected scores)
    scenes = [
        (gray, red, None, [0.9, 0.0, 0.0, 0.9]),
        (green, red, None, [0.9, 0.9, 0.0, 0.0]),
        ([0.2, 0.2, 0.6], red, None, [0.9, 0.0, 0.9, 0.0]),
        (gray, gray, None, [0.0, 0.0, 0.0, 0.9]),
        (gray, [0.4, 0.1, 0.1], None, [0.0, 0.0, 0.0, 0.9]),
        # A green mat under the vehicle on a neutral scene.
        (gray, red, green, [0.9, 0.9, 0.0, 0.0]),
        # The dark green mouse pad color measured on an iPhone screenshot.
        (gray, red, [0.227, 0.34, 0.279], [0.9, 0.9, 0.0, 0.0]),
        # A slightly green-tinted white desk stays a parking zone.
        (gray, red, [0.8, 0.82, 0.8], [0.9, 0.0, 0.0, 0.9]),
    ]
    runner = tf.lite.Interpreter(model_path=str(OUT / "detector-demo.tflite")).get_signature_runner()
    coreml = ct.models.MLModel(str(OUT / "detector-demo.mlpackage"))
    for background, block, ground, expected in scenes:
        image = np.empty(SHAPES["nhwc"], dtype=np.float32)
        image[...] = background
        if ground is not None:
            image[:, 272:400, 128:384, :] = ground
        image[:, 160:256, 192:320, :] = block
        for name, result in [("tflite", runner(image=image)), ("coreml", coreml.predict({"image": image}))]:
            np.testing.assert_allclose(result["boxes"], DEMO_BOXES, atol=1e-6, err_msg=f"{name} demo boxes")
            np.testing.assert_allclose(result["scores"], [expected], atol=1e-6, err_msg=f"{name} demo {background}")
            np.testing.assert_allclose(result["classes"], DEMO_CLASSES, atol=1e-6, err_msg=f"{name} demo classes")


def make_coreml(layout: str) -> None:
    shape = SHAPES[layout]
    end = [1, SIZE, SIZE, 1] if layout == "nhwc" else [1, 1, SIZE, SIZE]

    @mb.program(input_specs=[mb.TensorSpec(shape=shape)], opset_version=ct.target.iOS15)
    def program(image):
        red = mb.slice_by_index(x=image, begin=[0, 0, 0, 0], end=end)
        mean = mb.reshape(x=mb.reduce_mean(x=red, axes=[1, 2, 3], keep_dims=False), shape=[1, 1])
        zero = mb.mul(x=mean, y=0.0)
        boxes = mb.add(x=BOXES, y=mb.reshape(x=zero, shape=[1, 1, 1]), name="boxes")
        scores = mb.concat(values=[mean, zero], axis=1, name="scores")
        classes = mb.add(x=CLASSES, y=zero, name="classes")
        return boxes, scores, classes

    model = ct.convert(
        program,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS15,
        compute_precision=ct.precision.FLOAT32,
    )
    model.save(str(OUT / f"detector-{layout}.mlpackage"))


def self_check(layout: str) -> None:
    """Run both models on a solid (0.8, 0.4, 0.2) input and assert the documented outputs."""
    pixel = np.array([0.8, 0.4, 0.2], dtype=np.float32)
    image = np.broadcast_to(pixel, (1, SIZE, SIZE, 3))
    if layout == "nchw":
        image = image.transpose(0, 3, 1, 2)
    image = np.ascontiguousarray(image)

    interpreter = tf.lite.Interpreter(model_path=str(OUT / f"detector-{layout}.tflite"))
    runner = interpreter.get_signature_runner()
    results = {"tflite": runner(image=image)}
    results["coreml"] = ct.models.MLModel(str(OUT / f"detector-{layout}.mlpackage")).predict({"image": image})
    for name, result in results.items():
        np.testing.assert_allclose(result["boxes"], BOXES, atol=1e-6, err_msg=f"{name} {layout} boxes")
        np.testing.assert_allclose(result["scores"], [[0.8, 0.0]], atol=1e-3, err_msg=f"{name} {layout} scores")
        np.testing.assert_allclose(result["classes"], CLASSES, atol=1e-6, err_msg=f"{name} {layout} classes")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "solid.png", 640, 480, (204, 102, 51))
    write_png(OUT / "dark.png", 640, 480, (51, 102, 204))
    write_png(OUT / "tall.png", 512, 60000, (204, 102, 51))
    for layout in SHAPES:
        make_tflite(layout)
        make_coreml(layout)
        self_check(layout)
    make_dynamic_tflite()
    check_dynamic()
    make_large_tflite()
    check_large()
    make_demo_tflite()
    make_demo_coreml()
    check_demo()
    print(f"wrote fixtures to {OUT}")


if __name__ == "__main__":
    main()
