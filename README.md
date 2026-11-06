# Anon Watcher

Anon Watcher searches YouTube videos and playlists with the YouTube Data API, then plays available MP4 or HLS streams in its custom HTML5 player. It does not embed YouTube's player. Playback depends on the selected video's availability, the configured Invidious-compatible stream endpoint, and the browser's media support.

The default stream endpoint is `https://yt.chocolatemoo53.com`. To use another Invidious-compatible instance, set `INVIDIOUS_INSTANCE_URL` to its HTTPS origin before starting the server. `INVIDIOUS_REGION` can be set to a two-letter country code; it defaults to `US`.
