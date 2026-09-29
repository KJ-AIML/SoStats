import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';

type ResolvedAddress = { address: string; family: 4 | 6 };

export class KnowledgeFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'KnowledgeFetchError';
  }
}

export function isPublicKnowledgeAddress(value: string) {
  if (isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
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

async function resolvePublic(url: URL): Promise<ResolvedAddress> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new KnowledgeFetchError('Knowledge URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new KnowledgeFetchError(
      'Knowledge URL cannot contain embedded credentials',
    );
  }

  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw new KnowledgeFetchError(
      'Knowledge URL must use the standard HTTP or HTTPS port',
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new KnowledgeFetchError('Knowledge URL host is not publicly routable');
  }

  if (isIP(hostname)) {
    if (!isPublicKnowledgeAddress(hostname)) {
      throw new KnowledgeFetchError(
        'Knowledge URL address is not publicly routable',
      );
    }
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicKnowledgeAddress(entry.address))
  ) {
    throw new KnowledgeFetchError(
      'Knowledge URL resolved to a non-public address',
    );
  }

  return {
    address: addresses[0].address,
    family: addresses[0].family as 4 | 6,
  };
}

function requestBytes(
  url: URL,
  resolved: ResolvedAddress,
  maxBytes: number,
  timeoutMs: number,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
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
            'text/html, application/xhtml+xml, text/plain, application/pdf;q=0.95',
          'accept-encoding': 'identity',
          'user-agent': 'SoStats-Knowledge/1.0',
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (response) => {
        const declaredLength = Number(response.headers['content-length'] || 0);
        if (declaredLength > maxBytes) {
          request.destroy(
            new KnowledgeFetchError(
              'Knowledge source exceeded the download size limit',
            ),
          );
          return;
        }

        const encoding = String(
          response.headers['content-encoding'] || 'identity',
        ).toLowerCase();
        if (encoding !== 'identity') {
          request.destroy(
            new KnowledgeFetchError(
              'Knowledge source returned an unsupported content encoding',
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            request.destroy(
              new KnowledgeFetchError(
                'Knowledge source exceeded the download size limit',
              ),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });

        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new KnowledgeFetchError('Knowledge source timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

export async function fetchPublicKnowledgeUrl(
  input: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
  } = {},
) {
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;
  const timeoutMs = options.timeoutMs || 12_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current: URL;

  try {
    current = new URL(input);
  } catch {
    throw new KnowledgeFetchError('Knowledge URL is invalid');
  }

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const resolved = await resolvePublic(current);
    const response = await requestBytes(
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
        throw new KnowledgeFetchError('Knowledge URL redirect limit exceeded');
      }
      current = new URL(response.headers.location, current);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new KnowledgeFetchError(
        `Knowledge source returned HTTP ${response.status}`,
        response.status,
      );
    }

    let contentType = String(
      response.headers['content-type'] || 'application/octet-stream',
    )
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    if (
      contentType === 'application/octet-stream' &&
      response.body.subarray(0, 5).toString('ascii') === '%PDF-'
    ) {
      contentType = 'application/pdf';
    }

    const supported =
      contentType === 'application/pdf' ||
      contentType === 'text/html' ||
      contentType === 'application/xhtml+xml' ||
      contentType.startsWith('text/');

    if (!supported) {
      throw new KnowledgeFetchError(
        `Unsupported knowledge content type: ${contentType}`,
      );
    }

    return {
      url: current.toString(),
      contentType,
      body: response.body,
    };
  }

  throw new KnowledgeFetchError('Knowledge URL redirect limit exceeded');
}
