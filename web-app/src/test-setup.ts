import { afterEach, beforeEach } from 'vitest';

// React reports render crashes and jsdom reports uncaught errors through console.error; a test that passes over
// one is hiding a broken tree. React's dev-only "Warning:" messages (act, SSR layout effects) are not crashes and
// are left out. Tests that expect an error stub console.error themselves (vi.spyOn), bypassing this recorder.
const original = console.error;
let reported: string[] = [];

beforeEach(() => {
  reported = [];
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Warning:')) { original(...args); return; }
    reported.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 300));
    original(...args);
  };
});

afterEach(() => {
  console.error = original;
  if (reported.length > 0) throw new Error(`Unexpected console.error during the test:\n${reported.join('\n')}`);
});
