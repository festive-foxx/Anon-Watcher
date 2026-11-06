const form = document.querySelector('#watch-form');
const input = document.querySelector('#video-link');
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
    throw new Error('That is a YouTube watch link, not a direct media URL. This player does not extract YouTube streams.');
  }
  return url;
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

function showMedia(url, updateAddress = true) {
  currentMediaUrl = url.toString();
  input.value = currentMediaUrl;
  videoLabel.textContent = url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  sourceLabel.textContent = url.hostname;
  message.textContent = '';
  emptyPlayer.hidden = true;
  customControls.hidden = false;
  playerBar.hidden = false;
  shareButton.disabled = false;
  player.src = currentMediaUrl;
  player.load();
  updateTime();
  updatePlayButton();

  if (updateAddress) {
    const shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('video', currentMediaUrl);
    window.history.replaceState({}, '', shareUrl);
  }
}

function clearMedia(updateAddress = true) {
  player.pause();
  player.removeAttribute('src');
  player.load();
  currentMediaUrl = '';
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
    message.textContent = `Playback could not start: ${error.message}`;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    showMedia(parseMediaUrl(input.value));
  } catch (error) {
    message.textContent = error.message;
    input.focus();
  }
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
  if (currentMediaUrl) {
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
  shareUrl.searchParams.set('video', currentMediaUrl);
  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    message.textContent = 'Share link copied. It contains the full media URL.';
  } catch (error) {
    message.textContent = `Could not copy the share link: ${error.message}`;
  }
});

clearButton.addEventListener('click', () => clearMedia());

const initialMedia = new URLSearchParams(window.location.search).get('video');
if (initialMedia) {
  input.value = initialMedia;
  try {
    showMedia(parseMediaUrl(initialMedia), false);
  } catch (error) {
    message.textContent = error.message;
  }
}

updateVolume();
updateFullscreenButton();
