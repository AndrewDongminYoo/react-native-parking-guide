/** The shortest time between two guidance announcements on iOS. */
export const GUIDANCE_ANNOUNCEMENT_INTERVAL_MS = 2000;

/** The guidance line that was last announced, and when. */
export interface GuidanceAnnouncement {
  readonly line: string;
  /** Milliseconds, from the same clock as `now` in `decideGuidanceAnnouncement`. */
  readonly at: number;
}

export type GuidanceAnnouncementDecision =
  /** Announce `line` now and record it as the last announcement. */
  | { readonly kind: 'announce' }
  /**
   * `line` changed too soon after the last announcement; announce it after `delayMs` if it is still the current line.
   * The caller announces when the wait ends and does not call `decideGuidanceAnnouncement` again, because a clock that
   * went backwards would return another `wait`.
   */
  | { readonly kind: 'wait'; readonly delayMs: number }
  /** `line` is the last announced line; announce nothing. */
  | { readonly kind: 'skip' };

/**
 * Decides whether the capture screen announces its first guidance line. A line is announced only when it differs from
 * the last announced line, and at most once every `intervalMs`. A change inside the interval waits until the interval
 * ends, so the line that stays on screen is announced even when no new render follows.
 */
export function decideGuidanceAnnouncement(
  last: GuidanceAnnouncement | null,
  line: string,
  now: number,
  intervalMs: number = GUIDANCE_ANNOUNCEMENT_INTERVAL_MS,
): GuidanceAnnouncementDecision {
  if (last === null) {
    return { kind: 'announce' };
  }
  if (last.line === line) {
    return { kind: 'skip' };
  }
  const elapsed = now - last.at;
  if (elapsed >= intervalMs) {
    return { kind: 'announce' };
  }
  // A clock that went backwards waits one full interval, not longer.
  return { kind: 'wait', delayMs: Math.min(intervalMs, intervalMs - elapsed) };
}
