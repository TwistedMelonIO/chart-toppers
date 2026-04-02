# Chart Toppers — Session Handoff

> Last updated: 2026-04-02 | Version: v3.4.0
> Update this file at the end of every significant session.

---

## Quick Start for New Session

Paste this into your first message on any machine:

> I'm continuing work on Chart Toppers. Read `SESSION_HANDOFF.md` in the project root for full context, then tell me what you've absorbed.

---

## Project Overview

**Chart Toppers** is a live gameshow scoring system with QLab 5 integration. Two teams (Anthems vs Icons) compete across 4 rounds of music-based challenges. The server tracks scores, manages a countdown timer, sends OSC commands to QLab for audio playback, and serves a real-time dashboard via Socket.IO.

**Stack:** Node.js 20 / Express / Socket.IO / Docker / OSC (UDP+TCP) / QLab 5
**Repo:** `TwistedMelonIO/chart-toppers` (private)
**Port:** `localhost:3200` (dashboard), `53536` (OSC input from Companion)

---

## Architecture

```
Bitfocus Companion (OSC UDP :53536)
        |
        v
  src/server.js          -- Express + Socket.IO + UDP OSC listener
        |                    All game state, scoring, round management
        |                    REST API + real-time events
        | HTTP POST
        v
  bridge/server.js       -- OSC bridge container (osc-bridge:3201)
        |                    UDP fire-and-forget to QLab
        |                    TCP SLIP/OSC for bidirectional polling
        v
    QLab 5 (host)        -- Audio playback, text cues, file retargeting

  public/app.js          -- Dashboard client (Socket.IO)
  public/settings.js     -- Settings page (REST API only)
```

Both containers run in Docker. The bridge exists because Docker on macOS can't reliably send UDP to host.docker.internal from within a container.

Bitfocus Companion receives custom variable updates via HTTP API on port 8000 (genre names, track names).

---

## Show Structure & Scoring

| Round | Name | Tracks | Scoring | Max Earned |
|-------|------|--------|---------|------------|
| R1 | Name It In Five | 6 clips per genre | 1 pt = 2 secs | 12 secs |
| R2 | On Track | 4 tracks per genre | 1 pt = 5 secs | 20 secs |
| R3 | Mash Up Mayhem | 4 mashups per genre | 1 pt = 8 secs | 64 secs |
| R4 | Final Showdown | Rapid-fire clips | 1 pt (points only, NO time) | N/A |

- **Max timer:** 100 seconds (CONFIG.MAX_TIME)
- **Max earnable time:** 96 seconds (12+20+64)
- **Round 4:** Awards points only — no time added. QLab text cue still updates with point count.

---

## Music Pack System

Three complete packs in `data/packs/`:

| Pack | File | R1 | R2 | R3 | R4 |
|------|------|----|----|----|----|
| Pack 1: UK / USA / Germany | `uk-usa-german.json` | 114 (57x2) | 24 | 48 | 38 |
| Pack 2: Europe Med | `european.json` | 112 (56x2) | 24 | 48 | 40 |
| Pack 3: Teens | `teens.json` | 112 (56x2) | 24 | 48 | 39 |

### Pack JSON Structure
```json
{
  "packId": "uk-usa-german",
  "name": "Pack 1: UK / USA / Germany",
  "genres": { "1": ["70's 80's 90's", "Boy Bands", "Country Hits"], ... },
  "rounds": {
    "1": {
      "name": "Name It In Five",
      "scoring": "1 pt = 2 secs",
      "tracks": [
        { "cue": "R1T1.1", "fileName": "PACK_A_ROUND 1_TRACK_1.1_Stayin' Alive", "band": "The Bee Gees", "track": "Stayin' Alive", "genre": "70's 80's 90's" },
        { "cue": "R1T1.2", "fileName": "PACK_A_ROUND 1_TRACK_1.2_", "band": "The Bee Gees", "track": "Stayin' Alive", "genre": "70's 80's 90's" },
        ...
      ]
    }
  }
}
```

### Cue Numbering
- **Round 1:** `R1T{n}.1` (5-sec hook) / `R1T{n}.2` (10-sec reveal)
- **Rounds 2-4:** `R{round}T{n}`

### Pack Switching
When a pack is selected in Settings, `updateTrackCuesForPack()` iterates all tracks and sends OSC to QLab:
- `/cue/{cueNumber}/fileTarget` — retargets the audio file (basePath + fileName)
- `/cue/{cueNumber}/name` — updates the cue display name ("Band - Track")

### Audio Base Path
Configurable from Settings UI. Stored in `data/pack-settings.json`. No Docker restart needed — it's metadata sent via OSC.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/server.js` | Main server (~1,454 lines). All game logic, API endpoints, OSC handling |
| `bridge/server.js` | OSC bridge. UDP + TCP SLIP to QLab |
| `public/app.js` | Dashboard client. Socket.IO, license gate, team UI |
| `public/settings.js` | Settings page. Pack selection, audio path, activity log |
| `public/index.html` | Dashboard HTML. License gate overlay, team cards, points cards |
| `public/settings.html` | Settings HTML. Pack dropdown, audio path input |
| `data/pack-settings.json` | Persisted: currentPack, audioBasePath, lastChanged |
| `data/packs/*.json` | Track databases (3 packs) |
| `docker-compose.yml` | Two services: chart-toppers + osc-bridge |

---

## API Endpoints

### Game
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full game state + round state |
| POST | `/api/correct/:team` | Register correct answer (anthems/icons) |
| POST | `/api/reset/:team` | Reset one team |
| POST | `/api/reset` | Reset all teams |
| POST | `/api/stop/:team` | OSC stop for one team |

### Rounds
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/round` | Current round state |
| POST | `/api/round/next` | Advance to next round |
| POST | `/api/round/:num` | Set specific round (0-4) |

### Packs & Audio
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/pack-settings` | Get/set current pack |
| GET/POST | `/api/audio-path` | Get/set QLab audio folder path |
| GET | `/api/pack-tracks/:packId` | Get track data for a pack |
| POST | `/api/reload-packs` | Hot-reload packs from disk |

### License
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/license_status` | Current license state |
| POST | `/api/activate_license` | Activate with license key |

---

## Socket.IO Events

### Server -> Client
- `stateUpdate` — full game state on any change
- `roundUpdate` — round state on round change
- `teamReset` — team was reset
- `packChanged` — pack selection changed
- `countdownTick` — ~5fps during active playback
- `countdownStop` / `countdownComplete` — playback ended

### Client -> Server
- `correct` / `reset` / `stop` — game actions
- `setRound` / `nextRound` / `resetRounds` — round control

---

## Docker

```bash
# Rebuild
docker compose up -d --build

# Stop
docker compose stop

# Logs
docker compose logs -f chart-toppers
docker compose logs -f osc-bridge
```

**Named volume:** `chart-toppers-data:/app/data` persists license key, machine ID, pack settings, activity log.

---

## Known Issues & Cleanup Items

1. **`hideCountdown(teamId)` is called in app.js but never defined** — countdown display doesn't clear on team reset (minor bug)
2. **Duplicate socket events:** `teamPlaying`/`triggerPlaying` and `teamStopPlaying`/`triggerStop` are emitted for the same OSC event — legacy duplicates, only countdown events are used by the client
3. **`POINTS_PER_CORRECT` config (default 5)** is unused — `ROUND_SCORING` overrides it entirely
4. **Test files:** `test_copy.html`, `test_copy_fix.html` in root and public — dev artifacts, can be removed
5. **Settings password (`8888`)** is client-side only — no server-side guard on the settings page
6. **Countdown UI disabled** — commented out in app.js, needs re-syncing with QLab playback before re-enabling

---

## Session Log

### 2026-04-02 (Session 2) — Genre System, Companion Integration, Track Randomization

**What was done:**
- Added QLab pack arming: when a pack is selected, arms the selected pack cue group (P1/P2/P3) and disarms the others via `/cue/{group}/armed`
- Added genre cue system: G1-G9 text cues in QLab updated on pack change, SG1-SG3 start cues retarget to correct G cues on round change via `/cue/{sg}/cueTargetNumber`
- Integrated Companion HTTP API (port 8000): pushes `genre_g1`-`genre_g3` custom variables on round/pack change, `track_1`-`track_6` on genre load
- Companion API uses POST to `/api/custom-variable/{name}/value` with plain text body
- Added genre track randomization system: `/chart-toppers/loadgenre/{1-3}` OSC command randomly selects tracks from genre pool and retargets fixed QLab cue slots
- Round 1: picks 6 random track pairs (.1 hook + .2 reveal) from ~19 available
- Round 2/3: picks 4 random tracks from pool
- Also available as REST API: `POST /api/loadgenre/:index`
- Added VIDEO_OFFSET config (3s) to account for countdown video intro when sending loadActionAt to QLab
- Fixed packs directory: moved from data/packs/ to /app/packs/ in Docker to avoid named volume mount hiding the files
- Fixed Dockerfile to COPY data/packs/ to ./packs/
- Reset now clears playing state on dashboard for both teams
- Disabled countdown UI in dashboard (commented out, easy to re-enable when synced with QLab)
- Built AppleScript for replacing Stream Deck IDs in QLab Network cues (runs as QLab Script cue)

**Decisions made:**
- Companion custom variables approach (not direct button targeting) for flexibility
- Companion URL: `http://host.docker.internal:8000` from Docker container
- Genre OSC uses index (1-3) not name — server looks up genre name from current pack/round
- VIDEO_OFFSET = 3 seconds (calibrated by testing against actual countdown video)
- Only send loadActionAt on play when earnedTime > 0 (prevents jumping to end of video after reset)
- Pack JSON files live at /app/packs/ (outside the /app/data volume mount)

**What's next / pending:**
- Create `track_1` through `track_6` custom variables in Companion
- Re-sync countdown UI with QLab playback (disabled for now)
- Round 4 track loading works via pack change (all 38 tracks, no randomization needed)
- Test full show flow: pack select → round advance → genre load → play → score → countdown
- Address remaining known issues from previous session (hideCountdown bug, test file cleanup)

---

### 2026-04-02 — Pack Data & Scoring Overhaul (v3.3.0 -> v3.4.0)

**What was done:**
- Created 3 complete music pack JSON files from PDF data (uk-usa-german, european, teens)
- Replaced all demo track data with dynamic pack loading from `data/packs/` JSON files
- Added configurable QLab audio folder path (Settings UI + API + persistent storage)
- Implemented Round 4 points-only scoring (no time added, QLab text cue updates with points)
- Fixed scoring: R2 changed from 4s to 5s/pt, R3 changed from 6s to 8s/pt
- Added cue numbering system: R1T{n}.1/.2 for hook/reveal, R{2-4}T{n} for other rounds
- Added API endpoints: audio-path, pack-tracks, reload-packs
- Updated dashboard pack display names and points card for Round 4
- Fixed Pack 3 file naming: all PACK2_ prefixes corrected to PACK3_
- Bumped to v3.4.0, pushed to GitHub with release

**Decisions made:**
- Audio base path is metadata only — no Docker restart needed, just re-sends OSC commands
- Pack data lives in JSON files, not hardcoded in server.js — hot-reloadable via API
- Round 4 points stored in `team.points` separate from `team.earnedTime`
- QLab text cue receives points value (not time) during Round 4

**What's next / pending:**
- Docker needs rebuild on production Mac Studio after pulling latest
- Test QLab integration with actual audio files (set audio base path in Settings)
- Verify all cue numbers in QLab workspace match the R{round}T{track} pattern
- Address known issues listed above (hideCountdown bug, cleanup test files)

---

## How to Update This File

At the end of every significant session, add a new entry to the Session Log section above with:
1. Date and summary title
2. What was done (bullet points)
3. Key decisions made
4. What's next / pending

Keep the rest of the document current if architecture or API changes.
