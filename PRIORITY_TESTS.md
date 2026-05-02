# Priority Test Checklist

Top 5 things to verify in a QLab dry run. Tick each as you go.

---

## 1. R4 DUALGO flow — ending in a draw

- [ ] Randomise R3 scores, enter R4
- [ ] Play both R4 countdowns so final scores end up **tied**
- [ ] Fire `/chart-toppers/singlescores` → log shows `DUALGO armed`
- [ ] Fire `/chart-toppers/dualscreen` → log shows `DUALGO → TIEBREAK`
- [ ] TIEBREAK group plays in QLab
- [ ] IBUZZ + ABUZZ armed for tiebreak answer
- [ ] Buzz in on tiebreak → mark correct → log shows `TB stopped`, `tiebreakActive` cleared

---

## 2. R2 tied R1 → coin flip → refresh flow

- [ ] Start R1 tied (e.g. both teams 2 correct)
- [ ] Enter R2 → log `R2 COINFLIP] Draw detected`
- [ ] CF2 plays in QLab (coin flip animation)
- [ ] Fire `/cointoss/{winner}` → winner set as firstTeam, SD navs to genre page
- [ ] Pick a genre → R2T1/R2T2 load, SD → SDE1
- [ ] Winner plays, score correct answers (buzzers stay disarmed)
- [ ] Fire `/refreshtracks` → tracks swap for other team, SD navs to opponent answer page
- [ ] Other team plays, score correct answers
- [ ] Fire `/refreshtracks` again → log `Both teams played — retargeting R2GO2 → AWO`

---

## 3. R3 mashup + R3SCORES notes

- [ ] Enter R3, pick a genre (e.g. 1990's)
- [ ] 4 mashups load into R3T1–R3T4
- [ ] R3SCORES cue notes show 4 lines in format `N. Band1 - Track1 & Band2 - Track2`
- [ ] Fire R3T1 → team buzzes → mark correct → SD returns to SDE1, buzzers disarm
- [ ] Fire R3T2 → wrong team buzzes first → mark incorrect → that team's buzzer locks out, track resumes
- [ ] Other team buzzes → mark correct → OK
- [ ] Complete round, advance to R4

---

## 4. Pack switching mid-session

- [ ] Start with `uk-usa-german` — verify G1/G2/G3 = `70's 80's 90's / BOY BANDS / COUNTRY HITS`
- [ ] Verify G4/G5/G6 = `ROOF RAISERS / HEART STRINGS / FLOOR FILLERS`
- [ ] Verify G7/G8/G9 = `1980's / 1990's / 2000's`
- [ ] Switch to `european` — G1/G2/G3 change to `LATIN / BOY BANDS / MEDITERRANEAN CLASSICS`, G4-G9 stay
- [ ] Switch to `teens` — G1/G2/G3 change to `RETRO CLASSICS / TIKTOK HITS / K POP`, G4 = `GRAMMY WINNERS`, G5 = `MUSICALS`, G6 = `INDIE`
- [ ] Switch back to `uk-usa-german` — G1-G6 return to Pack 1 values

---

## 5. Golden Record refresh across rounds

- [ ] R1: activate Golden Record for Anthems (`/api/golden-record/anthems`)
- [ ] Verify Anthems GR armed in dashboard
- [ ] Mark a correct answer → verify 2× time applied (GR used state)
- [ ] Enter R2 → Anthems GR `available=true`, `used=false` again (refreshed)
- [ ] Activate GR for Icons in R2
- [ ] Enter R3 → Icons GR refreshed
- [ ] Try to activate GR in R4 → should be blocked (log: `Golden Record not available in round 4`)

---

## Results

- [ ] All 5 priority tests passed
- [ ] Auto test passed (`python3 scripts/test-rounds.py` → 10/10)
- [ ] Ready for live show
