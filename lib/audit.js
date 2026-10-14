// Audit lines — turns a before/after snapshot of the game data into short,
// human-readable descriptions of what actually changed.
//
// Pure: no storage and no clock, so `/api/data` (Vercel Blob) and `server.js`
// (local files) can share it. Callers stamp the time and the actor.

export const AUDIT_MAX = 500;    // entries kept in the log
export const MAX_LINES = 14;     // lines kept per entry
export const MAX_ENTRIES = 12;   // entries kept per save

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dates are stored as plain 'YYYY-MM-DD'. Parse the parts by hand rather than
// going through Date(), which reads them as UTC and shifts a day westward.
export function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    if (!m) return String(d || 'no date');
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

const names = (a) => a.slice().sort((x, y) => x.localeCompare(y)).join(', ');
const pts = (v) => (v === undefined || v === null || v === '' ? '—' : String(v));
const teamName = (t) => (t === 'team1' ? 'Team 1' : t === 'team2' ? 'Team 2' : '—');
const sorted = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));

export function clipLines(lines, max = MAX_LINES) {
    if (lines.length <= max) return lines;
    return lines.slice(0, max).concat('…and ' + (lines.length - max) + ' more');
}

// A rename in the app removes one roster name and adds another in the same
// save, then rewrites that name through every past week. Spotting the pair lets
// us log one "renamed" line instead of an add, a remove, and an edit entry for
// every week of the season. Nothing else in the UI can shrink the roster, so a
// 1-for-1 swap is a rename.
export function renamePair(before, after) {
    const b = before.roster || [], a = after.roster || [];
    const added = a.filter(n => !b.includes(n));
    const removed = b.filter(n => !a.includes(n));
    if (added.length === 1 && removed.length === 1) return { from: removed[0], to: added[0] };
    return null;
}

export function diffRoster(before, after, rename) {
    const lines = [];
    const b = before.roster || [], a = after.roster || [];
    const bg = before.guests || [], ag = after.guests || [];

    if (rename) {
        lines.push('Renamed ' + rename.from + ' to ' + rename.to);
    } else {
        a.filter(n => !b.includes(n))
            .forEach(n => lines.push('+ ' + n + ' added' + (ag.includes(n) ? ' as a guest' : ' to the roster')));
        b.filter(n => !a.includes(n))
            .forEach(n => lines.push('− ' + n + ' removed from the roster'));
    }

    // Guest flags, ignoring names the lines above already cover.
    const covered = (n) => (rename && (n === rename.from || n === rename.to)) || a.includes(n) !== b.includes(n);
    const mapped = (n) => (rename && n === rename.from ? rename.to : n);
    const bgSet = new Set(bg.map(mapped));
    ag.forEach(n => { if (!bgSet.has(n) && !covered(n)) lines.push(n + ' marked as a guest'); });
    const agSet = new Set(ag);
    bg.map(mapped).forEach(n => { if (!agSet.has(n) && !covered(n)) lines.push(n + ' is now a regular'); });

    return lines;
}

function teamOf(week, name) {
    const p = week.players || {};
    if ((p.team1 || []).includes(name)) return 'team1';
    if ((p.team2 || []).includes(name)) return 'team2';
    return null;
}
function weekNames(week) {
    const p = week.players || {};
    return new Set((p.team1 || []).concat(p.team2 || []).concat(Object.keys(week.finalTally || {})));
}
// The week's 12-0 rounds as a stable string, e.g. "Team 1 + Team 2".
function koSummary(week) {
    const ko = week.koRounds || [];
    if (!ko.length) return 'none';
    return ko.map(r => teamName(r.winner)).sort().join(' + ');
}
function koCrossed(week, map) {
    const s = new Set();
    (week.koRounds || []).forEach(r => (r.crossed || []).forEach(n => s.add(map(n))));
    return s;
}

export function diffWeek(before, after, rename) {
    const map = rename ? (n => (n === rename.from ? rename.to : n)) : (n => n);
    // Read the old week under the new name, so a rename on its own says nothing.
    const old = rename ? JSON.parse(JSON.stringify(before)) : before;
    if (rename) {
        const p = old.players || (old.players = {});
        p.team1 = (p.team1 || []).map(map);
        p.team2 = (p.team2 || []).map(map);
        const ft = {};
        Object.entries(old.finalTally || {}).forEach(([k, v]) => { ft[map(k)] = v; });
        old.finalTally = ft;
    }

    const lines = [];
    if (old.date !== after.date) lines.push('Date ' + fmtDate(old.date) + ' → ' + fmtDate(after.date));

    const bs = old.teamScores || {}, as = after.teamScores || {};
    if (bs.team1 !== as.team1 || bs.team2 !== as.team2) {
        lines.push('Team score ' + pts(bs.team1) + '–' + pts(bs.team2) + ' → ' + pts(as.team1) + '–' + pts(as.team2));
    }

    const bt = old.finalTally || {}, at = after.finalTally || {};
    sorted(new Set([...weekNames(old), ...weekNames(after)])).forEach(n => {
        const mb = teamOf(old, n), ma = teamOf(after, n);
        const vb = bt[n], va = at[n];
        if (!mb && ma) {
            lines.push('+ ' + n + ' on ' + teamName(ma) + (va === undefined ? '' : ' · ' + va + ' pts'));
        } else if (mb && !ma) {
            lines.push('− ' + n + ' off ' + teamName(mb));
        } else {
            if (mb !== ma) lines.push(n + ': ' + teamName(mb) + ' → ' + teamName(ma));
            if (vb !== va) lines.push(n + ' ' + pts(vb) + ' → ' + pts(va));
        }
    });

    const kb = koSummary(old), ka = koSummary(after);
    if (kb !== ka) lines.push('12-0 rounds: ' + kb + ' → ' + ka);
    const cb = koCrossed(old, map), ca = koCrossed(after, n => n);
    sorted(ca).forEach(n => { if (!cb.has(n)) lines.push(n + ' lifted their Joker'); });
    sorted(cb).forEach(n => { if (!ca.has(n)) lines.push(n + ' no longer lifted their Joker'); });

    return lines;
}

export function summariseWeek(week) {
    const p = week.players || {}, s = week.teamScores || {}, ft = week.finalTally || {};
    const lines = [];
    if ((p.team1 || []).length) lines.push('Team 1 (' + pts(s.team1) + '): ' + names(p.team1));
    if ((p.team2 || []).length) lines.push('Team 2 (' + pts(s.team2) + '): ' + names(p.team2));
    const ko = koSummary(week);
    if (ko !== 'none') lines.push('12-0 rounds: ' + ko);
    // Only call out players whose points differ from their team's score.
    const own = Object.keys(ft)
        .filter(n => { const t = teamOf(week, n); return t ? ft[n] !== s[t] : true; })
        .sort((a, b) => a.localeCompare(b));
    if (own.length) lines.push('Own points: ' + own.map(n => n + ' ' + pts(ft[n])).join(', '));
    return lines;
}

export function clipEntries(entries) {
    if (entries.length <= MAX_ENTRIES) return entries;
    const rest = entries.length - MAX_ENTRIES;
    return entries.slice(0, MAX_ENTRIES).concat({
        action: 'And ' + rest + ' more change' + (rest > 1 ? 's' : ''),
        lines: entries.slice(MAX_ENTRIES).map(e => e.action)
    });
}

// Full before/after diff. `server.js` uses this directly; the Blob API builds
// the same entries week by week so it only reads the blobs that changed.
export function diffData(before, after) {
    const rename = renamePair(before, after);
    const entries = [];

    const rl = diffRoster(before, after, rename);
    if (rl.length) entries.push({ action: 'Roster updated', lines: clipLines(rl) });

    const byId = new Map((before.season || []).filter(w => w && w.id).map(w => [w.id, w]));
    const afterIds = new Set((after.season || []).map(w => w && w.id));

    (after.season || []).forEach(w => {
        if (!w) return;
        const old = byId.get(w.id);
        if (!old) {
            entries.push({ action: 'Game day added · ' + fmtDate(w.date), lines: clipLines(summariseWeek(w)) });
            return;
        }
        const l = diffWeek(old, w, rename);
        if (l.length) entries.push({ action: 'Week ' + w.week + ' edited · ' + fmtDate(w.date), lines: clipLines(l) });
    });

    (before.season || []).forEach(w => {
        if (w && w.id && !afterIds.has(w.id)) {
            entries.push({ action: 'Game day deleted · ' + fmtDate(w.date), lines: clipLines(summariseWeek(w)) });
        }
    });

    return clipEntries(entries);
}

// A display name supplied by the client, made safe to store and re-render.
// Sent percent-encoded because HTTP headers can't carry non-latin1 characters.
export function cleanActor(raw) {
    let v = String(Array.isArray(raw) ? raw[0] : (raw || ''));
    try { v = decodeURIComponent(v); } catch (_) { /* keep it as sent */ }
    // Drop control characters without writing any into this source file.
    v = Array.from(v).filter(ch => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; }).join('');
    return v.trim().slice(0, 40) || 'someone';
}
