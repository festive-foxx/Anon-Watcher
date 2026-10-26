# Anon Watcher

Anon Watcher is a minimal YouTube video viewer. Paste a YouTube URL or 11-character video ID to play a video in YouTube's official privacy-enhanced embed. It accepts regular watch links, `youtu.be`, Shorts, live, and embed URLs. Add `?yt=VIDEO_ID` to open a video directly or use the share control to copy a link.

The page does not store watch history. The player uses `youtube-nocookie.com`; this is YouTube's privacy-enhanced embed mode, not anonymity. YouTube still receives the viewer's network connection and may process viewing data when playback begins. Embedding can be disabled by a video's owner, and age-restricted videos may require YouTube sign-in.

## Run locally

Requires Node.js 20 or newer. Run:

```sh
npm start
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` by default. Set `PORT` to change the port.

For shared deployment, put the service behind an access-controlled HTTPS reverse proxy and firewall.