/**
 * Repository Pattern Implementation
 * Abstract data access layer with in-memory reference implementation
 * Production implementations can swap out the storage backend
 */

import type { Repository, Entity } from '../core/types';
import { ok, err, type AsyncResult } from '../core/result';

export abstract class BaseRepository<T extends Entity> implements Repository<T> {
  abstract findById(id: T['id']): AsyncResult<T>;
  abstract findAll(): AsyncResult<T[]>;
  abstract save(entity: T): AsyncResult<T>;
  abstract delete(id: T['id']): AsyncResult<boolean>;
}

export class InMemoryRepository<T extends Entity> extends BaseRepository<T> {
  private storage: Map<T['id'], T> = new Map();

  async findById(id: T['id']): AsyncResult<T> {
    const entity = this.storage.get(id);
    if (!entity) {
      return err(new Error(`Entity with id ${id} not found`));
    }
    return ok(entity);
  }

  async findAll(): AsyncResult<T[]> {
    return ok(Array.from(this.storage.values()));
  }

  async save(entity: T): AsyncResult<T> {
    entity.updatedAt = new Date();
    this.storage.set(entity.id, entity);
    return ok(entity);
  }

  async delete(id: T['id']): AsyncResult<boolean> {
    const deleted = this.storage.delete(id);
    return ok(deleted);
  }

  async findBy(predicate: (entity: T) => boolean): AsyncResult<T[]> {
    const results = Array.from(this.storage.values()).filter(predicate);
    return ok(results);
  }

  async findOne(predicate: (entity: T) => boolean): AsyncResult<T> {
    const entity = Array.from(this.storage.values()).find(predicate);
    if (!entity) {
      return err(new Error('Entity not found'));
    }
    return ok(entity);
  }

  clear(): void {
    this.storage.clear();
  }

  size(): number {
    return this.storage.size;
  }
}

export class CachedRepository<T extends Entity> extends BaseRepository<T> {
  private cache: Map<T['id'], T> = new Map();
  private cacheExpiryMs: number;
  private lastUpdated: Map<T['id'], number> = new Map();

  constructor(
    private delegate: Repository<T>,
    cacheExpirySeconds: number = 300,
  ) {
    super();
    this.cacheExpiryMs = cacheExpirySeconds * 1000;
  }

  async findById(id: T['id']): AsyncResult<T> {
    const cached = this.getFromCache(id);
    if (cached) {
      return ok(cached);
    }

    const result = await this.delegate.findById(id);
    if (result.success) {
      this.cache.set(id, result.value);
      this.lastUpdated.set(id, Date.now());
    }
    return result;
  }

  async findAll(): AsyncResult<T[]> {
    return this.delegate.findAll();
  }

  async save(entity: T): AsyncResult<T> {
    this.invalidateCache(entity.id);
    return this.delegate.save(entity);
  }

  async delete(id: T['id']): AsyncResult<boolean> {
    this.invalidateCache(id);
    return this.delegate.delete(id);
  }

  private getFromCache(id: T['id']): T | null {
    const cached = this.cache.get(id);
    if (!cached) return null;

    const lastUpdate = this.lastUpdated.get(id);
    if (!lastUpdate || Date.now() - lastUpdate > this.cacheExpiryMs) {
      this.cache.delete(id);
      this.lastUpdated.delete(id);
      return null;
    }

    return cached;
  }

  private invalidateCache(id: T['id']): void {
    this.cache.delete(id);
    this.lastUpdated.delete(id);
  }

  clearCache(): void {
    this.cache.clear();
    this.lastUpdated.clear();
  }
}
