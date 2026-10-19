import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, afterEach, beforeEach, expect, vi } from 'vitest';
import { deriveDraft, type DerivedDraft } from '@fantasy-draft/shared';
import type { DraftStoreApi } from '../draftStore';
import type { DraftStore } from './types';
import { shadowFormat, shadowSource } from './derive-shadow-source';

type Difference = { readonly field: keyof DerivedDraft; readonly derived: unknown; readonly stored: unknown };
const differences: { readonly step: number; readonly store: number; readonly fields: readonly Difference[] }[] = [];
const subscriptions: (() => void)[] = [];
let nextStore = 0;
let step = 0;
let storeIds = new WeakMap<object, number>();
let firstStore: DraftStoreApi | undefined;
const reports: { readonly scenario: string; readonly views: number; readonly differences: typeof differences }[] = [];

function compare(state: DraftStore, api: object): void {
  let store = storeIds.get(api);
  if (store === undefined) {
    store = nextStore++;
    storeIds.set(api, store);
  }
  if (!expect.getState().currentTestName) return;
  step += 1;
  const derived = deriveDraft(shadowSource(state), shadowFormat(state));
  const fields: Difference[] = [];
  const keys = ['draftedPlayerIds', 'teamRosters', 'myRoster', 'currentPick', 'shortlistedPlayerIds', 'isMyTurn'] as const;
  for (const field of keys) {
    if (!isDeepStrictEqual(derived[field], state[field])) {
      fields.push({ field, derived: derived[field], stored: state[field] });
    } else {
      expect(derived[field]).toEqual(state[field]);
    }
  }
  if (fields.length) differences.push({ step, store, fields });
}

function observe(candidate: unknown): void {
  if (typeof candidate !== 'function' || !('getState' in candidate) ||
      typeof candidate.getState !== 'function' || !('subscribe' in candidate) ||
      typeof candidate.subscribe !== 'function') return;
  const state: unknown = Reflect.apply(candidate.getState, candidate, []);
  if (typeof state !== 'object' || state === null || !('draftHistory' in state)) return;
  const store = candidate as DraftStoreApi;
  firstStore ??= store;
  compare(store.getState(), store);
  subscriptions.push(store.subscribe(next => { compare(next, store); }));
}

vi.mock('zustand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zustand')>();
  return {
    ...actual,
    create: new Proxy(actual.create, {
      apply(target, thisArg: unknown, args: unknown[]): unknown {
        const result: unknown = Reflect.apply(target, thisArg, args);
        if (args.length === 0 && typeof result === 'function') {
          return new Proxy(result, {
            apply(curried, receiver: unknown, initializer: unknown[]): unknown {
              const store: unknown = Reflect.apply(curried, receiver, initializer);
              observe(store);
              return store;
            },
          });
        }
        observe(result);
        return result;
      },
    }),
  };
});

beforeEach(() => {
  differences.length = 0;
  nextStore = 0;
  storeIds = new WeakMap();
  step = 0;
  if (firstStore) compare(firstStore.getState(), firstStore);
});

afterAll(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  const directory = process.env.DERIVE_SHADOW_REPORT_DIR;
  const testPath = expect.getState().testPath;
  if (directory && testPath) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${basename(testPath)}.json`), JSON.stringify(reports, null, 2) + '\n');
  }
});

afterEach(() => {
  expect(step, 'The shadow must observe the real store in every scenario').toBeGreaterThan(0);
  reports.push({ scenario: expect.getState().currentTestName ?? 'unknown', views: step, differences: [...differences] });
  expect(differences).toMatchSnapshot('documented deriveDraft mismatches');
});
