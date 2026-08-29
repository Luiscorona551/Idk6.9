import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';
import { createRequire } from 'node:module';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';
import { chat } from './chat.js';
import { aiRequest, aiStatus } from './ai.js';
import { hasSession, setupRoutes } from './setup-gate.js';

const require = createRequire(import.meta.url);
// resolve() lands on the Node build (lib/); the browser build lives in dist/.
const epoxyPath = join(
  dirname(require.resolve('@mercuryworkshop/epoxy-transport')),
  '../dist'
);
const root = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

const backend = {
  proxy: Boolean(wisp && typeof wisp.routeRequest === 'function'),
  chat: Boolean(chat && typeof chat.handleUpgrade === 'function')
};

function backendStatus() {
  return { ...backend, ai: aiStatus() };
}

app.use(express.json({ limit: '64kb' }));
app.get('/healthz', (req, res) => {
  const status = backendStatus();
  const ok = status.proxy && status.chat;
  res.status(ok ? 200 : 503).json({ ok, service: 'ugs-desktop', https: req.secure, ...status });
});
setupRoutes(app);
app.get('/api/status', (req, res) => res.json({ ok: true, ...backendStatus() }));
app.get('/api/ai/status', (req, res) => res.json(aiStatus()));
app.post('/api/ai', aiRequest);

// Ultraviolet's own uv.config.js is overridden by ours so the service worker
// lives under /uv/ instead of the site root.
app.get('/uv/uv.config.js', (req, res) => res.sendFile(join(root, 'uv.config.js')));
app.use('/uv/', express.static(uvPath));
app.use('/baremux/', express.static(baremuxPath));
app.use('/epoxy/', express.static(epoxyPath));
const PRIVATE = /^\/(node_modules|public|package(-lock)?\.json|server\.js|chat\.js|ai\.js|setup-gate\.js|Dockerfile|render\.yaml|\.env)/;
app.use((req, res, next) => (PRIVATE.test(req.path) ? res.sendStatus(404) : next()));
app.use(express.static(root, { extensions: ['html'], dotfiles: 'ignore' }));

const httpsKey = process.env.HTTPS_KEY_FILE;
const httpsCert = process.env.HTTPS_CERT_FILE;
const server = httpsKey && httpsCert
  ? createHttpsServer({ key: readFileSync(httpsKey), cert: readFileSync(httpsCert) }, app)
  : createHttpServer(app);

server.on('upgrade', (req, socket, head) => {
  const requestURL = req.url || '';
  if (!hasSession(req)) {
    socket.destroy();
  } else if (/^\/wisp(?:\/|\?|$)/.test(requestURL)) {
    wisp.routeRequest(req, socket, head);
  } else if (/^\/chat(?:\?|$)/.test(requestURL)) {
    chat.handleUpgrade(req, socket, head, ws => chat.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const protocol = httpsKey && httpsCert ? 'https' : 'http';
server.listen(port, host, () => {
  console.log(`UGS listening on ${protocol}://${host}:${port}`);
  console.log(`Backends ready: Proxy | Chat | AI ${aiStatus().configured ? 'configured' : 'waiting for AI_API_KEY'}`);
});
