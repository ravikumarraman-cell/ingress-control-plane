/**
 * Logger Implementation
 * Structured logging with context support
 * Tracks correlation IDs for request tracing
 */

import type { Logger } from './types';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
  correlationId?: string;
}

export class ConsoleLogger implements Logger {
  private minLevel: LogLevel = LogLevel.INFO;
  private correlationId: string | null = null;

  constructor(minLevel?: LogLevel) {
    if (minLevel) this.minLevel = minLevel;
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext = {
      ...context,
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack: error?.stack,
    };
    this.log(LogLevel.ERROR, message, errorContext, error);
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (this.shouldLog(level)) {
      const entry: LogEntry = {
        timestamp: new Date(),
        level,
        message,
        context,
        error,
        correlationId: this.correlationId || undefined,
      };

      const formatted = this.formatEntry(entry);
      this.output(level, formatted);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const correlationId = entry.correlationId ? ` [${entry.correlationId}]` : '';
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const errorInfo = entry.error ? ` ${entry.error.name}: ${entry.error.message}` : '';

    return `${timestamp}${correlationId} [${entry.level}] ${entry.message}${errorInfo}${context}`;
  }

  private output(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }
}

export class NoOpLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
