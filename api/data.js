// /api/data — GET loads, POST saves game data to a PRIVATE Vercel Blob store.
//
// Storage layout (each is its own blob, for easier management):
//   roster.json              -> { roster: [names] }
//   season.json              -> { weeks: [ { id, week, date, key, hash } ] }  (index)
//   weeks/week-<id>.json      -> one game week object
//
// The client still exchanges a single { season: [...weeks], roster: [...] }
// object; this function assembles it on GET and splits it on POST. On POST only
// weeks whose content changed are rewritten (compared via a hash in the index).
// Legacy single-blob data (thuruppu-data.json) is migrated transparently.
import { put, list, del, get } from '@vercel/blob';

const ACCESS = 'private';
const ROSTER_KEY = 'roster.json';
const INDEX_KEY = 'season.json';
const LEGACY_KEY = 'thuruppu-data.json';
const weekKey = (id) => 'weeks/week-' + id + '.json';

function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}
function newId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function readJson(pathname) {
    const r = await get(pathname, { access: ACCESS });
    if (!r || !r.stream) return null;
    const text = await new Response(r.stream).text();
    return text ? JSON.parse(text) : null;
}

// Write a blob, overwriting; fall back to delete-then-create so a save can never
// fail on "already exists".
async function writeJson(pathname, obj) {
    const body = JSON.stringify(obj, null, 2);
    try {
        return await put(pathname, body, {
            access: ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json'
        });
    } catch (e) {
        try {
            const { blobs } = await list({ prefix: pathname });
            const existing = blobs.find(b => b.pathname === pathname);
            if (existing) await del(existing.url);
        } catch (_) { /* ignore cleanup errors */ }
        return await put(pathname, body, {
            access: ACCESS, addRandomSuffix: false, contentType: 'application/json'
        });
    }
}

async function loadAll() {
    const index = await readJson(INDEX_KEY);
    if (!index) {
        // Migration path: fall back to the legacy single blob if present.
        const legacy = await readJson(LEGACY_KEY);
        if (legacy) return { season: legacy.season || [], roster: legacy.roster || [] };
        return { season: [], roster: [] };
    }
    const [rosterObj, weeks] = await Promise.all([
        readJson(ROSTER_KEY),
        Promise.all((index.weeks || []).map(ref => readJson(ref.key)))
    ]);
    return {
        season: weeks.filter(Boolean),
        roster: (rosterObj && rosterObj.roster) || []
    };
}

async function saveAll(data) {
    const season = Array.isArray(data.season) ? data.season : [];
    const roster = Array.isArray(data.roster) ? data.roster : [];

    const oldIndex = await readJson(INDEX_KEY);
    const oldHash = {};
    const oldKeys = new Set();
    (oldIndex && oldIndex.weeks || []).forEach(r => { oldHash[r.key] = r.hash; oldKeys.add(r.key); });

    const weeksMeta = [];
    const newKeys = new Set();
    const writes = [];
    for (const w of season) {
        if (!w.id) w.id = newId();
        const key = weekKey(w.id);
        newKeys.add(key);
        const json = JSON.stringify(w);
        const hash = hashStr(json);
        if (oldHash[key] !== hash) writes.push(writeJson(key, w));
        weeksMeta.push({ id: w.id, week: w.week, date: w.date, key, hash });
    }

    writes.push(writeJson(ROSTER_KEY, { roster }));
    await Promise.all(writes);
    await writeJson(INDEX_KEY, { weeks: weeksMeta, savedAt: new Date().toISOString() });

    // Remove week blobs that are no longer referenced.
    const deletes = [];
    for (const key of oldKeys) if (!newKeys.has(key)) deletes.push(del(key).catch(() => {}));
    await Promise.all(deletes);
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
            return res.status(200).json(await loadAll());
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
            await saveAll(data);
            return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
        }

        res.status(405).json({ ok: false, error: 'method not allowed' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}
