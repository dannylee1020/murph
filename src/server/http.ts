import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location });
  res.end();
}

export function sendText(res: ServerResponse, text: string, status = 200): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return (body ? JSON.parse(body) : {}) as T;
}

export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}

export function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function safeStaticPath(staticRoot: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const candidate = path.resolve(staticRoot, decoded.slice(1));
  if (!candidate.startsWith(staticRoot)) {
    return null;
  }
  return candidate;
}

function serveFile(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, { 'content-type': contentType(filePath) });
  createReadStream(filePath).pipe(res);
  return true;
}

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  staticRoot: string
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, { ok: false, error: 'not_found' }, 404);
    return;
  }

  const filePath = safeStaticPath(staticRoot, url.pathname);
  if (filePath && serveFile(res, filePath)) {
    return;
  }

  const indexPath = path.join(staticRoot, 'index.html');
  if (existsSync(indexPath)) {
    const html = await readFile(indexPath, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  sendText(res, 'Murph UI has not been built. Run npm run build.', 503);
}
