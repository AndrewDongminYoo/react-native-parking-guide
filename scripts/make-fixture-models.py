# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["coremltools==9.0", "tensorflow==2.21.0"]
# ///
"""Generate the synthetic detector fixtures in fixtures/detector/.

Run from the repository root: `uv run scripts/make-fixture-models.py`.

Every model follows the README "Detector model contract" input and output names and returns two rows:
- row 0: box [0.1, 0.2, 0.6, 0.9], class 0 (kickboard), score = mean of input channel 0 (red);
- row 1: a zero padding row, box [0, 0, 0, 0], class 3, score 0.

`solid.png` is a 640 x 480 image with RGB (204, 102, 51), so a correct pipeline (stretch to 512 x 512, pixel values
in [0, 1], the model's layout) returns a row-0 score of 0.8 within 1e-3 (float32 summation error). Reading NHWC data as NCHW gives about 0.467 instead.
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
    for layout in SHAPES:
        make_tflite(layout)
        make_coreml(layout)
        self_check(layout)
    print(f"wrote fixtures to {OUT}")


if __name__ == "__main__":
    main()
