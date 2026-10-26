const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
const player = document.querySelector('#video-player');
const emptyPlayer = document.querySelector('#empty-player');
const playerBar = document.querySelector('#player-bar');
const shareButton = document.querySelector('#share-button');
const clearButton = document.querySelector('#clear-button');
const message = document.querySelector('#message');
let currentVideoId = '';

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

const initialVideo = new URLSearchParams(window.location.search).get('yt');
if (initialVideo) {
  input.value = initialVideo;
  try {
    showVideo(extractVideoId(initialVideo), false);
  } catch (error) {
    message.textContent = error.message;
  }
}