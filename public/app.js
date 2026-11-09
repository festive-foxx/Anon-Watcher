const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const searchType = document.querySelector('#search-type');
const searchStatus = document.querySelector('#search-status');
const resultsTitle = document.querySelector('#results-title');
const searchResults = document.querySelector('#search-results');
const nextPageButton = document.querySelector('#next-page-button');
const player = document.querySelector('#media-player');
const playerWrap = document.querySelector('#player-wrap');
const emptyPlayer = document.querySelector('#empty-player');
const customControls = document.querySelector('#custom-controls');
const playerBar = document.querySelector('#player-bar');
const videoLabel = document.querySelector('#video-label');
const sourceLabel = document.querySelector('#source-label');
const playButton = document.querySelector('#play-button');
const playIcon = document.querySelector('#play-icon');
const pauseIcon = document.querySelector('#pause-icon');
const seekSlider = document.querySelector('#seek-slider');
const currentTimeLabel = document.querySelector('#current-time');
const durationLabel = document.querySelector('#duration');
const muteButton = document.querySelector('#mute-button');
const volumeIcon = document.querySelector('#volume-icon');
const mutedIcon = document.querySelector('#muted-icon');
const volumeSlider = document.querySelector('#volume-slider');
const playbackSpeed = document.querySelector('#playback-speed');
const fullscreenButton = document.querySelector('#fullscreen-button');
const shareButton = document.querySelector('#share-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
let currentMediaUrl = '';
let currentVideoId = '';
let currentFallbackStream = null;
let fallbackAttempt = null;
let hlsPlayer = null;
let cancelHlsStartup = null;
let searchRequestId = 0;
let playbackRequestId = 0;
let nextPageToken = '';
let resultMode = 'search';
let resultQuery = '';
let resultType = 'all';
let resultPlaylistId = '';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
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
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)
    && (url.pathname === '/watch' || url.hostname === 'youtu.be' || /^\/(?:shorts|live|embed)\//.test(url.pathname))) {
    throw new Error('Choose a video from search or paste a direct media URL.');
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
      throw new Error('YouTube search and stream lookup require the Anon Watcher server; GitHub Pages is static.');
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

function updatePlayButton() {
  const paused = player.paused || player.ended;
  playIcon.hidden = !paused;
  pauseIcon.hidden = paused;
  playButton.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}

function updateTime() {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  seekSlider.max = String(duration);
  seekSlider.value = String(Math.min(player.currentTime || 0, duration));
  seekSlider.disabled = duration === 0;
  seekSlider.setAttribute('aria-valuetext', `${formatTime(player.currentTime)} of ${formatTime(duration)}`);
  currentTimeLabel.textContent = formatTime(player.currentTime);
  durationLabel.textContent = formatTime(duration);
}

function updateVolume() {
  const muted = player.muted || player.volume === 0;
  volumeIcon.hidden = muted;
  mutedIcon.hidden = !muted;
  muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  volumeSlider.value = String(muted ? 0 : player.volume);
}

function updateFullscreenButton() {
  const fullscreen = document.fullscreenElement === playerWrap;
  fullscreenButton.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.title = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
}

function showMedia(url, title, videoId = '', updateAddress = true, mediaType = 'mp4', fallback = null) {
  if (hlsPlayer) {
    if (cancelHlsStartup) cancelHlsStartup(new Error('Playback was replaced.'));
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  let mediaReady = Promise.resolve();
  currentMediaUrl = url.toString();
  currentVideoId = videoId;
  currentFallbackStream = fallback;
  fallbackAttempt = null;
  input.value = currentMediaUrl;
  videoLabel.textContent = title || url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  sourceLabel.textContent = url.hostname;
  message.textContent = '';
  emptyPlayer.hidden = true;
  customControls.hidden = false;
  playerBar.hidden = false;
  shareButton.disabled = false;
  const isHls = mediaType === 'hls' || /\.m3u8$/i.test(url.pathname);
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
          fail(new Error('The HLS stream could not be loaded. Try another video or stream instance.'));
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
  updateTime();
  updatePlayButton();

  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    if (videoId) shareUrl.searchParams.set('yt', videoId);
    else shareUrl.searchParams.set('video', currentMediaUrl);
    window.history.replaceState({}, '', shareUrl);
  }
  return mediaReady;
}

async function attemptFallback() {
  if (!currentFallbackStream) return fallbackAttempt || false;
  if (fallbackAttempt) return fallbackAttempt;
  const fallback = currentFallbackStream;
  currentFallbackStream = null;
  const attempt = (async () => {
    try {
      const url = parseMediaUrl(fallback.url);
      await showMedia(url, videoLabel.textContent, currentVideoId, true, fallback.type);
      await player.play();
      message.textContent = '';
      return true;
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        message.textContent = 'HLS stream loaded. Press play to start.';
        return true;
      }
      message.textContent = `The video stream failed, and its HLS fallback could not be played: ${error.message}`;
      return false;
    }
  })();
  fallbackAttempt = attempt;
  try {
    return await attempt;
  } finally {
    if (fallbackAttempt === attempt) fallbackAttempt = null;
  }
}

async function playVideo(videoId, title = '', updateAddress = true) {
  const requestId = ++playbackRequestId;
  message.textContent = 'Finding a playable stream…';
  try {
    const result = await requestJson(`/api/videos/${encodeURIComponent(videoId)}/stream`);
    if (requestId !== playbackRequestId) return;
    if (result.fallback) {
      if (typeof result.fallback.url !== 'string' || !['mp4', 'hls'].includes(result.fallback.type)) {
        throw new Error('The server returned an invalid fallback stream.');
      }
    }
    const url = parseMediaUrl(result.url);
    await showMedia(
      url,
      title || result.title || 'YouTube video',
      videoId,
      updateAddress,
      result.type,
      result.fallback || null,
    );
    if (requestId !== playbackRequestId) return;
    try {
      await player.play();
      message.textContent = '';
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        message.textContent = 'Stream loaded. Press play to start.';
      } else {
        await attemptFallback();
      }
    }
    document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (requestId === playbackRequestId) message.textContent = error.message;
  }
}

function clearMedia(updateAddress = true) {
  playbackRequestId += 1;
  currentFallbackStream = null;
  fallbackAttempt = null;
  if (hlsPlayer) {
    if (cancelHlsStartup) cancelHlsStartup(new Error('Playback was cancelled.'));
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  player.pause();
  player.removeAttribute('src');
  player.load();
  currentMediaUrl = '';
  currentVideoId = '';
  input.value = '';
  videoLabel.textContent = 'Open a video';
  sourceLabel.textContent = 'DIRECT MEDIA';
  emptyPlayer.hidden = false;
  customControls.hidden = true;
  playerBar.hidden = true;
  shareButton.disabled = true;
  message.textContent = '';
  updateTime();
  updatePlayButton();
  if (updateAddress) window.history.replaceState({}, '', window.location.pathname);
}

async function togglePlayback() {
  if (!player.paused && !player.ended) {
    player.pause();
    return;
  }
  try {
    await player.play();
    message.textContent = '';
  } catch (error) {
    if (currentFallbackStream || fallbackAttempt) {
      await attemptFallback();
    } else {
      message.textContent = `Playback could not start: ${error.message}`;
    }
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    showMedia(parseMediaUrl(input.value), '');
    player.play().catch(() => {
      message.textContent = 'Media loaded. Press play to start.';
    });
  } catch (error) {
    message.textContent = error.message;
    input.focus();
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

playButton.addEventListener('click', togglePlayback);
player.addEventListener('click', (event) => {
  if (event.target === player && currentMediaUrl) togglePlayback();
});
player.addEventListener('play', updatePlayButton);
player.addEventListener('pause', updatePlayButton);
player.addEventListener('ended', updatePlayButton);
player.addEventListener('timeupdate', updateTime);
player.addEventListener('durationchange', updateTime);
player.addEventListener('loadedmetadata', updateTime);
player.addEventListener('volumechange', updateVolume);
player.addEventListener('error', () => {
  if (currentFallbackStream) {
    void attemptFallback();
  } else if (currentMediaUrl && !fallbackAttempt) {
    message.textContent = 'The media could not be played. Check the URL, access permissions, format, and browser support.';
  }
});

seekSlider.addEventListener('input', () => {
  if (Number.isFinite(player.duration)) player.currentTime = Number(seekSlider.value);
});
muteButton.addEventListener('click', () => {
  if (player.muted || player.volume === 0) {
    if (player.volume === 0) player.volume = 0.5;
    player.muted = false;
  } else {
    player.muted = true;
  }
});
volumeSlider.addEventListener('input', () => {
  player.volume = Number(volumeSlider.value);
  player.muted = player.volume === 0;
});
playbackSpeed.addEventListener('change', () => {
  player.playbackRate = Number(playbackSpeed.value);
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === playerWrap) await document.exitFullscreen();
    else await playerWrap.requestFullscreen();
  } catch (error) {
    message.textContent = `Fullscreen could not be changed: ${error.message}`;
  }
});
document.addEventListener('fullscreenchange', updateFullscreenButton);

playerWrap.addEventListener('keydown', (event) => {
  if (event.target !== playerWrap && event.target !== player) return;
  if (!currentMediaUrl) return;
  if (event.key === ' ' || event.key === 'k') {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + direction * 5));
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    player.volume = Math.max(0, Math.min(1, player.volume + direction * 0.05));
    player.muted = player.volume === 0;
  } else if (event.key.toLowerCase() === 'm') {
    player.muted = !player.muted;
  } else if (event.key.toLowerCase() === 'f') {
    fullscreenButton.click();
  }
});

shareButton.addEventListener('click', async () => {
  if (!currentMediaUrl) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  if (currentVideoId) shareUrl.searchParams.set('yt', currentVideoId);
  else shareUrl.searchParams.set('video', currentMediaUrl);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    message.textContent = currentVideoId
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
if (initialVideo && /^[A-Za-z0-9_-]{11}$/.test(initialVideo)) {
  playVideo(initialVideo, '', false);
} else if (initialMedia) {
  input.value = initialMedia;
  try {
    showMedia(parseMediaUrl(initialMedia), '', '', false);
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

updateVolume();
updateFullscreenButton();
