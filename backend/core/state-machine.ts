/**
 * State Machine Implementation
 * Encodes valid state transitions and prevents invalid state changes
 * Essential for maintaining workflow integrity
 */

import type { Result } from './types';
import { ok, err } from './result';

export type StateTransition<S> = {
  from: S;
  to: S;
  guard?: () => boolean;
};

export interface StateMachineConfig<S> {
  initialState: S;
  transitions: StateTransition<S>[];
  onStateChange?: (from: S, to: S) => void | Promise<void>;
}

export class StateMachine<S extends string | number> {
  private currentState: S;
  private transitionMap: Map<S, Set<S>> = new Map();
  private guardMap: Map<`${S}-${S}`, () => boolean> = new Map();
  private stateHistory: Array<{ state: S; timestamp: Date }> = [];

  constructor(private config: StateMachineConfig<S>) {
    this.currentState = config.initialState;
    this.buildTransitionMap();
  }

  private buildTransitionMap(): void {
    for (const transition of this.config.transitions) {
      if (!this.transitionMap.has(transition.from)) {
        this.transitionMap.set(transition.from, new Set());
      }
      this.transitionMap.get(transition.from)!.add(transition.to);

      if (transition.guard) {
        const key = `${transition.from}-${transition.to}` as const;
        this.guardMap.set(key, transition.guard);
      }
    }
  }

  canTransitionTo(nextState: S): boolean {
    const allowedTransitions = this.transitionMap.get(this.currentState);
    if (!allowedTransitions?.has(nextState)) return false;

    const guard = this.guardMap.get(`${this.currentState}-${nextState}` as const);
    return guard ? guard() : true;
  }

  transitionTo(nextState: S): Result<S> {
    if (!this.canTransitionTo(nextState)) {
      return err(new Error(`Invalid transition from ${this.currentState} to ${nextState}`));
    }

    const previousState = this.currentState;
    this.currentState = nextState;
    this.stateHistory.push({ state: nextState, timestamp: new Date() });

    if (this.config.onStateChange) {
      this.config.onStateChange(previousState, nextState);
    }

    return ok(nextState);
  }

  getState(): S {
    return this.currentState;
  }

  getHistory(): Array<{ state: S; timestamp: Date }> {
    return [...this.stateHistory];
  }

  reset(): void {
    this.currentState = this.config.initialState;
    this.stateHistory = [{ state: this.currentState, timestamp: new Date() }];
  }
}
