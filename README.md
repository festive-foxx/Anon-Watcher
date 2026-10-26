# Anon Proxy

An authenticated, HTTPS-only text reader for public websites. Every requested hostname and redirect is checked with a family-safe DNS-over-HTTPS resolver before the server connects. Requests fail closed when the resolver is unavailable, and resolved addresses are pinned for the outbound connection.

The default category filter is Cloudflare Family (`family.cloudflare-dns.com`). Category databases are imperfect: this does not guarantee that every adult page is blocked, especially content hosted on general-purpose domains.

## Run locally

Requires Node.js 20 or newer. Set a private username and a password of at least 16 characters, then start the server:

```sh
PROXY_USERNAME=admin PROXY_PASSWORD='replace-with-a-private-16-character-or-longer-password' npm start
```

Open `http://localhost:3000`; the browser will prompt for the configured credentials. The server binds to `127.0.0.1` by default. Set `PORT` to change the port.

## Managed deployment

- Keep the service on a private network. If other users need access, put it behind a trusted HTTPS reverse proxy and firewall; do not expose Basic Auth over plain HTTP.
- Set `HOST=0.0.0.0` only when the container or host is isolated by that network boundary and firewall.
- Set `PROXY_USERNAME` and `PROXY_PASSWORD` through your secrets manager or deployment environment, not source control.
- `ADULT_FILTER_DOH_URL` can select an administrator-approved HTTPS DNS-over-HTTPS endpoint. `ADULT_FILTER_NAME` sets the label shown in the UI. The resolver must provide the desired adult-category policy; a generic resolver will not provide equivalent filtering.
- Access logs go to standard output and record timestamp, configured user, destination hostname, and outcome. They omit URL paths and query strings.

The reader accepts HTML and plain text, caps responses at 2 MB, and checks redirect targets with the same filter. It does not render remote scripts or page assets.