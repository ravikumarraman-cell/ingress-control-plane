/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping requests to failing services
 * Implements half-open state for automatic recovery detection
 */

import { ok, err, type AsyncResult } from '../core/result';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => AsyncResult<T>): AsyncResult<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        return err(new Error('Circuit breaker is OPEN'));
      }
    }

    try {
      const result = await fn();

      if (result.success) {
        this.onSuccess();
      } else {
        this.onFailure();
      }

      return result;
    } catch (error) {
      this.onFailure();
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.config.timeoutMs;
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }
}

export class RetryStrategy {
  constructor(
    private maxRetries: number = 3,
    private initialDelayMs: number = 100,
    private backoffMultiplier: number = 2,
  ) {}

  async execute<T>(fn: () => AsyncResult<T>): AsyncResult<T> {
    let lastError: Error | undefined;
    let delay = this.initialDelayMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const result = await fn();

      if (result.success) {
        return result;
      }

      lastError = result.error;

      if (attempt < this.maxRetries) {
        await this.sleep(delay);
        delay *= this.backoffMultiplier;
      }
    }

    return err(lastError || new Error('Max retries exceeded'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;

  constructor(
    private tokensPerSecond: number,
    initialTokens?: number,
  ) {
    this.tokens = initialTokens ?? tokensPerSecond;
    this.lastRefillTime = Date.now();
  }

  async acquireToken(): Promise<void> {
    this.refillTokens();

    while (this.tokens < 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      this.refillTokens();
    }

    this.tokens--;
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefillTime) / 1000;
    const tokensToAdd = timePassed * this.tokensPerSecond;

    this.tokens = Math.min(this.tokens + tokensToAdd, this.tokensPerSecond);
    this.lastRefillTime = now;
  }
}

export class Bulkhead {
  private activeRequests = 0;

  constructor(private maxConcurrent: number) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.activeRequests++;

    try {
      return await fn();
    } finally {
      this.activeRequests--;
    }
  }

  getActiveRequests(): number {
    return this.activeRequests;
  }

  getRemainingCapacity(): number {
    return Math.max(0, this.maxConcurrent - this.activeRequests);
  }
}
