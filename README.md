# Fifty Eight League — Thuruppu Game Tracker

Weekly score tracker for Thuruppu (28/56). Supports 4/6/8/10 players, a saved
roster with dropdown seat assignment, round-table view with team colours, team &
thani bid scoring, automatic 6-6 round resets, end-of-week points tally, and a
per-player season leaderboard.

Login protected. When deployed and online, **every change is saved to a private
Vercel Blob store** and shared across all your friends' devices (it survives
refreshes and redeploys). If the server can't be reached it falls back to the
browser's local storage and syncs up when it's back online — the header badge
shows which state you're in.

## Using the app

Five tabs along the bottom:

- **New game** — pick how many are playing, assign seats (alternate seats =
  alternate teams), enter the bid, and save each game. Team scores auto-reset to
  6-6 when a round is won.
- **This week** — the current week's games, rounds won, and the end-of-week
  points tally entry.
- **Season** — leaderboard, season stats, a **per-week matchup summary** (who was
  on Team 1 vs Team 2 and the final score), **Add a past game day**, and
  **Edit points** on any past week.
- **Roster** — your regular players. Add once; tap ✎ to **rename** (the change
  propagates through all past games) or × to remove (history is kept).
- **Data** — export/import a JSON backup, view raw data, sign out.

### Add a past game day

On the **Season** tab, "Add a past game day" lets you log a night you didn't
track live: pick the date (calendar), enter each team's score, and tap T1/T2 per
player. **The team score is given to every player on that team** for the
leaderboard; type a number in a player's box only to override that one player.

### Edit a previous week's points

Each week card on the **Season** tab has an **Edit points** button. For manually
entered weeks you can change the team scores (which re-apply to everyone, minus
any overrides); for live-tracked weeks you can adjust each player's tally.

### King Maker & Joker badges (12-0 rounds)

In both the "Add a past game day" and "Edit points" forms you can record **12-0
rounds** (only when a round was actually won 12-0). For each one, pick the
winning team:

- 👑 **King Maker** — every player on the winning team gets a King Maker badge
  worth **+2** points.
- 🃏 **Joker** — every player on the losing team gets a Joker (tracked as a
  count, no points).
- ❌🃏 **Lifted Joker** — tap any losing player who lifted their Joker away; they
  get **+2**.

A week can have several 12-0 rounds (e.g. one 12-0 and one 0-12). The leaderboard
shows each player's total 👑 / 🃏 / ❌🃏 counts and folds the badge points into
their score.

## Deploy to Vercel (one time, ~5 minutes)

1. Push this repo to GitHub (already set up — just `git push`)
2. Go to https://vercel.com → **Add New → Project** → import `fifty-eight-league`
3. Framework preset: **Other**. No build settings needed. Click **Deploy**
4. Open the project → **Storage** tab → **Create Database → Blob** → set access to
   **Private** → create the store and **Connect** it to this project
   (this auto-adds the `BLOB_READ_WRITE_TOKEN` environment variable)
5. Add the login credentials (see below), then **Deployments → Redeploy** the
   latest deployment so the new env vars take effect
6. Done. Open your Vercel URL and sign in.

> The store must be **Private** — the API reads it server-side via the Blob
> SDK's `get()` and never exposes a public URL. A store's access mode is fixed at
> creation, so choose Private when you create it.

### Login

Credentials are **required environment variables** — there are no hardcoded
defaults in the code. In Vercel → Settings → Environment Variables, add
`AUTH_USER` and `AUTH_PASS`, then redeploy. Without them the login/data APIs
return a 500 "not configured" error.

## Auto-deploy

Vercel's built-in Git integration deploys automatically on every push to `main`
once the repo is imported. No GitHub Actions workflow is needed. App secrets
(`AUTH_USER`, `AUTH_PASS`, `BLOB_READ_WRITE_TOKEN`) live in Vercel's Environment
Variables, never in the repo.

## Push to GitHub

```bash
git add -A
git commit -m "your message"
git push
```

## Run locally

```bash
cp .env.example .env    # then edit AUTH_USER / AUTH_PASS
node server.js          # no npm install needed for local dev
```

Open http://localhost:3000 — locally, data is saved to `data/thuruppu-data.json`
(the local dev server uses file storage; Vercel Blob is only used in production).

## How storage works

| Where | Storage | Persists? |
|---|---|---|
| Vercel (production) | Private Vercel Blob via `/api/data` | Yes — shared across all devices |
| Local dev | `data/` folder on disk | Yes |
| Browser | localStorage fallback | Yes, per device; syncs up when the server is reachable |

Export/Import JSON from the Data tab any time for an extra backup.

## Scoring rules

| Scenario | Bidding team | Opposite team |
|---|---|---|
| Bid 28-40 made | +1 | -1 |
| Bid 28-40 lost | -2 | +2 |
| Bid >40 made | +2 | -2 |
| Bid >40 lost | -3 | +3 |
| Thani made | +3 | -3 |
| Thani lost | -4 | +4 |

Teams start each round at 6-6. When a team drops below 0, the other team wins the
round and scores reset to 6-6. Multiple rounds can happen in one game week.
The season leaderboard ranks players by their end-of-week tally totals, with round
wins as the tiebreaker.
