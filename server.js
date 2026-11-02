const https = require('node:https');
const { isIP } = require('node:net');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createServer } = require('node:http');
const { parse } = require('node-html-parser');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const resolverName = process.env.ADULT_FILTER_NAME || 'Cloudflare Family';
const resolverUrl = new URL(process.env.ADULT_FILTER_DOH_URL || 'https://family.cloudflare-dns.com/dns-query');
const invidiousOrigin = new URL(process.env.INVIDIOUS_INSTANCE_URL || 'https://invidious.tiekoetter.com');
const publicDir = resolve(__dirname, 'public');
const maxResponseBytes = 2 * 1024 * 1024;
const requestTimeoutMs = 12000;

if (resolverUrl.protocol !== 'https:' || resolverUrl.username || resolverUrl.password) {
  throw new Error('ADULT_FILTER_DOH_URL must be an HTTPS URL without embedded credentials.');
}
if (invidiousOrigin.protocol !== 'https:' || invidiousOrigin.username || invidiousOrigin.password || invidiousOrigin.pathname !== '/') {
  throw new Error('INVIDIOUS_INSTANCE_URL must be an HTTPS origin without a path or credentials.');
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

async function fetchInvidiousVideos(path) {
  const url = new URL(path, invidiousOrigin);
  let upstream;
  try {
    upstream = await fetch(url, {
      redirect: 'manual',
      headers: {
        accept: 'text/html',
        'user-agent': 'AnonWatcher/1.0 (+local video catalog)',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw createError('The Invidious instance could not be reached.', 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    throw createError('The Invidious instance redirected this catalog request.', 502);
  }
  if (!upstream.ok) throw createError(`The Invidious instance returned HTTP ${upstream.status}.`, 502);
  const html = await upstream.text();
  if (html.length > 3 * 1024 * 1024) throw createError('The Invidious results page is too large.', 502);

  const document = parse(html);
  const videos = [];
  for (const card of document.querySelectorAll('.pure-u-md-1-4')) {
    const watchLink = card.querySelector('a[href^="/watch?v="]');
    const href = watchLink?.getAttribute('href');
    if (!href) continue;
    const videoId = new URL(href, invidiousOrigin).searchParams.get('v') || '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;

    const imagePath = card.querySelector('img.thumbnail')?.getAttribute('src') || '';
    let thumbnail = '';
    try {
      const imageUrl = new URL(imagePath, invidiousOrigin);
      if (imageUrl.origin === invidiousOrigin.origin) thumbnail = imageUrl.toString();
    } catch {}

    const title = card.querySelector('.video-card-row a[href^="/watch?v="]')?.textContent.trim() || 'Untitled video';
    const author = card.querySelector('.channel-name')?.textContent.trim() || 'Unknown channel';
    const duration = card.querySelector('.length')?.textContent.trim() || '';
    const views = card.querySelector('.video-data')?.textContent.trim() || '';
    videos.push({ videoId, title, author, duration, views, thumbnail });
    if (videos.length >= 32) break;
  }
  return videos;
}

async function fetchInvidiousJson(path) {
  let upstream;
  try {
    upstream = await fetch(new URL(path, invidiousOrigin), {
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'user-agent': 'AnonWatcher/1.0 (+local video catalog)',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw createError('The Invidious instance could not be reached.', 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    throw createError('The Invidious instance redirected this catalog request.', 502);
  }
  if (!upstream.ok) throw createError(`The Invidious instance returned HTTP ${upstream.status}.`, 502);
  const body = await upstream.text();
  if (body.length > 3 * 1024 * 1024) throw createError('The Invidious results are too large.', 502);
  try {
    return JSON.parse(body);
  } catch {
    throw createError('The Invidious instance returned an invalid catalog response.', 502);
  }
}

function mapInvidiousVideo(video) {
  if (!video || typeof video !== 'object') return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId || '')) return null;
  let thumbnail = '';
  for (const candidate of Array.isArray(video.videoThumbnails) ? video.videoThumbnails : []) {
    try {
      const url = new URL(candidate.url, invidiousOrigin);
      if (url.protocol === 'https:' && url.origin === invidiousOrigin.origin) {
        thumbnail = url.toString();
        break;
      }
    } catch {}
  }
  const seconds = Number.isFinite(video.lengthSeconds) && video.lengthSeconds >= 0
    ? Math.floor(video.lengthSeconds)
    : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const duration = hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  return {
    videoId: video.videoId,
    title: typeof video.title === 'string' ? video.title : 'Untitled video',
    author: typeof video.author === 'string' ? video.author : 'Unknown channel',
    duration: video.lengthSeconds == null ? '' : duration,
    views: video.viewCountText || (Number.isFinite(video.viewCount)
      ? `${video.viewCount.toLocaleString()} views` : ''),
    thumbnail,
  };
}

function mapInvidiousPlaylist(playlist) {
  if (!playlist || typeof playlist !== 'object') return null;
  if (!/^[A-Za-z0-9_-]+$/.test(playlist.playlistId || '')) return null;
  let thumbnail = '';
  if (typeof playlist.playlistThumbnail === 'string') {
    try {
      const url = new URL(playlist.playlistThumbnail, invidiousOrigin);
      if (url.protocol === 'https:' && url.origin === invidiousOrigin.origin) thumbnail = url.toString();
    } catch {}
  }
  return {
    playlistId: playlist.playlistId,
    title: typeof playlist.title === 'string' ? playlist.title : 'Untitled playlist',
    author: typeof playlist.author === 'string' ? playlist.author : 'Unknown channel',
    videoCount: Number.isFinite(Number(playlist.videoCount)) ? Number(playlist.videoCount) : 0,
    thumbnail,
  };
}

const httpServer = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && requestUrl.pathname === '/api/videos') {
      const mode = requestUrl.searchParams.get('mode') || 'trending';
      let videos;
      let playlists = [];
      if (mode === 'search') {
        const query = (requestUrl.searchParams.get('q') || '').trim();
        if (!query || query.length > 160) throw createError('Enter a search under 160 characters.');
        const type = requestUrl.searchParams.get('type') || 'all';
        if (!['all', 'video', 'playlist'].includes(type)) {
          throw createError('Choose all results, videos, or playlists.');
        }
        const pageValue = requestUrl.searchParams.get('page') || '1';
        const page = Number(pageValue);
        if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(page) || page < 1 || page > 1000) {
          throw createError('Choose a valid search results page.');
        }
        const results = await fetchInvidiousJson(
          `/api/v1/search?q=${encodeURIComponent(query)}&type=${type}&page=${page}`,
        );
        if (!Array.isArray(results)) throw createError('The Invidious instance returned an invalid catalog response.', 502);
        videos = [];
        for (const result of results) {
          if (!result || typeof result !== 'object') continue;
          if (result.type === 'playlist') {
            const playlist = mapInvidiousPlaylist(result);
            if (playlist) playlists.push(playlist);
          } else if (result.type === 'video' || result.videoId) {
            const video = mapInvidiousVideo(result);
            if (video) videos.push(video);
          }
        }
        videos = videos.slice(0, 32);
        playlists = playlists.slice(0, 32);
      } else if (mode === 'trending') {
        const region = requestUrl.searchParams.get('region') || 'US';
        if (!/^[A-Z]{2}$/.test(region)) throw createError('Choose a valid two-letter region.');
        videos = await fetchInvidiousVideos(`/feed/trending?region=${encodeURIComponent(region)}`);
      } else {
        throw createError('Choose search or trending.', 400);
      }
      return sendJson(response, 200, { mode, videos, playlists, instance: invidiousOrigin.host });
    }
    const playlistMatch = requestUrl.pathname.match(/^\/api\/playlists\/([A-Za-z0-9_-]+)$/);
    if (request.method === 'GET' && playlistMatch) {
      const playlist = await fetchInvidiousJson(`/api/v1/playlists/${playlistMatch[1]}`);
      if (!playlist || typeof playlist !== 'object' || !Array.isArray(playlist.videos)) {
        throw createError('The Invidious instance returned an invalid playlist response.', 502);
      }
      const videos = playlist.videos.map(mapInvidiousVideo).filter(Boolean);
      return sendJson(response, 200, { videos, instance: invidiousOrigin.host });
    }
    if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' ${invidiousOrigin.origin}; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'`,
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
    return sendJson(response, error.status || (error instanceof SyntaxError ? 400 : 500), {
      error: error.message || 'The request could not be completed.',
    });
  }
});

httpServer.listen(port, host, () => {
  console.log(`Anon Watcher is ready at http://${host}:${port}`);
  console.log(`Search and trending from ${invidiousOrigin.host}; playback uses YouTube privacy-enhanced embeds.`);
});