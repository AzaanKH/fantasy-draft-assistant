import { IDBRequest, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';

/** Runs `after` on every fake IndexedDB put (to abort or observe its transaction) until `mockRestore`. */
export function interceptPut(after: (store: IDBObjectStore, request: IDBRequest<unknown>) => void): { mockRestore: () => void } {
  const descriptor = Object.getOwnPropertyDescriptor(FakeObjectStore.prototype, 'put');
  const original: unknown = descriptor?.value;
  if (!descriptor || typeof original !== 'function') throw new Error('Missing IndexedDB put implementation');
  Object.defineProperty(FakeObjectStore.prototype, 'put', { ...descriptor, value(this: IDBObjectStore, value: unknown, key?: IDBValidKey): unknown {
    const request: unknown = Reflect.apply(original, this, [value, key]);
    if (!(request instanceof IDBRequest)) throw new Error('Invalid IndexedDB request');
    after(this, request);
    return request;
  } });
  return { mockRestore: () => { Object.defineProperty(FakeObjectStore.prototype, 'put', descriptor); } };
}
