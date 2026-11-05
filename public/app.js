const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
const invidiousPlayerOption = document.querySelector('#invidious-player-option');
const player = document.querySelector('#video-player');
const emptyPlayer = document.querySelector('#empty-player');
const playerBar = document.querySelector('#player-bar');
const shareButton = document.querySelector('#share-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const searchTypeControl = document.querySelector('#search-type-control');
const searchTypeFilter = document.querySelector('#search-type-filter');
const trendingTab = document.querySelector('#trending-tab');
const regionSelect = document.querySelector('#region-select');
const catalogTitle = document.querySelector('#catalog-title');
const catalogStatus = document.querySelector('#catalog-status');
const videoGrid = document.querySelector('#video-grid');
const nextPageButton = document.querySelector('#next-page-button');
const queueCount = document.querySelector('#queue-count');
const queuePlayNextButton = document.querySelector('#queue-play-next');
const queueClearButton = document.querySelector('#queue-clear');
const queueEmpty = document.querySelector('#queue-empty');
const queueList = document.querySelector('#queue-list');
const isGitHubPages = window.location.hostname === 'festive-foxx.github.io'
  && window.location.pathname.startsWith('/Anon-Watcher/');
const instanceDirectoryUrl = 'https://api.invidious.io/instances.json?sort_by=api';
let currentVideoId = '';
let currentPlaylistId = '';
let currentMode = 'trending';
let currentQuery = '';
let currentSearchType = 'all';
let currentPage = 1;
let catalogRequestId = 0;
let playbackRequestId = 0;
let currentPlayerOrigin = '';
const playbackQueue = [];
let availableInstances;

function getAvailableInstances() {
  if (!availableInstances) {
    availableInstances = fetch(instanceDirectoryUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Invidious directory returned HTTP ${response.status}.`);
      const entries = await response.json();
      return entries
        .map(([, details]) => details)
        .filter((details) => details?.api && details.cors && details.type === 'https'
          && details.monitor?.down === false)
        .map((details) => {
          try {
            const url = new URL(details.uri);
            if (url.protocol !== 'https:' || url.username || url.password
              || (url.port && url.port !== '443') || url.pathname !== '/') return null;
            return url;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(0, 8);
    }).catch((error) => {
      availableInstances = undefined;
      throw error;
    });
  }
  return availableInstances;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function mapApiVideo(video, instanceUrl) {
  if (!video || typeof video !== 'object') return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId || '')) return null;
  const thumbnails = Array.isArray(video.videoThumbnails) ? video.videoThumbnails : [];
  let thumbnail = '';
  for (const candidate of thumbnails) {
    try {
      const url = new URL(candidate.url, instanceUrl);
      if (url.protocol === 'https:' && (url.origin === instanceUrl.origin
        || url.hostname === 'i.ytimg.com' || url.hostname === 'img.youtube.com')) {
        thumbnail = url.toString();
        break;
      }
    } catch {}
  }
  const views = video.viewCountText || (Number.isFinite(video.viewCount)
    ? `${video.viewCount.toLocaleString()} views` : '');
  return {
    videoId: video.videoId,
    title: typeof video.title === 'string' ? video.title : 'Untitled video',
    author: typeof video.author === 'string' ? video.author : 'Unknown channel',
    duration: formatDuration(video.lengthSeconds),
    views,
    thumbnail,
  };
}

function mapApiPlaylist(playlist, instanceUrl) {
  if (!playlist || typeof playlist !== 'object') return null;
  if (!/^[A-Za-z0-9_-]+$/.test(playlist.playlistId || '')) return null;
  const rawThumbnail = typeof playlist.playlistThumbnail === 'string'
    ? playlist.playlistThumbnail
    : Array.isArray(playlist.playlistThumbnails)
      ? playlist.playlistThumbnails.find((thumbnail) => typeof thumbnail?.url === 'string')?.url
      : '';
  let thumbnail = '';
  if (rawThumbnail) {
    try {
      const url = new URL(rawThumbnail, instanceUrl);
      if (url.protocol === 'https:' && (url.origin === instanceUrl.origin
        || url.hostname === 'i.ytimg.com' || url.hostname === 'img.youtube.com')) {
        thumbnail = url.toString();
      }
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

async function loadPagesCatalog(mode, query, page = 1, searchType = 'all') {
  const instances = await getAvailableInstances();
  if (!instances.length) throw new Error('No CORS-enabled Invidious instances are currently available.');

  let lastError;
  for (const instanceUrl of instances) {
    const endpoint = mode === 'search'
      ? new URL('/api/v1/search', instanceUrl)
      : new URL('/api/v1/trending', instanceUrl);
    if (mode === 'search') {
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('type', searchType);
      endpoint.searchParams.set('page', String(page));
    } else {
      endpoint.searchParams.set('region', regionSelect.value);
    }

    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`${instanceUrl.host} returned HTTP ${response.status}.`);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error(`${instanceUrl.host} returned an invalid catalog response.`);
      const videos = [];
      const playlists = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.type === 'playlist') {
          const playlist = mapApiPlaylist(entry, instanceUrl);
          if (playlist) playlists.push(playlist);
        } else if (entry.type === 'video' || entry.videoId) {
          const video = mapApiVideo(entry, instanceUrl);
          if (video) videos.push(video);
        }
      }
      return {
        videos: videos.slice(0, 32),
        playlists: playlists.slice(0, 32),
        instance: instanceUrl.host,
        playerOrigin: instanceUrl.origin,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'No Invidious instance could load the catalog.');
}

async function loadPagesPlaylist(playlistId) {
  const instances = await getAvailableInstances();
  if (!instances.length) throw new Error('No CORS-enabled Invidious instances are currently available.');

  let lastError;
  for (const instanceUrl of instances) {
    try {
      const endpoint = new URL(`/api/v1/playlists/${encodeURIComponent(playlistId)}`, instanceUrl);
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`${instanceUrl.host} returned HTTP ${response.status}.`);
      const playlist = await response.json();
      if (!Array.isArray(playlist.videos)) {
        throw new Error(`${instanceUrl.host} returned an invalid playlist response.`);
      }
      return {
        videos: playlist.videos.map((video) => mapApiVideo(video, instanceUrl)).filter(Boolean),
        instance: instanceUrl.host,
        playerOrigin: instanceUrl.origin,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'No Invidious instance could load this playlist.');
}

async function loadServerPlaylist(playlistId) {
  const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load this playlist.');
  if (!Array.isArray(result.videos)) throw new Error('The server returned an invalid playlist response.');
  return result;
}

async function getInvidiousPlayerOrigin() {
  if (currentPlayerOrigin) return currentPlayerOrigin;
  if (isGitHubPages) {
    const instances = await getAvailableInstances();
    if (!instances.length) throw new Error('No Invidious instances are currently available.');
    currentPlayerOrigin = instances[0].origin;
  } else {
    const response = await fetch('/api/config');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the Invidious player configuration.');
    const origin = new URL(result.playerOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
      throw new Error('The server returned an invalid Invidious player origin.');
    }
    currentPlayerOrigin = origin.origin;
  }
  return currentPlayerOrigin;
}

async function getPlayerUrl(path, parameters) {
  if (!invidiousPlayerOption.checked) {
    return `https://www.youtube-nocookie.com/embed/${path}?${parameters}`;
  }
  const origin = await getInvidiousPlayerOrigin();
  return `${origin}/embed/${path}?${parameters}`;
}

function extractYouTubeTarget(value) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return { videoId: trimmed, playlistId: '' };

  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Paste a valid YouTube link or 11-character video ID.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(hostname)) {
    throw new Error('Use a link from YouTube or youtu.be.');
  }

  const playlistId = url.searchParams.get('list') || '';
  if (playlistId && !/^[A-Za-z0-9_-]{1,128}$/.test(playlistId)) {
    throw new Error('That link does not contain a valid YouTube playlist ID.');
  }

  let videoId = '';
  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v') || '';
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    videoId = match?.[1] || '';
  }

  if (playlistId && !videoId) return { videoId: '', playlistId };
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error('That link does not contain a valid YouTube video or playlist ID.');
  }
  return { videoId, playlistId };
}

async function showVideo(videoId, updateAddress = true, playlistId = '') {
  currentVideoId = videoId;
  currentPlaylistId = playlistId;
  const parameters = new URLSearchParams({ rel: '0', playsinline: '1' });
  if (playlistId) parameters.set('list', playlistId);
  const requestId = ++playbackRequestId;
  message.textContent = '';
  try {
    const source = await getPlayerUrl(encodeURIComponent(videoId), parameters);
    if (requestId !== playbackRequestId) return;
    player.src = source;
    player.hidden = false;
    emptyPlayer.hidden = true;
    playerBar.hidden = false;
    shareButton.disabled = false;
  } catch (error) {
    if (requestId === playbackRequestId) message.textContent = `Could not load the selected player: ${error.message}`;
  }
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('yt', videoId);
    if (playlistId) shareUrl.searchParams.set('list', playlistId);
    window.history.replaceState({}, '', shareUrl);
  }
}

async function showPlaylist(playlistId, updateAddress = true) {
  currentVideoId = '';
  currentPlaylistId = playlistId;
  const parameters = new URLSearchParams({ list: playlistId, rel: '0', playsinline: '1' });
  const requestId = ++playbackRequestId;
  message.textContent = '';
  try {
    const source = await getPlayerUrl('videoseries', parameters);
    if (requestId !== playbackRequestId) return;
    player.src = source;
    player.hidden = false;
    emptyPlayer.hidden = true;
    playerBar.hidden = false;
    shareButton.disabled = false;
  } catch (error) {
    if (requestId === playbackRequestId) message.textContent = `Could not load the selected player: ${error.message}`;
  }
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('list', playlistId);
    window.history.replaceState({}, '', shareUrl);
  }
}

function clearVideo(updateAddress = true) {
  playbackRequestId += 1;
  currentVideoId = '';
  currentPlaylistId = '';
  player.src = 'about:blank';
  player.hidden = true;
  emptyPlayer.hidden = false;
  playerBar.hidden = true;
  shareButton.disabled = true;
  message.textContent = '';
  input.value = '';
  if (updateAddress) window.history.replaceState({}, '', window.location.pathname);
}

function setBrowseState(mode) {
  trendingTab.classList.toggle('active', mode === 'trending');
  catalogTitle.textContent = mode === 'trending' ? 'Trending videos' : 'Search results';
  searchTypeControl.hidden = mode !== 'search';
}

function makeVideoCard(video) {
  const card = document.createElement('article');
  card.className = 'video-card';
  const thumbnailWrap = document.createElement('div');
  thumbnailWrap.className = 'thumbnail-wrap';
  const thumbnailButton = document.createElement('button');
  thumbnailButton.type = 'button';
  thumbnailButton.className = 'thumbnail-button';
  thumbnailButton.setAttribute('aria-label', `Watch ${video.title}`);

  if (video.thumbnail) {
    const image = document.createElement('img');
    image.src = video.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    thumbnailButton.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'thumbnail-fallback';
    fallback.textContent = 'AW';
    thumbnailButton.append(fallback);
  }

  if (video.duration) {
    const duration = document.createElement('span');
    duration.className = 'video-duration';
    duration.textContent = video.duration;
    thumbnailButton.append(duration);
  }
  thumbnailButton.addEventListener('click', () => openVideo(video.videoId));

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'video-queue-popup';
  addButton.textContent = '+ Add to queue';
  addButton.setAttribute('aria-label', `Add ${video.title} to queue`);
  addButton.addEventListener('click', () => addToQueue(video));
  thumbnailWrap.append(thumbnailButton, addButton);

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'video-title';
  title.textContent = video.title;
  title.addEventListener('click', () => openVideo(video.videoId));

  const author = document.createElement('p');
  author.className = 'video-author';
  author.textContent = video.author;
  const metadata = document.createElement('p');
  metadata.className = 'video-metadata';
  metadata.textContent = video.views;
  card.append(thumbnailWrap, title, author, metadata);
  return card;
}

function makePlaylistCard(playlist) {
  const card = document.createElement('article');
  card.className = 'video-card playlist-card';
  const art = document.createElement('div');
  art.className = 'playlist-art';
  if (playlist.thumbnail) {
    const image = document.createElement('img');
    image.src = playlist.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    art.append(image);
  } else {
    art.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h10M4 20h10m5-5v7m-3.5-3.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }
  const title = document.createElement('p');
  title.className = 'video-title';
  title.textContent = playlist.title;
  title.title = playlist.title;
  const author = document.createElement('p');
  author.className = 'video-author';
  author.textContent = playlist.author;
  const metadata = document.createElement('p');
  metadata.className = 'video-metadata';
  metadata.textContent = `${playlist.videoCount.toLocaleString()} videos · Playlist`;
  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'card-action';
  playButton.textContent = 'Play playlist';
  playButton.setAttribute('aria-label', `Play playlist ${playlist.title}`);
  playButton.addEventListener('click', () => openPlaylist(playlist.playlistId));
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'card-action';
  addButton.textContent = 'Queue playlist';
  addButton.setAttribute('aria-label', `Add playlist ${playlist.title} to queue`);
  addButton.addEventListener('click', async () => {
    addButton.disabled = true;
    addButton.textContent = 'Loading playlist…';
    try {
      const result = isGitHubPages
        ? await loadPagesPlaylist(playlist.playlistId)
        : await loadServerPlaylist(playlist.playlistId);
      if (!result.videos.length) throw new Error('This playlist has no playable videos.');
      for (const video of result.videos) playbackQueue.push(video);
      renderQueue();
      message.textContent = `Added ${result.videos.length} videos from “${playlist.title}” to the queue.`;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      addButton.disabled = false;
      addButton.textContent = 'Queue playlist';
    }
  });
  card.append(art, title, author, metadata, playButton, addButton);
  return card;
}

function renderQueue() {
  queueCount.textContent = String(playbackQueue.length);
  queuePlayNextButton.disabled = playbackQueue.length === 0;
  queueClearButton.disabled = playbackQueue.length === 0;
  queueEmpty.hidden = playbackQueue.length > 0;
  queueList.replaceChildren();
  for (const [index, video] of playbackQueue.entries()) {
    const item = document.createElement('li');
    item.className = 'queue-item';
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'queue-play';
    playButton.textContent = `${index + 1}. ${video.title} · ${video.author}`;
    playButton.title = video.title;
    playButton.addEventListener('click', () => playQueueItem(index));
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'queue-remove';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${video.title} from queue`);
    removeButton.addEventListener('click', () => {
      playbackQueue.splice(index, 1);
      renderQueue();
    });
    item.append(playButton, removeButton);
    queueList.append(item);
  }
}

function playQueueItem(index) {
  const [video] = playbackQueue.splice(index, 1);
  if (!video) return;
  renderQueue();
  openVideo(video.videoId);
}

function addToQueue(video) {
  playbackQueue.push(video);
  renderQueue();
}

async function openVideo(videoId) {
  input.value = videoId;
  await showVideo(videoId);
  document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openPlaylist(playlistId) {
  input.value = `https://www.youtube.com/playlist?list=${playlistId}`;
  await showPlaylist(playlistId);
  document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadCatalog(mode, query = '', page = 1, searchType = searchTypeFilter.value) {
  const requestId = ++catalogRequestId;
  currentMode = mode;
  currentQuery = query;
  if (mode === 'search') currentSearchType = searchType;
  setBrowseState(mode);
  catalogStatus.textContent = 'Loading…';
  if (page === 1) {
    currentPage = 1;
    videoGrid.replaceChildren();
    nextPageButton.hidden = true;
    nextPageButton.disabled = false;
  } else {
    nextPageButton.disabled = true;
    nextPageButton.textContent = 'Loading…';
  }

  const parameters = new URLSearchParams({ mode });
  if (mode === 'search') {
    parameters.set('q', query);
    parameters.set('type', currentSearchType);
  }
  else parameters.set('region', regionSelect.value);
  if (mode === 'search') parameters.set('page', String(page));

  try {
    let result;
    if (isGitHubPages) {
      result = await loadPagesCatalog(mode, query, page, currentSearchType);
    } else {
      const response = await fetch(`/api/videos?${parameters}`);
      result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load videos.');
    }
    if (requestId !== catalogRequestId) return;
    if (result.playerOrigin) currentPlayerOrigin = result.playerOrigin;
    const playlists = result.playlists || [];
    if (!result.videos.length && !playlists.length) {
      catalogStatus.textContent = page === 1 ? 'No results found' : `No more results · ${result.instance}`;
      nextPageButton.hidden = true;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const video of result.videos) fragment.append(makeVideoCard(video));
    for (const playlist of playlists) fragment.append(makePlaylistCard(playlist));
    videoGrid.append(fragment);
    currentPage = page;
    catalogStatus.textContent = mode === 'search' && playlists.length
      ? `${videoGrid.children.length} results · ${result.instance}`
      : `${videoGrid.children.length} videos · ${result.instance}`;
    nextPageButton.hidden = mode !== 'search';
  } catch (error) {
    if (requestId === catalogRequestId) {
      catalogStatus.textContent = error.message;
      nextPageButton.hidden = mode !== 'search' || videoGrid.children.length === 0;
    }
  } finally {
    if (requestId === catalogRequestId) {
      nextPageButton.disabled = false;
      nextPageButton.textContent = 'Next page';
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const target = extractYouTubeTarget(input.value);
    if (target.playlistId && !target.videoId) await showPlaylist(target.playlistId);
    else await showVideo(target.videoId, true, target.playlistId);
  } catch (error) {
    message.textContent = error.message;
    input.focus();
  }
});

invidiousPlayerOption.addEventListener('change', () => {
  if (currentVideoId) showVideo(currentVideoId, false, currentPlaylistId);
  else if (currentPlaylistId) showPlaylist(currentPlaylistId, false);
});

shareButton.addEventListener('click', async () => {
  if (!currentVideoId && !currentPlaylistId) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  if (currentVideoId) shareUrl.searchParams.set('yt', currentVideoId);
  if (currentPlaylistId) shareUrl.searchParams.set('list', currentPlaylistId);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    message.textContent = 'Share link copied.';
  } catch {
    message.textContent = shareUrl.toString();
  }
});

clearButton.addEventListener('click', () => clearVideo());
queuePlayNextButton.addEventListener('click', () => playQueueItem(0));
queueClearButton.addEventListener('click', () => {
  playbackQueue.length = 0;
  renderQueue();
});
trendingTab.addEventListener('click', () => loadCatalog('trending'));
regionSelect.addEventListener('change', () => {
  if (currentMode === 'trending') loadCatalog('trending');
});
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }
  loadCatalog('search', query, 1, searchTypeFilter.value);
});
searchTypeFilter.addEventListener('change', () => {
  if (currentMode === 'search' && currentQuery) {
    loadCatalog('search', currentQuery, 1, searchTypeFilter.value);
  }
});
nextPageButton.addEventListener('click', () => {
  if (currentMode !== 'search' || nextPageButton.disabled) return;
  nextPageButton.disabled = true;
  loadCatalog('search', currentQuery, currentPage + 1, currentSearchType);
});

const initialVideo = new URLSearchParams(window.location.search).get('yt');
if (initialVideo) {
  input.value = initialVideo;
  try {
    const target = extractYouTubeTarget(initialVideo);
    const playlistId = target.playlistId || new URLSearchParams(window.location.search).get('list') || '';
    if (playlistId && !/^[A-Za-z0-9_-]{1,128}$/.test(playlistId)) {
      throw new Error('That link does not contain a valid YouTube playlist ID.');
    }
    if (target.videoId) showVideo(target.videoId, false, playlistId);
    else showPlaylist(target.playlistId, false);
  } catch (error) {
    message.textContent = error.message;
  }
} else {
  const initialPlaylist = new URLSearchParams(window.location.search).get('list');
  if (initialPlaylist) {
    try {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(initialPlaylist)) {
        throw new Error('That link does not contain a valid YouTube playlist ID.');
      }
      input.value = `https://www.youtube.com/playlist?list=${initialPlaylist}`;
      showPlaylist(initialPlaylist, false);
    } catch (error) {
      message.textContent = error.message;
    }
  }
}

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery) {
  searchInput.value = initialQuery;
  const initialSearchType = new URLSearchParams(window.location.search).get('type');
  if (['all', 'video', 'playlist'].includes(initialSearchType)) {
    searchTypeFilter.value = initialSearchType;
  }
  loadCatalog('search', initialQuery, 1, searchTypeFilter.value);
} else {
  loadCatalog('trending');
}
renderQueue();