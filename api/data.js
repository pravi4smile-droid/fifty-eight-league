// /api/data — GET loads, POST saves game data to a PRIVATE Vercel Blob store.
//
// Storage layout (each is its own blob, for easier management):
//   roster.json              -> { roster: [names] }
//   season.json              -> { weeks: [ { id, week, date, key, hash } ] }  (index)
//   weeks/week-<id>.json      -> one game week object
//   audit.json               -> { entries: [ { at, actor, action, lines } ] }
//
// The client still exchanges a single { season: [...weeks], roster: [...] }
// object; this function assembles it on GET and splits it on POST. On POST only
// weeks whose content changed are rewritten (compared via a hash in the index).
// Legacy single-blob data (thuruppu-data.json) is migrated transparently.
//
// Every POST is also diffed against what is already stored and the result is
// appended to the audit log — read back with GET /api/data?audit=1. Doing it
// here rather than in the client means no change can skip the log.
import { put, list, del, get } from '@vercel/blob';
import {
    AUDIT_MAX, clipEntries, clipLines, diffRoster, diffWeek, fmtDate, renamePair, summariseWeek, cleanActor
} from '../lib/audit.js';

const ACCESS = 'private';
const ROSTER_KEY = 'roster.json';
const INDEX_KEY = 'season.json';
const LEGACY_KEY = 'thuruppu-data.json';
const AUDIT_KEY = 'audit.json';
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

// Same read, but a missing or unparseable blob is just "nothing there". Used by
// the audit paths, where a read failure must never take a save down with it.
async function readJsonSafe(pathname) {
    try { return await readJson(pathname); } catch (_) { return null; }
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
        if (legacy) return { season: legacy.season || [], roster: legacy.roster || [], guests: legacy.guests || [] };
        return { season: [], roster: [], guests: [] };
    }
    const [rosterObj, weeks] = await Promise.all([
        readJson(ROSTER_KEY),
        Promise.all((index.weeks || []).map(ref => readJson(ref.key)))
    ]);
    return {
        season: weeks.filter(Boolean),
        roster: (rosterObj && rosterObj.roster) || [],
        guests: (rosterObj && rosterObj.guests) || []
    };
}

async function saveAll(data, actor) {
    const season = Array.isArray(data.season) ? data.season : [];
    const roster = Array.isArray(data.roster) ? data.roster : [];
    const guests = Array.isArray(data.guests) ? data.guests : [];

    const [oldIndex, oldRoster] = await Promise.all([readJson(INDEX_KEY), readJsonSafe(ROSTER_KEY)]);
    const oldHash = {};
    const oldKeys = new Set();
    const oldMeta = {};
    (oldIndex && oldIndex.weeks || []).forEach(r => { oldHash[r.key] = r.hash; oldKeys.add(r.key); oldMeta[r.key] = r; });

    const weeksMeta = [];
    const newKeys = new Set();
    const writes = [];          // thunks, so the audit can read the old blobs first
    const addedWeeks = [];
    const changedWeeks = [];
    for (const w of season) {
        if (!w.id) w.id = newId();
        const key = weekKey(w.id);
        newKeys.add(key);
        const json = JSON.stringify(w);
        const hash = hashStr(json);
        if (oldHash[key] !== hash) {
            writes.push(() => writeJson(key, w));
            (oldKeys.has(key) ? changedWeeks : addedWeeks).push({ key, week: w });
        }
        weeksMeta.push({ id: w.id, week: w.week, date: w.date, key, hash });
    }
    const goneKeys = [...oldKeys].filter(k => !newKeys.has(k));

    // Work out what changed while the old copies are still in the store.
    const entries = await auditEntries({
        oldIndex, oldRoster, roster, guests, addedWeeks, changedWeeks, goneKeys, oldMeta
    });

    writes.push(() => writeJson(ROSTER_KEY, { roster, guests }));
    await Promise.all(writes.map(run => run()));
    await writeJson(INDEX_KEY, { weeks: weeksMeta, savedAt: new Date().toISOString() });

    // Remove week blobs that are no longer referenced.
    await Promise.all(goneKeys.map(key => del(key).catch(() => {})));

    // The log is a convenience — never let it fail a save that already landed.
    try { await appendAudit(entries, actor); } catch (_) { /* ignore */ }
}

// Describe this save as a list of { action, lines }. Reads back only the week
// blobs whose hash moved, so a one-week edit costs one extra read.
async function auditEntries({ oldIndex, oldRoster, roster, guests, addedWeeks, changedWeeks, goneKeys, oldMeta }) {
    if (!oldIndex) {
        // First save into this store — there is no "before" worth diffing.
        const legacy = await readJsonSafe(LEGACY_KEY);
        const n = addedWeeks.length;
        return [{
            action: legacy ? 'Data moved to the split-blob layout' : 'Data set up',
            lines: [n + ' game day' + (n === 1 ? '' : 's') + ', ' + roster.length + ' players']
        }];
    }

    const before = {
        roster: (oldRoster && oldRoster.roster) || [],
        guests: (oldRoster && oldRoster.guests) || []
    };
    const after = { roster, guests };
    const rename = renamePair(before, after);

    const entries = [];
    const rl = diffRoster(before, after, rename);
    if (rl.length) entries.push({ action: 'Roster updated', lines: clipLines(rl) });

    addedWeeks.forEach(({ week }) => entries.push({
        action: 'Game day added · ' + fmtDate(week.date),
        lines: clipLines(summariseWeek(week))
    }));

    const olds = await Promise.all(changedWeeks.map(c => readJsonSafe(c.key)));
    changedWeeks.forEach(({ week }, i) => {
        if (!olds[i]) return;   // nothing to compare against
        const lines = diffWeek(olds[i], week, rename);
        if (lines.length) entries.push({
            action: 'Week ' + week.week + ' edited · ' + fmtDate(week.date),
            lines: clipLines(lines)
        });
    });

    goneKeys.forEach(key => {
        const m = oldMeta[key] || {};
        entries.push({
            action: 'Game day deleted · ' + fmtDate(m.date),
            lines: ['Was week ' + (m.week === undefined ? '?' : m.week)]
        });
    });

    return clipEntries(entries);
}

async function appendAudit(entries, actor) {
    if (!entries.length) return;
    const at = new Date().toISOString();
    const current = await readJsonSafe(AUDIT_KEY);
    let log = (current && Array.isArray(current.entries)) ? current.entries : [];
    entries.forEach(e => log.push({ at, actor, action: e.action, lines: e.lines }));
    if (log.length > AUDIT_MAX) log = log.slice(log.length - AUDIT_MAX);
    await writeJson(AUDIT_KEY, { entries: log });
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
            if (/[?&]audit=1(&|$)/.test(req.url || '')) {
                const log = await readJsonSafe(AUDIT_KEY);
                return res.status(200).json({ entries: (log && log.entries) || [] });
            }
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
            await saveAll(data, cleanActor(req.headers['x-actor']));
            return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
        }

        res.status(405).json({ ok: false, error: 'method not allowed' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}
