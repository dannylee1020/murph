import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SERVER_PORT,
  formatListenError,
  resolveListenPort,
  startServer
} from '../shared/server/startup';

function serverThatFails(error: unknown): Server {
  const emitter = new EventEmitter() as Server;
  emitter.listen = (() => {
    queueMicrotask(() => emitter.emit('error', error));
    return emitter;
  }) as Server['listen'];
  return emitter;
}

describe('server startup', () => {
  it('uses 5173 by default and honors configured ports', () => {
    expect(resolveListenPort({})).toBe(DEFAULT_SERVER_PORT);
    expect(resolveListenPort({ MURPH_PORT: '5291' })).toBe(5291);
    expect(resolveListenPort({ PORT: '5292', MURPH_PORT: '5291' })).toBe(5292);
  });

  it('rejects invalid ports', () => {
    expect(() => resolveListenPort({ PORT: 'auto' })).toThrow('Invalid Murph port "auto"');
    expect(() => resolveListenPort({ PORT: '70000' })).toThrow('Invalid Murph port "70000"');
  });

  it('explains occupied ports without suggesting automatic fallback', () => {
    const message = formatListenError(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }), 5173);

    expect(message).toContain('Port 5173 is already in use');
    expect(message).toContain('does not automatically switch ports');
    expect(message).toContain('OAuth callback URLs');
  });

  it('does not call onListening when the requested port is occupied', async () => {
    const port = 5291;
    const candidate = serverThatFails(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
    let listened = false;

    const message = await new Promise<string>((resolve) => {
      startServer(candidate, {
        port,
        onListening: () => {
          listened = true;
        },
        onFatalError: (_error, formatted) => {
          resolve(formatted);
        }
      });
    });

    expect(listened).toBe(false);
    expect(message).toContain(`Port ${port} is already in use`);
  });
});
