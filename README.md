# Anon Watcher

Anon Watcher is an Invidious-style video browser. It loads trending and search results from a configured Invidious instance, then plays selected videos in YouTube's privacy-enhanced embed. Paste a YouTube URL or 11-character video ID to keep using the direct-watch flow. It accepts regular watch links, `youtu.be`, Shorts, live, and embed URLs. Add `?yt=VIDEO_ID` to open a video directly or use the share control to copy a link.

The page does not store watch history. Search terms are sent to the configured Invidious instance, and thumbnails load from that instance. The player uses `youtube-nocookie.com`; this is YouTube's privacy-enhanced embed mode, not anonymity. YouTube still receives the viewer's network connection and may process viewing data when playback begins. Embedding can be disabled by a video's owner, and age-restricted videos may require YouTube sign-in.

## Run locally

Requires Node.js 20 or newer. Run:

```sh
npm start
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` by default. Set `PORT` to change the port.

The default catalog instance is `https://invidious.tiekoetter.com`. Set `INVIDIOUS_INSTANCE_URL` to another trusted HTTPS Invidious origin if needed. The adapter only requests that origin's generated search and trending paths; it does not fetch arbitrary URLs. Instance availability and rate limits can affect catalog results.

For shared deployment, put the service behind an access-controlled HTTPS reverse proxy and firewall.