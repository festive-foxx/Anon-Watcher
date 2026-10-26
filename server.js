const { createHash, timingSafeEqual } = require('node:crypto');
const https = require('node:https');
const { isIP } = require('node:net');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createServer } = require('node:http');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const username = process.env.PROXY_USERNAME || '';
const password = process.env.PROXY_PASSWORD || '';
const resolverName = process.env.ADULT_FILTER_NAME || 'Cloudflare Family';
const resolverUrl = new URL(process.env.ADULT_FILTER_DOH_URL || 'https://family.cloudflare-dns.com/dns-query');
const publicDir = resolve(__dirname, 'public');
const maxResponseBytes = 2 * 1024 * 1024;
const requestTimeoutMs = 12000;

if (!username || password.length < 16) {
  throw new Error('Set PROXY_USERNAME and a PROXY_PASSWORD with at least 16 characters before starting.');
}
if (resolverUrl.protocol !== 'https:' || resolverUrl.username || resolverUrl.password) {
  throw new Error('ADULT_FILTER_DOH_URL must be an HTTPS URL without embedded credentials.');
}

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function logAccess(event, destination, outcome, actor = username) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    event,
    user: actor,
    host: destination || null,
    outcome,
  }));
}

function matchesSecret(actual, expected) {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function isAuthorized(request) {
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization || '');
  if (!match) return false;
  let credentials;
  try {
    credentials = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = credentials.indexOf(':');
  if (separator < 0) return false;
  const usernameMatches = matchesSecret(credentials.slice(0, separator), username);
  const passwordMatches = matchesSecret(credentials.slice(separator + 1), password);
  return usernameMatches && passwordMatches;
}

function requireAuthorization(request, response) {
  if (isAuthorized(request)) return true;
  response.writeHead(401, {
    'www-authenticate': 'Basic realm="Anon Proxy", charset="UTF-8"',
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end('Authentication required');
  return false;
}

function isPublicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [first, second, third] = address.split('.').map(Number);
  return !(
    first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

async function queryFamilyDns(domain) {
  const queryUrl = new URL(resolverUrl);
  queryUrl.searchParams.set('name', domain);
  queryUrl.searchParams.set('type', 'A');
  let response;
  try {
    response = await fetch(queryUrl, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw createError('The content filter is unavailable; this request was blocked.', 503);
  }
  if (!response.ok) throw createError('The content filter is unavailable; this request was blocked.', 503);

  let result;
  try {
    result = await response.json();
  } catch {
    throw createError('The content filter returned an invalid response; this request was blocked.', 503);
  }
  if (result.Comment?.includes('Filtered')) {
    throw createError('This destination is blocked by the adult-content filter.', 403);
  }
  if (result.Status !== 0) {
    throw createError('This destination could not be verified by the content filter.', 403);
  }
  return result.Answer || [];
}

async function resolvePublicIpv4(domain, visited = new Set()) {
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, '');
  if (!normalizedDomain || isIP(normalizedDomain) || visited.has(normalizedDomain) || visited.size >= 8) {
    throw createError('This destination could not be verified safely.', 403);
  }
  visited.add(normalizedDomain);

  const answers = await queryFamilyDns(normalizedDomain);
  const addresses = answers.filter((answer) => answer.type === 1).map((answer) => answer.data);
  if (addresses.includes('0.0.0.0')) {
    throw createError('This destination is blocked by the adult-content filter.', 403);
  }
  if (addresses.some((address) => !isPublicIpv4(address))) {
    throw createError('This destination resolves to a non-public address and was blocked.', 403);
  }
  for (const answer of answers.filter((entry) => entry.type === 5)) {
    await resolvePublicIpv4(answer.data, visited);
  }
  if (addresses.length === 0) {
    throw createError('This destination has no verified public IPv4 address.', 403);
  }
  return addresses[0];
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw createError('Enter a valid web address.');
  }
  if (url.protocol !== 'https:') throw createError('Only HTTPS addresses are supported.');
  if (url.port && url.port !== '443') throw createError('Only the standard HTTPS port is supported.');
  if (url.username || url.password || isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw createError('Addresses containing credentials or IP addresses are not allowed.');
  }
  return url;
}

function requestPinned(url, address) {
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectRequest(error);
      else resolveRequest(result);
    };
    const request = https.request(url, {
      headers: {
        accept: 'text/html,text/plain,application/xhtml+xml',
        'accept-encoding': 'identity',
        'user-agent': 'AnonProxyReader/1.0',
      },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
    }, (response) => {
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          request.destroy(createError('This page is larger than the 2 MB reader limit.', 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        status: response.statusCode || 502,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('aborted', () => finish(createError('The destination closed the connection early.', 502)));
      response.on('error', (error) => finish(error));
    });
    timer = setTimeout(() => request.destroy(createError('The destination request timed out.', 504)), requestTimeoutMs);
    request.on('error', (error) => finish(error.status ? error : createError('The destination could not be reached.', 502)));
    request.end();
  });
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function toReadableText(content, contentType) {
  if (/html|xhtml/i.test(contentType)) {
    content = content
      .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/article|\/section|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
  }
  return decodeEntities(content).replace(/[\t\r ]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

async function readPage(address) {
  let currentUrl = validateUrl(address);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const address = await resolvePublicIpv4(currentUrl.hostname);
    const response = await requestPinned(currentUrl, address);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || redirects === 5) throw createError('The destination redirected too many times.', 502);
      currentUrl = validateUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw createError(`The destination returned HTTP ${response.status}.`, 502);
    }
    const contentType = response.headers['content-type'] || '';
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      throw createError('This reader supports HTML and plain-text pages only.', 415);
    }
    return {
      text: toReadableText(response.body, contentType),
      title: currentUrl.hostname,
      url: currentUrl.toString(),
    };
  }
  throw createError('The destination redirected too many times.', 502);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

const httpServer = createServer(async (request, response) => {
  if (!requireAuthorization(request, response)) {
    if (request.url === '/api/read') logAccess('read', null, 'unauthorized', null);
    return;
  }

  let destination = null;
  let isReadRequest = false;
  try {
    if (request.method === 'GET' && request.url === '/api/config') {
      return sendJson(response, 200, {
        filter: { name: resolverName, enabled: true },
        access: 'authenticated',
        maxResponseBytes,
      });
    }
    if (request.method === 'POST' && request.url === '/api/read') {
      isReadRequest = true;
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw createError('Request is too large.', 413);
      }
      const payload = JSON.parse(body);
      try {
        destination = new URL(payload.url).hostname;
      } catch {
        destination = null;
      }
      const page = await readPage(payload.url);
      logAccess('read', destination, 'allowed');
      return sendJson(response, 200, page);
    }
    if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      return response.end(await readFile(resolve(publicDir, 'index.html')));
    }
    const assets = {
      '/app.css': ['app.css', 'text/css; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    };
    if (request.method === 'GET' && assets[request.url]) {
      const [file, contentType] = assets[request.url];
      response.writeHead(200, { 'content-type': contentType, 'x-content-type-options': 'nosniff' });
      return response.end(await readFile(resolve(publicDir, file)));
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  } catch (error) {
    if (isReadRequest) logAccess('read', destination, error.status === 403 ? 'blocked' : 'error');
    return sendJson(response, error.status || (error instanceof SyntaxError ? 400 : 500), {
      error: error.message || 'The request could not be completed.',
    });
  }
});

httpServer.listen(port, host, () => {
  console.log(`Anon Proxy is ready at http://${host}:${port}`);
  console.log(`Adult-content filter: ${resolverName}`);
  console.log('Access logs include destination hostnames, but not URL paths or query strings.');
});