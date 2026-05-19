import type { Server } from 'node:http';

export const DEFAULT_SERVER_PORT = 5173;

export interface StartServerOptions {
  port: number;
  onListening: () => void;
  onFatalError?: (error: unknown, message: string) => void;
}

function configuredPortRaw(env: NodeJS.ProcessEnv): string {
  return env.PORT ?? env.MURPH_PORT ?? String(DEFAULT_SERVER_PORT);
}

export function resolveListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = configuredPortRaw(env).trim();
  const port = Number(raw);

  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Murph port "${raw}". Set PORT or MURPH_PORT to a number from 1 to 65535.`);
  }

  return port;
}

export function isAddressInUseError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE';
}

export function formatListenError(error: unknown, port: number): string {
  if (isAddressInUseError(error)) {
    return [
      `Port ${port} is already in use.`,
      'Murph does not automatically switch ports because OAuth callback URLs and local tunnels depend on the configured origin.',
      'Stop the process using that port, or set PORT/MURPH_PORT intentionally after updating any provider callback URLs.'
    ].join(' ');
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `Murph could not start on port ${port}: ${detail}`;
}

export function startServer(server: Server, options: StartServerOptions): void {
  const handleError = (error: unknown): void => {
    const message = formatListenError(error, options.port);
    if (options.onFatalError) {
      options.onFatalError(error, message);
      return;
    }

    console.error(message);
    process.exit(1);
  };

  server.once('error', handleError);
  server.listen(options.port, () => {
    server.off('error', handleError);
    options.onListening();
  });
}
