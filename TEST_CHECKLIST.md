# Chart Toppers — Manual Test Checklist

Walkthrough you can tick off during a dry run. Covers QLab-visible things the auto test script can't check (physical StreamDeck navigation, QLab cue playback, on-screen text, audio).

Run the full auto-test suite first (license persistence + game logic):
```
bash scripts/test-all.sh
```
This wraps `test-license-persistence.sh` and `test-rounds.py`. License tests run first and fail fast — game-logic tests are skipped if persistence is broken. Then use this checklist for the visual / audio stuff.

---

## Pre-test setup

- [ ] Docker containers running (`docker compose ps` shows both up)
- [ ] `docker compose logs -f chart-toppers` open in a terminal for live trace
- [ ] QLab workspace open
- [ ] StreamDeck / Companion running
- [ ] Buzzer device connected (if testing R1/R3)
- [ ] iPad stage host display open (http://<server>:3200/stagehost or equivalent)
- [ ] `curl -X POST http://localhost:3200/api/reset` — clean slate, round 0

---

## Round 1 — Name in 5 (buzzer round)

### 1A. Normal flow
- [ ] Enter R1 → StreamDeck shows SDE1
- [ ] 6 track pairs auto-loaded (log: `[R1 SHUFFLE] Loaded 6 random pairs`)
- [ ] Team 1 buzzes in → answer page appears
- [ ] Mark correct → earned time updates on dashboard
- [ ] Continue through all 6 pairs for team 1
- [ ] Fire `/chart-toppers/r1teamdone` → SD navigates to other team's answer page
- [ ] Fire `/chart-toppers/refreshgenre` → tracks reload + SD returns to SDE1
- [ ] Team 2 plays their 6 pairs
- [ ] Second `/r1teamdone` → R1GOTO → R2

### 1B. Golden Record in R1
- [ ] Activate Golden Record for one team (`/api/golden-record/{team}`)
- [ ] Next correct answer gives 2× time
- [ ] Dashboard shows GR used state

---

## Round 2 — On Track

### 2A. Non-tied R1 → R2 (leader auto-set)
- [ ] Enter R2 → leader plays first (check log: `[ROUND] R2 auto first-team`)
- [ ] StreamDeck on genre picker page (SDE8)
- [ ] G4/G5/G6 QLab text cues show current pack's R2 genres
- [ ] Pick a genre → R2T1/R2T2 load with correct songs
- [ ] StreamDeck returns to SDE1 after genre pick
- [ ] Team 1 plays, score correct answers
- [ ] Fire `/chart-toppers/refreshtracks` → tracks swap, SD navs to opponent page
- [ ] Team 2 plays, score correct answers
- [ ] Second `/refreshtracks` → R2GO2 → AWO (log: `Both teams played`)

### 2B. Tied R1 → R2 coin flip
- [ ] Start with tied R1 scores (use `/api/correct` evenly)
- [ ] Enter R2 → R2COINFLIP retargets to CF2 (log: `R2 COINFLIP] Draw detected`)
- [ ] Run coin flip, fire `/cointoss/{team}` → winner set as firstTeam
- [ ] Continue through genre pick + refresh flow as normal

### 2C. Buzzers stay disarmed throughout R2
- [ ] Enter R2 → log: `[R2 FLOW] Buzzers disarmed for Round 2`
- [ ] After every correct/incorrect in R2 → log shows defensive disarm
- [ ] Physical buzzers do not fire any QLab cue

---

## Round 3 — Mashup Madness

### 3A. Non-tied R2 → R3 (leader auto-set)
- [ ] Enter R3 → leader plays first
- [ ] StreamDeck on R3 genre picker (SDE9)
- [ ] G7/G8/G9 show `1980's`, `1990's`, `2000's` (universal mashups, same across all packs)
- [ ] Pick a genre → 4 random mashups load into R3T1–R3T4
- [ ] R3SCORES cue notes populated with all 4 answers in format `N. Band1 - Track1 & Band2 - Track2`
- [ ] Team 1 plays: press track → team buzzes → mark correct → SD returns to SDE1
- [ ] Buzzers arm for each new track and disarm on correct/incorrect
- [ ] Incorrect locks out the buzzing team until next track
- [ ] `/chart-toppers/refreshtracks` swaps for team 2

### 3B. Tied R2 → R3 coin flip
- [ ] Tied R2 → R3 entry → R3COINFLIP retargets to CF3
- [ ] Run coin flip, fire `/cointoss/{team}`
- [ ] Continue normally

---

## Round 4 — Final 100 Second Showdown

### 4A. Non-tied R3 → R4 (loser plays first)
- [ ] Enter R4 → R4NEXT points at loser's block (log: `R4NEXT → R4ICON` or `R4ANTHEM`)
- [ ] R4COINFLIP also points at loser's block
- [ ] LEADERSD points at loser's SDE page (R4 rule: loser plays first)
- [ ] DUALGO target → R5 (log: `DUALGO] Retargeting → R5 — R5 (winner reveal)`)
- [ ] Countdown videos loaded to correct position per team
- [ ] Fire R4NEXT → plays loser's block → countdown starts
- [ ] Score correct answers → R4 points accumulate
- [ ] At any point, if scores become tied → DUALGO flips to TIEBREAK live
- [ ] Team switches after first countdown finishes
- [ ] Fire `/chart-toppers/singlescores` → DUALGO armed (log: `[SINGLESCORES] DUALGO armed`)
- [ ] Fire `/chart-toppers/dualscreen` → DUALGO plays → SD navigates to final screen

### 4B. Tied R3 → R4 coin flip
- [ ] Tied R3 → R4 entry → R4NEXT → CF4, R4COINFLIP → CF4
- [ ] LEADERSD → SDE1 (neutral page)
- [ ] DUALGO target → TIEBREAK (tied at 0-R4 points too)
- [ ] Fire R4NEXT → plays coin flip group
- [ ] Coin flip resolves → fire `/cointoss/{winner}` → R4NEXT → winner's block
- [ ] LEADERSD flips to winner's SDE page
- [ ] Continue as normal

### 4C. R4 end with clear winner
- [ ] Play through both teams, one clearly ahead
- [ ] `/singlescores` → `/dualscreen` → DUALGO plays R5
- [ ] R5 winner reveal displays correct winner
- [ ] Buzzers stay disarmed throughout R4

### 4D. R4 end with a draw → TIEBREAK
- [ ] Play through both teams, scores equal at end
- [ ] `/singlescores` → DUALGO target = TIEBREAK
- [ ] `/dualscreen` → DUALGO plays TIEBREAK group
- [ ] Buzzers armed at tiebreaker start (log: `arm IBUZZ/ABUZZ for tiebreaker`)
- [ ] Tiebreak question plays
- [ ] A team buzzes in, mark correct → tiebreakActive cleared
- [ ] Winner shown

---

## Cross-round tests

### Pack switching
- [ ] Switch to `uk-usa-german` → G1-G6 reflect Pack 1 genres, G7-G9 stay `1980's/1990's/2000's`
- [ ] Switch to `european` → G1-G3 change, G4-G9 stay pinned
- [ ] Switch to `teens` → G1-G3 change to `RETRO CLASSICS/TIKTOK HITS/K POP`, G4 = `GRAMMY WINNERS`

### Golden Record across rounds
- [ ] Team uses GR in R1 → enters R2 → GR available again
- [ ] Team uses GR in R2 → enters R3 → GR available again
- [ ] GR not available in R4 (blocked by `activateGoldenRecord`)

### Score randomisation (dev helper)
- [ ] `POST /api/randomise-round3` → both teams get ~30s earned
- [ ] `POST /api/randomise-round3?seconds=10` → both teams ~10s (with ±3 jitter)
- [ ] Countdown video cues load to correct position

### Reset
- [ ] `POST /api/reset` → all scores 0, GR available, round 0, no current team
- [ ] `POST /api/reset/{team}` → only that team resets
- [ ] DUALGO returned to default R5, IBUZZ/ABUZZ/JUMP re-disarmed

---

## License persistence (rollout verification — v5.4.0+)

Run these once per machine after deploying v5.4.0 to confirm the dual-tier persistence is working. The license must survive every scenario below without manual re-activation.

### Pre-checks
- [ ] App boots showing `valid: true` at `http://localhost:3200/api/license_status`
- [ ] Host backup exists: `ls ~/.twisted-melon/chart-toppers/` shows `license_key` and `machine_id`
- [ ] Volume copy exists: `docker compose exec chart-toppers ls /app/data/` shows `license_key` and `machine_id`

### T1 — Container restart
- [ ] `docker compose restart chart-toppers` → license still valid

### T2 — Rebuild
- [ ] `docker compose up -d --build` → license still valid (logs: `Active license key resolved`)

### T3 — Force recreate without env var
- [ ] `unset LICENSE_KEY && docker compose up -d --force-recreate` → license still valid
- [ ] Logs show key resolved from volume, not env

### T4 — Volume destruction (the killer test)
- [ ] `docker compose down -v` (note the `-v` — destroys the volume)
- [ ] `docker compose up -d`
- [ ] Logs show: `Restored volume from host backup: license_key` and `Restored volume from host backup: machine_id`
- [ ] License valid at `/api/license_status`

### T5 — Host backup destruction (reverse direction)
- [ ] License valid before starting
- [ ] `rm -rf ~/.twisted-melon/chart-toppers/` while container is running
- [ ] `docker compose restart chart-toppers`
- [ ] Logs show: `Restored host backup: license_key` and `Restored host backup: machine_id`
- [ ] Host folder repopulated: `ls ~/.twisted-melon/chart-toppers/` shows both files restored
- [ ] License still valid

### T6 — Mac mini reboot simulation
- [ ] `docker compose down` (no `-v`)
- [ ] Reboot the Mac OR fully quit Docker Desktop
- [ ] Start Docker Desktop, wait for container auto-start (`restart: unless-stopped`)
- [ ] License valid without any human action

### T7 — Bad-key paste in web UI doesn't break things
- [ ] Note current valid licensee name from `/api/license_status`
- [ ] Open web UI, paste a junk string into the license field, click Activate
- [ ] Activation rejected
- [ ] `cat ~/.twisted-melon/chart-toppers/license_key` still shows the original valid key
- [ ] Container restart → license still valid (junk paste did NOT clobber disk)

### T8 — Docker Desktop factory reset (do not run unless you want to)
- [ ] Docker Desktop → Troubleshoot → Reset to factory defaults
- [ ] Re-clone repo, `docker compose up -d --build`
- [ ] Logs show: `Restored volume from host backup: license_key`
- [ ] License valid without re-activation

If any of T1–T7 fail, **do not roll out** — escalate before the demo. T8 is destructive to other Docker workloads, only run on a dedicated test machine.

---

## Known gotchas to watch for

- **Genre text casing**: R2/R3 genres are pinned uppercase in the server except year suffixes (e.g. `1980's` not `1980'S`)
- **R4NEXT in tied case**: fires coin flip (CF4) until `/cointoss` resolves, then flips to winner
- **R4 retarget race**: `/singlescores` arms DUALGO, `/dualscreen` uses `await` to ensure arm arrives at QLab before start
- **R1 auto-randomise**: tracks auto-load on R1 entry, no genre pick needed (buzzer round)
- **R2 refresh**: state-based (driven by `r2PlayedTeams`), idempotent — repeated refresh calls don't double-advance
