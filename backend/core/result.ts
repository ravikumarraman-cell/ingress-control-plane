/**
 * Core Result type utilities for Railway-Oriented Programming
 * Provides composable error handling throughout the control plane
 */

import type { Result } from './types';

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

export class ResultError extends Error {
  constructor(message: string, public readonly code: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'ResultError';
  }
}

export function ok<T>(value: T): Result<T> {
  return { success: true, value };
}

export function err<E extends Error = Error>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T>(result: Result<T>): result is { success: true; value: T } {
  return result.success;
}

export function isErr<T, E extends Error = Error>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success;
}

export function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  return isOk(result) ? ok(fn(result.value)) : result;
}

export function flatMapResult<T, U>(result: Result<T>, fn: (value: T) => Result<U>): Result<U> {
  return isOk(result) ? fn(result.value) : result;
}

export function bimap<T, U, E extends Error>(
  result: Result<T, E>,
  onOk: (value: T) => U,
  onErr: (error: E) => U,
): U {
  return isOk(result) ? onOk(result.value) : onErr(result.error);
}

export function getOrElse<T>(result: Result<T>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue;
}

export function getOrThrow<T>(result: Result<T>): T {
  if (isOk(result)) return result.value;
  throw result.error;
}

export async function okAsync<T>(value: T): AsyncResult<T> {
  return ok(value);
}

export async function errAsync<E extends Error = Error>(error: E): AsyncResult<never, E> {
  return err(error);
}

export async function mapAsync<T, U>(
  result: AsyncResult<T>,
  fn: (value: T) => Promise<U>,
): AsyncResult<U> {
  const resolved = await result;
  if (!isOk(resolved)) return resolved;
  try {
    const mapped = await fn(resolved.value);
    return ok(mapped);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function flatMapAsync<T, U>(
  result: AsyncResult<T>,
  fn: (value: T) => AsyncResult<U>,
): AsyncResult<U> {
  const resolved = await result;
  if (!isOk(resolved)) return resolved;
  return fn(resolved.value);
}

export async function allAsync<T extends unknown[]>(
  ...results: { [K in keyof T]: AsyncResult<T[K]> }
): AsyncResult<T> {
  const resolved = await Promise.all(results);
  const values: unknown[] = [];

  for (const result of resolved) {
    if (!isOk(result)) return result;
    values.push(result.value);
  }

  return ok(values as T);
}

export async function allAsyncIterable<T>(
  results: Iterable<AsyncResult<T>>,
): AsyncResult<T[]> {
  const values: T[] = [];
  for (const result of results) {
    const resolved = await result;
    if (!isErr(resolved)) {
      values.push(resolved.value);
    } else {
      return resolved;
    }
  }
  return ok(values);
}

export function tap<T>(result: Result<T>, fn: (value: T) => void): Result<T> {
  if (isOk(result)) {
    fn(result.value);
  }
  return result;
}

export async function tapAsync<T>(result: AsyncResult<T>, fn: (value: T) => Promise<void>): AsyncResult<T> {
  const resolved = await result;
  if (isOk(resolved)) {
    await fn(resolved.value);
  }
  return resolved;
}

export function tapError<T, E extends Error>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> {
  if (isErr(result)) {
    fn(result.error);
  }
  return result;
}

export async function tapErrorAsync<T, E extends Error>(
  result: AsyncResult<T, E>,
  fn: (error: E) => Promise<void>,
): AsyncResult<T, E> {
  const resolved = await result;
  if (isErr(resolved)) {
    await fn(resolved.error);
  }
  return resolved;
}
