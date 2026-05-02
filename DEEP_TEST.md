# Chart Toppers — Deep Test Plan v4.2.2

## Pre-Test Setup
- [ ] Docker containers running (`docker compose up -d --build`)
- [ ] Buzzer script running with OSC (`~/chart-toppers/buzzer/`)
- [ ] QLab workspace open with all cues
- [ ] StreamDeck/Companion connected
- [ ] Web UI open at `localhost:3200`
- [ ] Master reset via API before starting

## Scoring Reference
| Round | Per Correct | Notes |
|-------|------------|-------|
| R1 | 4 seconds | Name It In Five |
| R2 | 6 seconds | On Track |
| R3 | 8 seconds | Mash Up Mayhem |
| R4 | 1 point | Points only (no time added to countdown) |

---

## TEST A: Anthems Lowest (Icons Lead)

### Round 1
- [ ] Set round to 1
- [ ] Coin toss / auto-set first team
- [ ] Team 1 plays — correct answers register (4s each)
- [ ] Team 2 plays — correct answers register (4s each)
- [ ] Undo button works for each team
- [ ] Golden Record available for both teams
- [ ] QLab text cues 1 and 2 update correctly
- [ ] StreamDeck pages switch correctly
- [ ] Web UI shows correct time earned

### Round 2
- [ ] Set round to 2
- [ ] Auto first-team set (leader plays first)
- [ ] Team 1 plays — correct answers register (6s each)
- [ ] Refresh tracks OSC fires → StreamDeck switches to other team
- [ ] Team 2 plays — correct answers register (6s each)
- [ ] QLab text cues update correctly

### Round 3
- [ ] Set round to 3
- [ ] Track selected → `/chart-toppers/r3play/{n}` received
- [ ] Buzz → active track pauses only
- [ ] Correct → active track stops
- [ ] Test incorrect flow:
  - [ ] Buzz → pause
  - [ ] Incorrect (1st) → resumes after 1s delay
  - [ ] Buzz again → pause
  - [ ] Incorrect (2nd) → track stops, does NOT resume
- [ ] Correct answers register (8s each)
- [ ] QLab text cues update correctly

### Round 4 (Anthems lowest → Anthems first)
- [ ] Trigger R4 — all score cues (1, 2, 1.1, 2.2) zero out
- [ ] R4SINGLESCORE → R4SANTHEM (Anthems individual scoreboard)
- [ ] R4GOTO → R4ICON (Icons block, second team)
- [ ] `/playing/anthems` fires → web UI shows "Points Earned" / 0
- [ ] Anthems correct answers update cues 1 + 1.1 with points
- [ ] Anthems scoreboard reveals (single) — cue 1.1 shows correct points
- [ ] `/playing/icons` fires:
  - [ ] R4SINGLESCORE → SCOREBOARD (dual)
  - [ ] R4GOTO → R5
  - [ ] Anthems scores refreshed to cues 1 + 1.1
  - [ ] Web UI shows "Points Earned" / 0 for Icons
- [ ] Icons correct answers update cues 2 + 2.2 with points
- [ ] Dual scoreboard reveals — cues 1 and 2 match 1.1 and 2.2
- [ ] R4GOTO fires → R5 (winner)

### Winner
- [ ] Correct team announced as winner (highest total = earnedTime + points)

---

## TEST B: Icons Lowest (Anthems Lead)

Repeat all of TEST A but with flipped scores so Icons is the loser and goes first in R4.

### Key differences to verify:
- [ ] R4 entry: R4SINGLESCORE → R4SICON (Icons individual scoreboard)
- [ ] R4GOTO → R4ANTHEM (Anthems block, second team)
- [ ] `/playing/icons` fires first
- [ ] Icons scoreboard reveals (single) — cue 2.2 shows correct points
- [ ] `/playing/anthems` fires second:
  - [ ] R4SINGLESCORE → SCOREBOARD (dual)
  - [ ] R4GOTO → R5
  - [ ] Icons scores refreshed to cues 2 + 2.2
- [ ] Dual scoreboard — cues 1 and 2 match 1.1 and 2.2
- [ ] Correct winner announced

---

## TEST C: Edge Cases

### Tied scores into R4
- [ ] Equal earnedTime after R3 — auto first-team skipped, manual coin toss required
- [ ] Coin toss works, R4 proceeds normally

### Golden Record
- [ ] Arm golden record → next correct answer doubled
- [ ] Undo reverses golden record (restores to available)
- [ ] Golden record only available R1-R3 (not R4)

### Undo
- [ ] Undo last correct answer — score decreases
- [ ] Undo disabled when no history
- [ ] Undo during R4 — points decrease, cues 1/2 and 1.1/2.2 all update

### Buzzer
- [ ] Buzzer OSC arrives at server (check logs)
- [ ] Buzz outside R3 — no pause (no crash)
- [ ] Multiple rapid buzzes don't cause issues

### Reset
- [ ] Master reset zeros all cues (1, 2, 1.1, 2.2)
- [ ] R4GOTO resets to default
- [ ] Web UI resets to "Time Earned" / "seconds"

---

## Log Template

Use this for each test run:

```
Test: [A/B/C]
Date: 
Round 1 — Icons: _s, Anthems: _s ✅/❌
Round 2 — Icons: _s, Anthems: _s ✅/❌
Round 3 — Icons: _s, Anthems: _s ✅/❌
  Buzzer pause: ✅/❌
  Incorrect resume: ✅/❌
  Both wrong stop: ✅/❌
Round 4 — Icons: _pts, Anthems: _pts ✅/❌
  Single scoreboard: ✅/❌
  Dual scoreboard: ✅/❌
  Cue sync (1=1.1, 2=2.2): ✅/❌
Winner: [team] ✅/❌
Notes:
```
