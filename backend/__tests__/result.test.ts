/**
 * Result Type Composition Tests
 * Validates railway-oriented programming error handling
 */

import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, mapResult, flatMapResult, allAsync, tapAsync } from '../core/result';

describe('Result Type', () => {
  describe('ok() and err()', () => {
    it('creates successful result with value', () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toBe(42);
    });

    it('creates error result with Error', () => {
      const error = new Error('Something failed');
      const result = err(error);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toBe('Something failed');
    });
  });

  describe('mapResult()', () => {
    it('transforms value in success case', () => {
      const result = mapResult(ok(5), x => x * 2);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toBe(10);
    });

    it('passes through error case', () => {
      const error = new Error('Test error');
      const result = mapResult(err(error), x => x * 2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toBe('Test error');
    });
  });

  describe('flatMapResult()', () => {
    it('chains results without nesting', () => {
      const result = flatMapResult(ok(5), x => ok(x * 2));
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toBe(10);
    });

    it('short-circuits on error', () => {
      const result = flatMapResult(err(new Error('First error')), x => err(new Error('Should not reach')));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toBe('First error');
    });
  });

  describe('allAsync()', () => {
    it('combines multiple async results into tuple', async () => {
      const result = await allAsync(Promise.resolve(ok(1)), Promise.resolve(ok(2)), Promise.resolve(ok(3)));
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toEqual([1, 2, 3]);
    });

    it('short-circuits on first error', async () => {
      const result = await allAsync(Promise.resolve(ok(1)), Promise.resolve(err(new Error('Failed'))));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toBe('Failed');
    });
  });

  describe('tapAsync()', () => {
    it('executes side effect and returns original result', async () => {
      let sideEffectRan = false;
      const result = await tapAsync(Promise.resolve(ok(42)), async value => {
        sideEffectRan = true;
        expect(value).toBe(42);
      });

      expect(sideEffectRan).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toBe(42);
    });
  });
});
