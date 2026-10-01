import { describe, it, expect } from 'vitest';
import { localDevPorts } from '@fantasy-draft/shared';

describe('local service ports', () => {
  it('keeps local defaults and resolves the verification pair together', () => {
    expect(localDevPorts()).toMatchObject({ webPort: 3000, apiPort: 3001 });
    expect(localDevPorts({ DRAFT_WEB_PORT: '3100', DRAFT_API_PORT: '3101', PORT: '9000' }))
      .toEqual({ webPort: 3100, apiPort: 3101, webOrigin: 'http://localhost:3100', apiOrigin: 'http://127.0.0.1:3101' });
    expect(localDevPorts({ PORT: '4001' }).apiPort).toBe(4001);
  });
  it.each(['', '0', '-1', '65536', '3100suffix', '3.1', ' 3100'])('rejects invalid port %j', value => {
    expect(() => localDevPorts({ DRAFT_WEB_PORT: value })).toThrow();
    expect(() => localDevPorts({ DRAFT_API_PORT: value })).toThrow();
  });
  it('rejects colliding services', () => {
    expect(() => localDevPorts({ DRAFT_API_PORT: '3000' })).toThrow('different');
  });
  it('omits the default HTTP port from both local origins', () => {
    expect(localDevPorts({ DRAFT_WEB_PORT: '80' }).webOrigin).toBe('http://localhost');
    expect(localDevPorts({ DRAFT_API_PORT: '80' }).apiOrigin).toBe('http://127.0.0.1');
  });
});
