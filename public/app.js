const form = document.querySelector('#unified-form');
const input = document.querySelector('#unified-input');
const searchType = document.querySelector('#search-type');
const resultsPanel = document.querySelector('#results-panel');
const searchStatus = document.querySelector('#search-status');
const resultsTitle = document.querySelector('#results-title');
const searchResults = document.querySelector('#search-results');
const nextPageButton = document.querySelector('#next-page-button');
const playlistControls = document.querySelector('#playlist-controls');
const playPlaylistButton = document.querySelector('#play-playlist-button');
const player = document.querySelector('#media-player');
let youtubePlayer = document.querySelector('#youtube-player');
const emptyPlayer = document.querySelector('#empty-player');
const playerBar = document.querySelector('#player-bar');
const videoLabel = document.querySelector('#video-label');
const sourceLabel = document.querySelector('#source-label');
const shareButton = document.querySelector('#share-button');
const favoriteButton = document.querySelector('#favorite-button');
const theaterButton = document.querySelector('#theater-button');
const loopPlaylistButton = document.querySelector('#loop-playlist-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
const libraryDrawer = document.querySelector('#library-drawer');
const libraryButton = document.querySelector('#library-button');
const drawerBackdrop = document.querySelector('#drawer-backdrop');
const settingsDialog = document.querySelector('#settings-dialog');
const apiKeyInput = document.querySelector('#api-key-input');
const settingsStatus = document.querySelector('#settings-status');
const HISTORY_KEY = 'anon-watcher-history';
const SAVED_KEY = 'anon-watcher-saved';
const API_KEY = 'anon-watcher-youtube-api-key';
let currentMediaUrl = '';
let currentVideoId = '';
let currentPlaylistId = '';
let currentTitle = '';
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
let youtubeApiPlayer = null;
let youtubePlaybackState = -1;

function setMessage(text) {
  message.textContent = text;
}

function readLocalList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
  } catch (error) {
    setMessage(`Could not read local data: ${error.message}`);
    return [];
  }
}

function writeLocalList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    setMessage(`Could not save local data: ${error.message}`);
    return false;
  }
}

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
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtu.be', 'www.youtu.be',
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
  if (!videoId && /^[A-Za-z0-9_-]{11,128}$/.test(url.searchParams.get('list') || '')) return null;
  throw new Error('Enter a valid YouTube video link or 11-character video ID.');
}

function parseYouTubePlaylistId(value) {
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase())) return null;
  const playlistId = url.searchParams.get('list');
  return playlistId && /^[A-Za-z0-9_-]{11,128}$/.test(playlistId) ? playlistId : null;
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
  if (!/\.(?:mp4|m3u8)$/i.test(url.pathname)) {
    throw new Error('Direct playback supports MP4 and HLS (.m3u8) URLs.');
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
  if (!response.ok) {
    const error = new Error(result.error || `The server returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function normalizeApiItem(item) {
  const kind = item.id?.kind === 'youtube#playlist' || item.id?.playlistId ? 'playlist' : 'video';
  const id = kind === 'playlist' ? item.id?.playlistId : item.id?.videoId;
  if (kind === 'playlist' ? !/^[A-Za-z0-9_-]{11,128}$/.test(id || '') : !/^[A-Za-z0-9_-]{11}$/.test(id || '')) {
    return null;
  }
  const thumbnails = item.snippet?.thumbnails || {};
  const thumbnail = thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || '';
  return {
    id,
    kind,
    title: typeof item.snippet?.title === 'string' ? item.snippet.title : 'Untitled',
    author: typeof item.snippet?.channelTitle === 'string' ? item.snippet.channelTitle : '',
    thumbnail: /^https:\/\/(?:i\.ytimg\.com|yt3\.ggpht\.com)\//.test(thumbnail) ? thumbnail : '',
  };
}

async function requestWithLocalApiFallback(endpoint, fallbackResource, parameters) {
  try {
    return await requestJson(endpoint);
  } catch (serverError) {
    let apiKey = '';
    try {
      apiKey = localStorage.getItem(API_KEY) || '';
    } catch (error) {
      throw new Error(`Search failed, and the saved API key could not be read: ${error.message}`);
    }
    if (!apiKey) throw serverError;
    const url = new URL(`https://www.googleapis.com/youtube/v3/${fallbackResource}`);
    for (const [key, value] of Object.entries(parameters)) {
      if (value) url.searchParams.set(key, value);
    }
    url.searchParams.set('key', apiKey);
    let response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (error) {
      throw new Error(`Server search failed (${serverError.message}); the local API key request also failed: ${error.message}`);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error?.message || `YouTube Data API returned HTTP ${response.status}.`);
    }
    if (!Array.isArray(result?.items)) throw new Error('YouTube returned an invalid search response.');
    const items = fallbackResource === 'playlistItems'
      ? result.items.map((item) => {
        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return null;
        return normalizeApiItem({ id: { kind: 'youtube#video', videoId }, snippet: item.snippet });
      }).filter(Boolean)
      : result.items.map(normalizeApiItem).filter(Boolean);
    return { items, nextPageToken: result.nextPageToken || '' };
  }
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
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'result-action';
  action.textContent = item.kind === 'playlist' ? 'Browse playlist' : 'Watch video';
  action.addEventListener('click', openItem);
  card.append(action);
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
    const fallbackParameters = resultMode === 'playlist'
      ? { part: 'snippet,contentDetails', playlistId: resultPlaylistId, maxResults: '50', pageToken }
      : {
        part: 'snippet', q: resultQuery,
        type: resultType === 'all' ? 'video,playlist' : resultType,
        maxResults: '20', pageToken,
      };
    const result = await requestWithLocalApiFallback(
      endpoint,
      resultMode === 'playlist' ? 'playlistItems' : 'search',
      fallbackParameters,
    );
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
  if (!trimmed) return;
  if (trimmed.length > 160) {
    resultsPanel.hidden = false;
    searchStatus.textContent = 'Search terms must be 160 characters or fewer.';
    return;
  }
  resultsPanel.hidden = false;
  resultMode = 'search';
  resultQuery = trimmed;
  resultType = type;
  resultPlaylistId = '';
  playlistControls.hidden = true;
  resultsTitle.textContent = `Results for “${trimmed}”`;
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
  resultsPanel.hidden = false;
  resultMode = 'playlist';
  resultQuery = '';
  resultPlaylistId = playlistId;
  playlistControls.hidden = false;
  resultsTitle.textContent = title;
  loadResultPage();
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('list', playlistId);
    window.history.replaceState({}, '', shareUrl);
  }
}

function currentEntry() {
  if (currentPlaylistId) return { kind: 'playlist', id: currentPlaylistId, title: currentTitle };
  if (currentVideoId) return { kind: 'video', id: currentVideoId, title: currentTitle };
  if (currentMediaUrl) return { kind: 'media', url: currentMediaUrl, title: currentTitle };
  return null;
}

function recordPlayback() {
  const entry = currentEntry();
  if (!entry) return;
  const key = entry.kind === 'media' ? entry.url : `${entry.kind}:${entry.id}`;
  const history = readLocalList(HISTORY_KEY).filter((item) => item.key !== key);
  history.unshift({ ...entry, key, playedAt: Date.now() });
  writeLocalList(HISTORY_KEY, history.slice(0, 50));
  renderLibrary();
}

function isSaved(entry) {
  const key = entry.kind === 'media' ? entry.url : `${entry.kind}:${entry.id}`;
  return readLocalList(SAVED_KEY).some((item) => item.key === key);
}

function updateFavoriteButton() {
  const entry = currentEntry();
  favoriteButton.disabled = !entry;
  favoriteButton.setAttribute('aria-pressed', String(entry ? isSaved(entry) : false));
  favoriteButton.textContent = entry && isSaved(entry) ? 'Saved' : 'Save';
}

function renderLibraryList(container, entries, saved) {
  container.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = saved ? 'Nothing saved yet.' : 'No watch history yet.';
    container.append(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'library-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'library-entry';
    open.textContent = entry.title || entry.id || entry.url;
    open.addEventListener('click', () => {
      closeLibrary();
      if (entry.kind === 'video') playVideo(entry.id, entry.title);
      else if (entry.kind === 'playlist') playPlaylist(entry.id, entry.title);
      else if (entry.kind === 'media') playMedia(entry.url, entry.title, true);
    });
    row.append(open);
    if (saved) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'library-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${entry.title || 'saved item'}`);
      remove.addEventListener('click', () => {
        writeLocalList(SAVED_KEY, readLocalList(SAVED_KEY).filter((item) => item.key !== entry.key));
        renderLibrary();
        updateFavoriteButton();
      });
      row.append(remove);
    }
    container.append(row);
  }
}

function renderLibrary() {
  renderLibraryList(document.querySelector('#saved-items'), readLocalList(SAVED_KEY), true);
  renderLibraryList(document.querySelector('#history-items'), readLocalList(HISTORY_KEY), false);
}

function openLibrary() {
  renderLibrary();
  libraryDrawer.hidden = false;
  drawerBackdrop.hidden = false;
  libraryButton.setAttribute('aria-expanded', 'true');
}

function closeLibrary() {
  libraryDrawer.hidden = true;
  drawerBackdrop.hidden = true;
  libraryButton.setAttribute('aria-expanded', 'false');
}

function updateAddress(parameter, value) {
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  if (value) shareUrl.searchParams.set(parameter, value);
  window.history.replaceState({}, '', shareUrl);
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

function playMedia(address, title = '', updateUrl = true) {
  const url = parseMediaUrl(address);
  const requestId = ++playbackRequestId;
  const mediaReady = showMedia(url, title, updateUrl);
  void mediaReady.then(async () => {
    if (requestId !== playbackRequestId) return;
    try {
      await player.play();
      setMessage('');
    } catch (error) {
      if (requestId !== playbackRequestId) return;
      if (error.name === 'NotAllowedError') setMessage('Media loaded. Press play to start.');
      else if (error.name !== 'AbortError') setMessage(`Playback could not start: ${error.message}`);
    }
  }).catch((error) => {
    if (requestId === playbackRequestId) setMessage(error.message);
  });
}

function showMedia(url, title = '', updateUrl = true, mediaType = 'mp4') {
  stopDirectPlayback();
  if (youtubeApiPlayer) youtubeApiPlayer.stopVideo();
  if (!youtubeApiPlayer) youtubePlayer.src = 'about:blank';
  youtubePlayer.hidden = true;
  player.hidden = false;
  currentMediaUrl = url.toString();
  currentVideoId = '';
  currentPlaylistId = '';
  currentTitle = title || url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  loopPlaylistButton.hidden = true;
  videoLabel.textContent = currentTitle;
  sourceLabel.textContent = url.hostname;
  setMessage('');
  emptyPlayer.hidden = true;
  playerBar.hidden = false;
  shareButton.disabled = false;
  updateFavoriteButton();
  const isHls = mediaType === 'hls' || /\.m3u8$/i.test(url.pathname);
  let mediaReady = Promise.resolve();
  if (isHls && window.Hls?.isSupported()) {
    hlsPlayer = new window.Hls();
    const activeHlsPlayer = hlsPlayer;
    mediaReady = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => fail(new Error('Timed out while loading the HLS stream.')), 20000);
      const onManifestParsed = () => finish(resolve);
      const onError = (_event, data) => {
        if (data.fatal) fail(new Error('The HLS stream could not be loaded. Check the URL or try another browser.'));
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
  if (updateUrl) updateAddress('url', currentMediaUrl);
  recordPlayback();
  return mediaReady;
}

function initializeYoutubeApiPlayer() {
  if (!window.YT?.Player || youtubeApiPlayer || (!currentVideoId && !currentPlaylistId)) return;
  youtubeApiPlayer = new window.YT.Player(youtubePlayer, {
    events: {
      onReady: (event) => {
        youtubePlayer = event.target.getIframe();
        if (currentVideoId) event.target.loadVideoById(currentVideoId);
        else if (currentPlaylistId) event.target.loadPlaylist({ list: currentPlaylistId });
      },
      onStateChange: (event) => { youtubePlaybackState = event.data; },
      onError: () => setMessage('The YouTube player could not load this video.'),
    },
  });
}

function showYouTubeVideo(videoId, title = '', updateUrl = true) {
  stopDirectPlayback();
  currentVideoId = videoId;
  currentPlaylistId = '';
  currentMediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
  currentTitle = title || 'YouTube video';
  loopPlaylistButton.hidden = true;
  videoLabel.textContent = currentTitle;
  sourceLabel.textContent = 'YOUTUBE · PRIVACY-ENHANCED EMBED';
  setMessage('');
  emptyPlayer.hidden = true;
  player.hidden = true;
  youtubePlayer.hidden = false;
  youtubePlayer.title = currentTitle;
  if (youtubeApiPlayer) youtubeApiPlayer.loadVideoById(videoId);
  else {
    const params = new URLSearchParams({
      autoplay: '1', controls: '1', playsinline: '1', rel: '0',
      enablejsapi: '1', origin: window.location.origin,
    });
    youtubePlayer.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
    initializeYoutubeApiPlayer();
  }
  playerBar.hidden = false;
  shareButton.disabled = false;
  updateFavoriteButton();
  recordPlayback();
  if (updateUrl) updateAddress('v', videoId);
}

function playPlaylist(playlistId, title = '', updateUrl = true, scrollToPlayer = true) {
  playbackRequestId += 1;
  stopDirectPlayback();
  currentVideoId = '';
  currentPlaylistId = playlistId;
  currentMediaUrl = '';
  currentTitle = title || 'YouTube playlist';
  videoLabel.textContent = currentTitle;
  sourceLabel.textContent = 'YOUTUBE · PLAYLIST';
  setMessage('');
  emptyPlayer.hidden = true;
  player.hidden = true;
  youtubePlayer.hidden = false;
  youtubePlayer.title = currentTitle;
  if (youtubeApiPlayer) {
    youtubeApiPlayer.setLoop(playlistLoopEnabled);
    youtubeApiPlayer.loadPlaylist({ list: playlistId });
  } else {
    const parameters = new URLSearchParams({
      list: playlistId, autoplay: '1', controls: '1', playsinline: '1', rel: '0',
      enablejsapi: '1', origin: window.location.origin,
    });
    if (playlistLoopEnabled) {
      parameters.set('loop', '1');
      parameters.set('playlist', playlistId);
    }
    youtubePlayer.src = `https://www.youtube-nocookie.com/embed/videoseries?${parameters}`;
    initializeYoutubeApiPlayer();
  }
  playerBar.hidden = false;
  shareButton.disabled = false;
  loopPlaylistButton.hidden = false;
  loopPlaylistButton.setAttribute('aria-pressed', String(playlistLoopEnabled));
  updateFavoriteButton();
  recordPlayback();
  if (updateUrl) updateAddress('list', playlistId);
  if (scrollToPlayer) document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playVideo(videoId, title = '', updateUrl = true) {
  playbackRequestId += 1;
  showYouTubeVideo(videoId, title, updateUrl);
  document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearMedia(updateUrl = true) {
  playbackRequestId += 1;
  document.body.classList.remove('theater-mode');
  theaterButton.setAttribute('aria-pressed', 'false');
  theaterButton.textContent = 'Theater';
  stopDirectPlayback();
  if (youtubeApiPlayer) youtubeApiPlayer.stopVideo();
  if (!youtubeApiPlayer) youtubePlayer.src = 'about:blank';
  youtubePlayer.hidden = true;
  player.hidden = false;
  currentMediaUrl = '';
  currentVideoId = '';
  currentPlaylistId = '';
  currentTitle = '';
  loopPlaylistButton.hidden = true;
  videoLabel.textContent = 'Open a video';
  sourceLabel.textContent = 'DIRECT MEDIA';
  emptyPlayer.hidden = false;
  playerBar.hidden = true;
  shareButton.disabled = true;
  updateFavoriteButton();
  setMessage('');
  if (updateUrl) updateAddress('', '');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  try {
    const videoId = parseYouTubeVideoId(value);
    if (videoId) {
      playVideo(videoId);
      return;
    }
    const playlistId = parseYouTubePlaylistId(value);
    if (playlistId) {
      browsePlaylist(playlistId, 'YouTube playlist');
      playPlaylist(playlistId);
      return;
    }
    if (/^https?:\/\//i.test(value) && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(value)) {
      playMedia(value);
      return;
    }
    startSearch(value);
  } catch (error) {
    setMessage(error.message);
    input.focus();
  }
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
  if (youtubeApiPlayer) youtubeApiPlayer.setLoop(playlistLoopEnabled);
  else playPlaylist(currentPlaylistId, currentTitle, false, false);
  setMessage(playlistLoopEnabled ? 'Loop enabled.' : 'Loop disabled.');
});

player.addEventListener('error', () => {
  if (currentMediaUrl && !currentVideoId) {
    setMessage('The media could not be played. Check the URL, access permissions, format, and browser support.');
  }
});

shareButton.addEventListener('click', async () => {
  if (!currentMediaUrl && !currentVideoId && !currentPlaylistId) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  if (currentPlaylistId) shareUrl.searchParams.set('list', currentPlaylistId);
  else if (currentVideoId) shareUrl.searchParams.set('v', currentVideoId);
  else shareUrl.searchParams.set('url', currentMediaUrl);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    setMessage(currentMediaUrl && !currentVideoId ? 'Anon link copied. It contains the full media URL.' : 'Anon link copied.');
  } catch (error) {
    setMessage(`Could not copy the Anon link: ${error.message}`);
  }
});

favoriteButton.addEventListener('click', () => {
  const entry = currentEntry();
  if (!entry) return;
  const key = entry.kind === 'media' ? entry.url : `${entry.kind}:${entry.id}`;
  const saved = readLocalList(SAVED_KEY);
  if (saved.some((item) => item.key === key)) {
    if (!writeLocalList(SAVED_KEY, saved.filter((item) => item.key !== key))) return;
    setMessage('Removed from saved items.');
  } else {
    if (!writeLocalList(SAVED_KEY, [{ ...entry, key, savedAt: Date.now() }, ...saved])) return;
    setMessage('Saved in this browser.');
  }
  updateFavoriteButton();
  renderLibrary();
});

clearButton.addEventListener('click', () => clearMedia());
theaterButton.addEventListener('click', () => {
  const enabled = document.body.classList.toggle('theater-mode');
  theaterButton.setAttribute('aria-pressed', String(enabled));
  theaterButton.textContent = enabled ? 'Exit theater' : 'Theater';
});
libraryButton.addEventListener('click', openLibrary);
document.querySelector('#close-library-button').addEventListener('click', closeLibrary);
drawerBackdrop.addEventListener('click', closeLibrary);
document.querySelector('#clear-data-button').addEventListener('click', () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(SAVED_KEY);
    localStorage.removeItem(API_KEY);
    renderLibrary();
    updateFavoriteButton();
    apiKeyInput.value = '';
    setMessage('Local history, saved items, and API key cleared.');
  } catch (error) {
    setMessage(`Could not clear local data: ${error.message}`);
  }
});

document.querySelector('#settings-button').addEventListener('click', () => {
  try {
    apiKeyInput.value = localStorage.getItem(API_KEY) || '';
    settingsStatus.textContent = '';
    settingsDialog.showModal();
  } catch (error) {
    setMessage(`Could not read the saved API key: ${error.message}`);
  }
});
document.querySelector('#save-settings-button').addEventListener('click', () => {
  try {
    if (apiKeyInput.value.trim()) localStorage.setItem(API_KEY, apiKeyInput.value.trim());
    else localStorage.removeItem(API_KEY);
    settingsStatus.textContent = 'Settings saved in this browser.';
    settingsDialog.close();
  } catch (error) {
    settingsStatus.textContent = `Could not save the API key: ${error.message}`;
  }
});
document.querySelector('#remove-api-key-button').addEventListener('click', () => {
  try {
    localStorage.removeItem(API_KEY);
    apiKeyInput.value = '';
    settingsStatus.textContent = 'Saved API key removed.';
  } catch (error) {
    settingsStatus.textContent = `Could not remove the API key: ${error.message}`;
  }
});

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName));
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === ' ' || event.code === 'Space') {
    if (!currentVideoId && !currentPlaylistId && !currentMediaUrl) return;
    event.preventDefault();
    if (currentVideoId || currentPlaylistId) {
      if (youtubeApiPlayer && youtubePlaybackState === 1) youtubeApiPlayer.pauseVideo();
      else youtubeApiPlayer?.playVideo();
    } else if (player.paused) {
      void player.play().catch((error) => setMessage(`Playback could not start: ${error.message}`));
    } else {
      player.pause();
    }
  } else if (key === 'f') {
    if (currentVideoId || currentPlaylistId || currentMediaUrl) {
      const target = document.querySelector('#player-wrap');
      if (!document.fullscreenElement) void target.requestFullscreen?.();
      else void document.exitFullscreen?.();
    }
  } else if (key === 'm') {
    if (currentVideoId || currentPlaylistId) {
      if (youtubeApiPlayer?.isMuted()) youtubeApiPlayer.unMute();
      else youtubeApiPlayer?.mute();
    } else if (currentMediaUrl) {
      player.muted = !player.muted;
    }
  }
});

window.onYouTubeIframeAPIReady = initializeYoutubeApiPlayer;
const youtubeApiScript = document.createElement('script');
youtubeApiScript.src = 'https://www.youtube.com/iframe_api';
youtubeApiScript.async = true;
document.head.append(youtubeApiScript);

const parameters = new URLSearchParams(window.location.search);
const initialVideo = parameters.get('v') || parameters.get('yt');
const initialMedia = parameters.get('url') || parameters.get('video');
const initialPlaylist = parameters.get('list');
const initialQuery = parameters.get('q');
if (initialVideo) {
  try {
    const videoId = parseYouTubeVideoId(initialVideo);
    if (videoId) playVideo(videoId, '', false);
  } catch (error) {
    setMessage(error.message);
  }
} else if (initialMedia) {
  input.value = initialMedia;
  try {
    const videoId = parseYouTubeVideoId(initialMedia);
    if (videoId) playVideo(videoId, '', false);
    else playMedia(initialMedia, '', false);
  } catch (error) {
    setMessage(error.message);
  }
}
if (initialPlaylist && /^[A-Za-z0-9_-]{11,128}$/.test(initialPlaylist)) {
  browsePlaylist(initialPlaylist, 'Playlist', false);
} else if (initialQuery) {
  const initialType = ['all', 'video', 'playlist'].includes(parameters.get('type'))
    ? parameters.get('type')
    : 'all';
  input.value = initialQuery;
  startSearch(initialQuery, initialType, false);
}

renderLibrary();
