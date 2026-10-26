import { describe, expect, it, jest } from '@jest/globals';

import type {
  DetectorAsyncRunner,
  DetectorRunnerWorklets,
} from '../guidance/asyncRunner';

interface FakeFrame {
  refs: number;
  incrementRefCount(): void;
  decrementRefCount(): void;
}

function frame(): FakeFrame {
  return {
    refs: 1,
    incrementRefCount() {
      this.refs += 1;
    },
    decrementRefCount() {
      this.refs -= 1;
    },
  };
}

/**
 * A fake `Worklets` whose `createRunAsync` queues calls, so a test decides when the background work runs.
 * Each test loads the module in isolation, because the runner keeps its context for the life of the module.
 */
function setup() {
  const queue: (() => void)[] = [];
  const createContext = jest.fn((_name: string) => ({
    createRunAsync:
      <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => {
        queue.push(() => fn(...args));
      },
  }));
  const worklets = {
    createContext,
    createSharedValue: <T>(value: T) => ({ value }),
  } as unknown as DetectorRunnerWorklets;
  let create!: <F>(w: DetectorRunnerWorklets) => DetectorAsyncRunner<F>;
  jest.isolateModules(() => {
    create = require('../guidance/asyncRunner').createDetectorAsyncRunner;
  });
  const drain = () => {
    while (queue.length > 0) {
      queue.shift()!();
    }
  };
  return { worklets, createContext, create, queue, drain };
}

describe('createDetectorAsyncRunner', () => {
  it('creates one context and keeps it for every runner', () => {
    const { worklets, createContext, create } = setup();
    create(worklets);
    create(worklets);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(createContext).toHaveBeenCalledWith('ParkingGuide.detector');
  });

  it('runs work in the background with the frame kept alive, then releases it', () => {
    const { worklets, create, queue, drain } = setup();
    const run = create<FakeFrame>(worklets);
    const work = jest.fn();
    const f = frame();
    expect(run(f, work)).toBe(true);
    expect(f.refs).toBe(2);
    expect(work).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    drain();
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.refs).toBe(1);
  });

  it('skips a frame while the previous work is running, across runners', () => {
    const { worklets, create, drain } = setup();
    const first = create<FakeFrame>(worklets);
    const second = create<FakeFrame>(worklets);
    const f = frame();
    expect(first(frame(), () => undefined)).toBe(true);
    expect(second(f, () => undefined)).toBe(false);
    expect(f.refs).toBe(1);
    drain();
    expect(second(f, () => undefined)).toBe(true);
  });

  it('releases the frame and the busy flag when the work throws', () => {
    const { worklets, create, drain } = setup();
    const run = create<FakeFrame>(worklets);
    const f = frame();
    run(f, () => {
      throw new Error('model failed');
    });
    expect(drain).toThrow('model failed');
    expect(f.refs).toBe(1);
    expect(run(frame(), () => undefined)).toBe(true);
  });

  it('clears the busy flag when releasing the frame throws', () => {
    const { worklets, create, drain } = setup();
    const run = create<FakeFrame>(worklets);
    const f = frame();
    f.decrementRefCount = () => {
      throw new Error('frame closed');
    };
    run(f, () => undefined);
    expect(drain).toThrow('frame closed');
    expect(run(frame(), () => undefined)).toBe(true);
  });

  it('undoes the reference and the busy flag when scheduling throws', () => {
    const { create } = setup();
    const worklets = {
      createContext: () => ({
        createRunAsync: () => () => {
          throw new Error('context gone');
        },
      }),
      createSharedValue: <T>(value: T) => ({ value }),
    } as unknown as DetectorRunnerWorklets;
    const run = create<FakeFrame>(worklets);
    const f = frame();
    expect(() => run(f, () => undefined)).toThrow('context gone');
    expect(f.refs).toBe(1);
    expect(() => run(f, () => undefined)).toThrow('context gone');
  });
});
