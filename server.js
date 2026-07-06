// Local development server - mimics the Vercel API using file storage
// Run: node server.js  (production uses api/ serverless functions + Vercel Blob)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'thuruppu-data.json');

// Load a local .env file (git-ignored) for dev credentials — no secrets in code.
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
if (!AUTH_USER || !AUTH_PASS) {
    console.error('Missing AUTH_USER / AUTH_PASS. Copy .env.example to .env and set them.');
    process.exit(1);
}
const TOKEN = Buffer.from(AUTH_USER + ':' + AUTH_PASS).toString('base64');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (e) { return { season: [], roster: [] }; }
}

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 10e6) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
}

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/api/login' && req.method === 'POST') {
        const body = await readBody(req);
        if (body && body.username === AUTH_USER && body.password === AUTH_PASS) {
            return json(res, 200, { ok: true, token: TOKEN });
        }
        return json(res, 401, { ok: false, error: 'Wrong username or password' });
    }

    if (url === '/api/data') {
        if (req.headers['x-auth-token'] !== TOKEN) return json(res, 401, { ok: false, error: 'unauthorized' });
        if (req.method === 'GET') return json(res, 200, readData());
        if (req.method === 'POST') {
            const data = await readBody(req);
            if (!data) return json(res, 400, { ok: false, error: 'invalid body' });
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            return json(res, 200, { ok: true, savedAt: new Date().toISOString() });
        }
        return json(res, 405, { ok: false });
    }

    // static
    let filePath = path.join(__dirname, url === '/' ? 'index.html' : path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
    if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log('Thuruppu Tracker (local dev) at http://localhost:' + PORT);
    console.log('Login: ' + AUTH_USER + ' / ' + AUTH_PASS);
});
