declare module "dexie" {
  export interface Collection<T> {
    toArray(): Promise<T[]>;
    sortBy(keyPath: keyof T & string): Promise<T[]>;
  }

  export interface WhereClause<T> {
    equals(value: unknown): Collection<T>;
  }

  export interface Table<T, TKey> {
    put(value: T): Promise<TKey>;
    get(key: TKey): Promise<T | undefined>;
    delete(key: TKey): Promise<void>;
    toArray(): Promise<T[]>;
    where(keyPath: keyof T & string): WhereClause<T>;
  }

  export default class Dexie {
    constructor(name: string);
    version(version: number): {
      stores(schema: Record<string, string>): void;
    };
    close(): void;
  }
}
