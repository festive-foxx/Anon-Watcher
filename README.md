# Anon Watcher

Anon Watcher is an Invidious-style video browser. It loads trending and search results from a configured Invidious instance, then plays selected videos and playlists in YouTube's privacy-enhanced embed. Paste a YouTube video or playlist URL, or an 11-character video ID, to use the direct-watch flow. It accepts regular watch links, playlist links, `youtu.be`, Shorts, live, and embed URLs. Add `?yt=VIDEO_ID` or `?list=PLAYLIST_ID` to open a video or playlist directly, or use the share control to copy a link.

The player defaults to YouTube's privacy-enhanced embed. Optionally select **Try ad-free playback via Invidious** to use an Invidious embed for videos and playlists instead. This can avoid YouTube ad playback, but is not guaranteed; it depends on the chosen public instance and may not work for every video. When enabled, that instance receives playback requests. The setting is not saved.

Search results can be filtered to show all results, videos, or playlists, and browsed page by page with the **Next page** button. Play playlists directly from search results, or add videos or all playable videos from a playlist to the in-page queue; queue entries can be played next, selected to play, removed, or cleared. The queue is held only in memory and is not saved.

The page does not store watch history. Search terms are sent to the configured Invidious instance, and thumbnails load from that instance. By default, the player uses `youtube-nocookie.com`; this is YouTube's privacy-enhanced embed mode, not anonymity. YouTube still receives the viewer's network connection and may process viewing data when playback begins. Invidious availability, video compatibility, and ad-free playback are not guaranteed. Embedding can be disabled by a video's owner, and age-restricted videos may require YouTube sign-in.

## Run locally

Requires Node.js 20 or newer. Run:

```sh
npm start
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` by default. Set `PORT` to change the port.

The default catalog instance is `https://invidious.tiekoetter.com`. Set `INVIDIOUS_INSTANCE_URL` to another trusted HTTPS Invidious origin if needed. The adapter only requests that origin's generated search and trending paths; it does not fetch arbitrary URLs. Instance availability and rate limits can affect catalog results. For optional Invidious playback, the player can use the configured origin or another monitored HTTPS backend from the public instance directory.

For shared deployment, put the service behind an access-controlled HTTPS reverse proxy and firewall.

## GitHub Pages

The GitHub Pages version is a static site and does not run `server.js`. It discovers currently online, CORS-enabled HTTPS instances from the public Invidious instance directory, then calls their JSON API directly from the browser for search and trending. If an instance is unavailable, it tries another listed instance. Availability, CORS policy, and rate limits are outside this project's control.

The Pages site retains the direct YouTube link/video ID player and privacy-enhanced YouTube embed, with the optional Invidious player available. Use **Choose backend** to enable Invidious playback and open the monitored HTTPS backend picker. You can retry playback on another backend manually because browsers cannot reliably detect a cross-origin embed refusing to load. Search queries go to a CORS-enabled Invidious instance; thumbnail and playback requests may go to Invidious and YouTube. Public backends can be unavailable or refuse specific videos. This is not anonymity, and Pages does not provide a server-side proxy.

The workflow in `.github/workflows/pages.yml` publishes the `public/` directory to GitHub Pages on pushes to `main`. Enable GitHub Pages with **Build and deployment → Source: GitHub Actions** in the repository settings if it is not already enabled.