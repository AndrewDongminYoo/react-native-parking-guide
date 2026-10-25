import type { ModelBox } from '../inference/mapping';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts a rectangle in the coordinates of a camera preview of size `view` that uses `resizeMode="cover"` to a
 * normalized `ModelBox` in the upright camera frame of size `frame`, accounting for the cropped frame edges. Each
 * coordinate is clamped to `[0, 1]`. Throws `RangeError` for non-finite values or a non-positive size.
 */
export function screenRectToFrameBox(
  rect: ScreenRect,
  view: Size,
  frame: Size
): ModelBox {
  const sizes = [view.width, view.height, frame.width, frame.height];
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (
    !sizes.every((value) => Number.isFinite(value) && value > 0) ||
    !values.every(Number.isFinite)
  ) {
    throw new RangeError(
      'screenRectToFrameBox needs finite values and positive view and frame sizes.'
    );
  }
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  const shownWidth = frame.width * scale;
  const shownHeight = frame.height * scale;
  const offsetX = (shownWidth - view.width) / 2;
  const offsetY = (shownHeight - view.height) / 2;
  return [
    clampUnit((rect.x + offsetX) / shownWidth),
    clampUnit((rect.y + offsetY) / shownHeight),
    clampUnit((rect.x + rect.width + offsetX) / shownWidth),
    clampUnit((rect.y + rect.height + offsetY) / shownHeight),
  ];
}
