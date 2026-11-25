/**
 * Event Bus Implementation
 * Observer pattern for loosely-coupled event-driven architecture
 * Supports both synchronous and asynchronous event handlers
 */

import type { DomainEvent, EventHandler } from './types';
import { isErr, type AsyncResult, ok, err, tapAsync } from './result';
import type { Logger } from './types';

export type EventSubscription = () => void;

export class EventBus {
  private handlers: Map<string, Set<EventHandler<DomainEvent>>> = new Map();
  private eventHistory: DomainEvent[] = [];
  private maxHistorySize = 10000;

  constructor(private logger: Logger) {}

  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
  ): EventSubscription {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler as EventHandler<DomainEvent>);
    this.logger.debug(`Handler subscribed to ${eventType}`);

    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler<DomainEvent>);
      this.logger.debug(`Handler unsubscribed from ${eventType}`);
    };
  }

  async publish<T extends DomainEvent>(event: T): AsyncResult<void> {
    this.addToHistory(event);
    const handlers = this.handlers.get(event.eventType);

    if (!handlers || handlers.size === 0) {
      this.logger.debug(`No handlers for event type ${event.eventType}`);
      return ok(void 0);
    }

    const results = await Promise.all(
      Array.from(handlers).map(handler =>
        tapAsync(
          handler.handle(event),
          async () => {
            this.logger.debug(`Handler executed for ${event.eventType}`);
          },
        ),
      ),
    );

    for (const result of results) {
      if (isErr(result)) {
        return result;
      }
    }

    return ok(void 0);
  }

  async publishBatch(events: DomainEvent[]): AsyncResult<void> {
    for (const event of events) {
      const result = await this.publish(event);
      if (isErr(result)) return result;
    }
    return ok(void 0);
  }

  getHistory(): DomainEvent[] {
    return [...this.eventHistory];
  }

  getHistorySince(timestamp: Date): DomainEvent[] {
    return this.eventHistory.filter(e => e.timestamp > timestamp);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  private addToHistory(event: DomainEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }
}
