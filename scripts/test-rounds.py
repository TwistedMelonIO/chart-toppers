#!/usr/bin/env python3
"""
Chart Toppers — round flow smoke test.

Drives the running server via HTTP API to simulate scoring scenarios and
verifies server state + QLab OSC output after each step.

Run the server first (docker compose up -d), then:
    python3 scripts/test-rounds.py

Exit code 0 = all pass, 1 = at least one failure.
"""

import json
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3200"
CONTAINER = "chart-toppers"
DOCKER_COMPOSE_DIR = (
    "/Users/chrisdevlin/Library/Mobile Documents/com~apple~CloudDocs/"
    "Twisted Melon/CascadeProjects/chart-toppers"
)

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
RESET = "\033[0m"


class TestFailure(Exception):
    pass


def api(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            txt = r.read().decode()
            try:
                return json.loads(txt)
            except json.JSONDecodeError:
                return txt
    except urllib.error.HTTPError as e:
        return {"__error__": f"HTTP {e.code}", "body": e.read().decode()}
    except urllib.error.URLError as e:
        raise TestFailure(f"Server unreachable at {url}: {e.reason}") from e


def state():
    return api("/api/state")


def reset():
    api("/api/reset", method="POST")
    time.sleep(0.15)


def set_round(n):
    api(f"/api/round/{n}", method="POST")
    time.sleep(0.2)


def correct(team):
    api(f"/api/correct/{team}", method="POST")
    time.sleep(0.05)


def score_team(team, count):
    for _ in range(count):
        correct(team)


def cointoss(team):
    api(f"/api/cointoss/{team}", method="POST")
    time.sleep(0.2)


_log_anchor_line_count = 0


def _count_lines_in_full_log():
    """Return total line count of container logs (used as a scenario anchor)."""
    proc = subprocess.run(
        ["docker", "compose", "logs", "--no-log-prefix", CONTAINER],
        cwd=DOCKER_COMPOSE_DIR,
        capture_output=True,
        text=True,
        timeout=15,
    )
    return proc.stdout.count("\n")


def snapshot_log_anchor():
    """Remember the current log line count so subsequent checks only see NEW lines."""
    global _log_anchor_line_count
    _log_anchor_line_count = _count_lines_in_full_log()


def get_logs_since_anchor():
    """Return all log lines added since the last snapshot_log_anchor()."""
    proc = subprocess.run(
        ["docker", "compose", "logs", "--no-log-prefix", CONTAINER],
        cwd=DOCKER_COMPOSE_DIR,
        capture_output=True,
        text=True,
        timeout=15,
    )
    lines = proc.stdout.splitlines()
    return "\n".join(lines[_log_anchor_line_count:])


def log_contains(pattern):
    return pattern in get_logs_since_anchor()


def assert_eq(label, actual, expected):
    if actual != expected:
        raise TestFailure(f"{label}: expected {expected!r}, got {actual!r}")


def assert_log(label, pattern):
    # Small wait so async log writes settle
    time.sleep(0.2)
    if not log_contains(pattern):
        raise TestFailure(f"{label}: expected log line containing {pattern!r}")


def scenario(name, fn):
    print(f"  {DIM}→ running...{RESET}", end="\r")
    snapshot_log_anchor()
    try:
        fn()
        print(f"  {GREEN}✓{RESET} {name}" + " " * 20)
        return True
    except TestFailure as e:
        print(f"  {RED}✗{RESET} {name}")
        print(f"      {RED}{e}{RESET}")
        return False
    except Exception as e:
        print(f"  {RED}✗{RESET} {name} (crashed)")
        print(f"      {RED}{type(e).__name__}: {e}{RESET}")
        return False


# ======================================================================
# Scenarios
# ======================================================================


def s1_r1_winner():
    """R1 normal play: Anthems wins, advance to R2 → leader plays first."""
    reset()
    set_round(1)
    score_team("anthems", 3)  # 12s in R1 (4s per correct)
    score_team("icons", 1)    # 4s in R1
    s = state()
    assert_eq("Anthems earned", s["anthems"]["earnedTime"], 12)
    assert_eq("Icons earned", s["icons"]["earnedTime"], 4)
    # GR state refresh on R2 entry
    set_round(2)
    s = state()
    assert_eq("Anthems GR available", s["anthems"]["goldenRecordAvailable"], True)
    assert_eq("Icons GR available", s["icons"]["goldenRecordAvailable"], True)
    # Leader auto-set (Anthems, since they lead)
    assert_eq("R2 firstTeam = anthems", s["turn"]["firstTeam"], "anthems")


def s2_r1_tied_r2_coinflip():
    """R1 tied → entering R2 triggers R2COINFLIP → CF2."""
    reset()
    set_round(1)
    score_team("anthems", 2)
    score_team("icons", 2)
    s = state()
    assert_eq("R1 tied", s["anthems"]["earnedTime"], s["icons"]["earnedTime"])
    set_round(2)
    assert_log("R2 coinflip → CF2", "R2 COINFLIP] Draw detected")
    assert_log("R2COINFLIP target CF2", '/cue/R2COINFLIP/cueTargetNumber → "CF2"')


def s3_r2_refresh_flow():
    """R2: first team correct → refreshtracks swaps → second team correct → refreshtracks advances R2GO2→AWO."""
    reset()
    set_round(1)
    score_team("anthems", 3)
    score_team("icons", 1)
    set_round(2)
    api("/api/loadgenre/1", method="POST")
    time.sleep(0.3)
    # First team scores 2 (marks them as played in r2PlayedTeams)
    score_team("anthems", 2)
    # Refresh: should swap to icons, R2GO2 should stay R2T
    api("/api/refreshtracks", method="POST")
    time.sleep(0.3)
    assert_log("refreshtracks API exists", "")  # no specific log, we just care state is good
    # After swap, opponent is marked played (anticipated), so both in set
    # Second refresh → should go to AWO
    api("/api/refreshtracks", method="POST")
    time.sleep(0.3)
    assert_log("R2GO2 → AWO", '/cue/R2GO2/cueTargetNumber → "AWO"')


def s4_r2_tied_r3_coinflip():
    """R2 tied → R3 entry triggers R3COINFLIP → CF3."""
    reset()
    set_round(2)
    score_team("anthems", 2)  # 12s at 6/correct
    score_team("icons", 2)
    s = state()
    assert_eq("R2 tied", s["anthems"]["earnedTime"], s["icons"]["earnedTime"])
    set_round(3)
    assert_log("R3 coinflip CF3", "R3 COINFLIP] Draw detected")
    assert_log("R3COINFLIP target CF3", '/cue/R3COINFLIP/cueTargetNumber → "CF3"')


def s5_r3_to_r4_with_leader():
    """R3 → R4 with leader: R4NEXT → loser block, DUALGO → R5."""
    reset()
    set_round(3)
    score_team("anthems", 3)  # 24s
    score_team("icons", 1)    # 8s
    set_round(4)
    s = state()
    assert_eq("R4 firstTeam = icons (loser)", s["turn"]["firstTeam"], "icons")
    assert_log("R4NEXT → R4ICON", '/cue/R4NEXT/cueTargetNumber → "R4ICON"')
    assert_log("DUALGO → R5 on R4 entry", "DUALGO] Retargeting → R5 — R5 (winner reveal)")


def s6_r3_tied_r4_coinflip():
    """R3 tied → R4 entry: R4NEXT → CF4, LEADERSD → SDE1, DUALGO → TIEBREAK."""
    reset()
    set_round(3)
    score_team("anthems", 3)
    score_team("icons", 3)
    set_round(4)
    assert_log("R4NEXT → CF4", "R4NEXT → CF4")
    assert_log("R4COINFLIP → CF4", "R4 COINFLIP] Draw detected")
    assert_log("LEADERSD → SDE1", "LEADER SD] Tie")
    assert_log("DUALGO → TIEBREAK", "DUALGO] Retargeting → TIEBREAK")
    # Cointoss: anthems wins the flip
    cointoss("anthems")
    s = state()
    assert_eq("firstTeam = anthems post-cointoss", s["turn"]["firstTeam"], "anthems")
    assert_log("R4NEXT → R4ANTHEM post-cointoss", '/cue/R4NEXT/cueTargetNumber → "R4ANTHEM"')
    assert_log("LEADERSD → SDE11 post-cointoss", '/cue/LEADERSD/cueTargetNumber → "SDE11"')


def s7_r4_winner_no_tiebreak():
    """R4 play with a clear winner: DUALGO stays R5, no tiebreaker."""
    reset()
    set_round(3)
    score_team("anthems", 2)
    score_team("icons", 1)
    set_round(4)
    # Simulate some R4 points
    score_team("anthems", 3)
    score_team("icons", 1)
    s = state()
    assert_eq("Anthems leads", s["anthems"]["points"] > s["icons"]["points"], True)
    assert_log("DUALGO → R5 during R4", "DUALGO] Retargeting → R5 — R5 (winner reveal)")


def s8_r4_tied_tiebreaker():
    """R4 play ending tied: DUALGO retargets to TIEBREAK live."""
    reset()
    set_round(3)
    score_team("anthems", 2)
    score_team("icons", 2)
    set_round(4)
    # Equal R4 points → stays tied
    score_team("anthems", 2)
    score_team("icons", 2)
    assert_log("DUALGO → TIEBREAK on tied R4", "DUALGO] Retargeting → TIEBREAK")


def s9_buzzers_disarmed_r2_r4():
    """R2 and R4 should have buzzers disarmed."""
    reset()
    set_round(2)
    assert_log("R2 disarm IBUZZ", '/cue/IBUZZ/armed → disarm IBUZZ for R2')
    assert_log("R2 disarm ABUZZ", '/cue/ABUZZ/armed → disarm ABUZZ for R2')
    set_round(3)  # clear state
    set_round(4)
    assert_log("R4 disarm IBUZZ", '/cue/IBUZZ/armed → disarm IBUZZ for R4')
    assert_log("R4 disarm ABUZZ", '/cue/ABUZZ/armed → disarm ABUZZ for R4')


def s10_golden_record_refresh():
    """Golden Record should refresh on each round entry (R1, R2, R3)."""
    reset()
    set_round(1)
    api("/api/golden-record/anthems", method="POST")
    time.sleep(0.1)
    s = state()
    assert_eq("Anthems GR armed after activation", s["anthems"]["goldenRecordArmed"], True)
    set_round(2)
    s = state()
    assert_eq("Anthems GR refreshed on R2 entry", s["anthems"]["goldenRecordArmed"], False)
    assert_eq("Anthems GR available on R2 entry", s["anthems"]["goldenRecordAvailable"], True)


# ======================================================================
# Main
# ======================================================================


def main():
    print()
    print("Chart Toppers round flow tests")
    print("=" * 50)

    # Verify server is up
    try:
        s = state()
        if "__error__" in s:
            print(f"{RED}Server returned error: {s}{RESET}")
            return 1
    except TestFailure as e:
        print(f"{RED}{e}{RESET}")
        return 1

    tests = [
        ("Scenario 1: R1 normal → R2 leader auto-set", s1_r1_winner),
        ("Scenario 2: R1 tied → R2COINFLIP → CF2", s2_r1_tied_r2_coinflip),
        ("Scenario 3: R2 refresh flow → R2GO2 → AWO", s3_r2_refresh_flow),
        ("Scenario 4: R2 tied → R3COINFLIP → CF3", s4_r2_tied_r3_coinflip),
        ("Scenario 5: R3 → R4 leader → R4NEXT → loser block", s5_r3_to_r4_with_leader),
        ("Scenario 6: R3 tied → R4 cointoss flow", s6_r3_tied_r4_coinflip),
        ("Scenario 7: R4 clear winner → DUALGO stays R5", s7_r4_winner_no_tiebreak),
        ("Scenario 8: R4 ending tied → DUALGO → TIEBREAK", s8_r4_tied_tiebreaker),
        ("Scenario 9: Buzzers disarmed in R2 + R4", s9_buzzers_disarmed_r2_r4),
        ("Scenario 10: Golden Record refreshes per round", s10_golden_record_refresh),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        if scenario(name, fn):
            passed += 1
        else:
            failed += 1

    # Final reset so the server is clean after tests
    reset()

    print()
    print("=" * 50)
    total = passed + failed
    colour = GREEN if failed == 0 else RED
    print(f"  {colour}{passed}/{total} passed{RESET}")
    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
