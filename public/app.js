const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const searchType = document.querySelector('#search-type');
const searchStatus = document.querySelector('#search-status');
const resultsTitle = document.querySelector('#results-title');
const searchResults = document.querySelector('#search-results');
const nextPageButton = document.querySelector('#next-page-button');
const playlistControls = document.querySelector('#playlist-controls');
const playPlaylistButton = document.querySelector('#play-playlist-button');
const player = document.querySelector('#media-player');
const youtubePlayer = document.querySelector('#youtube-player');
const emptyPlayer = document.querySelector('#empty-player');
const playerBar = document.querySelector('#player-bar');
const videoLabel = document.querySelector('#video-label');
const sourceLabel = document.querySelector('#source-label');
const shareButton = document.querySelector('#share-button');
const loopPlaylistButton = document.querySelector('#loop-playlist-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
let currentMediaUrl = '';
let currentVideoId = '';
let currentPlaylistId = '';
let playlistLoopEnabled = false;
let hlsPlayer = null;
let cancelHlsStartup = null;
let searchRequestId = 0;
let playbackRequestId = 0;
let nextPageToken = '';
let resultMode = 'search';
let resultQuery = '';
let resultType = 'all';
let resultPlaylistId = '';

function parseYouTubeVideoId(value) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const youtubeHosts = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
  ]);
  if (!youtubeHosts.has(hostname)) return null;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) YouTube link without embedded credentials.');
  }

  const videoId = hostname.endsWith('youtu.be')
    ? url.pathname.split('/').filter(Boolean)[0]
    : url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
  throw new Error('Enter a valid YouTube video link or 11-character video ID.');
}

function parseMediaUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete direct media URL, including https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) media URL without embedded credentials.');
  }
  if (window.location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('Use an HTTPS media URL on this secure page.');
  }
  return url;
}

async function requestJson(path) {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  let result;
  try {
    result = await response.json();
  } catch {
    if (window.location.hostname === 'festive-foxx.github.io') {
      throw new Error('YouTube search requires the Anon Watcher server; GitHub Pages is static.');
    }
    throw new Error('The Anon Watcher server returned an invalid response.');
  }
  if (!response.ok) throw new Error(result.error || `The server returned HTTP ${response.status}.`);
  return result;
}

function makeResultCard(item) {
  const card = document.createElement('article');
  card.className = 'search-card';
  const openItem = item.kind === 'playlist'
    ? () => browsePlaylist(item.id, item.title)
    : () => playVideo(item.id, item.title);
  const thumbnail = document.createElement('button');
  thumbnail.className = 'result-thumb';
  thumbnail.type = 'button';
  thumbnail.setAttribute('aria-label', `${item.kind === 'playlist' ? 'Open playlist' : 'Watch'}: ${item.title}`);
  if (item.thumbnail) {
    const image = document.createElement('img');
    image.src = item.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    thumbnail.append(image);
  }
  const kind = document.createElement('span');
  kind.className = 'result-kind';
  kind.textContent = item.kind;
  thumbnail.append(kind);
  thumbnail.addEventListener('click', openItem);

  const title = document.createElement('button');
  title.className = 'result-title';
  title.type = 'button';
  title.textContent = item.title;
  title.addEventListener('click', openItem);
  const author = document.createElement('p');
  author.className = 'result-author';
  author.textContent = item.author;
  card.append(thumbnail, title, author);

  if (item.kind === 'playlist') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'result-action';
    action.textContent = 'Browse playlist';
    action.addEventListener('click', openItem);
    card.append(action);
  } else {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'result-action';
    action.textContent = 'Watch video';
    action.addEventListener('click', openItem);
    card.append(action);
  }
  return card;
}

function renderResults(items, append) {
  if (!append) searchResults.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of items) fragment.append(makeResultCard(item));
  searchResults.append(fragment);
}

async function loadResultPage(pageToken = '', append = false) {
  const requestId = ++searchRequestId;
  nextPageButton.disabled = true;
  searchStatus.textContent = 'Loading…';
  if (!append) {
    searchResults.replaceChildren();
    nextPageButton.hidden = true;
  }
  const parameters = new URLSearchParams({ pageToken });
  const endpoint = resultMode === 'playlist'
    ? `/api/playlists/${encodeURIComponent(resultPlaylistId)}?${parameters}`
    : (() => {
      parameters.set('q', resultQuery);
      parameters.set('type', resultType);
      return `/api/search?${parameters}`;
    })();

  try {
    const result = await requestJson(endpoint);
    if (requestId !== searchRequestId) return;
    renderResults(result.items, append);
    nextPageToken = result.nextPageToken || '';
    nextPageButton.hidden = !nextPageToken;
    searchStatus.textContent = result.items.length
      ? `${searchResults.children.length} result${searchResults.children.length === 1 ? '' : 's'}`
      : 'No results found.';
  } catch (error) {
    if (requestId !== searchRequestId) return;
    searchStatus.textContent = error.message;
    nextPageButton.hidden = true;
  } finally {
    if (requestId === searchRequestId) nextPageButton.disabled = false;
  }
}

function startSearch(query, type = searchType.value, updateAddress = true) {
  const trimmed = query.trim();
  if (!trimmed) {
    searchInput.focus();
    return;
  }
  if (trimmed.length > 160) {
    searchStatus.textContent = 'Search terms must be 160 characters or fewer.';
    return;
  }
  resultMode = 'search';
  resultQuery = trimmed;
  resultType = type;
  resultPlaylistId = '';
  playlistControls.hidden = true;
  resultsTitle.textContent = `Results for “${trimmed}”`;
  searchInput.value = trimmed;
  searchType.value = type;
  loadResultPage();
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('q', trimmed);
    if (type !== 'all') shareUrl.searchParams.set('type', type);
    window.history.replaceState({}, '', shareUrl);
  }
}

function browsePlaylist(playlistId, title, updateAddress = true) {
  resultMode = 'playlist';
  resultQuery = '';
  resultPlaylistId = playlistId;
  playlistControls.hidden = false;
  resultsTitle.textContent = title;
  searchStatus.textContent = 'Loading playlist…';
  loadResultPage();
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('list', playlistId);
    window.history.replaceState({}, '', shareUrl);
  }
}

function stopDirectPlayback() {
  if (hlsPlayer) {
    if (cancelHlsStartup) cancelHlsStartup(new Error('Playback was replaced.'));
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  player.pause();
  player.removeAttribute('src');
  player.load();
}

function showMedia(url, title = '', updateAddress = true, mediaType = 'mp4') {
  stopDirectPlayback();
  youtubePlayer.src = 'about:blank';
  youtubePlayer.hidden = true;
  player.hidden = false;
  currentMediaUrl = url.toString();
  currentVideoId = '';
  currentPlaylistId = '';
  loopPlaylistButton.hidden = true;
  input.value = currentMediaUrl;
  videoLabel.textContent = title || url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  sourceLabel.textContent = url.hostname;
  message.textContent = '';
  emptyPlayer.hidden = true;
  playerBar.hidden = false;
  shareButton.disabled = false;
  const isHls = mediaType === 'hls' || /\.m3u8$/i.test(url.pathname);
  let mediaReady = Promise.resolve();
  if (isHls && window.Hls?.isSupported()) {
    hlsPlayer = new window.Hls();
    const activeHlsPlayer = hlsPlayer;
    mediaReady = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        fail(new Error('Timed out while loading the HLS stream.'));
      }, 20000);
      const onManifestParsed = () => finish(resolve);
      const onError = (_event, data) => {
        if (data.fatal) {
          fail(new Error('The HLS stream could not be loaded. Check the URL or try another browser.'));
        }
      };
      const finish = (callback, value) => {
        window.clearTimeout(timeoutId);
        activeHlsPlayer.off(window.Hls.Events.MANIFEST_PARSED, onManifestParsed);
        activeHlsPlayer.off(window.Hls.Events.ERROR, onError);
        if (cancelHlsStartup === cancel) cancelHlsStartup = null;
        callback(value);
      };
      const fail = (error) => {
        finish(reject, error);
        if (hlsPlayer === activeHlsPlayer) {
          activeHlsPlayer.destroy();
          hlsPlayer = null;
        }
      };
      const cancel = (error) => finish(reject, error);
      cancelHlsStartup = cancel;
      activeHlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, onManifestParsed);
      activeHlsPlayer.on(window.Hls.Events.ERROR, onError);
    });
    activeHlsPlayer.loadSource(currentMediaUrl);
    activeHlsPlayer.attachMedia(player);
  } else if (isHls && !player.canPlayType('application/vnd.apple.mpegurl')) {
    throw new Error('This browser does not support HLS playback.');
  } else {
    player.src = currentMediaUrl;
    player.load();
  }

  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('video', currentMediaUrl);
    window.history.replaceState({}, '', shareUrl);
  }
  return mediaReady;
}

function showYouTubeVideo(videoId, title = '', updateAddress = true) {
  stopDirectPlayback();
  currentVideoId = videoId;
  currentPlaylistId = '';
  loopPlaylistButton.hidden = true;
  currentMediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
  input.value = currentMediaUrl;
  videoLabel.textContent = title || 'YouTube video';
  sourceLabel.textContent = 'YOUTUBE · PRIVACY-ENHANCED EMBED';
  message.textContent = '';
  emptyPlayer.hidden = true;
  player.hidden = true;
  youtubePlayer.hidden = false;
  youtubePlayer.title = videoLabel.textContent;
  youtubePlayer.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&controls=1&playsinline=1&rel=0`;
  playerBar.hidden = false;
  shareButton.disabled = false;

  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('yt', videoId);
    window.history.replaceState({}, '', shareUrl);
  }
}

function playPlaylist(playlistId, title = '', updateAddress = true, scrollToPlayer = true) {
  playbackRequestId += 1;
  stopDirectPlayback();
  currentVideoId = '';
  currentPlaylistId = playlistId;
  currentMediaUrl = '';
  input.value = '';
  videoLabel.textContent = title || 'YouTube playlist';
  sourceLabel.textContent = 'YOUTUBE · PLAYLIST';
  message.textContent = '';
  emptyPlayer.hidden = true;
  player.hidden = true;
  youtubePlayer.hidden = false;
  youtubePlayer.title = videoLabel.textContent;
  const parameters = new URLSearchParams({
    list: playlistId,
    autoplay: '1',
    controls: '1',
    playsinline: '1',
    rel: '0',
  });
  if (playlistLoopEnabled) parameters.set('loop', '1');
  youtubePlayer.src = `https://www.youtube-nocookie.com/embed/videoseries?${parameters}`;
  playerBar.hidden = false;
  shareButton.disabled = false;
  loopPlaylistButton.hidden = false;
  loopPlaylistButton.setAttribute('aria-pressed', String(playlistLoopEnabled));

  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('list', playlistId);
    window.history.replaceState({}, '', shareUrl);
  }
  if (scrollToPlayer) {
    document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function playVideo(videoId, title = '', updateAddress = true) {
  playbackRequestId += 1;
  showYouTubeVideo(videoId, title, updateAddress);
  document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearMedia(updateAddress = true) {
  playbackRequestId += 1;
  stopDirectPlayback();
  youtubePlayer.src = 'about:blank';
  youtubePlayer.hidden = true;
  player.hidden = false;
  currentMediaUrl = '';
  currentVideoId = '';
  currentPlaylistId = '';
  loopPlaylistButton.hidden = true;
  input.value = '';
  videoLabel.textContent = 'Open a video';
  sourceLabel.textContent = 'DIRECT MEDIA';
  emptyPlayer.hidden = false;
  playerBar.hidden = true;
  shareButton.disabled = true;
  message.textContent = '';
  if (updateAddress) window.history.replaceState({}, '', window.location.pathname);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const requestId = ++playbackRequestId;
  try {
    const videoId = parseYouTubeVideoId(input.value);
    if (videoId) {
      playVideo(videoId);
      return;
    }

    await showMedia(parseMediaUrl(input.value));
    if (requestId !== playbackRequestId) return;
    try {
      await player.play();
      message.textContent = '';
    } catch (error) {
      if (requestId !== playbackRequestId) return;
      if (error.name === 'NotAllowedError') {
        message.textContent = 'Media loaded. Press play to start.';
      } else if (error.name !== 'AbortError') {
        message.textContent = `Playback could not start: ${error.message}`;
      }
    }
  } catch (error) {
    if (requestId === playbackRequestId) {
      message.textContent = error.message;
      input.focus();
    }
  }
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  startSearch(searchInput.value, searchType.value);
});
nextPageButton.addEventListener('click', () => {
  if (!nextPageToken || nextPageButton.disabled) return;
  loadResultPage(nextPageToken, true);
});
playPlaylistButton.addEventListener('click', () => {
  if (resultPlaylistId) playPlaylist(resultPlaylistId, resultsTitle.textContent);
});
loopPlaylistButton.addEventListener('click', () => {
  if (!currentPlaylistId) return;
  playlistLoopEnabled = !playlistLoopEnabled;
  loopPlaylistButton.setAttribute('aria-pressed', String(playlistLoopEnabled));
  const playlistId = currentPlaylistId;
  const title = videoLabel.textContent;
  playPlaylist(playlistId, title, false, false);
  message.textContent = playlistLoopEnabled
    ? 'Loop enabled; the playlist restarted.'
    : 'Loop disabled; the playlist restarted.';
});

player.addEventListener('error', () => {
  if (currentMediaUrl && !currentVideoId) {
    message.textContent = 'The media could not be played. Check the URL, access permissions, format, and browser support.';
  }
});

shareButton.addEventListener('click', async () => {
  if (!currentMediaUrl && !currentVideoId && !currentPlaylistId) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  if (currentPlaylistId) shareUrl.searchParams.set('list', currentPlaylistId);
  else if (currentVideoId) shareUrl.searchParams.set('yt', currentVideoId);
  else shareUrl.searchParams.set('video', currentMediaUrl);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    message.textContent = currentPlaylistId
      ? 'Playlist link copied.'
      : currentVideoId
        ? 'Share link copied.'
        : 'Share link copied. It contains the full media URL.';
  } catch (error) {
    message.textContent = `Could not copy the share link: ${error.message}`;
  }
});

clearButton.addEventListener('click', () => clearMedia());

const parameters = new URLSearchParams(window.location.search);
const initialVideo = parameters.get('yt');
const initialMedia = parameters.get('video');
const initialPlaylist = parameters.get('list');
const initialQuery = parameters.get('q');
if (initialVideo) {
  try {
    const videoId = parseYouTubeVideoId(initialVideo);
    if (videoId) playVideo(videoId, '', false);
  } catch (error) {
    message.textContent = error.message;
  }
} else if (initialMedia) {
  input.value = initialMedia;
  try {
    const videoId = parseYouTubeVideoId(initialMedia);
    if (videoId) {
      playVideo(videoId, '', false);
    } else {
      void showMedia(parseMediaUrl(initialMedia), '', false).catch((error) => {
        message.textContent = error.message;
      });
    }
  } catch (error) {
    message.textContent = error.message;
  }
}
if (initialPlaylist && /^[A-Za-z0-9_-]{11,128}$/.test(initialPlaylist)) {
  browsePlaylist(initialPlaylist, 'Playlist', false);
} else if (initialQuery) {
  const initialType = ['all', 'video', 'playlist'].includes(parameters.get('type'))
    ? parameters.get('type')
    : 'all';
  startSearch(initialQuery, initialType, false);
}

requestJson('/api/config').then((config) => {
  if (!config.searchConfigured && !initialQuery && !initialPlaylist) {
    searchStatus.textContent = 'Set YOUTUBE_API_KEY on the server to enable YouTube search.';
  }
}).catch(() => {
  if (window.location.hostname === 'festive-foxx.github.io') {
    searchStatus.textContent = 'YouTube search requires the Anon Watcher server; GitHub Pages is static.';
  }
});
