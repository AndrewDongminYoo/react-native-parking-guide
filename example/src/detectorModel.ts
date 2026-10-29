/**
 * The detector model, or undefined to check image quality only. Either an absolute path, a `file:///` or (Android)
 * `content://` URI, or a file name in the app's files directory: `Documents` on iOS, `Context.getFilesDir()` on
 * Android. The package bundles no model. For a device smoke test with the demo fixture, follow the README section
 * "Live detector guidance".
 */
export const DETECTOR_MODEL: string | undefined = undefined;

/**
 * The `runDetector` model URI for `model`: unchanged when it is an absolute path or contains `://`, otherwise
 * `filesDirectory` joined with `model`. `filesDirectory` is the `filesDirectory` initial property that the native app
 * passes; without it a file name stays as it is, so the detector reports a model error instead of no model.
 */
export function detectorModelUri(
  model: string | undefined,
  filesDirectory: string | undefined,
): string | undefined {
  if (
    model === undefined ||
    model.startsWith('/') ||
    model.includes('://') ||
    filesDirectory === undefined
  ) {
    return model;
  }
  return `${filesDirectory.replace(/\/+$/, '')}/${model}`;
}
