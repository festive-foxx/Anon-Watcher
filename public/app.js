const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
const player = document.querySelector('#video-player');
const emptyPlayer = document.querySelector('#empty-player');
const playerBar = document.querySelector('#player-bar');
const shareButton = document.querySelector('#share-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-query');
const trendingTab = document.querySelector('#trending-tab');
const regionSelect = document.querySelector('#region-select');
const catalogTitle = document.querySelector('#catalog-title');
const catalogStatus = document.querySelector('#catalog-status');
const videoGrid = document.querySelector('#video-grid');
const isGitHubPages = window.location.hostname === 'festive-foxx.github.io'
  && window.location.pathname.startsWith('/Anon-Watcher/');
const instanceDirectoryUrl = 'https://api.invidious.io/instances.json?sort_by=api';
let currentVideoId = '';
let currentMode = 'trending';
let currentQuery = '';
let catalogRequestId = 0;
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

async function loadPagesCatalog(mode, query) {
  const instances = await getAvailableInstances();
  if (!instances.length) throw new Error('No CORS-enabled Invidious instances are currently available.');

  let lastError;
  for (const instanceUrl of instances) {
    const endpoint = mode === 'search'
      ? new URL('/api/v1/search', instanceUrl)
      : new URL('/api/v1/trending', instanceUrl);
    if (mode === 'search') {
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('type', 'video');
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
      const videos = await response.json();
      if (!Array.isArray(videos)) throw new Error(`${instanceUrl.host} returned an invalid catalog response.`);
      return {
        videos: videos.map((video) => mapApiVideo(video, instanceUrl)).filter(Boolean).slice(0, 32),
        instance: instanceUrl.host,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'No Invidious instance could load the catalog.');
}

function extractVideoId(value) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

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

  let videoId = '';
  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v') || '';
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    videoId = match?.[1] || '';
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error('That link does not contain a valid YouTube video ID.');
  }
  return videoId;
}

function showVideo(videoId, updateAddress = true) {
  currentVideoId = videoId;
  player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&playsinline=1`;
  player.hidden = false;
  emptyPlayer.hidden = true;
  playerBar.hidden = false;
  shareButton.disabled = false;
  message.textContent = '';
  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('yt', videoId);
    window.history.replaceState({}, '', shareUrl);
  }
}

function clearVideo(updateAddress = true) {
  currentVideoId = '';
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
}

function makeVideoCard(video) {
  const card = document.createElement('article');
  card.className = 'video-card';
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
  card.append(thumbnailButton, title, author, metadata);
  return card;
}

function openVideo(videoId) {
  input.value = videoId;
  showVideo(videoId);
  document.querySelector('#watcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadCatalog(mode, query = '') {
  const requestId = ++catalogRequestId;
  currentMode = mode;
  currentQuery = query;
  setBrowseState(mode);
  catalogStatus.textContent = 'Loading…';
  videoGrid.replaceChildren();

  const parameters = new URLSearchParams({ mode });
  if (mode === 'search') parameters.set('q', query);
  else parameters.set('region', regionSelect.value);

  try {
    let result;
    if (isGitHubPages) {
      result = await loadPagesCatalog(mode, query);
    } else {
      const response = await fetch(`/api/videos?${parameters}`);
      result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load videos.');
    }
    if (requestId !== catalogRequestId) return;
    if (!result.videos.length) {
      catalogStatus.textContent = 'No videos found';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const video of result.videos) fragment.append(makeVideoCard(video));
    videoGrid.append(fragment);
    catalogStatus.textContent = `${result.videos.length} videos · ${result.instance}`;
  } catch (error) {
    if (requestId === catalogRequestId) catalogStatus.textContent = error.message;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    showVideo(extractVideoId(input.value));
  } catch (error) {
    message.textContent = error.message;
    input.focus();
  }
});

shareButton.addEventListener('click', async () => {
  if (!currentVideoId) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  shareUrl.searchParams.set('yt', currentVideoId);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    message.textContent = 'Share link copied.';
  } catch {
    message.textContent = shareUrl.toString();
  }
});

clearButton.addEventListener('click', () => clearVideo());
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
  loadCatalog('search', query);
});

const initialVideo = new URLSearchParams(window.location.search).get('yt');
if (initialVideo) {
  input.value = initialVideo;
  try {
    showVideo(extractVideoId(initialVideo), false);
  } catch (error) {
    message.textContent = error.message;
  }
}

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery) {
  searchInput.value = initialQuery;
  loadCatalog('search', initialQuery);
} else {
  loadCatalog('trending');
}