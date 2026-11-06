// Serves diii for development: http://localhost:<port> (Web Serial needs
// localhost or HTTPS). No dependencies, so it runs without `npm install`.
//
//   node tools/serve.mjs [port] [--watch]      (default 8000, or $PORT)
//
// --watch reloads open pages when a file changes: a stylesheet is swapped in
// place (the serial connection stays up), anything else reloads the page. It
// also answers sw.js with a worker that caches nothing and clears diii's
// caches, since the real one (stale-while-revalidate) would show each edit
// one reload late.

import { watch as watchFiles } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8000);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.map': 'application/json'
};

// ------------------------------------------------------------------ watch mode

const EVENTS_PATH = '/__watch';

// added to every HTML page: reload on a change, or swap the stylesheet
const CLIENT = `<script>
(() => {
    const events = new EventSource('${EVENTS_PATH}');
    events.onmessage = (event) => {
        const files = JSON.parse(event.data);
        if (files.every((f) => f.endsWith('.css'))) {
            for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
                const url = new URL(link.href);
                if (!files.some((f) => url.pathname.endsWith('/' + f))) continue;
                url.searchParams.set('v', Date.now());
                link.href = url.href;
            }
            console.info('[watch] restyled:', files.join(', '));
        } else {
            location.reload();
        }
    };
})();
</script>`;

// the dev stand-in for sw.js: no cache, so every load is the files on disk
const DEV_WORKER = `// tools/serve.mjs --watch: caches nothing, and clears what diii cached
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith('diii')).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});
`;

const IGNORED = /(^|[\\/])(\.git|node_modules|dist)([\\/]|$)/;

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

if (watch) {
    /** @type {Set<string>} */
    let changed = new Set();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    // editors save in several steps; one message per burst
    watchFiles(root, { recursive: true }, (_event, name) => {
        if (!name || IGNORED.test(name)) return;
        changed.add(String(name).split(sep).join('/'));
        clearTimeout(timer);
        timer = setTimeout(() => {
            const files = [...changed];
            changed = new Set();
            console.log(`changed: ${files.join(', ')}`);
            for (const res of clients) res.write(`data: ${JSON.stringify(files)}\n\n`);
        }, 120);
    });
}

// ------------------------------------------------------------------ server

createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);

    if (watch && urlPath === EVENTS_PATH) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive'
        });
        res.write(': watching\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }
    if (watch && urlPath === '/sw.js') {
        res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' }).end(DEV_WORKER);
        return;
    }

    let file = normalize(join(root, urlPath));
    if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
        res.writeHead(403).end();
        return;
    }
    try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        let body = await readFile(file);
        if (watch && extname(file) === '.html') {
            const html = body.toString('utf8');
            const at = html.lastIndexOf('</body>');
            body = Buffer.from(at < 0 ? html + CLIENT : html.slice(0, at) + CLIENT + html.slice(at));
        }
        // no-store: edits show up on reload without fighting the browser cache
        res.writeHead(200, {
            'Content-Type': types[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
}).listen(port, '127.0.0.1', () => {
    const mode = watch ? ', reloading on changes' : '';
    console.log(`diii at http://localhost:${port}${mode}  (Ctrl+C to stop)`);
    if (watch) console.log(`watching ${relative(process.cwd(), root) || '.'}`);
});
