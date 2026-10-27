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
const nextPageButton = document.querySelector('#next-page-button');
let currentVideoId = '';
let currentMode = 'trending';
let currentQuery = '';
let currentPage = 1;
let catalogRequestId = 0;

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

async function loadCatalog(mode, query = '', page = 1) {
  const requestId = ++catalogRequestId;
  currentMode = mode;
  currentQuery = query;
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
  if (mode === 'search') parameters.set('q', query);
  else parameters.set('region', regionSelect.value);
  if (mode === 'search') parameters.set('page', String(page));

  try {
    const response = await fetch(`/api/videos?${parameters}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load videos.');
    if (requestId !== catalogRequestId) return;
    if (!result.videos.length) {
      catalogStatus.textContent = page === 1 ? 'No videos found' : `No more videos · ${result.instance}`;
      nextPageButton.hidden = true;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const video of result.videos) fragment.append(makeVideoCard(video));
    videoGrid.append(fragment);
    currentPage = page;
    catalogStatus.textContent = `${videoGrid.children.length} videos · ${result.instance}`;
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
nextPageButton.addEventListener('click', () => {
  if (currentMode !== 'search' || nextPageButton.disabled) return;
  nextPageButton.disabled = true;
  loadCatalog('search', currentQuery, currentPage + 1);
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