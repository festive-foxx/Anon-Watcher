# Anon Watcher

Anon Watcher uses one input to search YouTube videos and playlists, play a YouTube URL or 11-character video ID, or play a direct MP4/HLS (`.m3u8`) URL. Playback appears above search results. Open a playlist and choose **Autoplay entire playlist** to play its videos in order; use **Loop playlist** in the player bar to restart the playlist after its last video.

Watch history, saved videos, and an optional YouTube Data API fallback key stay in browser `localStorage`. The fallback key is sent directly from the browser to YouTube when server search is unavailable or over quota. YouTube playback uses the `youtube-nocookie.com` embed. Direct media is played by the browser; HLS support depends on the browser.

YouTube search normally requires a server-side key. Set `YOUTUBE_API_KEY` before starting the Anon Watcher server, or add an optional fallback key in **Settings**. `GET /health` provides a lightweight server health check.
