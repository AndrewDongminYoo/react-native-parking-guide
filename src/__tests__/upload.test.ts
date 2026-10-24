import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import type { VerificationResult } from '../types';
import {
  DEFAULT_UPLOAD_RETRIES,
  DEFAULT_UPLOAD_RETRY_DELAY_MS,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  uploadVerification,
} from '../upload';

const ENDPOINT = 'https://verify.example.com/parking';

const RESULT: VerificationResult = {
  verdict: 'PASS',
  score: 1,
  rules: [{ id: 'UPRIGHT', verdict: 'PASS', score: 1, confidence: 0.9 }],
  photo: { uri: 'file:///photo.jpg', width: 1080, height: 1920, sha256: 'abc' },
  metadata: {
    capturedAt: '2026-01-01T00:00:00.000Z',
    location: { lat: 37.5665, lng: 126.978, accuracy: 5 },
    deviceTilt: { pitch: 0, roll: 0 },
    modelVersion: '0.1.0-dev',
    platform: 'ios',
  },
};

type FetchMock = jest.Mock<
  (input: string, init?: RequestInit) => Promise<Response>
>;

function response(status: number, text = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  } as unknown as Response;
}

/** A fetch call that settles only when its signal aborts. */
function hang(_input: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });
}

let fetchMock: FetchMock;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe('uploadVerification', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_UPLOAD_TIMEOUT_MS).toBe(10000);
    expect(DEFAULT_UPLOAD_RETRIES).toBe(2);
    expect(DEFAULT_UPLOAD_RETRY_DELAY_MS).toBe(500);
  });

  it('posts the result as JSON and returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(response(200, '{"accepted":true}'));
    const result = await uploadVerification<{ accepted: boolean }>(RESULT, {
      endpoint: ENDPOINT,
      headers: { Authorization: 'Bearer token', accept: 'text/plain' },
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { accepted: true },
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'accept': 'text/plain',
      'Authorization': 'Bearer token',
    });
    expect(JSON.parse(init?.body as string)).toEqual(RESULT);
    expect(init?.signal).toBeDefined();
  });

  it('returns an undefined body for an empty 2xx response', async () => {
    fetchMock.mockResolvedValueOnce(response(204));
    await expect(
      uploadVerification(RESULT, { endpoint: ENDPOINT })
    ).resolves.toEqual({ ok: true, status: 204, body: undefined, attempts: 1 });
  });

  it('reports an invalid JSON body without retrying', async () => {
    fetchMock.mockResolvedValue(response(200, 'not json'));
    await expect(
      uploadVerification(RESULT, { endpoint: ENDPOINT, retryDelayMs: 0 })
    ).resolves.toEqual({
      ok: false,
      error: 'invalid_response',
      status: 200,
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable HTTP status', async () => {
    fetchMock.mockResolvedValue(response(400, '{"error":"bad"}'));
    await expect(
      uploadVerification(RESULT, { endpoint: ENDPOINT, retryDelayMs: 0 })
    ).resolves.toEqual({ ok: false, error: 'http', status: 400, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503, 599])(
    'retries HTTP %i and succeeds on a later attempt',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(201, '{"id":1}'));
      await expect(
        uploadVerification(RESULT, { endpoint: ENDPOINT, retryDelayMs: 0 })
      ).resolves.toEqual({
        ok: true,
        status: 201,
        body: { id: 1 },
        attempts: 2,
      });
    }
  );

  it('stops after the configured retries and reports the last failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response(502));
    await expect(
      uploadVerification(RESULT, {
        endpoint: ENDPOINT,
        retries: 1,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({ ok: false, error: 'http', status: 502, attempts: 2 });

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(
      uploadVerification(RESULT, { endpoint: ENDPOINT, retryDelayMs: 0 })
    ).resolves.toEqual({ ok: false, error: 'network', attempts: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts an attempt after timeoutMs and reports a timeout', async () => {
    fetchMock.mockImplementation(hang);
    await expect(
      uploadVerification(RESULT, {
        endpoint: ENDPOINT,
        timeoutMs: 10,
        retries: 1,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({ ok: false, error: 'timeout', attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out while reading a 2xx body without retrying', async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      return {
        status: 200,
        ok: true,
        text: () => hang('', init).then(() => ''),
      } as unknown as Response;
    });
    await expect(
      uploadVerification(RESULT, {
        endpoint: ENDPOINT,
        timeoutMs: 10,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({
      ok: false,
      error: 'timeout',
      status: 200,
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out even when fetch ignores the abort signal', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await expect(
      uploadVerification(RESULT, {
        endpoint: ENDPOINT,
        timeoutMs: 10,
        retries: 0,
      })
    ).resolves.toEqual({ ok: false, error: 'timeout', attempts: 1 });
  });

  it('waits retryDelayMs * 2^(n-1) before retry n', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(response(503));
    const pending = uploadVerification(RESULT, {
      endpoint: ENDPOINT,
      retryDelayMs: 100,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: 'http',
      status: 503,
      attempts: 3,
    });
  });

  it('rejects invalid options without calling fetch', async () => {
    const invalid: unknown[] = [
      null,
      { endpoint: 'http://verify.example.com' },
      { endpoint: 'https://' },
      { endpoint: 'https:///path' },
      { endpoint: 'https://host name' },
      { endpoint: 'ftp://verify.example.com' },
      { endpoint: 'https://@/x' },
      { endpoint: 'https://:443/x' },
      { endpoint: 'https://user@' },
      { endpoint: 'https://user:pass@verify.example.com/x' },
      { endpoint: 'https://evil.example\\@verify.example.com' },
      { endpoint: 'https://verify.example.com:port/x' },
      { endpoint: undefined },
      { endpoint: ENDPOINT, timeoutMs: 0 },
      { endpoint: ENDPOINT, timeoutMs: Number.POSITIVE_INFINITY },
      { endpoint: ENDPOINT, timeoutMs: Number.NaN },
      { endpoint: ENDPOINT, retries: -1 },
      { endpoint: ENDPOINT, retries: 1.5 },
      { endpoint: ENDPOINT, retries: '2' },
      { endpoint: ENDPOINT, retryDelayMs: -1 },
      { endpoint: ENDPOINT, retryDelayMs: Number.NaN },
      { endpoint: ENDPOINT, retryDelayMs: Number.POSITIVE_INFINITY },
      { endpoint: ENDPOINT, headers: null },
      { endpoint: ENDPOINT, headers: ['Authorization', 'token'] },
      { endpoint: ENDPOINT, headers: { Authorization: 1 } },
    ];
    for (const options of invalid) {
      await expect(
        uploadVerification(RESULT, options as never)
      ).rejects.toThrow(RangeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'HTTPS://verify.example.com',
    'https://verify.example.com:8443/parking?v=1#x',
    'https://192.0.2.1/parking',
    'https://[2001:db8::1]:8443/parking',
  ])('accepts %s', async (endpoint) => {
    fetchMock.mockResolvedValueOnce(response(200));
    await expect(
      uploadVerification(RESULT, { endpoint })
    ).resolves.toMatchObject({ ok: true });
  });

  it('does not mutate the result or the headers', async () => {
    fetchMock.mockResolvedValueOnce(response(200));
    const snapshot = JSON.parse(JSON.stringify(RESULT));
    const headers = Object.freeze({ Authorization: 'Bearer token' });
    await uploadVerification(Object.freeze(RESULT), {
      endpoint: ENDPOINT,
      headers,
    });
    expect(RESULT).toEqual(snapshot);
    expect(headers).toEqual({ Authorization: 'Bearer token' });
  });
});
