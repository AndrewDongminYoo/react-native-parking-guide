import type { VerificationResult } from './types';

export const DEFAULT_UPLOAD_TIMEOUT_MS = 10000;
export const DEFAULT_UPLOAD_RETRIES = 2;
export const DEFAULT_UPLOAD_RETRY_DELAY_MS = 500;

export interface UploadOptions {
  /** Caller-owned `https://` URL. The package has no default endpoint. */
  readonly endpoint: string;
  /** Sent after the default `Content-Type` and `Accept` headers; a caller header replaces a default case-insensitively. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Per-attempt limit in milliseconds for the request and the response body. Finite and > 0. Default: 10000. */
  readonly timeoutMs?: number;
  /** Additional attempts after the first. Integer >= 0. Default: 2. */
  readonly retries?: number;
  /** Retry n (1-based) waits `retryDelayMs * 2^(n - 1)` milliseconds. Finite and >= 0. Default: 500. */
  readonly retryDelayMs?: number;
}

export type UploadErrorKind =
  'http' | 'network' | 'timeout' | 'invalid_response';

export type UploadResult<T = unknown> =
  | {
      readonly ok: true;
      readonly status: number;
      /** Parsed JSON response body, or `undefined` for an empty body. Not validated against `T`. */
      readonly body: T | undefined;
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly error: UploadErrorKind;
      /** HTTP status, when a response was received. */
      readonly status?: number;
      readonly attempts: number;
    };

interface AttemptOutcome {
  readonly result: UploadResult;
  readonly retryable: boolean;
}

const ENDPOINT_PATTERN = /^https:\/\/([^/?#]*)(?:[/?#]\S*)?$/i;
const AUTHORITY_PATTERN = /^([^:]*)(?::(\d{1,5}))?$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const NUMERIC_LABEL_PATTERN = /^(?:0x[0-9a-f]*|\d+)$/i;
const IPV4_PART_PATTERN = /^(?:0|[1-9]\d{0,2})$/;
const TIMEOUT = Symbol('timeout');

/** Accepts `https://` with a DNS name of letter-digit-hyphen labels or a dotted-decimal IPv4 host and an optional port. */
function isValidEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string') {
    return false;
  }
  const authority = ENDPOINT_PATTERN.exec(endpoint)?.[1];
  const parts =
    authority === undefined ? null : AUTHORITY_PATTERN.exec(authority);
  if (!parts) {
    return false;
  }
  const host = parts[1]!;
  const port = parts[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return false;
  }
  if (host.length === 0 || host.length > 253) {
    return false;
  }
  const labels = host.split('.');
  // URL parsers read a host whose last label is numeric as IPv4, so it must be a valid dotted-decimal address.
  if (NUMERIC_LABEL_PATTERN.test(labels[labels.length - 1]!)) {
    return (
      labels.length === 4 &&
      labels.every(
        (label) => IPV4_PART_PATTERN.test(label) && Number(label) <= 255,
      )
    );
  }
  return labels.every((label) => DNS_LABEL_PATTERN.test(label));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function validateOptions(options: UploadOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new RangeError('Upload options must be an object.');
  }
  const { endpoint, headers, timeoutMs, retries, retryDelayMs } = options;
  if (!isValidEndpoint(endpoint)) {
    throw new RangeError('endpoint must be an https:// URL with a host.');
  }
  if (
    headers !== undefined &&
    (typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers) ||
      Object.values(headers).some((value) => typeof value !== 'string'))
  ) {
    throw new RangeError('headers must be an object of string values.');
  }
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== 'number' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0)
  ) {
    throw new RangeError('timeoutMs must be a finite number > 0.');
  }
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 0)) {
    throw new RangeError('retries must be an integer >= 0.');
  }
  if (
    retryDelayMs !== undefined &&
    (typeof retryDelayMs !== 'number' ||
      !Number.isFinite(retryDelayMs) ||
      retryDelayMs < 0)
  ) {
    throw new RangeError('retryDelayMs must be a finite number >= 0.');
  }
}

function buildHeaders(
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const callerNames = new Set(
    Object.keys(headers).map((name) => name.toLowerCase()),
  );
  const merged: Record<string, string> = {};
  for (const [name, value] of [
    ['Content-Type', 'application/json'],
    ['Accept', 'application/json'],
  ] as const) {
    if (!callerNames.has(name.toLowerCase())) {
      merged[name] = value;
    }
  }
  return { ...merged, ...headers };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  attempts: number,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Racing the timer also bounds fetch implementations that ignore the abort signal.
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
  });
  try {
    let response: Response | typeof TIMEOUT;
    try {
      response = await Promise.race([
        fetch(endpoint, { ...init, signal: controller.signal }),
        timeout,
      ]);
    } catch {
      return {
        result: {
          ok: false,
          error: controller.signal.aborted ? 'timeout' : 'network',
          attempts,
        },
        retryable: true,
      };
    }
    if (response === TIMEOUT) {
      return {
        result: { ok: false, error: 'timeout', attempts },
        retryable: true,
      };
    }
    const { status } = response;
    if (status < 200 || status > 299) {
      return {
        result: { ok: false, error: 'http', status, attempts },
        retryable: isRetryableStatus(status),
      };
    }
    // The server accepted the upload, so a later failure is not retried to avoid a duplicate submission.
    let text: string | typeof TIMEOUT;
    try {
      text = await Promise.race([response.text(), timeout]);
    } catch {
      return {
        result: {
          ok: false,
          error: controller.signal.aborted ? 'timeout' : 'network',
          status,
          attempts,
        },
        retryable: false,
      };
    }
    if (text === TIMEOUT) {
      return {
        result: { ok: false, error: 'timeout', status, attempts },
        retryable: false,
      };
    }
    if (text === '') {
      return {
        result: { ok: true, status, body: undefined, attempts },
        retryable: false,
      };
    }
    try {
      return {
        result: { ok: true, status, body: JSON.parse(text), attempts },
        retryable: false,
      };
    } catch {
      return {
        result: { ok: false, error: 'invalid_response', status, attempts },
        retryable: false,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Posts `result` as JSON to the caller's `endpoint`. Runs only when called; the package never uploads on its own.
 * Resolves with an `UploadResult` for every transport outcome and rejects with `RangeError` only for invalid options.
 * See the README section "Opt-in upload" for the request format, retry rules, and privacy implications.
 */
export async function uploadVerification<T = unknown>(
  result: VerificationResult,
  options: UploadOptions,
): Promise<UploadResult<T>> {
  validateOptions(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_UPLOAD_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_UPLOAD_RETRY_DELAY_MS;
  const init: RequestInit = {
    method: 'POST',
    headers: buildHeaders(options.headers),
    body: JSON.stringify(result),
  };
  for (let attempts = 1; ; attempts++) {
    const outcome = await attempt(options.endpoint, init, timeoutMs, attempts);
    if (!outcome.retryable || attempts > retries) {
      return outcome.result as UploadResult<T>;
    }
    await delay(retryDelayMs * 2 ** (attempts - 1));
  }
}
