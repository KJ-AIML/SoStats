import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';

type ResolvedAddress = { address: string; family: 4 | 6 };

export function isPublicAddress(value: string) {
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    if (a >= 224) return false;
    return true;
  }

  if (isIP(value) !== 6) return false;
  const normalized = value.toLowerCase();
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  ) {
    return false;
  }
  return true;
}

function terminalError(message: string) {
  const error = new Error(message);
  Object.assign(error, { terminal: true });
  return error;
}

async function resolvePublic(url: URL): Promise<ResolvedAddress> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw terminalError('RSS URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw terminalError('RSS URL cannot contain embedded credentials');
  }

  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw terminalError('RSS URL must use the standard HTTP or HTTPS port');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw terminalError('RSS URL host is not publicly routable');
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw terminalError('RSS URL address is not publicly routable');
    }
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw terminalError('RSS URL resolved to a non-public address');
  }

  return {
    address: addresses[0].address,
    family: addresses[0].family as 4 | 6,
  };
}

function requestText(
  url: URL,
  resolved: ResolvedAddress,
  maxBytes: number,
  timeoutMs: number,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        headers: {
          accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
          'user-agent': 'SoStats-RSS/1.0',
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;

        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            request.destroy(
              terminalError('RSS response exceeded the size limit'),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });

        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('RSS request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

export async function fetchPublicFeed(
  input: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
  } = {},
) {
  const maxBytes = options.maxBytes || 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs || 10_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = new URL(input);

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const resolved = await resolvePublic(current);
    const response = await requestText(
      current,
      resolved,
      maxBytes,
      timeoutMs,
    );

    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.location
    ) {
      if (redirect === maxRedirects) {
        throw terminalError('RSS redirect limit exceeded');
      }
      current = new URL(response.headers.location, current);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        `RSS source returned HTTP ${response.status}`,
      );
      Object.assign(error, {
        terminal:
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status),
      });
      throw error;
    }

    return {
      url: current.toString(),
      contentType: response.headers['content-type'] || null,
      body: response.body,
    };
  }

  throw terminalError('RSS redirect limit exceeded');
}
