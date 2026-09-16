import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeBoundedEvent } from './http-security.js';

function slowResponse() {
  const events = new EventEmitter();
  const response = Object.assign(events, {
    destroyed: false, writableEnded: false, writableLength: 0,
    write: vi.fn(() => false),
    destroy: vi.fn(() => { response.destroyed = true; events.emit('close'); }),
  });
  return response;
}
afterEach(() => vi.useRealTimers());

describe('SSE backpressure limits', () => {
  it('allows a normal large write to drain instead of immediately disconnecting', () => {
    vi.useFakeTimers();
    const response = slowResponse();
    writeBoundedEvent(response as unknown as ServerResponse, 'snapshot', 100);
    expect(response.destroy).not.toHaveBeenCalled();
    response.emit('drain');
    vi.advanceTimersByTime(5001);
    expect(response.destroy).not.toHaveBeenCalled();
  });

  it('disconnects a client that never drains', () => {
    vi.useFakeTimers();
    const response = slowResponse();
    writeBoundedEvent(response as unknown as ServerResponse, 'snapshot', 100);
    vi.advanceTimersByTime(5001);
    expect(response.destroy).toHaveBeenCalledOnce();
  });

  it('disconnects before exceeding the buffer cap', () => {
    const response = slowResponse();
    response.writableLength = 98;
    writeBoundedEvent(response as unknown as ServerResponse, 'snapshot', 100);
    expect(response.write).not.toHaveBeenCalled();
    expect(response.destroy).toHaveBeenCalledOnce();
  });
});
