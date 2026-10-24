export const GUIDE_FRAME_ASPECT_RATIO = 4 / 3;
export const GUIDE_FRAME_MAX_WIDTH = 420;
export const GUIDE_FRAME_HORIZONTAL_MARGIN = 24;
export const GUIDE_FRAME_VERTICAL_MARGIN = 16;
export const GUIDE_FRAME_HINT_GAP = 12;

export interface LayoutSize {
  width: number;
  height: number;
}

/**
 * Returns the guide frame width that fits, together with the hint below it,
 * inside `area`: at most `area.width - 2 * GUIDE_FRAME_HORIZONTAL_MARGIN`,
 * at most `GUIDE_FRAME_MAX_WIDTH`, and short enough that the 4:3 frame, the
 * hint gap, the hint, and `GUIDE_FRAME_VERTICAL_MARGIN` above and below fit in
 * `area.height`. Returns 0 when no frame fits.
 */
export function fitGuideFrameWidth(
  area: LayoutSize,
  hintHeight: number
): number {
  const byWidth = area.width - 2 * GUIDE_FRAME_HORIZONTAL_MARGIN;
  const byHeight =
    (area.height -
      hintHeight -
      GUIDE_FRAME_HINT_GAP -
      2 * GUIDE_FRAME_VERTICAL_MARGIN) *
    GUIDE_FRAME_ASPECT_RATIO;
  return Math.max(
    0,
    Math.floor(Math.min(byWidth, byHeight, GUIDE_FRAME_MAX_WIDTH))
  );
}
