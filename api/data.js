// /api/data — GET loads, POST saves game data to Vercel Blob storage
import { put, list, del } from '@vercel/blob';

const BLOB_NAME = 'thuruppu-data.json';

// Overwrite the single data blob. Uses allowOverwrite where supported and
// falls back to delete-then-create so a save can never fail on "already exists".
async function saveBlob(body) {
    try {
        return await put(BLOB_NAME, body, {
            access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json'
        });
    } catch (e) {
        try {
            const { blobs } = await list({ prefix: BLOB_NAME });
            const existing = blobs.find(b => b.pathname === BLOB_NAME);
            if (existing) await del(existing.url);
        } catch (_) { /* ignore cleanup errors */ }
        return await put(BLOB_NAME, body, {
            access: 'public', addRandomSuffix: false, contentType: 'application/json'
        });
    }
}

function expectedToken() {
    const user = process.env.AUTH_USER;
    const pass = process.env.AUTH_PASS;
    if (!user || !pass) return null;
    return Buffer.from(user + ':' + pass).toString('base64');
}

export default async function handler(req, res) {
    const token = expectedToken();
    if (!token) {
        return res.status(500).json({ ok: false, error: 'AUTH_USER / AUTH_PASS not configured' });
    }
    if (req.headers['x-auth-token'] !== token) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    try {
        if (req.method === 'GET') {
            const { blobs } = await list({ prefix: BLOB_NAME });
            const blob = blobs.find(b => b.pathname === BLOB_NAME);
            if (!blob) return res.status(200).json({ season: [], roster: [] });
            // cache-busting query so we always read the latest version
            const r = await fetch(blob.url + '?t=' + Date.now());
            const data = await r.json();
            return res.status(200).json(data);
        }

        if (req.method === 'POST') {
            // req.body is usually parsed by Vercel, but accept a raw string too.
            let data = req.body;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (_) { data = null; }
            }
            if (!data || typeof data !== 'object') {
                return res.status(400).json({ ok: false, error: 'invalid body' });
            }
            await saveBlob(JSON.stringify(data, null, 2));
            return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
        }

        res.status(405).json({ ok: false, error: 'method not allowed' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}
