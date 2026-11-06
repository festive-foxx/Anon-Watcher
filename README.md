# Anon Watcher

Anon Watcher is a static video player for direct media URLs. Paste a URL to a video file or stream to play it in the custom HTML5 player. The player provides play/pause, seeking, volume, playback speed, and fullscreen controls.

YouTube watch links and video IDs are not direct media URLs. Anon Watcher does not search for videos, extract YouTube streams, or use YouTube or Invidious embeds. Use a direct media URL that you are authorized to access. HLS playback depends on native browser support; for example, support varies between browsers.

The player does not save watch history. Playback requests go directly from the browser to the media host. Share links include the full media URL and its query parameters, so do not share links containing private or temporary credentials.

## Run locally

Requires Node.js 20 or newer. Run:

```sh
npm start
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` by default. Set `PORT` to change the port.

## GitHub Pages

The GitHub Pages version is a static site published from the `public/` directory. It supports the same direct-media player, subject to browser media support and the media host's access controls. Enable GitHub Pages with **Build and deployment → Source: GitHub Actions** in the repository settings if it is not already enabled.
