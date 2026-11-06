const https = require('node:https');
const { isIP } = require('node:net');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createServer } = require('node:http');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const resolverName = process.env.ADULT_FILTER_NAME || 'Cloudflare Family';
const resolverUrl = new URL(process.env.ADULT_FILTER_DOH_URL || 'https://family.cloudflare-dns.com/dns-query');
const invidiousOrigin = new URL(process.env.INVIDIOUS_INSTANCE_URL || 'https://yt.chocolatemoo53.com');
const invidiousRegion = (process.env.INVIDIOUS_REGION || 'US').toUpperCase();
const youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
const publicDir = resolve(__dirname, 'public');
const hlsJsPath = require.resolve('hls.js/dist/hls.min.js');
const maxResponseBytes = 2 * 1024 * 1024;
const requestTimeoutMs = 12000;

if (resolverUrl.protocol !== 'https:' || resolverUrl.username || resolverUrl.password) {
  throw new Error('ADULT_FILTER_DOH_URL must be an HTTPS URL without embedded credentials.');
}
if (invidiousOrigin.protocol !== 'https:' || invidiousOrigin.username || invidiousOrigin.password
  || invidiousOrigin.pathname !== '/' || invidiousOrigin.search || invidiousOrigin.hash) {
  throw new Error('INVIDIOUS_INSTANCE_URL must be an HTTPS origin without a path or credentials.');
}
if (!/^[A-Z]{2}$/.test(invidiousRegion)) {
  throw new Error('INVIDIOUS_REGION must be a two-letter country code.');
}

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
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

async function fetchApiJson(url, headers, serviceName) {
  let upstream;
  let fetchError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      upstream = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      break;
    } catch (error) {
      fetchError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!upstream) {
    console.error(`Unable to reach ${serviceName} at ${url.host}: ${fetchError?.cause?.code || fetchError?.name || 'network error'}`);
    throw createError(`The ${serviceName} service at ${url.host} could not be reached after retrying.`, 502);
  }
  const body = await upstream.text();
  if (body.length > 6 * 1024 * 1024) throw createError(`The ${serviceName} response is too large.`, 502);
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw createError(`The ${serviceName} service returned an invalid response.`, 502);
  }
  if (!upstream.ok) {
    const message = result.error?.message;
    throw createError(
      typeof message === 'string' ? message : `The ${serviceName} service returned HTTP ${upstream.status}.`,
      502,
    );
  }
  return result;
}

function youtubeApiUrl(resource, parameters) {
  if (!youtubeApiKey) {
    throw createError('YouTube search is not configured. Set YOUTUBE_API_KEY on the server.', 503);
  }
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set('key', youtubeApiKey);
  return url;
}

function validatePageToken(value) {
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createError('Choose a valid results page.');
  }
  return value;
}

function youtubeSearchItem(item) {
  const kind = item.id?.kind === 'youtube#playlist' ? 'playlist' : 'video';
  const id = kind === 'playlist' ? item.id?.playlistId : item.id?.videoId;
  const validId = kind === 'playlist'
    ? /^[A-Za-z0-9_-]{11,128}$/.test(id || '')
    : /^[A-Za-z0-9_-]{11}$/.test(id || '');
  if (!validId) return null;
  const thumbnails = item.snippet?.thumbnails || {};
  const thumbnail = thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || '';
  return {
    id,
    kind,
    title: typeof item.snippet?.title === 'string' ? item.snippet.title : 'Untitled',
    author: typeof item.snippet?.channelTitle === 'string' ? item.snippet.channelTitle : '',
    description: typeof item.snippet?.description === 'string' ? item.snippet.description : '',
    thumbnail: /^https:\/\/(?:i\.ytimg\.com|yt3\.ggpht\.com)\//.test(thumbnail) ? thumbnail : '',
  };
}

const httpServer = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && requestUrl.pathname === '/api/config') {
      return sendJson(response, 200, { searchConfigured: Boolean(youtubeApiKey) });
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/search') {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      if (!query || query.length > 160) throw createError('Enter a search under 160 characters.');
      const type = requestUrl.searchParams.get('type') || 'all';
      if (!['all', 'video', 'playlist'].includes(type)) {
        throw createError('Choose all results, videos, or playlists.');
      }
      const pageToken = validatePageToken(requestUrl.searchParams.get('pageToken') || '');
      const results = await fetchApiJson(youtubeApiUrl('search', {
        part: 'snippet',
        q: query,
        type: type === 'all' ? 'video,playlist' : type,
        maxResults: '20',
        pageToken,
      }), { accept: 'application/json' }, 'YouTube Data API');
      if (!Array.isArray(results.items)) {
        throw createError('YouTube returned an invalid search response.', 502);
      }
      return sendJson(response, 200, {
        items: results.items.map(youtubeSearchItem).filter(Boolean),
        nextPageToken: validatePageToken(results.nextPageToken || ''),
      });
    }
    const playlistMatch = requestUrl.pathname.match(/^\/api\/playlists\/([A-Za-z0-9_-]{11,128})$/);
    if (request.method === 'GET' && playlistMatch) {
      const pageToken = validatePageToken(requestUrl.searchParams.get('pageToken') || '');
      const results = await fetchApiJson(youtubeApiUrl('playlistItems', {
        part: 'snippet,contentDetails',
        playlistId: playlistMatch[1],
        maxResults: '50',
        pageToken,
      }), { accept: 'application/json' }, 'YouTube Data API');
      if (!Array.isArray(results.items)) {
        throw createError('YouTube returned an invalid playlist response.', 502);
      }
      const items = results.items.map((item) => {
        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return null;
        return youtubeSearchItem({
          id: { kind: 'youtube#video', videoId },
          snippet: item.snippet,
        });
      }).filter(Boolean);
      return sendJson(response, 200, {
        items,
        nextPageToken: validatePageToken(results.nextPageToken || ''),
      });
    }
    const videoMatch = requestUrl.pathname.match(/^\/api\/videos\/([A-Za-z0-9_-]{11})\/stream$/);
    if (request.method === 'GET' && videoMatch) {
      const detailsUrl = new URL(`/api/v1/videos/${videoMatch[1]}`, invidiousOrigin);
      detailsUrl.searchParams.set('region', invidiousRegion);
      const details = await fetchApiJson(detailsUrl, { accept: 'application/json' }, 'video stream');
      const streams = (Array.isArray(details.formatStreams) ? details.formatStreams : []).flatMap((stream) => {
        if (!stream || typeof stream.url !== 'string'
          || !(stream.type || '').toLowerCase().startsWith('video/mp4')) return [];
        try {
          const url = new URL(stream.url);
          if (url.protocol !== 'https:' || url.username || url.password) return [];
          const height = Number.parseInt(stream.qualityLabel || '', 10) || 0;
          return [{ url: url.toString(), quality: stream.qualityLabel || '', height }];
        } catch {
          return [];
        }
      }).sort((a, b) => b.height - a.height);
      let stream;
      if (streams.length) {
        stream = { url: streams[0].url, type: 'mp4', quality: streams[0].quality };
      } else {
        try {
          const hlsUrl = new URL(details.hlsUrl);
          if (hlsUrl.protocol === 'https:' && !hlsUrl.username && !hlsUrl.password) {
            stream = { url: hlsUrl.toString(), type: 'hls', quality: '' };
          }
        } catch {
          throw createError('The selected video has no browser-compatible stream available.', 404);
        }
      }
      if (!stream) throw createError('The selected video has no browser-compatible stream available.', 404);
      return sendJson(response, 200, {
        ...stream,
        title: typeof details.title === 'string' ? details.title : '',
      });
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https:; img-src 'self' https://i.ytimg.com https://yt3.ggpht.com; media-src 'self' https: blob:; frame-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      return response.end(await readFile(resolve(publicDir, 'index.html')));
    }
    const assets = {
      '/app.css': ['app.css', 'text/css; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    };
    if (request.method === 'GET' && requestUrl.pathname === '/vendor/hls.min.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=86400',
      });
      return response.end(await readFile(hlsJsPath));
    }
    if (request.method === 'GET' && assets[requestUrl.pathname]) {
      const [file, contentType] = assets[requestUrl.pathname];
      response.writeHead(200, { 'content-type': contentType, 'x-content-type-options': 'nosniff' });
      return response.end(await readFile(resolve(publicDir, file)));
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  } catch (error) {
    return sendJson(response, error.status || (error instanceof SyntaxError ? 400 : 500), {
      error: error.message || 'The request could not be completed.',
    });
  }
});

httpServer.listen(port, host, () => {
  console.log(`Anon Watcher is ready at http://${host}:${port}`);
  console.log(`YouTube search ${youtubeApiKey ? 'is configured' : 'needs YOUTUBE_API_KEY'}; streams use ${invidiousOrigin.host}.`);
});