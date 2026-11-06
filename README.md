# Anon Watcher

Anon Watcher searches YouTube videos and playlists with the YouTube Data API, then plays available MP4 streams in its custom HTML5 player. It does not embed YouTube's player. Playback depends on the selected video's availability, the configured Invidious-compatible stream endpoint, and the browser's media support.

## Configure and run

Requires Node.js 20 or newer. Set a YouTube Data API v3 key on the server, then run:

```sh
YOUTUBE_API_KEY=your-key npm start
```

The key stays server-side and is never sent to the browser. Restrict the key to the YouTube Data API and set suitable API quotas in Google Cloud. The server binds to `127.0.0.1:3000` by default; set `PORT` or `HOST` to change this.

Video streams are looked up using the Invidious-compatible endpoint `https://snopyta.org/api/v1/videos/{videoId}`. Set `INVIDIOUS_INSTANCE_URL` to another trusted HTTPS Invidious origin if that instance is unavailable. The configured instance's `formatStreams` must contain HTTPS MP4 URLs. Public instances can be unavailable, rate-limited, or unable to provide streams for particular videos.

Search uses the YouTube Data API; video and playlist IDs from search are resolved server-side. The browser requests the selected media URL directly from its media host. No watch history is saved. Sharing a YouTube result shares its video ID; sharing a pasted media URL includes the full URL, which could contain private or temporary credentials.

## GitHub Pages

GitHub Pages publishes a static site and cannot securely provide the server-side YouTube API key or run the search and stream lookup endpoints. Search and YouTube stream playback require running Anon Watcher with `npm start`; direct media URL playback remains available on the static page.

The Pages workflow publishes `public/` on pushes to `main`. Enable GitHub Pages with **Build and deployment → Source: GitHub Actions** in the repository settings if it is not already enabled.
