# IDK Desktop Node Deployment

This package is the complete uploaded project. The Node server is `server.js`.
It provides the Proxy, Chat WebSocket, setup gate, health check, and optional
server-side AI route.

## Run on a Node host

```bash
npm install
npm start
```

The host must provide HTTPS. Set these environment variables on the host:

- `SESSION_SECRET`: a long random value that stays the same between restarts.
- `SETUP_KEYS`: optional comma-separated setup keys. The package defaults are in `.env.example`.
- `AI_API_KEY`: optional server-side AI provider key.
- `AI_MODEL`: optional model name; defaults to `gpt-4o-mini`.
- `AI_BASE_URL`: optional provider base URL; defaults to OpenAI.

The host should send its assigned `PORT` to the process. Check `/healthz`; a
successful response reports both `proxy: true` and `chat: true`.

## Render

The included `render.yaml` is ready for a Render Node web service. Use the
project files as the service source, set `SETUP_KEYS`, and optionally set
`AI_API_KEY`. Render supplies HTTPS and `PORT` automatically.

Do not put a real API key in `.env.example` or browser JavaScript.
