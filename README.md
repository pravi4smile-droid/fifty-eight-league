# Fifty Eight League — Thuruppu Game Tracker

Weekly score tracker for Thuruppu (28/56). Supports 4/6/8/10 players, roster with
dropdown seat assignment, round-table view with team colors, team & thani bid scoring,
automatic 6-6 round resets, end-of-week points tally, and a per-player season leaderboard.

Login protected. Data is stored in **Vercel Blob** when deployed (survives refresh,
redeploys, and works across all your friends' phones).

## Deploy to Vercel (one time, ~5 minutes)

1. Push this repo to GitHub (see below)
2. Go to https://vercel.com → **Add New → Project** → import `fifty-eight-league`
3. Framework preset: **Other**. No build settings needed. Click **Deploy**
4. After first deploy: open the project → **Storage** tab → **Create Database → Blob**
   → create a store and **Connect** it to this project
   (this auto-adds the `BLOB_READ_WRITE_TOKEN` environment variable)
5. Go to **Deployments** → redeploy the latest deployment
6. Done. Open your Vercel URL and sign in.

### Login

Credentials are **required environment variables** — there are no hardcoded
defaults in the code. In Vercel → Settings → Environment Variables, add
`AUTH_USER` and `AUTH_PASS`, then redeploy. Without them, the login/data APIs
return a 500 "not configured" error.

## Auto-deploy

Vercel's built-in Git integration deploys automatically on every push to `main`
once the repo is imported into Vercel (see the deploy steps above). No GitHub
Actions workflow is needed. App secrets (`AUTH_USER`, `AUTH_PASS`,
`BLOB_READ_WRITE_TOKEN`) live in Vercel's Environment Variables, never in the repo.

## Push to GitHub

```bash
cd thuruppu-app
git init
git add .
git commit -m "Thuruppu tracker with Vercel Blob storage and login"
git branch -M main
git remote add origin https://github.com/pravi4smile-droid/fifty-eight-league.git
git push -u origin main
```

(If the repo doesn't exist yet, create it first at https://github.com/new)

## Run locally

```bash
cp .env.example .env    # then edit AUTH_USER / AUTH_PASS
node server.js          # no npm install needed for local dev
```

Open http://localhost:3000 — locally, data is saved to `data/thuruppu-data.json`.

## How storage works

| Where | Storage | Persists? |
|---|---|---|
| Vercel (production) | Vercel Blob via `/api/data` | Yes — shared for everyone |
| Local dev | `data/` folder on disk | Yes |
| Browser | localStorage fallback | Yes, per device; syncs up when server reachable |

You can still Export/Import JSON from the Data tab any time for extra GitHub backups.

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
Season leaderboard ranks players by their end-of-week tally totals, with round wins
as tiebreaker.
