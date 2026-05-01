const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const osc = require("osc");
const dgram = require("dgram");
const path = require("path");
const fs = require('fs');
const { spawn } = require("child_process");
const os = require("os");
const PACKAGE_VERSION = require('../package.json').version;

// =============================================================================
// Configuration
// =============================================================================
const CONFIG = {
  // Web dashboard
  WEB_PORT: parseInt(process.env.WEB_PORT) || 3000,

  // OSC server (receives from Companion)
  OSC_LISTEN_PORT: parseInt(process.env.OSC_LISTEN_PORT) || 53535,

  // QLab OSC target (sends commands back to QLab)
  QLAB_HOST: process.env.QLAB_HOST || "host.docker.internal",
  QLAB_PORT: parseInt(process.env.QLAB_PORT) || 53000,

  // Game defaults
  MAX_TIME: parseInt(process.env.MAX_TIME) || 100,
  VIDEO_OFFSET: parseFloat(process.env.VIDEO_OFFSET) || 3, // seconds of intro before countdown starts
  POINTS_PER_CORRECT: parseInt(process.env.POINTS_PER_CORRECT) || 5,

  // Round-based scoring: seconds earned per correct answer per round (Round 4 = points, not seconds)
  ROUND_SCORING: {
    1: 4,   // Round 1 — Name It In Five: 6 clips, 1 pt = 4 secs, max 24 secs
    2: 6,   // Round 2 — On Track: 2 tracks per team, 1 pt = 6 secs, max 12 secs
    3: 8,   // Round 3 — Mash Up Mayhem: 4 mashups, 1 pt = 8 secs, max 64 secs
    4: 1,   // Round 4 — 1 point per correct (points only, no time added)
  },

  // QLab cue numbers for each team's LOAD time cue
  QLAB_CUE_ANTHEMS: process.env.QLAB_CUE_ANTHEMS || "ANTHEMS",
  QLAB_CUE_ICONS: process.env.QLAB_CUE_ICONS || "ICONS",

  // Round 4 flow: R4NEXT is a goto cue that the server retargets to the
  // appropriate team group (R4ANTHEM or R4ICON) based on score order.
  QLAB_CUE_R4NEXT: process.env.QLAB_CUE_R4NEXT || "R4NEXT",
  QLAB_CUE_R4_ANTHEMS: process.env.QLAB_CUE_R4_ANTHEMS || "R4ANTHEM",
  QLAB_CUE_R4_ICONS: process.env.QLAB_CUE_R4_ICONS || "R4ICON",
  // After both teams have played in R4, R4NEXT retargets to this cue (winner reveal / R5)
  QLAB_CUE_R4_END: process.env.QLAB_CUE_R4_END || "R5",
  // Tiebreaker cue — used instead of R5 when scores are tied after R4
  QLAB_CUE_TIEBREAK: process.env.QLAB_CUE_TIEBREAK || "TIEBREAK",

  // Team SD page cues — used by LEADERSD retarget (leader in R1-R3, loser in R4).
  QLAB_CUE_SDE_ANTHEMS: process.env.QLAB_CUE_SDE_ANTHEMS || "SDE11",
  QLAB_CUE_SDE_ICONS: process.env.QLAB_CUE_SDE_ICONS || "SDE10",

  // Round 2 flow: R2GO2 is a goto cue that points to R2T (tracks replay for
  // second team) after the first team has played, then to R3 once both have played.
  QLAB_CUE_R2GO2: process.env.QLAB_CUE_R2GO2 || "R2GO2",
  QLAB_CUE_R2_TEAM2: process.env.QLAB_CUE_R2_TEAM2 || "R2T",
  QLAB_CUE_R3: process.env.QLAB_CUE_R3 || "AWO",

  // Round 2 coin flip: R2COINFLIP is a goto cue retargeted on R2 entry.
  // Draw → CF2 (coin flip group), leader exists → GP2 (genre picker, skip flip).
  QLAB_CUE_R2_COINFLIP: process.env.QLAB_CUE_R2_COINFLIP || "R2COINFLIP",
  QLAB_CUE_CF2: process.env.QLAB_CUE_CF2 || "CF2",
  QLAB_CUE_GP2: process.env.QLAB_CUE_GP2 || "GP2",

  // Round 3 coin flip: same pattern as R2.
  // Draw → CF3 (coin flip group), leader exists → GP3 (genre picker, skip flip).
  QLAB_CUE_R3_COINFLIP: process.env.QLAB_CUE_R3_COINFLIP || "R3COINFLIP",
  QLAB_CUE_CF3: process.env.QLAB_CUE_CF3 || "CF3",
  QLAB_CUE_GP3: process.env.QLAB_CUE_GP3 || "GP3",

  // Round 4 coin flip: same pattern as R2/R3.
  // Draw → CF4 (coin flip group), scores differ → loser's block (R4ANTHEM/R4ICON).
  // R4 has no genre picker, so when not tied the target IS the first-team block.
  QLAB_CUE_CF4: process.env.QLAB_CUE_CF4 || "CF4",

  // Leader SD nav: LEADERSD is a goto cue retargeted to whichever team is
  // currently in the lead (SDE10 icons / SDE11 anthems). Recomputed after
  // every score change so it always points at the leader. In R4, points to loser.
  QLAB_CUE_LEADER_SD: process.env.QLAB_CUE_LEADER_SD || "LEADERSD",

  QLAB_CUE_R2: process.env.QLAB_CUE_R2 || "R2",

  // Admin password for sensitive operations
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "8888",
};

console.log("=== Chart Toppers - QLab Scoring System ===");
console.log("Configuration:", JSON.stringify(CONFIG, null, 2));

// =============================================================================
// Team definitions
// =============================================================================
const TEAMS = {
  anthems: { name: "Team Anthems", cueName: CONFIG.QLAB_CUE_ANTHEMS },
  icons: { name: "Team Icons", cueName: CONFIG.QLAB_CUE_ICONS },
};

// =============================================================================
// Activity Logging System
// =============================================================================
const ACTIVITY_LOG_FILE = path.join(__dirname, "../data/activity-log.json");
let activityLog = [];
const MAX_LOG_ENTRIES = 10000; // Keep up to 10,000 entries
const LOG_RETENTION_DAYS = 60; // Keep logs for 60 days

// Ensure data directory exists and load activity log
const dataDir = path.dirname(ACTIVITY_LOG_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load activity log from file
function loadActivityLog() {
  try {
    if (fs.existsSync(ACTIVITY_LOG_FILE)) {
      const data = fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8');
      activityLog = JSON.parse(data);
      console.log(`[ACTIVITY] Loaded ${activityLog.length} entries from persistent storage`);
      // Clean up old entries on load
      cleanupOldEntries();
    } else {
      console.log('[ACTIVITY] No activity log file found, starting fresh');
      activityLog = [];
    }
  } catch (error) {
    console.error('[ACTIVITY] Error loading activity log:', error);
    activityLog = [];
  }
}

// Save activity log to file
function saveActivityLog() {
  try {
    fs.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(activityLog, null, 2));
  } catch (error) {
    console.error('[ACTIVITY] Error saving activity log:', error);
  }
}

// Load on startup
loadActivityLog();

function logActivity(type, team, details, source = 'system') {
  const entry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    type,
    team,
    details,
    source
  };
  
  activityLog.push(entry);
  
  // Cleanup old entries
  cleanupOldEntries();
  
  // Persist to file
  saveActivityLog();
  
  console.log(`[ACTIVITY] ${type.toUpperCase()} - ${team} - ${details} (${source})`);
}

function cleanupOldEntries() {
  const cutoffDate = new Date(Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  
  // Remove entries older than retention period
  for (let i = activityLog.length - 1; i >= 0; i--) {
    if (new Date(activityLog[i].timestamp) < cutoffDate) {
      activityLog.splice(i, 1);
    }
  }
  
  // If still too many entries, remove oldest ones
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog.splice(0, activityLog.length - MAX_LOG_ENTRIES);
  }
}

function getActivityLog(team = 'all', type = 'all', days = 60) {
  const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  
  return activityLog.filter(entry => {
    const entryDate = new Date(entry.timestamp);
    
    // Date filter
    if (entryDate < cutoffDate) return false;
    
    // Team filter
    if (team !== 'all' && entry.team !== team) return false;
    
    // Type filter
    if (type !== 'all' && entry.type !== type) return false;
    
    return true;
  });
}

// =============================================================================
// Countdown State (QLab playback tracking)
// =============================================================================
const countdownState = {
  anthems: { active: false, elapsed: 0, remaining: 0, startOffset: null },
  icons: { active: false, elapsed: 0, remaining: 0, startOffset: null },
};

// =============================================================================
// Game State
// =============================================================================
function createTeamState() {
  return {
    correctAnswers: 0,
    earnedTime: 0,
    remainingTime: CONFIG.MAX_TIME,
    maxTime: CONFIG.MAX_TIME,
    pointsPerCorrect: CONFIG.POINTS_PER_CORRECT,
    points: 0,
    isActive: true,
    history: [],
    goldenRecordAvailable: true,
    goldenRecordArmed: false,
    goldenRecordUsed: false,
  };
}

let gameState = {
  anthems: createTeamState(),
  icons: createTeamState(),
};

// =============================================================================
// Round Tracking
// =============================================================================
const TOTAL_ROUNDS = 4; // Tracks T1-T4

// Tracks which teams have played their R4 block (cleared when entering R4 or on reset)
let r4PlayedTeams = new Set();

// Tracks which teams have played in Round 1 (cleared when entering R1 or on reset)
let r1PlayedTeams = 0; // 0 = none, 1 = first team done, 2 = both done

// Tracks which teams have played in Round 2 (cleared when entering R2 or on reset)
let r2PlayedTeams = new Set();

// Last loaded genre — used by refreshgenre to reload the same genre with fresh tracks
let lastLoadedGenre = { round: null, genreIndex: null };

// Stage host answers — populated on genre load, advanced on correct answer
let stageHostAnswers = [];
let stageHostAnswerIndex = 0;

// Tiebreaker active flag — set when dualscreen detects a tie in R4
let tiebreakActive = false;

// R2 refresh counter: 1st refreshtracks = swap tracks, 2nd = retarget R2GO2 → AWO
let r2RefreshCount = 0;

// R3 active track state: which mashup is playing, how many wrong answers on it
let r3ActiveTrack = 0;       // 0 = none, 1-4 = R3T1-R3T4
let r3WrongCount = 0;        // resets when a new track starts
let r3LastBuzzTeam = null;   // which team buzzed in on the current R3 track

// Map team IDs to their buzzer cue names in QLab
const TEAM_BUZZER_CUE = { icons: 'IBUZZ', anthems: 'ABUZZ' };

let roundState = {
  currentRound: 0,  // 0 = no round active, 1-4 = active round
  completedRounds: [], // Array of completed round numbers
};

// Pending OSC setTimeout handles for the staggered shuffle writes.
// Cleared at the start of each reset so a back-to-back trigger (e.g.
// round-reset followed immediately by round-enter, or rapid genre swaps)
// doesn't let stale tail-end writes clobber the new shuffle.
let r1ShuffleTimeouts = [];
let r4ShuffleTimeouts = [];
let genreLoadTimeouts = [];
// Pending OSC sends queued by resetRounds / resetAll. Cleared on each reset
// so rapid double-resets don't pile up overlapping bursts at the bridge.
let resetTimeouts = [];

// Schedule an OSC-emitting function relative to a delay counter, tracking the
// timeout handle in `bucket` so it can be cancelled. Returns the next delay.
function scheduleOsc(bucket, fn, delay) {
  bucket.push(setTimeout(fn, delay));
  return delay + OSC_STAGGER_MS;
}
function clearTimeoutBucket(bucket) {
  bucket.forEach(t => clearTimeout(t));
  bucket.length = 0;
}
// Cancel any pending writes targeting show cue content (R1T*/R2T*/R3T*/R4T*
// paths/names/notes). Called by every function that writes to those cues so a
// new load doesn't race the tail-end of a previous one — which would leave
// QLab with mixed state (e.g. new cue name + old file target).
function cancelAllCueWrites() {
  clearTimeoutBucket(r1ShuffleTimeouts);
  clearTimeoutBucket(r4ShuffleTimeouts);
  clearTimeoutBucket(genreLoadTimeouts);
  clearTimeoutBucket(qaTimeouts);
}

// Round 4 track play state — tracks which R4 tracks have been triggered (up to 40)
let r4TracksPlayed = {};
// Last R4 track number played in the current team's pass. Used to disarm the
// matching R4TG{N} cue when the second team starts so QLab skips it on the
// second-team playthrough (QLab can't disarm a cue based on another cue's play).
let lastR4TrackPlayed = null;

// =============================================================================
// Turn Tracking & StreamDeck Page Navigation
// =============================================================================
// Coin toss determines which team picks/plays first per round.
// After genre load → navigate StreamDeck to current team's page.
// After team stops → navigate to other team's page or back to genre page.

const GENRE_PAGES = { 1: 7, 2: 8, 3: 9 };   // StreamDeck page per round for genre picker
const TEAM_PAGES = { icons: 10, anthems: 11 }; // StreamDeck page per team

let turnState = {
  firstTeam: null,      // 'anthems' or 'icons' — coin toss winner
  currentTeam: null,    // 'anthems' or 'icons' — who's up right now
  phase: 'idle',        // 'idle' | 'genre-pick' | 'playing-first' | 'playing-second'
};

function otherTeam(teamId) {
  return teamId === 'anthems' ? 'icons' : 'anthems';
}

function resetTurnState() {
  turnState = { firstTeam: null, currentTeam: null, phase: 'idle' };
  console.log('[TURN] Turn state reset');
  io.emit('turnUpdate', turnState);
}

// Navigate StreamDeck to a specific Companion page via custom variable
function navigateStreamDeck(pageNum) {
  setCompanionVariable('streamdeck_page', String(pageNum));

  // Fire the SDE cue in QLab to change StreamDeck page
  const cueName = `SDE${pageNum}`;
  const address = `/cue/${cueName}/start`;
  const payload = JSON.stringify({ address, value: 0 });
  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  };
  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => console.log(`[STREAMDECK] Fired ${cueName} in QLab → page ${pageNum}`));
  });
  req.on("error", (err) => console.error(`[STREAMDECK] Failed to fire ${cueName}:`, err.message));
  req.write(payload);
  req.end();

  console.log(`[STREAMDECK] Navigate to page ${pageNum}`);
}

// Compute each team's combined score and identify leader/loser/tie.
// Combined score = earnedTime + points (works across all rounds).
function teamRanking() {
  const aScore = (gameState.anthems?.earnedTime || 0) + (gameState.anthems?.points || 0);
  const iScore = (gameState.icons?.earnedTime || 0) + (gameState.icons?.points || 0);
  if (aScore === iScore) {
    return { tie: true, aScore, iScore };
  }
  const leader = aScore > iScore ? 'anthems' : 'icons';
  const loser = leader === 'anthems' ? 'icons' : 'anthems';
  return { tie: false, leader, loser, aScore, iScore };
}

// Auto-set turnState.currentTeam based on the rule for a given round:
//   R1 → no auto-set (coin toss required)
//   R2, R3 → leader plays first
//   R4 → loser plays first
function autoSetFirstTeamForRound(roundNum, source) {
  if (roundNum === 1 || roundNum === 0) return; // R1 needs explicit coin toss
  const ranking = teamRanking();
  if (ranking.tie) {
    console.warn(
      `[ROUND] R${roundNum} first-team auto-set skipped (tie ${ranking.aScore} each) — operator must run coin toss`
    );
    logActivity('round', 'all', `R${roundNum} auto first-team skipped (tie)`, source);
    return;
  }
  const firstTeamId = roundNum === 4 ? ranking.loser : ranking.leader;
  const rule = roundNum === 4 ? 'loser plays first' : 'leader plays first';
  turnState.firstTeam = firstTeamId;
  turnState.currentTeam = firstTeamId;
  turnState.phase = 'genre-pick';
  console.log(
    `[ROUND] R${roundNum} auto first-team: ${TEAMS[firstTeamId].name} (${rule}, scores a=${ranking.aScore} i=${ranking.iScore})`
  );
  logActivity('round', firstTeamId, `R${roundNum} auto first-team: ${TEAMS[firstTeamId].name} (${rule})`, source);
  io.emit('turnUpdate', turnState);
  setCompanionVariable('current_team', TEAMS[firstTeamId].name);
}

// Auto-shuffle 6 random R1 pairs from ALL R1 tracks (ignoring genre) and
// load them into R1T1.1-R1T6.2. Mirrors resetR4Tracks — R1 uses buzzers,
// no genre pick, so the round auto-randomises on entry.
function resetR1Tracks() {
  const pack = packData[packSettings.currentPack];
  if (!pack || !pack.rounds || !pack.rounds['1']) {
    console.warn('[R1 SHUFFLE] No R1 tracks in current pack');
    return;
  }

  const allR1 = pack.rounds['1'].tracks.filter(t => t.band !== 'XX');
  const basePath = packSettings.audioBasePath || '';

  // Group .1 (hook) + .2 (reveal) into pairs by track number
  const pairs = {};
  allR1.forEach(t => {
    const num = t.cue.replace('R1T', '').split('.')[0];
    if (!pairs[num]) pairs[num] = {};
    if (t.cue.endsWith('.1')) pairs[num].hook = t;
    if (t.cue.endsWith('.2')) pairs[num].reveal = t;
  });

  const completePairs = Object.values(pairs).filter(p => p.hook && p.reveal);
  const slotsNeeded = GENRE_SLOTS['1'] || 6;
  const selected = shuffle(completePairs).slice(0, slotsNeeded);

  if (selected.length < slotsNeeded) {
    console.warn(`[R1 SHUFFLE] Only ${selected.length} complete pairs available (need ${slotsNeeded})`);
  }

  stageHostAnswers = [];
  stageHostAnswerIndex = 0;

  // Cancel any pending cue-content writes (own bucket + genre/qa/r4) so the
  // new shuffle isn't clobbered by tail-end OSC from a previous writer.
  cancelAllCueWrites();

  let delay = 0;
  const queue = (fn) => {
    r1ShuffleTimeouts.push(setTimeout(fn, delay));
    delay += OSC_STAGGER_MS;
  };
  selected.forEach((pair, i) => {
    const slotNum = i + 1;
    const hookSlot = `R1T${slotNum}.1`;
    const revealSlot = `R1T${slotNum}.2`;

    const hookPath = basePath ? path.join(basePath, pair.hook.fileName) : pair.hook.fileName;
    const hookName = `${pair.hook.band} - ${pair.hook.track} [SHORT]`.toUpperCase();
    const revealPath = basePath ? path.join(basePath, pair.reveal.fileName) : pair.reveal.fileName;
    const revealName = `${pair.reveal.band} - ${pair.reveal.track} [LONG]`.toUpperCase();
    const revealNotes = `Correct Answer: ${pair.hook.band} - ${pair.hook.track}`.toUpperCase();

    queue(() => updateQLabCueFilePath(hookSlot, hookPath));
    queue(() => updateQLabCueName(hookSlot, hookName));
    queue(() => updateQLabCueNotes(hookSlot, ''));
    queue(() => updateQLabCueFilePath(revealSlot, revealPath));
    queue(() => updateQLabCueName(revealSlot, revealName));
    queue(() => updateQLabCueNotes(revealSlot, revealNotes));

    setCompanionVariable(`track_${slotNum}`, `${pair.hook.band} - ${pair.hook.track}`);
    stageHostAnswers.push({ number: slotNum, track: pair.hook.track, artist: pair.hook.band });

    console.log(`[R1 SHUFFLE] Slot ${slotNum}: ${pair.hook.band} - ${pair.hook.track}`);
    logActivity('track_loaded', 'all', `R1 Slot ${slotNum}: ${pair.hook.band} - ${pair.hook.track} [random]`, 'round-enter');
  });

  io.emit('answersUpdate', { round: '1', genre: 'Random', answers: stageHostAnswers });
  if (stageHostAnswers.length > 0) {
    io.emit('currentTrack', { trackNumber: 1, total: stageHostAnswers.length });
  }
  console.log(`[R1 SHUFFLE] Loaded ${selected.length} random pairs into R1 slots`);
}

function resetR4Tracks() {
  r4TracksPlayed = {};
  lastR4TrackPlayed = null;

  // Shuffle ALL R4 tracks and assign to R4T1-R4T{n} + R4TF notes in matching order
  const pack = packData[packSettings.currentPack];
  if (pack && pack.rounds && pack.rounds['4']) {
    const allR4 = pack.rounds['4'].tracks.filter(t => t.band !== 'XX');
    const shuffled = [...allR4].sort(() => Math.random() - 0.5);
    const basePath = packSettings.audioBasePath || '';

    // Cancel any pending cue-content writes (own bucket + genre/qa/r1) so the
    // new shuffle isn't clobbered by tail-end OSC from a previous writer.
    cancelAllCueWrites();

    stageHostAnswers = [];
    stageHostAnswerIndex = 0;
    let delay = 0;
    const queue = (fn) => {
      r4ShuffleTimeouts.push(setTimeout(fn, delay));
      delay += OSC_STAGGER_MS;
    };
    shuffled.forEach((track, i) => {
      const slot = `R4T${i + 1}`;
      const fullPath = basePath ? path.join(basePath, track.fileName) : track.fileName;
      const cueName = `${track.band} - ${track.track}`;
      const notesText = `CORRECT ANSWER:\n\n${track.band} - ${track.track}`.toUpperCase();
      queue(() => updateQLabCueFilePath(slot, fullPath));
      queue(() => updateQLabCueName(slot, cueName));
      queue(() => updateQLabCueNotes(`R4TF${i + 1}`, notesText));
      r4TracksPlayed[i + 1] = false;
      stageHostAnswers.push({ number: i + 1, track: track.track, artist: track.band });
      console.log(`[R4 SHUFFLE] ${slot}: ${track.band} - ${track.track}`);
    });

    io.emit('answersUpdate', { round: '4', genre: 'Final Round', answers: stageHostAnswers });
    if (stageHostAnswers.length > 0) {
      io.emit('currentTrack', { trackNumber: 1, total: stageHostAnswers.length });
    }
    console.log(`[ROUND 4] Shuffled ${shuffled.length} tracks into R4T/R4TF slots`);
  }

  console.log('[ROUND 4] Track play state reset');
}

function setRound(roundNum, source = 'system') {
  const prev = roundState.currentRound;

  // Mark previous round as completed if it was active
  if (prev > 0 && !roundState.completedRounds.includes(prev)) {
    roundState.completedRounds.push(prev);
  }

  // Clear stage host answers on round change
  stageHostAnswers = [];
  stageHostAnswerIndex = 0;
  io.emit('clearAnswer');
  console.log(`[STAGE HOST] Answers cleared for round change → R${roundNum}`);

  // NOTE: QLab doesn't expose collapse/expand via OSC or AppleScript
  // Use keyboard shortcuts in QLab: < (collapse all), > (expand all)

  // R0: put QLab into show mode
  if (roundNum === 0) {
    sendBridgeOsc('/showMode', 1, '→ QLab show mode ON');
    console.log(`[QLAB] Show mode enabled`);
  }

  // Entering Round 4: retarget the R4NEXT goto cue to whichever team has the
  // lowest earnedTime so the operator's single GO button fires the right team.
  if (roundNum === 4 && prev !== 4) {
    r4PlayedTeams.clear();
    retargetR4NextToFirstTeam();
    const ranking = teamRanking();
    // Retarget R4SINGLESCORE to the first team's score cue
    if (!ranking.tie) {
      const firstTeam = ranking.loser; // loser goes first in R4
      const scoreCue = firstTeam === 'anthems' ? 'R4SANTHEM' : 'R4SICON';
      updateQLabCueTarget('R4SINGLESCORE', scoreCue);
      console.log(`[R4 FLOW] R4SINGLESCORE → ${scoreCue} (${TEAMS[firstTeam].name} first)`);
      // R4GOTO initially points at team 2's block (team 1 plays first)
      const secondTeam = otherTeam(firstTeam);
      const secondBlock = secondTeam === 'anthems' ? 'R4ANTHEM' : 'R4ICON';
      updateQLabCueTarget('R4GOTO', secondBlock);
      console.log(`[R4 FLOW] R4GOTO → ${secondBlock} (${TEAMS[secondTeam].name} plays second)`);
    }
    // Zero out all score cues for R4 (standard + R4-specific)
    sendBridgeOsc('/cue/1/text', '0', '→ cue 1 zeroed for R4');
    sendBridgeOsc('/cue/2/text', '0', '→ cue 2 zeroed for R4');
    sendBridgeOsc('/cue/1.1/text', '0', '→ cue 1.1 zeroed for R4');
    sendBridgeOsc('/cue/2.2/text', '0', '→ cue 2.2 zeroed for R4');
    console.log(`[R4 FLOW] All score cues zeroed for R4`);
  }

  // Entering Round 1: reset played count. The genre picker drives R1
  // randomness (loadGenreTracks), so do not auto-shuffle here — that would
  // race with the genre-pick OSC writes and leave QLab in a mixed state.
  if (roundNum === 1 && prev !== 1) {
    r1PlayedTeams = 0;
    refreshGoldenRecords('r1-enter');
  }

  // Entering Round 2: reset the R2 played set, refresh counter, and point R2GO2 at R2T.
  // Also retarget R2COINFLIP based on whether R1 ended in a draw.
  // Buzzers stay disarmed throughout R2 — no buzzer round.
  if (roundNum === 2 && prev !== 2) {
    r2PlayedTeams.clear();
    r2RefreshCount = 0;
    retargetR2GO2('round-enter');
    retargetR2CoinFlip('round-enter');
    sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ for R2');
    sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ for R2');
    console.log(`[R2 FLOW] Buzzers disarmed for Round 2`);
    refreshGoldenRecords('r2-enter');
  }

  // Entering Round 3: reset active track state and StreamDeck button colours
  // Also retarget R3COINFLIP based on whether scores are tied.
  if (roundNum === 3 && prev !== 3) {
    r3ActiveTrack = 0;
    r3WrongCount = 0;
    for (let i = 1; i <= 4; i++) {
      setCompanionVariable(`r3_track_${i}_played`, '0');
    }
    retargetR3CoinFlip('round-enter');
    refreshGoldenRecords('r3-enter');
  }

  roundState.currentRound = roundNum;
  console.log(`[ROUND] Round changed: ${prev} → ${roundNum} (${source})`);

  // Reset R4 track play state when entering Round 4
  if (roundNum === 4) {
    resetR4Tracks();
    // R4 has no buzzers during normal play (tiebreaker may arm them later
    // via /dualscreen). Proactively disarm on round entry.
    sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ for R4');
    sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ for R4');
    console.log(`[R4 FLOW] Buzzers disarmed for Round 4`);
    // Re-run LEADERSD now that currentRound is 4 (points to loser)
    retargetLeaderSD('r4-enter');
    // Initialise DUALGO target based on current scores (R5 unless scores are already tied)
    retargetDUALGO('r4-enter');
    // Re-send load-to-time for both teams' countdown videos.
    // Covers panic recovery: if all cues were stopped, QLab loses the
    // loadActionAt position. The server still has the correct times.
    if (gameState.anthems.earnedTime > 0) {
      sendQLabLoadCue('anthems', gameState.anthems.remainingTime);
      console.log(`[R4 FLOW] Re-sent loadActionAt for Team Anthems (${gameState.anthems.remainingTime}s remaining)`);
    }
    if (gameState.icons.earnedTime > 0) {
      sendQLabLoadCue('icons', gameState.icons.remainingTime);
      console.log(`[R4 FLOW] Re-sent loadActionAt for Team Icons (${gameState.icons.remainingTime}s remaining)`);
    }
    // R4TF notes are now set inside resetR4Tracks() to match the shuffled order
  }

  // Clear any currently playing team state on the dashboard
  io.emit("teamStopPlaying", "anthems");
  io.emit("teamStopPlaying", "icons");
  io.emit("triggerStop", "anthems");
  io.emit("triggerStop", "icons");

  // Retarget SG1-SG3 to the correct G cues for this round
  updateGenreTargets(roundNum);

  // Reset turn state for new round
  resetTurnState();

  // Auto first-team rules: R2/R3 leader, R4 loser. R1 requires coin toss.
  // Must run AFTER resetTurnState so the auto-set isn't wiped.
  if ([2, 3, 4].includes(roundNum) && prev !== roundNum) {
    autoSetFirstTeamForRound(roundNum, source);
  }

  // Broadcast to all connected clients
  io.emit("roundUpdate", roundState);

  // Log activity
  logActivity('round', 'all', `Round changed to ${roundNum === 0 ? 'none' : 'Track ' + roundNum}`, source);
}

function resetRounds(source = 'system') {
  roundState = {
    currentRound: 0,
    completedRounds: [],
  };
  resetR4Tracks();
  resetTurnState();
  r4PlayedTeams.clear();
  r1PlayedTeams = 0;
  r2PlayedTeams.clear();
  r2RefreshCount = 0;
  r3ActiveTrack = 0;
  r3WrongCount = 0;
  tiebreakActive = false;
  for (let i = 1; i <= 4; i++) {
    setCompanionVariable(`r3_track_${i}_played`, '0');
  }
  if (r4AutoRetargetTimer) {
    clearTimeout(r4AutoRetargetTimer);
    r4AutoRetargetTimer = null;
  }
  // Stagger the bulk of reset OSC so the bridge doesn't fire ~6 retargets
  // back-to-back at QLab on top of the resetR4Tracks shuffle burst. If a
  // prior staggered burst is still pending (e.g. resetAll just queued OSC
  // before calling us), append after it instead of racing against it.
  let delay = resetTimeouts.length * OSC_STAGGER_MS;
  delay = scheduleOsc(resetTimeouts, () => retargetR2GO2('reset'), delay);
  delay = scheduleOsc(resetTimeouts, () => {
    updateQLabCueTarget('R4GOTO', 'R4ICON');
    console.log(`[RESET] R4GOTO → R4ICON (default)`);
  }, delay);
  delay = scheduleOsc(resetTimeouts, () => {
    updateQLabCueTarget('R4SINGLESCORE', 'R4SICON');
    console.log(`[RESET] R4SINGLESCORE → R4SICON (default)`);
  }, delay);
  delay = scheduleOsc(resetTimeouts, () => {
    updateQLabCueTarget(CONFIG.QLAB_CUE_R2_COINFLIP, CONFIG.QLAB_CUE_GP2);
    console.log(`[RESET] R2COINFLIP → ${CONFIG.QLAB_CUE_GP2} (default)`);
  }, delay);
  delay = scheduleOsc(resetTimeouts, () => {
    updateQLabCueTarget(CONFIG.QLAB_CUE_R3_COINFLIP, CONFIG.QLAB_CUE_GP3);
    console.log(`[RESET] R3COINFLIP → ${CONFIG.QLAB_CUE_GP3} (default)`);
  }, delay);
  delay = scheduleOsc(resetTimeouts, () => {
    updateQLabCueTarget('DUALGO', 'R5');
    console.log(`[RESET] DUALGO → R5 (default)`);
  }, delay);
  // Clear any lingering "now playing" glow on the dashboard
  io.emit("teamStopPlaying", "anthems");
  io.emit("teamStopPlaying", "icons");
  io.emit("triggerStop", "anthems");
  io.emit("triggerStop", "icons");
  console.log(`[ROUND] Rounds reset (${source})`);
  io.emit("roundUpdate", roundState);
  logActivity('round', 'all', 'Rounds reset', source);
}

function resetTeam(teamId, source = 'system') {
  gameState[teamId] = createTeamState();
  console.log(`[GAME] ${TEAMS[teamId].name} reset to defaults`);
  // Clear the "now playing" glow for this team
  io.emit("teamStopPlaying", teamId);
  io.emit("triggerStop", teamId);
  // Update QLab text cues to show 0 seconds (both standard and R4)
  updateQLabTextCue(teamId, 0);
  const r4Cue = teamId === 'anthems' ? '1.1' : '2.2';
  sendBridgeOsc(`/cue/${r4Cue}/text`, '0', `→ reset ${r4Cue} to 0`);
  
  // Log activity
  logActivity('reset', teamId, 'Team reset', source);
}

function resetAll(source = 'system') {
  gameState = {
    anthems: createTeamState(),
    icons: createTeamState(),
  };
  console.log("[GAME] All teams reset to defaults");
  // Cancel any pending reset OSC before queuing a new burst.
  clearTimeoutBucket(resetTimeouts);
  // Stagger the score-zero + arming OSC so QLab isn't slammed.
  let delay = 0;
  delay = scheduleOsc(resetTimeouts, () => updateQLabTextCue("anthems", 0), delay);
  delay = scheduleOsc(resetTimeouts, () => updateQLabTextCue("icons", 0), delay);
  delay = scheduleOsc(resetTimeouts, () => sendBridgeOsc('/cue/1.1/text', '0', '→ reset 1.1 to 0'), delay);
  delay = scheduleOsc(resetTimeouts, () => sendBridgeOsc('/cue/2.2/text', '0', '→ reset 2.2 to 0'), delay);
  delay = scheduleOsc(resetTimeouts, () => armAllQLabCues(), delay);

  // Log activity
  logActivity('reset', 'all', 'All teams reset', source);

  // NOTE: QLab doesn't expose collapse/expand via OSC or AppleScript

  // Clear played tracks history so all tracks are available again
  resetPlayedTracks();

  // resetRounds queues its own staggered burst onto the same bucket; the
  // delay continues from where we left off so its OSC lands after this one.
  resetRounds(source);
}

function registerCorrectAnswer(teamId, source = 'system') {
  const team = gameState[teamId];
  if (!team || !team.isActive) {
    console.log(`[GAME] ${teamId} is not active, ignoring correct answer`);
    return null;
  }

  // Require an active round before accepting correct answers
  if (roundState.currentRound === 0) {
    console.log(`[GAME] No active round, ignoring correct answer for ${TEAMS[teamId].name}`);
    return null;
  }

  const currentRound = roundState.currentRound;

  if (currentRound !== 4) {
    // Rounds 1-3: check if team has already reached the maximum time limit
    if (team.earnedTime >= CONFIG.MAX_TIME) {
      console.log(`[GAME] ${TEAMS[teamId].name} has already reached ${CONFIG.MAX_TIME}s limit, ignoring correct answer`);
      return null;
    }
  }

  let pointsThisAnswer = CONFIG.ROUND_SCORING[currentRound] || CONFIG.POINTS_PER_CORRECT;

  // Golden Record: double points if armed (R1-R3 only)
  let goldenRecordApplied = false;
  if (team.goldenRecordArmed && currentRound !== 4) {
    pointsThisAnswer *= 2;
    team.goldenRecordArmed = false;
    team.goldenRecordUsed = true;
    team.goldenRecordAvailable = false;
    goldenRecordApplied = true;
    console.log(`[GAME] Golden Record applied for ${TEAMS[teamId].name} — doubled to ${pointsThisAnswer}s`);
  }

  team.correctAnswers += 1;

  if (currentRound === 4) {
    // Round 4: add points to earnedTime as bonus seconds
    team.earnedTime += pointsThisAnswer;
    team.remainingTime = team.maxTime - team.earnedTime;
    team.points += pointsThisAnswer;

    const entry = {
      timestamp: new Date().toISOString(),
      answer: team.correctAnswers,
      earnedTime: team.earnedTime,
      remainingTime: team.remainingTime,
      round: currentRound,
      pointsAwarded: pointsThisAnswer,
      type: 'points',
      goldenRecord: goldenRecordApplied,
    };
    team.history.push(entry);

    logActivity('correct', teamId, `Correct answer #${team.correctAnswers} (+${pointsThisAnswer}s, ${team.earnedTime}s total, round ${currentRound})`, source);
    console.log(
      `[GAME] ${TEAMS[teamId].name} Correct #${team.correctAnswers} | +${pointsThisAnswer}s (R${currentRound}) | Total: ${team.earnedTime}s`
    );

    // Update QLab text cue with current total
    updateQLabTextCue(teamId, team.earnedTime);
  } else {
    // Rounds 1-3: add seconds to earnedTime
    team.earnedTime = Math.min(team.earnedTime + pointsThisAnswer, CONFIG.MAX_TIME);
    team.remainingTime = team.maxTime - team.earnedTime;

    if (team.remainingTime < 0) {
      team.remainingTime = 0;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      answer: team.correctAnswers,
      earnedTime: team.earnedTime,
      remainingTime: team.remainingTime,
      round: currentRound,
      pointsAwarded: pointsThisAnswer,
      goldenRecord: goldenRecordApplied,
    };
    team.history.push(entry);

    logActivity('correct', teamId, `Correct answer #${team.correctAnswers} (+${pointsThisAnswer}s${goldenRecordApplied ? ' GOLDEN RECORD 2x' : ''}, ${team.earnedTime}s total, round ${currentRound})`, source);
    console.log(
      `[GAME] ${TEAMS[teamId].name} Correct #${team.correctAnswers} | +${pointsThisAnswer}s (R${currentRound})${goldenRecordApplied ? ' [GOLDEN RECORD 2x]' : ''} | Earned: ${team.earnedTime}s | Remaining: ${team.remainingTime}s`
    );

    // Update QLab text cue with current earned time
    updateQLabTextCue(teamId, team.earnedTime);
  }

  // Recompute leader so LEADERSD always points at the current winner
  retargetLeaderSD('correct-answer');

  // R4: keep DUALGO target tracking live scores (TIEBREAK if tied, else R5)
  retargetDUALGO('correct-answer');

  // R2: mark this team as having played. /refreshtracks uses r2PlayedTeams
  // to decide swap-vs-advance-to-AWO. Populated here because operator flows
  // fire /correct/{team} directly rather than always firing /playing/{team}.
  if (currentRound === 2) {
    if (!r2PlayedTeams.has(teamId)) {
      r2PlayedTeams.add(teamId);
      console.log(`[R2 FLOW] ${TEAMS[teamId].name} marked as played (via correct answer) — r2PlayedTeams size: ${r2PlayedTeams.size}`);
    }
  }

  // Tiebreaker: stop TB cue on correct answer
  if (tiebreakActive) {
    sendBridgeOsc('/cue/TB/stop', 0, '→ stop TB on tiebreaker correct');
    tiebreakActive = false;
    console.log(`[TIEBREAK] TB stopped — ${TEAMS[teamId].name} answered correctly`);
  }

  // Stage host: advance to next answer
  if (stageHostAnswers.length > 0) {
    stageHostAnswerIndex++;
    if (stageHostAnswerIndex < stageHostAnswers.length) {
      io.emit('currentTrack', { trackNumber: stageHostAnswerIndex + 1, total: stageHostAnswers.length });
    } else if (currentRound >= 1 && currentRound <= 3) {
      // R1-R3: all answers exhausted — clear the iPad until next genre load
      stageHostAnswers = [];
      stageHostAnswerIndex = 0;
      io.emit('clearAnswer');
      console.log(`[STAGE HOST] All R${currentRound} answers shown — iPad cleared`);
    }
  }

  // R1/R3: navigate StreamDeck back to SDE1 after correct answer
  if (currentRound === 1 || currentRound === 3) {
    navigateStreamDeck(1);
  }

  return gameState;
}

function undoLastAnswer(teamId, source = 'system') {
  const team = gameState[teamId];
  if (!team || team.history.length === 0) {
    console.log(`[GAME] Nothing to undo for ${teamId}`);
    return null;
  }

  const lastEntry = team.history.pop();
  team.correctAnswers = Math.max(0, team.correctAnswers - 1);

  if (lastEntry.type === 'points') {
    // Round 4: reverse points and earnedTime
    team.points -= lastEntry.pointsAwarded;
    team.earnedTime -= lastEntry.pointsAwarded;
  } else {
    // Rounds 1-3: reverse earnedTime
    team.earnedTime -= lastEntry.pointsAwarded;
  }

  // Clamp
  if (team.earnedTime < 0) team.earnedTime = 0;
  if (team.points < 0) team.points = 0;
  team.remainingTime = team.maxTime - team.earnedTime;

  // Restore golden record if it was used on this answer
  if (lastEntry.goldenRecord) {
    team.goldenRecordUsed = false;
    team.goldenRecordAvailable = true;
    team.goldenRecordArmed = false;
  }

  // Update QLab text cue
  updateQLabTextCue(teamId, team.earnedTime);

  // Update QLab load cue with new remaining time
  sendQLabLoadCue(teamId, team.remainingTime);

  // Recompute leader
  retargetLeaderSD('undo');

  // R4: undo may flip a tie <-> non-tie state, so keep DUALGO target live
  retargetDUALGO('undo');

  // Stop buzzer cues (most likely trigger for an undo)
  sendBridgeOsc('/cue/IBUZZ/stop', 0, '→ stop IBUZZ on undo');
  sendBridgeOsc('/cue/ABUZZ/stop', 0, '→ stop ABUZZ on undo');

  logActivity('undo', teamId, `Undo answer #${lastEntry.answer} (-${lastEntry.pointsAwarded}s${lastEntry.goldenRecord ? ' GOLDEN RECORD reversed' : ''}, now ${team.earnedTime}s)`, source);
  console.log(`[GAME] ${TEAMS[teamId].name} Undo #${lastEntry.answer} | -${lastEntry.pointsAwarded}s | Earned: ${team.earnedTime}s | Remaining: ${team.remainingTime}s`);

  return gameState;
}

// Refresh both teams' Golden Record availability at the start of a round.
// R1/R2/R3 each get a fresh Golden Record — if a team used it in the previous
// round, they can use it again in the new round. Does NOT touch R4 (no GR there).
function refreshGoldenRecords(source = 'system') {
  for (const teamId of ['anthems', 'icons']) {
    const team = gameState[teamId];
    if (!team) continue;
    const wasUsed = team.goldenRecordUsed || !team.goldenRecordAvailable;
    team.goldenRecordAvailable = true;
    team.goldenRecordArmed = false;
    team.goldenRecordUsed = false;
    if (wasUsed) {
      console.log(`[GOLDEN RECORD] Refreshed for ${TEAMS[teamId].name} (${source})`);
      logActivity('golden_record', teamId, `Golden Record refreshed for ${TEAMS[teamId].name}`, source);
    }
  }
  io.emit("stateUpdate", gameState);
}

function activateGoldenRecord(teamId, source = 'system') {
  const team = gameState[teamId];
  if (!team || !team.isActive) {
    console.log(`[GAME] ${teamId} is not active, ignoring Golden Record`);
    return null;
  }

  if (roundState.currentRound === 0 || roundState.currentRound === 4) {
    console.log(`[GAME] Golden Record not available in round ${roundState.currentRound} for ${TEAMS[teamId].name}`);
    return null;
  }

  if (!team.goldenRecordAvailable || team.goldenRecordUsed) {
    console.log(`[GAME] Golden Record already used by ${TEAMS[teamId].name}`);
    return null;
  }

  if (team.goldenRecordArmed) {
    console.log(`[GAME] Golden Record already armed for ${TEAMS[teamId].name}`);
    return null;
  }

  team.goldenRecordArmed = true;
  playGoldenRecordCue(teamId);

  logActivity('golden_record', teamId, `Golden Record activated for ${TEAMS[teamId].name}`, source);
  console.log(`[GAME] Golden Record ARMED for ${TEAMS[teamId].name} (${source})`);

  return gameState;
}

function playR4Track(trackNum, source = 'system') {
  if (trackNum < 1 || trackNum > stageHostAnswers.length) {
    console.log(`[ROUND 4] Invalid track number: ${trackNum} (max ${stageHostAnswers.length})`);
    return null;
  }

  if (roundState.currentRound !== 4) {
    console.log(`[ROUND 4] Not in Round 4 (current: ${roundState.currentRound}), ignoring R4T${trackNum}`);
    return null;
  }

  if (r4TracksPlayed[trackNum]) {
    console.log(`[ROUND 4] Track R4T${trackNum} already played, rejecting (${source})`);
    return null;
  }

  r4TracksPlayed[trackNum] = true;
  lastR4TrackPlayed = trackNum;

  // Fire QLab cue R4T{n}
  const cueName = `R4T${trackNum}`;
  const address = `/cue/${cueName}/start`;
  const payload = JSON.stringify({ address, value: 0 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[ROUND 4] Cue ${cueName} started (${source}): ${body}`);
    });
  });

  req.on("error", (err) => {
    console.error(`[ROUND 4] Error starting cue ${cueName}:`, err.message);
  });

  req.write(payload);
  req.end();

  logActivity('r4_track', 'all', `Round 4 track ${trackNum} played`, source);
  console.log(`[ROUND 4] Track R4T${trackNum} played (${source}) — played: ${JSON.stringify(r4TracksPlayed)}`);

  return r4TracksPlayed;
}

// =============================================================================
// Express + Socket.IO (Web Dashboard)
// =============================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// =============================================================================
// Buzzer Heartbeat
// =============================================================================
let lastBuzzerHeartbeat = 0;
const BUZZER_TIMEOUT_MS = 10000; // Consider disconnected after 10s

app.post("/api/buzzer/heartbeat", (req, res) => {
  const wasConnected = (Date.now() - lastBuzzerHeartbeat) < BUZZER_TIMEOUT_MS;
  lastBuzzerHeartbeat = Date.now();
  if (!wasConnected) {
    console.log("[BUZZER] Connected");
    io.emit("buzzerStatus", { connected: true });
  }
  res.json({ ok: true });
});

app.get("/api/buzzer/status", (req, res) => {
  const connected = (Date.now() - lastBuzzerHeartbeat) < BUZZER_TIMEOUT_MS;
  res.json({ connected });
});

// Map buzzer cue names to team IDs
const BUZZER_CUE_TEAM = { 'IBUZZ': 'icons', 'ABUZZ': 'anthems' };

app.post("/api/buzzer/trigger", (req, res) => {
  const { action, cue, key } = req.body || {};
  const detail = cue ? `Buzzer: ${action} cue ${cue} (key: ${key})` : `Buzzer: ${action} (key: ${key})`;
  console.log(`[BUZZER] ${detail}`);
  logActivity('buzzer', 'all', detail, 'buzzer');

  // Notify dashboard which team buzzed in
  const teamId = BUZZER_CUE_TEAM[cue];
  if (teamId) {
    io.emit("buzzerFired", { team: teamId });
  }

  res.json({ ok: true });
});

// Periodically check if buzzer has gone away
setInterval(() => {
  const connected = (Date.now() - lastBuzzerHeartbeat) < BUZZER_TIMEOUT_MS;
  if (!connected && lastBuzzerHeartbeat > 0) {
    // Only emit disconnect once (when it transitions from connected to disconnected)
    const timeSince = Date.now() - lastBuzzerHeartbeat;
    if (timeSince >= BUZZER_TIMEOUT_MS && timeSince < BUZZER_TIMEOUT_MS + 6000) {
      console.log("[BUZZER] Disconnected");
      io.emit("buzzerStatus", { connected: false });
    }
  }
}, 5000);

app.get("/api/state", (req, res) => {
  res.json({ ...gameState, round: roundState, turn: turnState });
});

// Round tracking API endpoints
app.get("/api/round", (req, res) => {
  res.json(roundState);
});

app.post("/api/round/next", (req, res) => {
  const next = roundState.currentRound + 1;
  if (next > TOTAL_ROUNDS) {
    return res.json({ success: false, message: "Already at final round" });
  }
  setRound(next, 'api');
  res.json({ success: true, round: roundState });
});

app.post("/api/round/reset", (req, res) => {
  // Cancel any pending reset OSC from a prior reset so we start with a clean
  // staggered queue instead of racing tail-end OSC against the new burst.
  clearTimeoutBucket(resetTimeouts);
  resetRounds('api');
  res.json({ success: true, round: roundState });
});

app.post("/api/round/:num", (req, res) => {
  const num = parseInt(req.params.num);
  if (isNaN(num) || num < 0 || num > TOTAL_ROUNDS) {
    return res.status(400).json({ success: false, message: `Invalid round. Use 0-${TOTAL_ROUNDS}.` });
  }
  setRound(num, 'api');
  res.json({ success: true, round: roundState });
});

// =============================================================================
// Track QA — batch-mode audio verification tool at /qa. Loads sequential
// batches of tracks into the real show cues (R1T*, R2T*, R3T*, R4T*) so the
// operator can verify file targets and answer notes through the actual show
// flow. Marks each batch as verified, then advances. Hidden from the operator
// dashboard. Delete this block + public/qa.{html,js} when QA is complete.
// =============================================================================
const QA_STATE_FILE = path.join(__dirname, "../data/track-qa.json");
const QA_COMPLETIONS_FILE = path.join(__dirname, "../data/qa-completions.json");
const QA_BATCH_SIZES = { '1': 6, '2': 2, '3': 4, '4': 35 };
let qaTimeouts = [];

// QA completions log — one entry per (pack, round) marked complete by the
// operator from the Track QA tool. Surfaced to docforge via /api/selftest/checklist.
let qaCompletions = []; // [{ packId, round, completedAt, total }]
function loadQaCompletions() {
  try {
    if (fs.existsSync(QA_COMPLETIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(QA_COMPLETIONS_FILE, 'utf8'));
      if (Array.isArray(data?.completions)) qaCompletions = data.completions;
    }
  } catch (e) {
    console.error('[QA] Failed to load completions:', e.message);
  }
}
function saveQaCompletions() {
  try {
    fs.writeFileSync(QA_COMPLETIONS_FILE, JSON.stringify({ completions: qaCompletions }, null, 2));
  } catch (e) {
    console.error('[QA] Failed to save completions:', e.message);
  }
}
loadQaCompletions();

let qaState = { packId: null, round: null, pointer: 0, verified: [] };
function loadQaState() {
  try {
    if (fs.existsSync(QA_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QA_STATE_FILE, 'utf8'));
      qaState = {
        packId: typeof data.packId === 'string' ? data.packId : null,
        round: typeof data.round === 'string' ? data.round : null,
        pointer: Number.isInteger(data.pointer) ? data.pointer : 0,
        verified: Array.isArray(data.verified) ? data.verified : [],
      };
    }
  } catch (err) {
    console.error('[QA] Failed to load state:', err.message);
  }
}
function saveQaState() {
  try {
    fs.writeFileSync(QA_STATE_FILE, JSON.stringify(qaState, null, 2));
  } catch (err) {
    console.error('[QA] Failed to save state:', err.message);
  }
}
loadQaState();

// Build the per-round source list in pack JSON order.
// R1 returns pairs ({hook, reveal}); R2/R3/R4 return single track entries.
function qaBuildRoundList(packId, round) {
  const pack = packData[packId];
  if (!pack || !pack.rounds || !pack.rounds[round]) return [];
  const tracks = (pack.rounds[round].tracks || []).filter(t => t.band !== 'XX');
  if (round === '1') {
    const pairs = {};
    const order = [];
    tracks.forEach(t => {
      const num = t.cue.replace('R1T', '').split('.')[0];
      if (!pairs[num]) { pairs[num] = {}; order.push(num); }
      if (t.cue.endsWith('.1')) pairs[num].hook = t;
      if (t.cue.endsWith('.2')) pairs[num].reveal = t;
    });
    return order.map(n => pairs[n]).filter(p => p.hook && p.reveal);
  }
  return tracks;
}

function qaKey(packId, round, item) {
  // For R1 pairs, key on hook fileName; for others, on the track fileName.
  const fn = item.hook ? item.hook.fileName : item.fileName;
  return `${packId}|${round}|${fn}`;
}

function qaQueue(fn, delay) {
  qaTimeouts.push(setTimeout(fn, delay));
}

function qaLoadBatch(packId, round, startIndex) {
  // Cancel any pending cue-content writes (own bucket + r1/r4/genre) so this
  // QA batch isn't clobbered by tail-end OSC from a previous writer.
  cancelAllCueWrites();
  const list = qaBuildRoundList(packId, round);
  if (!list.length) return { batch: [], total: 0, start: 0, end: 0 };
  const batchSize = QA_BATCH_SIZES[round] || 1;
  const start = Math.max(0, Math.min(startIndex, Math.max(0, list.length - 1)));
  const end = Math.min(start + batchSize, list.length);
  const batch = list.slice(start, end);
  const basePath = packSettings.audioBasePath || '';
  let delay = 0;

  if (round === '1') {
    batch.forEach((pair, i) => {
      const slotNum = i + 1;
      const hookSlot = `R1T${slotNum}.1`;
      const revealSlot = `R1T${slotNum}.2`;
      const hookPath = basePath ? path.join(basePath, pair.hook.fileName) : pair.hook.fileName;
      const hookName = `${pair.hook.band} - ${pair.hook.track} [SHORT]`.toUpperCase();
      const revealPath = basePath ? path.join(basePath, pair.reveal.fileName) : pair.reveal.fileName;
      const revealName = `${pair.reveal.band} - ${pair.reveal.track} [LONG]`.toUpperCase();
      const revealNotes = `Correct Answer: ${pair.hook.band} - ${pair.hook.track}`.toUpperCase();
      qaQueue(() => updateQLabCueFilePath(hookSlot, hookPath), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueName(hookSlot, hookName), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueNotes(hookSlot, ''), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueFilePath(revealSlot, revealPath), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueName(revealSlot, revealName), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueNotes(revealSlot, revealNotes), delay); delay += OSC_STAGGER_MS;
    });
  } else if (round === '2' || round === '3') {
    batch.forEach((track, i) => {
      const slot = `R${round}T${i + 1}`;
      const fullPath = basePath ? path.join(basePath, track.fileName) : track.fileName;
      const cueName = `${track.band} - ${track.track}`.toUpperCase();
      qaQueue(() => updateQLabCueFilePath(slot, fullPath), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueName(slot, cueName), delay); delay += OSC_STAGGER_MS;
    });
    if (round === '3') {
      const noteLines = batch.map((t, i) => {
        if (t.track1 && t.track2) return `${i + 1}. ${t.track1.band} - ${t.track1.track} & ${t.track2.band} - ${t.track2.track}`;
        return `${i + 1}. ${t.band} - ${t.track}`;
      });
      qaQueue(() => updateQLabCueNotes('R3SCORES', noteLines.join('\n\n')), delay); delay += OSC_STAGGER_MS;
    }
  } else if (round === '4') {
    batch.forEach((track, i) => {
      const slot = `R4T${i + 1}`;
      const fullPath = basePath ? path.join(basePath, track.fileName) : track.fileName;
      const cueName = `${track.band} - ${track.track}`;
      const notesText = `CORRECT ANSWER:\n\n${track.band} - ${track.track}`.toUpperCase();
      qaQueue(() => updateQLabCueFilePath(slot, fullPath), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueName(slot, cueName), delay); delay += OSC_STAGGER_MS;
      qaQueue(() => updateQLabCueNotes(`R4TF${i + 1}`, notesText), delay); delay += OSC_STAGGER_MS;
    });
  }

  // Push answers to the stagehost iPad so QA loads behave like a real
  // round-load (genre picker / R1 entry / R4 entry all do this too). For R3
  // mashups, include displayText with both layered songs so the iPad shows
  // the same content as the R3SCORES cue notes.
  stageHostAnswers = batch.map((item, i) => {
    if (item.hook) {
      return { number: i + 1, track: item.hook.track, artist: item.hook.band };
    }
    const ans = { number: i + 1, track: item.track, artist: item.band };
    if (round === '3' && item.track1 && item.track2) {
      ans.displayText = `${item.track1.band} - ${item.track1.track} & ${item.track2.band} - ${item.track2.track}`;
    }
    return ans;
  });
  stageHostAnswerIndex = 0;
  const genreLabel = round === '1' ? 'QA' : round === '4' ? 'QA — Final Round' : `QA — ${batch[0]?.genre || ''}`.trim();
  io.emit('answersUpdate', { round, genre: genreLabel, answers: stageHostAnswers });
  if (stageHostAnswers.length > 0) {
    io.emit('currentTrack', { trackNumber: 1, total: stageHostAnswers.length });
  }

  console.log(`[QA] Loaded batch ${start + 1}-${end} of ${list.length} (pack=${packId} round=${round})`);
  return {
    batch: batch.map(item => {
      if (item.hook) {
        return {
          band: item.hook.band, track: item.hook.track,
          hookFile: item.hook.fileName, revealFile: item.reveal.fileName,
          cue: `R1T${batch.indexOf(item) + 1}.1/.2`,
          key: qaKey(packId, round, item),
        };
      }
      return {
        band: item.band, track: item.track, fileName: item.fileName,
        cue: round === '4' ? `R4T${batch.indexOf(item) + 1}` : `R${round}T${batch.indexOf(item) + 1}`,
        key: qaKey(packId, round, item),
      };
    }),
    total: list.length,
    start,
    end,
  };
}

function qaSnapshot() {
  const packs = Object.keys(packData).map(id => ({ id, name: packData[id].name || id }));
  if (!qaState.packId || !qaState.round || !packData[qaState.packId]) {
    return { packs, packId: null, round: null, batch: [], total: 0, start: 0, end: 0, verifiedCount: 0, verified: [] };
  }
  const list = qaBuildRoundList(qaState.packId, qaState.round);
  const batchSize = QA_BATCH_SIZES[qaState.round] || 1;
  const start = Math.max(0, Math.min(qaState.pointer, Math.max(0, list.length - 1)));
  const end = Math.min(start + batchSize, list.length);
  const batch = list.slice(start, end).map((item, i) => {
    if (item.hook) {
      return {
        band: item.hook.band, track: item.hook.track,
        hookFile: item.hook.fileName, revealFile: item.reveal.fileName,
        cue: `R1T${i + 1}.1/.2`,
        key: qaKey(qaState.packId, qaState.round, item),
      };
    }
    return {
      band: item.band, track: item.track, fileName: item.fileName,
      cue: qaState.round === '4' ? `R4T${i + 1}` : `R${qaState.round}T${i + 1}`,
      key: qaKey(qaState.packId, qaState.round, item),
    };
  });
  // Verified count restricted to current pack+round
  const prefix = `${qaState.packId}|${qaState.round}|`;
  const verifiedInRound = qaState.verified.filter(k => k.startsWith(prefix));
  return {
    packs, packId: qaState.packId, round: qaState.round,
    pointer: qaState.pointer, batchSize,
    batch, total: list.length, start, end,
    verifiedCount: verifiedInRound.length,
    verified: verifiedInRound,
  };
}

app.get("/api/qa/state", (req, res) => {
  res.json(qaSnapshot());
});

app.post("/api/qa/select", express.json(), (req, res) => {
  const { packId, round } = req.body || {};
  if (!packData[packId]) return res.status(400).json({ success: false, error: 'Unknown packId' });
  if (!QA_BATCH_SIZES[String(round)]) return res.status(400).json({ success: false, error: 'Invalid round' });
  qaState.packId = packId;
  qaState.round = String(round);
  qaState.pointer = 0;
  saveQaState();
  qaLoadBatch(qaState.packId, qaState.round, qaState.pointer);
  res.json({ success: true, ...qaSnapshot() });
});

app.post("/api/qa/reload", (req, res) => {
  if (!qaState.packId || !qaState.round) return res.status(400).json({ success: false, error: 'Select a pack and round first' });
  qaLoadBatch(qaState.packId, qaState.round, qaState.pointer);
  res.json({ success: true, ...qaSnapshot() });
});

app.post("/api/qa/confirm", (req, res) => {
  if (!qaState.packId || !qaState.round) return res.status(400).json({ success: false, error: 'Select a pack and round first' });
  const list = qaBuildRoundList(qaState.packId, qaState.round);
  if (!list.length) return res.status(404).json({ success: false, error: 'No tracks for this round' });
  const batchSize = QA_BATCH_SIZES[qaState.round] || 1;
  const start = qaState.pointer;
  const end = Math.min(start + batchSize, list.length);
  for (let i = start; i < end; i++) {
    const k = qaKey(qaState.packId, qaState.round, list[i]);
    if (!qaState.verified.includes(k)) qaState.verified.push(k);
  }
  qaState.pointer = end >= list.length ? Math.max(0, list.length - batchSize) : end;
  saveQaState();
  const allDone = end >= list.length;
  qaLoadBatch(qaState.packId, qaState.round, qaState.pointer);
  res.json({ success: true, allDone, ...qaSnapshot() });
});

app.post("/api/qa/back", (req, res) => {
  if (!qaState.packId || !qaState.round) return res.status(400).json({ success: false, error: 'Select a pack and round first' });
  const batchSize = QA_BATCH_SIZES[qaState.round] || 1;
  qaState.pointer = Math.max(0, qaState.pointer - batchSize);
  saveQaState();
  qaLoadBatch(qaState.packId, qaState.round, qaState.pointer);
  res.json({ success: true, ...qaSnapshot() });
});

app.post("/api/qa/reset-round", (req, res) => {
  if (!qaState.packId || !qaState.round) return res.status(400).json({ success: false, error: 'Select a pack and round first' });
  const prefix = `${qaState.packId}|${qaState.round}|`;
  qaState.verified = qaState.verified.filter(k => !k.startsWith(prefix));
  qaState.pointer = 0;
  saveQaState();
  qaLoadBatch(qaState.packId, qaState.round, qaState.pointer);
  res.json({ success: true, ...qaSnapshot() });
});

// Mark the current pack+round as QA-complete. Stored persistently and
// surfaced as a checklist item in /api/selftest/checklist for docforge.
app.post("/api/qa/complete", express.json(), (req, res) => {
  const packId = req.body?.packId || qaState.packId;
  const round  = req.body?.round  || qaState.round;
  if (!packId || !round) return res.status(400).json({ success: false, error: 'packId and round required' });

  const list = qaBuildRoundList(packId, round);
  const total = list.length;
  const verifiedCount = qaState.verified.filter(k => k.startsWith(`${packId}|${round}|`)).length;

  qaCompletions = qaCompletions.filter(c => !(c.packId === packId && c.round === round));
  qaCompletions.push({
    packId, round,
    completedAt: new Date().toISOString(),
    total, verifiedCount,
  });
  saveQaCompletions();
  res.json({ success: true, completions: qaCompletions });
});

// Clear a single completion (or all if no params) — for re-running QA.
app.delete("/api/qa/complete", (req, res) => {
  const { packId, round } = req.query;
  if (packId && round) {
    qaCompletions = qaCompletions.filter(c => !(c.packId === packId && c.round === round));
  } else if (!packId && !round) {
    qaCompletions = [];
  } else {
    return res.status(400).json({ success: false, error: 'provide both packId and round, or neither' });
  }
  saveQaCompletions();
  res.json({ success: true, completions: qaCompletions });
});

app.get("/api/qa/completions", (req, res) => {
  res.json({ success: true, completions: qaCompletions });
});

// R4 manual retarget API — flips R4NEXT to the specified team's R4 group.
// Useful for testing or operator overrides. POST /api/r4/retarget/:team
app.post("/api/r4/retarget/:team", (req, res) => {
  const teamId = req.params.team;
  if (teamId !== 'anthems' && teamId !== 'icons') {
    return res.status(400).json({ success: false, message: "team must be 'anthems' or 'icons'" });
  }
  retargetR4NextToTeam(teamId, 'api');
  res.json({ success: true, team: teamId });
});

// Manual retarget of R2GO2 based on current r2PlayedTeams state.
// POST /api/r2/retarget
app.post("/api/r2/retarget", (req, res) => {
  retargetR2GO2('api');
  res.json({ success: true, playedTeams: Array.from(r2PlayedTeams) });
});

// Manual retarget of LEADERSD based on current scores.
// POST /api/leader/retarget
app.post("/api/leader/retarget", (req, res) => {
  retargetLeaderSD('api');
  res.json({ success: true });
});

// Next team trigger (HTTP counterpart of OSC /chart-toppers/nextteam).
// Flips currentTeam to the other team.
app.post("/api/nextteam", (req, res) => {
  if (!turnState.currentTeam) {
    return res.status(400).json({ success: false, message: "no currentTeam set — run cointoss first" });
  }
  const leavingTeam = turnState.currentTeam;
  const next = otherTeam(leavingTeam);
  if (roundState.currentRound === 2) {
    r2PlayedTeams.add(leavingTeam);
  } else if (roundState.currentRound === 4) {
    r4PlayedTeams.add(leavingTeam);
    // Retarget R4SINGLESCORE to the incoming team's score cue
    const scoreCue = next === 'anthems' ? 'R4SANTHEM' : 'R4SICON';
    updateQLabCueTarget('R4SINGLESCORE', scoreCue);
    console.log(`[R4 FLOW] R4SINGLESCORE → ${scoreCue} (${TEAMS[next].name} now playing)`);
    // Retarget R4GOTO: team 2's block if first team done, R5 if both done
    const bothPlayed = r4PlayedTeams.has('anthems') && r4PlayedTeams.has('icons');
    if (bothPlayed) {
      updateQLabCueTarget('R4GOTO', 'R5');
      console.log(`[R4 FLOW] R4GOTO → R5 (both teams played)`);
    } else {
      const nextBlock = next === 'anthems' ? 'R4ANTHEM' : 'R4ICON';
      updateQLabCueTarget('R4GOTO', nextBlock);
      console.log(`[R4 FLOW] R4GOTO → ${nextBlock} (${TEAMS[next].name} still to play)`);
    }
  }
  turnState.currentTeam = next;
  if (turnState.phase === 'playing-first') {
    turnState.phase = 'playing-second';
  } else if (turnState.phase === 'playing-second') {
    turnState.phase = 'genre-pick';
  }
  navigateStreamDeck(TEAM_PAGES[next]);
  setCompanionVariable('current_team', TEAMS[next].name);
  // Move the dashboard glow to the new team
  io.emit("teamStopPlaying", leavingTeam);
  io.emit("triggerStop", leavingTeam);
  io.emit("teamPlaying", next);
  io.emit("triggerPlaying", next);
  io.emit('turnUpdate', turnState);
  logActivity('turn', next, `Next team: ${TEAMS[next].name}`, 'api');
  res.json({ success: true, currentTeam: next, phase: turnState.phase });
});

// Turn state API
app.get("/api/turn", (req, res) => {
  res.json(turnState);
});

app.post("/api/cointoss/:team", (req, res) => {
  const teamId = req.params.team;
  if (!TEAMS[teamId]) {
    return res.status(400).json({ success: false, error: 'Invalid team. Use anthems or icons.' });
  }
  turnState.firstTeam = teamId;
  turnState.currentTeam = teamId;
  turnState.phase = roundState.currentRound === 4 ? 'playing-first' : 'genre-pick';
  io.emit('turnUpdate', turnState);
  logActivity('cointoss', teamId, `Coin toss: ${TEAMS[teamId].name} goes first`, 'api');

  // R4 on a tied-score entry: also set R4NEXT to the cointoss winner's block
  // so the operator's next GO fires the right team's countdown. Otherwise
  // navigate to the round's genre picker page.
  if (roundState.currentRound === 4) {
    retargetR4NextToTeam(teamId, 'cointoss-api');
  } else {
    const genrePage = GENRE_PAGES[roundState.currentRound];
    if (genrePage) {
      navigateStreamDeck(genrePage);
    }
  }

  // Update LEADERSD to the cointoss winner so the QLab Auto StreamDeck cue
  // points to the right team page even when scores are tied.
  retargetLeaderSD('cointoss-api');

  res.json({ success: true, turn: turnState });
});

// Activity log API endpoint
const MAX_ACTIVITY_LIMIT = 1000;

app.get("/api/activity", (req, res) => {
  const { team = 'all', type = 'all', days = '60', limit } = req.query;
  let activities = getActivityLog(team, type, parseInt(days));

  if (limit) {
    const parsedLimit = Math.min(Math.max(parseInt(limit), 1), MAX_ACTIVITY_LIMIT);
    activities = activities.slice(-parsedLimit);
  }

  res.json(activities);
});

// Reset activity log API endpoint (requires password)
app.post("/api/activity/reset", (req, res) => {
  const { password } = req.body;
  
  // Verify admin password
  if (password !== CONFIG.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "Invalid password" });
  }
  
  try {
    // Clear the activity log
    activityLog = [];
    saveActivityLog();
    
    // Log the reset action itself
    logActivity('system', 'all', 'Activity log reset by administrator', 'api');
    
    console.log("[API] Activity log reset by administrator");
    res.json({ success: true, message: "Activity log reset successfully" });
  } catch (error) {
    console.error("[API] Error resetting activity log:", error);
    res.status(500).json({ success: false, message: "Failed to reset activity log" });
  }
});

// Pack settings API endpoints with persistent storage
const PACK_SETTINGS_FILE = path.join(__dirname, "../data/pack-settings.json");

// QLab OSC bridge URL for sending commands
const BRIDGE_URL = process.env.BRIDGE_URL || "http://osc-bridge:3001";

// Load pack track data from JSON files
const PACKS_DIR = path.join(__dirname, '../packs');
function loadPackData() {
  const packs = {};
  try {
    const files = fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'));
    files.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, file), 'utf8'));
        packs[data.packId] = data;
      } catch (e) {
        console.error(`[PACKS] Failed to load ${file}:`, e.message);
      }
    });
  } catch (e) {
    console.warn(`[PACKS] Could not read packs directory (${PACKS_DIR}):`, e.message);
  }
  return packs;
}
let packData = loadPackData();
console.log(`[PACKS] Loaded ${Object.keys(packData).length} pack(s): ${Object.keys(packData).join(', ') || 'none'}`);

// Load pack settings from file or use defaults
// Per-resolution base font size (pt) for the genre picker text cues. The
// active resolution is picked in settings; the server scales fontSize down
// for long genre names so MEDITERRANEAN CLASSICS still fits in the same
// button as K POP. Tunable via settings.
const GENRE_FONT_DEFAULTS = {
  '3840x2160': 120,
  '5520x1080': 80,
  '2560x1280': 100,
};

// Char count below which no shrink applies; above it, fontSize scales
// linearly as threshold/len. Per-resolution because each QLab project's
// text bounding box differs.
const GENRE_SHRINK_THRESHOLD_DEFAULTS = {
  '3840x2160': 18,
  '5520x1080': 13,
  '2560x1280': 13,
};

// Color sent with every /text/format. QLab resets all unspecified fields
// in the format record, so we must include color or it defaults to white.
// rgbaColor uses 0-1 floats. Default is the show's pale yellow (#FFFFAE).
const GENRE_TEXT_COLOR_DEFAULT = { red: 1, green: 1, blue: 0.682, alpha: 1 };

let packSettings = {
  currentPack: 'uk-usa-german',
  audioBasePath: '',
  qlabResolution: '2560x1280',
  genreFontSizes: { ...GENRE_FONT_DEFAULTS },
  genreShrinkThresholds: { ...GENRE_SHRINK_THRESHOLD_DEFAULTS },
  lastChanged: null
};

// Function to load pack settings
function loadPackSettings() {
  try {
    if (fs.existsSync(PACK_SETTINGS_FILE)) {
      const data = fs.readFileSync(PACK_SETTINGS_FILE, 'utf8');
      const loaded = JSON.parse(data);
      // Merge loaded settings with defaults so new fields always exist
      packSettings = {
        currentPack: 'uk-usa-german',
        audioBasePath: '',
        lastChanged: null,
        ...loaded
      };
      // Strip wrapping quotes that may have been saved before sanitization
      // existed (Finder/Terminal paste habit).
      if (typeof packSettings.audioBasePath === 'string') {
        const trimmed = packSettings.audioBasePath.trim();
        if (
          (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          (trimmed.startsWith('"') && trimmed.endsWith('"'))
        ) {
          packSettings.audioBasePath = trimmed.slice(1, -1);
          console.log(`[PACK] Stripped wrapping quotes from saved audioBasePath`);
        } else {
          packSettings.audioBasePath = trimmed;
        }
      }
      console.log(`[PACK] Loaded pack settings: ${packSettings.currentPack}, audioBasePath: "${packSettings.audioBasePath || 'not set'}"`);
    } else {
      console.log('[PACK] No settings file found, using defaults');
    }
  } catch (error) {
    console.error('[PACK] Error loading pack settings:', error);
  }
}

// Function to save pack settings
function savePackSettings() {
  try {
    fs.writeFileSync(PACK_SETTINGS_FILE, JSON.stringify(packSettings, null, 2));
    console.log(`[PACK] Saved pack settings: ${packSettings.currentPack}`);
  } catch (error) {
    console.error('[PACK] Error saving pack settings:', error);
  }
}

// Load settings on server start
loadPackSettings();

// Function to send OSC command to update QLab cue file path
function updateQLabCueFilePath(cueNumber, filePath) {
  const address = `/cue/${cueNumber}/fileTarget`;
  const payload = JSON.stringify({ address, value: filePath });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → "${filePath}" (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Function to send OSC command to update QLab cue name
function updateQLabCueName(cueNumber, cueName) {
  const address = `/cue/${cueNumber}/name`;
  const payload = JSON.stringify({ address, value: cueName });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → "${cueName}" (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Function to send OSC command to update QLab cue notes
function updateQLabCueNotes(cueNumber, notes) {
  const address = `/cue/${cueNumber}/notes`;
  const payload = JSON.stringify({ address, value: notes });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → "${notes}" (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Round 4 flow: retarget R4NEXT based on score order.
//   - firstTeam  = lowest earnedTime  (plays first)
//   - secondTeam = highest earnedTime (plays second / the "winner" going in)
// On a tie we leave R4NEXT untouched and log a warning.
function r4TeamOrder() {
  const anthemsScore = gameState.anthems?.earnedTime || 0;
  const iconsScore = gameState.icons?.earnedTime || 0;
  if (anthemsScore === iconsScore) return null;
  const firstTeamId = anthemsScore < iconsScore ? 'anthems' : 'icons';
  return {
    firstTeamId,
    secondTeamId: firstTeamId === 'anthems' ? 'icons' : 'anthems',
    anthemsScore,
    iconsScore,
  };
}

function cueFor(teamId) {
  return teamId === 'anthems'
    ? CONFIG.QLAB_CUE_R4_ANTHEMS
    : CONFIG.QLAB_CUE_R4_ICONS;
}

function retargetR4NextToFirstTeam() {
  const order = r4TeamOrder();
  if (!order) {
    // Tied entry — R4NEXT points at the coin flip cue (CF4) so firing R4NEXT
    // plays the coin flip. After the coin flip resolves, /chart-toppers/cointoss
    // fires and the cointoss handler retargets R4NEXT to the winner's block.
    const ties = gameState.anthems?.earnedTime || 0;
    console.log(`[R4 FLOW] Tie score (${ties}s each) — R4NEXT → ${CONFIG.QLAB_CUE_CF4} (coin flip)`);
    logActivity('round', 'all', `R4 tie (${ties}s each) — R4NEXT → ${CONFIG.QLAB_CUE_CF4}`, 'system');
    updateQLabCueTarget(CONFIG.QLAB_CUE_R4NEXT, CONFIG.QLAB_CUE_CF4);
    return;
  }
  const targetCue = cueFor(order.firstTeamId);
  console.log(
    `[R4 FLOW] Scores — anthems=${order.anthemsScore}s, icons=${order.iconsScore}s → ${TEAMS[order.firstTeamId].name} plays first. Retargeting ${CONFIG.QLAB_CUE_R4NEXT} → ${targetCue}`
  );
  logActivity('round', order.firstTeamId, `R4 first team: ${TEAMS[order.firstTeamId].name} (retarget ${CONFIG.QLAB_CUE_R4NEXT} → ${targetCue})`, 'system');
  updateQLabCueTarget(CONFIG.QLAB_CUE_R4NEXT, targetCue);
}

// Retarget R4NEXT to a specific team's R4 group. Used by the playing-signal
// auto-retarget path (below) — as soon as a team starts playing in R4, we
// flip R4NEXT to the OTHER team so the operator's next GO fires that group.
function retargetR4NextToTeam(teamId, source = 'system') {
  const targetCue = cueFor(teamId);
  console.log(
    `[R4 FLOW] Retargeting ${CONFIG.QLAB_CUE_R4NEXT} → ${targetCue} (${TEAMS[teamId].name}) (${source})`
  );
  logActivity('round', teamId, `R4 retarget ${CONFIG.QLAB_CUE_R4NEXT} → ${targetCue} (${TEAMS[teamId].name})`, source);
  updateQLabCueTarget(CONFIG.QLAB_CUE_R4NEXT, targetCue);
}


// Map a team to its StreamDeck-page cue (SDE10 for icons, SDE11 for anthems).
// Used by retargetLeaderSD to point LEADERSD at the current leader's (or R4
// loser's) SD page.
function sdeCueFor(teamId) {
  return teamId === 'anthems'
    ? CONFIG.QLAB_CUE_SDE_ANTHEMS
    : CONFIG.QLAB_CUE_SDE_ICONS;
}

// Round 2 flow: retarget R2GO2 based on how many teams have played in R2.
//   - < 2 teams played: R2GO2 → R2T (tracks for second team)
//   - both played: R2GO2 → R3 (next round)
function retargetR2GO2(source = 'system') {
  const bothPlayed = r2PlayedTeams.has('anthems') && r2PlayedTeams.has('icons');
  const target = bothPlayed ? CONFIG.QLAB_CUE_R3 : CONFIG.QLAB_CUE_R2_TEAM2;
  const label = bothPlayed ? 'both played → R3' : 'R2T';
  console.log(
    `[R2 FLOW] Retargeting ${CONFIG.QLAB_CUE_R2GO2} → ${target} (${label}) (${source})`
  );
  logActivity('round', 'all', `R2 retarget ${CONFIG.QLAB_CUE_R2GO2} → ${target} (${label})`, source);
  updateQLabCueTarget(CONFIG.QLAB_CUE_R2GO2, target);
}

// Shared R2 refresh-tracks logic used by both the HTTP endpoint and the OSC
// handler. State-based, idempotent — repeated calls don't double-advance.
//   - 0 teams played: ignore
//   - 1 team played: swap tracks for opponent, nav SD, force LEADERSD
//   - 2 teams played: R2GO2 → AWO
function handleRefreshTracks(source) {
  if (!lastLoadedGenre.genreIndex) {
    console.warn(`[REFRESH TRACKS] No genre loaded yet, ignoring (${source})`);
    return { success: false, error: 'No genre loaded yet' };
  }

  const playedCount = r2PlayedTeams.size;

  if (playedCount === 0) {
    console.warn(`[REFRESH TRACKS] No team has played yet, ignoring (${source})`);
    return { success: false, error: 'No team has played yet' };
  }

  if (playedCount === 1) {
    const playedTeam = r2PlayedTeams.has('anthems') ? 'anthems' : 'icons';
    const nextTeam = otherTeam(playedTeam);
    console.log(`[REFRESH TRACKS] First team (${TEAMS[playedTeam].name}) done — swapping tracks for ${TEAMS[nextTeam].name} (${source})`);
    const result = loadGenreTracks(lastLoadedGenre.genreIndex);

    // Anticipate second team — mark them played so next refresh hits AWO branch
    r2PlayedTeams.add(nextTeam);
    console.log(`[REFRESH TRACKS] Marked ${TEAMS[nextTeam].name} as played (anticipated)`);

    // Update currentTeam so subsequent correct/incorrect targets the right team
    turnState.currentTeam = nextTeam;
    io.emit('turnUpdate', turnState);
    setCompanionVariable('current_team', TEAMS[nextTeam].name);

    // Nav SD + force LEADERSD to opponent
    navigateStreamDeck(TEAM_PAGES[nextTeam]);
    const nextSdeCue = sdeCueFor(nextTeam);
    updateQLabCueTarget(CONFIG.QLAB_CUE_LEADER_SD, nextSdeCue);
    console.log(`[LEADER SD] Refresh tracks — forced LEADERSD → ${nextSdeCue} (${TEAMS[nextTeam].name}, opponent of ${TEAMS[playedTeam].name})`);

    // Dashboard glow swap
    io.emit("teamStopPlaying", playedTeam);
    io.emit("triggerStop", playedTeam);
    io.emit("teamPlaying", nextTeam);
    io.emit("triggerPlaying", nextTeam);
    console.log(`[REFRESH TRACKS] StreamDeck → ${TEAMS[nextTeam].name} page, dashboard switched (was ${playedTeam})`);

    return { success: true, phase: 'swap', nextTeam, ...result };
  }

  // Both teams played → R2GO2 → AWO
  console.log(`[REFRESH TRACKS] Both teams played — retargeting R2GO2 → ${CONFIG.QLAB_CUE_R3} (${source})`);
  updateQLabCueTarget(CONFIG.QLAB_CUE_R2GO2, CONFIG.QLAB_CUE_R3);
  return { success: true, phase: 'advance' };
}

// Retarget R2COINFLIP based on whether R1 ended in a draw.
// Draw → CF2 (coin flip sequence), leader exists → GP2 (genre picker, skip flip).
function retargetR2CoinFlip(source = 'system') {
  const ranking = teamRanking();
  if (ranking.tie) {
    console.log(`[R2 COINFLIP] Draw detected (${ranking.aScore} each) — R2COINFLIP → ${CONFIG.QLAB_CUE_CF2}`);
    logActivity('coinflip', 'all', `R2 draw — coin flip required (${ranking.aScore} each)`, source);
    updateQLabCueTarget(CONFIG.QLAB_CUE_R2_COINFLIP, CONFIG.QLAB_CUE_CF2);
  } else {
    console.log(`[R2 COINFLIP] ${TEAMS[ranking.leader].name} leads (a=${ranking.aScore} i=${ranking.iScore}) — R2COINFLIP → ${CONFIG.QLAB_CUE_GP2}`);
    logActivity('coinflip', ranking.leader, `R2 no draw — skip coin flip, ${TEAMS[ranking.leader].name} leads`, source);
    updateQLabCueTarget(CONFIG.QLAB_CUE_R2_COINFLIP, CONFIG.QLAB_CUE_GP2);
  }
}

// Retarget R3COINFLIP based on whether scores are tied entering Round 3.
// Draw → CF3 (coin flip sequence), leader exists → GP3 (genre picker, skip flip).
function retargetR3CoinFlip(source = 'system') {
  const ranking = teamRanking();
  if (ranking.tie) {
    console.log(`[R3 COINFLIP] Draw detected (${ranking.aScore} each) — R3COINFLIP → ${CONFIG.QLAB_CUE_CF3}`);
    logActivity('coinflip', 'all', `R3 draw — coin flip required (${ranking.aScore} each)`, source);
    updateQLabCueTarget(CONFIG.QLAB_CUE_R3_COINFLIP, CONFIG.QLAB_CUE_CF3);
  } else {
    console.log(`[R3 COINFLIP] ${TEAMS[ranking.leader].name} leads (a=${ranking.aScore} i=${ranking.iScore}) — R3COINFLIP → ${CONFIG.QLAB_CUE_GP3}`);
    logActivity('coinflip', ranking.leader, `R3 no draw — skip coin flip, ${TEAMS[ranking.leader].name} leads`, source);
    updateQLabCueTarget(CONFIG.QLAB_CUE_R3_COINFLIP, CONFIG.QLAB_CUE_GP3);
  }
}

// Retarget LEADERSD to the team currently in the lead. Combined score =
// earnedTime + points so it works in R1-R3 (time-based) and R4 (points-based).
// On tie, fall back to turnState.currentTeam (i.e. whoever just won the coin
// flip / is currently playing) so LEADERSD always points somewhere sensible.
function retargetLeaderSD(source = 'system') {
  const a = gameState.anthems;
  const i = gameState.icons;
  const aScore = (a?.earnedTime || 0) + (a?.points || 0);
  const iScore = (i?.earnedTime || 0) + (i?.points || 0);
  let leaderId;
  let loserId;
  let label;
  if (aScore === iScore) {
    if (!turnState.currentTeam) {
      // Tied with no coin-toss winner yet — park LEADERSD on SDE1 so the
      // SD shows the neutral page until a team is selected.
      console.log(`[LEADER SD] Tie (${aScore} each) and no currentTeam — LEADERSD → SDE1 (${source})`);
      updateQLabCueTarget(CONFIG.QLAB_CUE_LEADER_SD, 'SDE1');
      return;
    }
    leaderId = turnState.currentTeam;
    loserId = otherTeam(leaderId);
    label = `Tie (${aScore} each) → currentTeam`;
  } else {
    leaderId = aScore > iScore ? 'anthems' : 'icons';
    loserId = otherTeam(leaderId);
    label = roundState.currentRound === 4 ? 'Loser (R4)' : 'Leader';
  }

  // Round 4: loser goes first, so LEADERSD normally points at the loser.
  // EXCEPTION: on a tied R4 (cointoss decided), leaderId is already the
  // cointoss winner (turnState.currentTeam) who plays first — point at them
  // directly, NOT the opposite team.
  const r4NotTied = roundState.currentRound === 4 && aScore !== iScore;
  const targetTeam = r4NotTied ? loserId : leaderId;
  const targetCue = sdeCueFor(targetTeam);
  console.log(
    `[LEADER SD] ${label}: ${TEAMS[targetTeam].name} (a=${aScore} i=${iScore}) → ${CONFIG.QLAB_CUE_LEADER_SD} → ${targetCue} (${source})`
  );
  updateQLabCueTarget(CONFIG.QLAB_CUE_LEADER_SD, targetCue);
}

// Continuously retarget DUALGO as scores change during R4.
//   - Scores tied  → DUALGO → TIEBREAK
//   - Scores differ → DUALGO → R5 (winner reveal)
// Called after every correct/incorrect/undo in R4 and on R4 entry.
// Uses teamRanking (earnedTime + points) — the game-wide total score.
// Does NOT touch tiebreakActive or buzzer arming — those stay under
// the control of /chart-toppers/dualscreen so the operator still drives
// when the tiebreaker actually fires.
function retargetDUALGO(source = 'system') {
  if (roundState.currentRound !== 4) return;
  const ranking = teamRanking();
  const target = ranking.tie ? CONFIG.QLAB_CUE_TIEBREAK : 'R5';
  const label = ranking.tie ? 'TIEBREAK (tied)' : 'R5 (winner reveal)';
  console.log(
    `[DUALGO] Retargeting → ${target} — ${label} (a=${ranking.aScore} i=${ranking.iScore}) (${source})`
  );
  updateQLabCueTarget('DUALGO', target);
}

// Delay before the auto-retarget fires after a team starts playing in R4.
// Gives the current cue sequence room to breathe before we flip the target.
const R4_AUTO_RETARGET_DELAY_MS = parseInt(process.env.R4_AUTO_RETARGET_DELAY_MS) || 10000;
let r4AutoRetargetTimer = null;

function retargetR4NextToCue(cueNumber, label, source) {
  console.log(
    `[R4 FLOW] Retargeting ${CONFIG.QLAB_CUE_R4NEXT} → ${cueNumber} (${label}) (${source})`
  );
  logActivity('round', 'all', `R4 retarget ${CONFIG.QLAB_CUE_R4NEXT} → ${cueNumber} (${label})`, source);
  updateQLabCueTarget(CONFIG.QLAB_CUE_R4NEXT, cueNumber);
}

function scheduleR4AutoRetarget(playingTeamId, source) {
  if (r4AutoRetargetTimer) {
    clearTimeout(r4AutoRetargetTimer);
    r4AutoRetargetTimer = null;
  }
  r4PlayedTeams.add(playingTeamId);
  const bothPlayed = r4PlayedTeams.has('anthems') && r4PlayedTeams.has('icons');

  if (bothPlayed) {
    console.log(
      `[R4 FLOW] Both teams have played — scheduling R4NEXT retarget → ${CONFIG.QLAB_CUE_R4_END} in ${R4_AUTO_RETARGET_DELAY_MS}ms (${source})`
    );
    r4AutoRetargetTimer = setTimeout(() => {
      r4AutoRetargetTimer = null;
      retargetR4NextToCue(CONFIG.QLAB_CUE_R4_END, 'winner reveal', `auto-after-${playingTeamId}-playing`);
    }, R4_AUTO_RETARGET_DELAY_MS);
  } else {
    const nextTeamId = otherTeam(playingTeamId);
    console.log(
      `[R4 FLOW] ${TEAMS[playingTeamId].name} now playing — scheduling R4NEXT retarget → ${TEAMS[nextTeamId].name} in ${R4_AUTO_RETARGET_DELAY_MS}ms (${source})`
    );
    r4AutoRetargetTimer = setTimeout(() => {
      r4AutoRetargetTimer = null;
      retargetR4NextToTeam(nextTeamId, `auto-after-${playingTeamId}-playing`);
    }, R4_AUTO_RETARGET_DELAY_MS);
  }
}

// Map pack IDs to QLab cue group names
const PACK_CUE_GROUPS = {
  'uk-usa-german': 'P1',
  'european':      'P2',
  'teens':         'P3'
};

// Arm the selected pack's cue group and disarm the others in QLab
function updateQLabPackArming(packId) {
  const selectedGroup = PACK_CUE_GROUPS[packId];
  if (!selectedGroup) {
    console.warn(`[QLAB OUT] No cue group mapping for pack: ${packId}`);
    return;
  }

  Object.entries(PACK_CUE_GROUPS).forEach(([id, group]) => {
    const armed = id === packId ? 1 : 0;
    const address = `/cue/${group}/armed`;
    const payload = JSON.stringify({ address, value: armed });

    const bridgeUrl = new URL("/send", BRIDGE_URL);
    const options = {
      hostname: bridgeUrl.hostname,
      port: bridgeUrl.port,
      path: bridgeUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        console.log(`[QLAB OUT] ${address} → ${armed} (${armed ? 'armed' : 'disarmed'}) (bridge: ${res.statusCode})`);
      });
    });

    req.on("error", (err) => {
      console.error(`[QLAB OUT] Bridge error (arm/disarm ${group}): ${err.message}`);
    });

    req.write(payload);
    req.end();
  });
}

// Companion HTTP API for custom variables
const COMPANION_URL = process.env.COMPANION_URL || "http://host.docker.internal:8000";

// Genre system: G1-G9 are text cues in QLab (3 per round, names set on pack change).
// SG1-SG3 are start cues that retarget to the correct G cues on round change.
const GENRE_CUE_MAP = {
  '1': ['G1', 'G2', 'G3'],   // Round 1 genres
  '2': ['G4', 'G5', 'G6'],   // Round 2 genres
  '3': ['G7', 'G8', 'G9'],   // Round 3 genres
};
const START_CUES = ['SG1', 'SG2', 'SG3'];

// R3 genre names are PINNED across all packs — the same Mashup Madness
// mashups are used for every pack, so G7/G8/G9 always show these labels
// regardless of pack JSON. R1 and R2 are per-pack (each pack has its own
// genre set in its JSON). Decade labels keep lowercase 's after the year
// (e.g. "1980's") — the rest of the catalogue is uppercase.
const R3_PINNED_GENRES = ["1980's", "1990's", "2000's"];

// Compute font size for a genre name based on the active QLab resolution.
// Long names get scaled down so MEDITERRANEAN CLASSICS still fits the same
// button as K POP. Threshold + curve are intentionally conservative —
// adjust GENRE_FONT_THRESHOLD / shrink curve once we eyeball real output.
function computeGenreFontSize(name) {
  const sizes = packSettings.genreFontSizes || GENRE_FONT_DEFAULTS;
  const thresholds = packSettings.genreShrinkThresholds || GENRE_SHRINK_THRESHOLD_DEFAULTS;
  const res = packSettings.qlabResolution;
  const base = sizes[res] || sizes['2560x1280'] || 100;
  const threshold = thresholds[res] || thresholds['2560x1280'] || 13;
  const len = (name || '').length;
  if (len <= threshold) return base;
  return Math.round(base * threshold / len);
}

// Update all G1-G9 genre text cue names in QLab + all Companion variables (called on pack change)
function updateAllGenreCues(packId) {
  const pack = packData[packId || packSettings.currentPack];
  if (!pack || !pack.genres) {
    console.warn(`[GENRE] No genre data found for pack: ${packId || packSettings.currentPack}`);
    return;
  }

  console.log(`[GENRE] Updating G1-G9 for ${pack.name}`);

  let delay = 0;
  Object.entries(GENRE_CUE_MAP).forEach(([round, cues]) => {
    // R3 always uses the pinned mashup decade labels regardless of pack JSON
    // (the same Mashup Madness mashups are shared across every pack).
    // R1 + R2 are per-pack — each pack has its own R1/R2 genre set.
    const genres = round === '3' ? R3_PINNED_GENRES : pack.genres[round];
    if (!genres) return;

    cues.forEach((cue, i) => {
      const genreName = (genres[i] || '').toUpperCase();
      const fontSize = computeGenreFontSize(genreName);
      const c = packSettings.genreTextColor || GENRE_TEXT_COLOR_DEFAULT;
      setTimeout(() => {
        updateQLabCueName(cue, genreName);
        sendBridgeOsc(`/cue/${cue}/text`, genreName, `→ set ${cue} text to "${genreName}"`);
        sendBridgeOsc(`/cue/${cue}/text/format/fontSize`, fontSize,
          `→ set ${cue} fontSize to ${fontSize}`);
        sendBridgeOsc(`/cue/${cue}/text/format/color`, [c.red, c.green, c.blue, c.alpha],
          `→ set ${cue} color to rgba(${c.red},${c.green},${c.blue},${c.alpha})`);
      }, delay);
      delay += 100;
    });
  });

  // Also update Companion variables + SG targets for the current round (default to R1 if no round active)
  updateGenreTargets(roundState.currentRound || 1);
}

// Retarget SG1-SG3 to the correct G cues for the given round + update Companion variables
function updateGenreTargets(roundNum) {
  const pack = packData[packSettings.currentPack];
  const targets = GENRE_CUE_MAP[String(roundNum)];

  if (!targets || roundNum < 1 || roundNum > 3) {
    console.log(`[GENRE] Round ${roundNum} has no genre picker — clearing SG targets and Companion`);
    START_CUES.forEach((sg, i) => {
      setCompanionVariable(`genre_g${i + 1}`, '');
    });
    return;
  }

  console.log(`[GENRE] Retargeting SG1-SG3 → ${targets.join(', ')} for Round ${roundNum}`);

  // R3 uses the pinned mashup decade labels; R1 + R2 are per-pack.
  const pinnedGenres = roundNum === 3 ? R3_PINNED_GENRES : null;

  START_CUES.forEach((sg, i) => {
    const targetCue = targets[i];

    // Retarget the start cue to point at the correct genre cue
    updateQLabCueTarget(sg, targetCue);

    // Update Companion custom variable with the genre name
    let genreName = '';
    if (pinnedGenres) {
      genreName = pinnedGenres[i] || '';
    } else if (pack && pack.genres && pack.genres[String(roundNum)]) {
      genreName = pack.genres[String(roundNum)][i] || '';
    }
    setCompanionVariable(`genre_g${i + 1}`, genreName.toUpperCase());
  });
}

// Send OSC to QLab to retarget a cue's target cue number
function updateQLabCueTarget(cueNumber, targetCueNumber) {
  const address = `/cue/${cueNumber}/cueTargetNumber`;
  const payload = JSON.stringify({ address, value: targetCueNumber });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → "${targetCueNumber}" (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error (cueTarget ${cueNumber}): ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Set a Companion custom variable via HTTP API (Companion 3.x)
function setCompanionVariable(varName, value) {
  const url = new URL(`/api/custom-variable/${varName}/value`, COMPANION_URL);
  const payload = String(value);

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[COMPANION] ${varName} → "${value}" (${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[COMPANION] Error setting ${varName}: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// =============================================================================
// Genre Track Randomization
// =============================================================================

// Number of tracks to randomly select per round when a genre is loaded
const GENRE_SLOTS = {
  '1': 6,  // 6 track pairs for Round 1 (hook + reveal = 12 cue retargets)
  '2': 2,  // 2 tracks per team for Round 2 (refreshed between teams)
  '3': 4,  // 4 tracks for Round 3
};

// Track deduplication: tracks played in rounds 1-3 won't be reused until master reset.
// Keyed by round number, each value is a Set of track identifiers (fileName).
let playedTracks = { '1': new Set(), '2': new Set(), '3': new Set() };

function resetPlayedTracks() {
  playedTracks = { '1': new Set(), '2': new Set(), '3': new Set() };
  console.log('[DEDUP] Played tracks history cleared');
}

// Fisher-Yates shuffle
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Load random tracks for a genre into fixed QLab cue slots
// genreIndex: 1, 2, or 3 (position in the current round's genre list)
function loadGenreTracks(genreIndex) {
  const currentRound = String(roundState.currentRound);
  const pack = packData[packSettings.currentPack];

  if (!pack) {
    console.warn(`[GENRE LOAD] No pack data for: ${packSettings.currentPack}`);
    return { success: false, error: 'No pack data' };
  }

  if (!pack.genres[currentRound]) {
    console.warn(`[GENRE LOAD] No genres for round ${currentRound}`);
    return { success: false, error: `No genres for round ${currentRound}` };
  }

  const genreName = pack.genres[currentRound][genreIndex - 1];
  if (!genreName) {
    console.warn(`[GENRE LOAD] No genre at index ${genreIndex} for round ${currentRound}`);
    return { success: false, error: `Invalid genre index ${genreIndex}` };
  }

  const slotsNeeded = GENRE_SLOTS[currentRound];
  if (!slotsNeeded) {
    console.warn(`[GENRE LOAD] No slot config for round ${currentRound}`);
    return { success: false, error: `Round ${currentRound} has no genre slots` };
  }

  const allTracks = pack.rounds[currentRound]?.tracks || [];
  const basePath = packSettings.audioBasePath || '';

  console.log(`[GENRE LOAD] Loading "${genreName}" for Round ${currentRound} (${slotsNeeded} slots needed)`);

  // Reset stage host answers for new genre load
  stageHostAnswers = [];
  stageHostAnswerIndex = 0;

  // Cancel any pending cue-content writes (own bucket + r1/r4/qa) so this
  // genre load isn't clobbered by tail-end OSC from a previous writer.
  cancelAllCueWrites();
  let osccDelay = 0;
  const queueOsc = (fn) => {
    genreLoadTimeouts.push(setTimeout(fn, osccDelay));
    osccDelay += OSC_STAGGER_MS;
  };

  // Get the dedup set for this round (rounds 1-3 only)
  const dedupSet = playedTracks[currentRound] || null;

  if (currentRound === '1') {
    // Round 1: tracks come in .1/.2 pairs — group by track number, pick 6 groups
    const genreTracks = allTracks.filter(t => t.genre === genreName);

    // Group into pairs by track number (e.g. R1T5.1 and R1T5.2 → group "5")
    const pairs = {};
    genreTracks.forEach(t => {
      const num = t.cue.replace('R1T', '').split('.')[0];
      if (!pairs[num]) pairs[num] = {};
      if (t.cue.endsWith('.1')) pairs[num].hook = t;
      if (t.cue.endsWith('.2')) pairs[num].reveal = t;
    });

    // Only use complete pairs, excluding already-played tracks
    let completePairs = Object.values(pairs).filter(p => p.hook && p.reveal);
    if (dedupSet && dedupSet.size > 0) {
      const beforeCount = completePairs.length;
      completePairs = completePairs.filter(p => !dedupSet.has(p.hook.fileName));
      console.log(`[DEDUP] Round ${currentRound} "${genreName}": filtered ${beforeCount - completePairs.length} already-played pairs, ${completePairs.length} remaining`);
    }
    const selected = shuffle(completePairs).slice(0, slotsNeeded);

    if (selected.length < slotsNeeded) {
      console.warn(`[GENRE LOAD] Only ${selected.length} complete pairs available for "${genreName}" (need ${slotsNeeded})`);
    }

    console.log(`[GENRE LOAD] Selected ${selected.length} pairs from ${completePairs.length} available`);

    // Record selected tracks as played for deduplication
    if (dedupSet) {
      selected.forEach(pair => dedupSet.add(pair.hook.fileName));
      console.log(`[DEDUP] Round ${currentRound}: ${dedupSet.size} total tracks marked as played`);
    }

    selected.forEach((pair, i) => {
      const slotNum = i + 1;
      const hookSlot = `R1T${slotNum}.1`;
      const revealSlot = `R1T${slotNum}.2`;

      const hookPath = basePath ? path.join(basePath, pair.hook.fileName) : pair.hook.fileName;
      const hookName = `${pair.hook.band} - ${pair.hook.track} [SHORT]`.toUpperCase();
      const revealPath = basePath ? path.join(basePath, pair.reveal.fileName) : pair.reveal.fileName;
      const revealName = `${pair.reveal.band} - ${pair.reveal.track} [LONG]`.toUpperCase();
      const revealNotes = `Correct Answer: ${pair.hook.band} - ${pair.hook.track}`.toUpperCase();

      queueOsc(() => updateQLabCueFilePath(hookSlot, hookPath));
      queueOsc(() => updateQLabCueName(hookSlot, hookName));
      queueOsc(() => updateQLabCueNotes(hookSlot, ''));
      queueOsc(() => updateQLabCueFilePath(revealSlot, revealPath));
      queueOsc(() => updateQLabCueName(revealSlot, revealName));
      queueOsc(() => updateQLabCueNotes(revealSlot, revealNotes));

      // Push to Companion
      setCompanionVariable(`track_${slotNum}`, `${pair.hook.band} - ${pair.hook.track}`);
      stageHostAnswers.push({ number: slotNum, track: pair.hook.track, artist: pair.hook.band });

      console.log(`[GENRE LOAD] Slot ${slotNum}: ${pair.hook.band} - ${pair.hook.track}`);
      logActivity('track_loaded', 'all', `R${currentRound} Slot ${slotNum}: ${pair.hook.band} - ${pair.hook.track} [${genreName}]`, 'osc');
    });

  } else {
    // Rounds 2 & 3: single cues, pick required number — excluding already-played and placeholder tracks
    let genreTracks = allTracks.filter(t => t.genre === genreName && t.band !== 'XX');
    if (dedupSet && dedupSet.size > 0) {
      const beforeCount = genreTracks.length;
      genreTracks = genreTracks.filter(t => !dedupSet.has(t.fileName));
      console.log(`[DEDUP] Round ${currentRound} "${genreName}": filtered ${beforeCount - genreTracks.length} already-played tracks, ${genreTracks.length} remaining`);
    }
    const selected = shuffle(genreTracks).slice(0, slotsNeeded);

    if (selected.length < slotsNeeded) {
      console.warn(`[GENRE LOAD] Only ${selected.length} tracks available for "${genreName}" (need ${slotsNeeded})`);
    }

    console.log(`[GENRE LOAD] Selected ${selected.length} tracks from ${genreTracks.length} available`);

    // Record selected tracks as played for deduplication
    if (dedupSet) {
      selected.forEach(t => dedupSet.add(t.fileName));
      console.log(`[DEDUP] Round ${currentRound}: ${dedupSet.size} total tracks marked as played`);
    }

    selected.forEach((track, i) => {
      const slotNum = i + 1;
      const slot = `R${currentRound}T${slotNum}`;
      const fullPath = basePath ? path.join(basePath, track.fileName) : track.fileName;
      const cueName = `${track.band} - ${track.track}`.toUpperCase();

      queueOsc(() => updateQLabCueFilePath(slot, fullPath));
      queueOsc(() => updateQLabCueName(slot, cueName));
      setCompanionVariable(`track_${slotNum}`, `${track.band} - ${track.track}`);
      const ans = { number: slotNum, track: track.track, artist: track.band };
      if (currentRound === '3' && track.track1 && track.track2) {
        ans.displayText = `${track.track1.band} - ${track.track1.track} & ${track.track2.band} - ${track.track2.track}`;
      }
      stageHostAnswers.push(ans);

      console.log(`[GENRE LOAD] Slot ${slot}: ${track.band} - ${track.track}`);
      logActivity('track_loaded', 'all', `${slot}: ${track.band} - ${track.track} [${genreName}]`, 'osc');
    });

    // R3: compose the answer note for R3SCORES from the selected mashups.
    // Each R3 track entry in the pack JSON has track1 + track2 sub-objects
    // ({band, track, id}) that describe the two songs layered into the mashup.
    // Format per line: "N. Band1 - Track1 & Band2 - Track2"
    if (currentRound === '3') {
      const noteLines = selected.map((t, i) => {
        if (t.track1 && t.track2) {
          return `${i + 1}. ${t.track1.band} - ${t.track1.track} & ${t.track2.band} - ${t.track2.track}`;
        }
        // Fallback for any legacy R3 entries that don't have track1/track2
        return `${i + 1}. ${t.band} - ${t.track}`;
      });
      const notes = noteLines.join('\n\n');
      updateQLabCueNotes('R3SCORES', notes);
      console.log(`[R3 FLOW] R3SCORES notes updated with ${selected.length} selected mashups`);
    }
  }

  // Clear any unused Companion track variables
  const maxSlots = 6;
  for (let i = (GENRE_SLOTS[currentRound] || 0) + 1; i <= maxSlots; i++) {
    setCompanionVariable(`track_${i}`, '');
  }

  // Remember what we loaded for refreshgenre
  lastLoadedGenre = { round: currentRound, genreIndex };

  logActivity('genre', 'all', `Loaded "${genreName}" for Round ${currentRound} (${slotsNeeded} random tracks)`, 'system');

  // Turn state update (StreamDeck page handled by QLab/buzzer, not server)
  if (turnState.currentTeam) {
    turnState.phase = 'playing-first';
    setCompanionVariable('current_team', TEAMS[turnState.currentTeam].name);
    io.emit('turnUpdate', turnState);
  }

  // Push answers to stage host view and show first answer
  io.emit('answersUpdate', { round: currentRound, genre: genreName, answers: stageHostAnswers });
  if (stageHostAnswers.length > 0) {
    io.emit('currentTrack', { trackNumber: 1, total: stageHostAnswers.length });
  }
  console.log(`[STAGE HOST] Loaded ${stageHostAnswers.length} answers for R${currentRound} "${genreName}"`);

  return { success: true, genre: genreName, round: currentRound, tracksLoaded: slotsNeeded };
}

// OSC stagger delay (ms) between messages to avoid network overload
const OSC_STAGGER_MS = 20;

// Function to update all track cues based on selected pack using JSON pack data
function updateTrackCuesForPack(packId) {
  const pack = packData[packId];
  if (!pack) {
    console.warn(`[PACK] No track data found for pack: ${packId}`);
    return;
  }

  const basePath = packSettings.audioBasePath || '';
  console.log(`[PACK] Updating track cues for ${pack.name} (base path: ${basePath || 'not set'})`);

  let delay = 0;
  Object.keys(pack.rounds).forEach(roundNum => {
    const round = pack.rounds[roundNum];
    round.tracks.forEach(track => {
      const fullPath = basePath ? path.join(basePath, track.fileName) : track.fileName;
      let cueName = `${track.band} - ${track.track}`;
      // Round 1 pairs: .1 = hook (short clip), .2 = reveal (long clip)
      if (roundNum === '1' && track.cue.endsWith('.1')) cueName += ' [SHORT]';
      if (roundNum === '1' && track.cue.endsWith('.2')) cueName += ' [LONG]';

      // Skip placeholder tracks
      if (track.band === 'XX') return;

      setTimeout(() => {
        updateQLabCueFilePath(track.cue, fullPath);
        updateQLabCueName(track.cue, cueName);
        // Add answer notes to Round 1 short clips
        if (roundNum === '1' && track.cue.endsWith('.1')) {
          updateQLabCueNotes(track.cue, `Correct Answer: ${track.band} - ${track.track}`);
        }
      }, delay);
      delay += OSC_STAGGER_MS;
    });
  });

  console.log(`[PACK] Queued ${delay / OSC_STAGGER_MS} cue updates over ${(delay / 1000).toFixed(1)}s`);
}

app.get("/api/pack-settings", (req, res) => {
  res.json(packSettings);
});

app.post("/api/pack-settings", (req, res) => {
  const { currentPack, lastChanged, qlabResolution, genreFontSizes } = req.body;

  const validPacks = Object.keys(packData).length > 0 ? Object.keys(packData) : ['uk-usa-german', 'european', 'teens'];
  if (!currentPack || !validPacks.includes(currentPack)) {
    return res.status(400).json({ success: false, message: "Invalid pack selection" });
  }

  const oldPack = packSettings.currentPack;
  packSettings = {
    ...packSettings,
    currentPack,
    ...(qlabResolution ? { qlabResolution } : {}),
    ...(genreFontSizes && typeof genreFontSizes === 'object' ? { genreFontSizes: { ...packSettings.genreFontSizes, ...genreFontSizes } } : {}),
    lastChanged: lastChanged || new Date().toISOString()
  };
  
  // Save to persistent storage
  savePackSettings();
  
  // Update QLab track cues (T1-T4) file paths and names based on selected pack
  updateTrackCuesForPack(currentPack);

  // R4 has no genre picker, so its cues stay in pack order unless we shuffle
  // here. R1-R3 shuffle on round entry / genre pick, so leave them alone.
  resetR4Tracks();

  // Arm selected pack cue group, disarm the others in QLab
  updateQLabPackArming(currentPack);

  // Update all genre text cue names (G1-G9) in QLab and Companion for current round
  updateAllGenreCues(currentPack);

  // Broadcast pack change to all connected dashboard clients
  io.emit("packChanged", currentPack);
  
  // Log activity
  logActivity('system', 'all', `Question pack changed from ${oldPack} to ${currentPack}`, 'api');
  console.log(`[PACK] Question pack changed to: ${currentPack}`);
  
  res.json({ success: true, ...packSettings });
});

// Audio base path API endpoints
app.get('/api/audio-path', (req, res) => {
  res.json({ audioBasePath: packSettings.audioBasePath || '' });
});

app.post('/api/audio-path', express.json(), (req, res) => {
  let { audioBasePath } = req.body;
  if (audioBasePath === undefined) {
    return res.status(400).json({ error: 'audioBasePath required' });
  }
  // Strip surrounding whitespace and matching wrapping quotes (common when
  // pasting from Finder/Terminal which adds 'single' or "double" quotes).
  audioBasePath = String(audioBasePath).trim();
  if (
    (audioBasePath.startsWith("'") && audioBasePath.endsWith("'")) ||
    (audioBasePath.startsWith('"') && audioBasePath.endsWith('"'))
  ) {
    audioBasePath = audioBasePath.slice(1, -1);
  }
  packSettings.audioBasePath = audioBasePath;
  packSettings.lastChanged = new Date().toISOString();
  savePackSettings();

  // Re-target all cues with new base path
  if (packSettings.currentPack) {
    updateTrackCuesForPack(packSettings.currentPack);
  }

  logActivity('system', 'all', `Audio base path updated to: ${audioBasePath}`, 'api');
  res.json({ success: true, audioBasePath });
});

// GET /api/pack-tracks/:packId — returns track data for a pack
app.get('/api/pack-tracks/:packId', (req, res) => {
  const pack = packData[req.params.packId];
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json(pack);
});

// POST /api/reload-packs — reload pack data from disk and refresh QLab
// genre cues so any text/cue changes flow through immediately.
app.post('/api/reload-packs', (req, res) => {
  packData = loadPackData();
  // Push updated G1-G9 text and SG retargets to QLab + Companion now that
  // pack data has been reloaded.
  if (packSettings.currentPack && packData[packSettings.currentPack]) {
    updateAllGenreCues(packSettings.currentPack);
  }
  res.json({ success: true, packs: Object.keys(packData) });
});

// POST /api/loadgenre/:index — load random tracks for a genre (1-3)
app.post('/api/loadgenre/:index', (req, res) => {
  const genreIndex = parseInt(req.params.index);
  if (isNaN(genreIndex) || genreIndex < 1 || genreIndex > 3) {
    return res.status(400).json({ success: false, error: 'Genre index must be 1, 2, or 3' });
  }
  const result = loadGenreTracks(genreIndex);
  // Navigate StreamDeck to page 1 after genre pick
  if (result.success) {
    navigateStreamDeck(1);
  }
  res.json(result);
});

// Refresh genre — reload same genre with fresh tracks + navigate SD to SDE1
app.post('/api/refreshgenre', (req, res) => {
  if (!lastLoadedGenre.genreIndex) {
    return res.status(400).json({ success: false, error: 'No genre loaded yet' });
  }
  console.log(`[GENRE REFRESH] Reloading genre index ${lastLoadedGenre.genreIndex} for Round ${lastLoadedGenre.round}`);
  const result = loadGenreTracks(lastLoadedGenre.genreIndex);
  // Match /loadgenre behaviour — return SD to SDE1 so the operator sees
  // the track-picker page after a refresh (important in R1 where the SD
  // may have been left on a team answer page by /r1teamdone).
  if (result.success) {
    navigateStreamDeck(1);
    console.log(`[API] StreamDeck → SDE1 after refreshgenre`);
  }
  res.json(result);
});

// Refresh tracks — reload R2T1/R2T2 with fresh tracks from the selected genre
app.post('/api/refreshtracks', (req, res) => {
  const result = handleRefreshTracks('api');
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// Team-specific correct answer
app.post("/api/correct/:team", (req, res) => {
  const teamId = req.params.team.toLowerCase();
  if (!TEAMS[teamId]) {
    return res.status(400).json({ success: false, message: "Invalid team. Use 'anthems' or 'icons'." });
  }
  const state = registerCorrectAnswer(teamId, 'api');
  if (state) {
    io.emit("stateUpdate", state);
    sendQLabLoadCue(teamId, state[teamId].remainingTime);
    res.json({ success: true, state });
  } else {
    res.json({ success: false, message: "Team not active" });
  }
});

// Golden Record activation
app.post("/api/golden-record/:team", (req, res) => {
  const teamId = req.params.team.toLowerCase();
  if (!TEAMS[teamId]) {
    return res.status(400).json({ success: false, message: "Invalid team. Use 'anthems' or 'icons'." });
  }
  const state = activateGoldenRecord(teamId, 'api');
  if (state) {
    io.emit("stateUpdate", state);
    io.emit("goldenRecordActivated", teamId);
    res.json({ success: true, state });
  } else {
    res.json({ success: false, message: "Golden Record not available" });
  }
});

// Reset a specific team
app.post("/api/reset/:team", (req, res) => {
  const teamId = req.params.team.toLowerCase();
  if (!TEAMS[teamId]) {
    return res.status(400).json({ success: false, message: "Invalid team. Use 'anthems' or 'icons'." });
  }
  playResetCue(teamId);
  console.log(`[API] Reset ${TEAMS[teamId].name} - playing ${teamId === "anthems" ? "AT" : "IT"} cue`);
  // Actually reset the team state and update text cue
  resetTeam(teamId, 'api');
  io.emit("stateUpdate", gameState);
  io.emit("teamReset", teamId);
  res.json({ success: true, message: `Reset ${TEAMS[teamId].name} - playing ${teamId === "anthems" ? "AT" : "IT"} cue` });
});

// Reset all teams
app.post("/api/reset", (req, res) => {
  playResetCue("anthems");
  playResetCue("icons");
  console.log("[API] Reset all teams - playing AT and IT cues");
  // Actually reset both teams and update text cues
  resetAll('api');
  io.emit("stateUpdate", gameState);
  io.emit("teamReset", "anthems");
  io.emit("teamReset", "icons");
  res.json({ success: true, message: "Reset all teams - playing AT and IT cues" });
});

// Randomise Round 3 scores for testing.
// Optional query/body: ?seconds=N — sets both teams to exactly N seconds
// earned (overrides the random roll). Use this for deterministic R4 setup.
app.post("/api/randomise-round3", (req, res) => {
  const R3_POINTS_PER_CORRECT = CONFIG.ROUND_SCORING[3] || 8;
  const targetSecondsRaw = req.query.seconds ?? req.body?.seconds;
  const targetSeconds = targetSecondsRaw != null ? parseInt(targetSecondsRaw, 10) : null;
  const hasTarget = Number.isFinite(targetSeconds) && targetSeconds >= 0;

  for (const teamId of ['anthems', 'icons']) {
    const team = gameState[teamId];

    // Determine the seconds to add for this team.
    // With a target: jitter ±3s around the target so both teams land in the
    // same region but not identical. Synthesize history entries worth
    // R3_POINTS_PER_CORRECT each (any remainder goes onto the last entry).
    // Without a target: random 3 or 4 correct answers (~30s).
    let r3Time;
    let numCorrect;
    if (hasTarget) {
      // Jitter: target-3 .. target+3, clamped to [0, MAX_TIME]
      const jitter = Math.floor(Math.random() * 7) - 3; // -3..+3
      r3Time = Math.max(0, Math.min(CONFIG.MAX_TIME, targetSeconds + jitter));
      numCorrect = Math.max(1, Math.ceil(r3Time / R3_POINTS_PER_CORRECT));
    } else {
      numCorrect = 3 + Math.floor(Math.random() * 2); // 3 or 4
      r3Time = numCorrect * R3_POINTS_PER_CORRECT;
    }

    team.earnedTime = Math.min(team.earnedTime + r3Time, CONFIG.MAX_TIME);
    team.remainingTime = team.maxTime - team.earnedTime;
    if (team.remainingTime < 0) team.remainingTime = 0;
    team.correctAnswers += numCorrect;

    for (let i = 0; i < numCorrect; i++) {
      const isLast = i === numCorrect - 1;
      const pts = hasTarget && isLast
        ? r3Time - (numCorrect - 1) * R3_POINTS_PER_CORRECT
        : R3_POINTS_PER_CORRECT;
      team.history.push({
        timestamp: new Date().toISOString(),
        answer: team.correctAnswers - numCorrect + i + 1,
        earnedTime: team.earnedTime - (numCorrect - i - 1) * R3_POINTS_PER_CORRECT,
        remainingTime: team.maxTime - (team.earnedTime - (numCorrect - i - 1) * R3_POINTS_PER_CORRECT),
        round: 3,
        pointsAwarded: pts,
        goldenRecord: false,
      });
    }

    updateQLabTextCue(teamId, team.earnedTime);
    // Load the countdown video cue to the correct position so R4 is playable.
    sendQLabLoadCue(teamId, team.remainingTime);
    const tag = hasTarget ? `target=${targetSeconds}s` : `random ${numCorrect} correct`;
    console.log(`[API] Randomised R3 for ${TEAMS[teamId].name}: ${tag} (+${r3Time}s), total ${team.earnedTime}s, loaded countdown at ${team.remainingTime}s`);
  }

  retargetLeaderSD('randomise-round3');
  io.emit("stateUpdate", gameState);
  const sourceTag = hasTarget ? `target=${targetSeconds}s` : 'random';
  logActivity('system', null, `Randomised Round 3 scores (${sourceTag}) — Anthems: ${gameState.anthems.earnedTime}s, Icons: ${gameState.icons.earnedTime}s`, 'api');
  res.json({
    success: true,
    target: hasTarget ? targetSeconds : null,
    anthems: { earnedTime: gameState.anthems.earnedTime, remainingTime: gameState.anthems.remainingTime },
    icons: { earnedTime: gameState.icons.earnedTime, remainingTime: gameState.icons.remainingTime },
  });
});

// =============================================================================
// License Validation System
// =============================================================================
let licenseState = { valid: false, error: "License not yet checked" };

async function getMachineId() {
  return new Promise((resolve, reject) => {
    const python = spawn("python3", ["machine_id_simple.py"]);
    let output = "";
    python.stdout.on("data", (data) => {
      output += data.toString();
    });
    python.stderr.on("data", (data) => {
      console.error(`[LICENSE] Machine ID error: ${data}`);
    });
    python.on("close", (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Machine ID script failed with code ${code}`));
      }
    });
  });
}

// Two-tier license persistence:
//   /app/data       → docker named volume (primary)
//   /app/host-data  → host bind mount (backup; survives volume destruction
//                     and Docker Desktop factory reset)
// Mirrors missing files between the two so either tier can rebuild the other.
const LICENSE_VOLUME_DIR = "/app/data";
const LICENSE_HOST_BACKUP_DIR = "/app/host-data";
const LICENSE_PERSIST_FILES = ["license_key", "machine_id"];

function _safeRead(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : ""; }
  catch { return ""; }
}
function _safeWrite(p, content) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
    return true;
  } catch (err) {
    console.error(`[LICENSE] Failed to write ${p}: ${err.message}`);
    return false;
  }
}
function syncLicensePersistenceTiers() {
  for (const name of LICENSE_PERSIST_FILES) {
    const volPath = path.join(LICENSE_VOLUME_DIR, name);
    const hostPath = path.join(LICENSE_HOST_BACKUP_DIR, name);
    const volVal = _safeRead(volPath);
    const hostVal = _safeRead(hostPath);
    if (volVal && !hostVal) {
      if (_safeWrite(hostPath, volVal)) console.log(`[LICENSE] Restored host backup: ${name}`);
    } else if (hostVal && !volVal) {
      if (_safeWrite(volPath, hostVal)) console.log(`[LICENSE] Restored volume from host backup: ${name}`);
    } else if (volVal && hostVal && volVal !== hostVal) {
      if (_safeWrite(hostPath, volVal)) console.warn(`[LICENSE] Resolved ${name} mismatch: host backup overwritten with volume copy`);
    }
  }
}
function persistLicenseKey(key) {
  if (!key) return;
  const targets = [
    path.join(LICENSE_VOLUME_DIR, "license_key"),
    path.join(LICENSE_HOST_BACKUP_DIR, "license_key"),
  ];
  let wrote = false;
  for (const target of targets) {
    if (_safeRead(target) !== key) {
      if (_safeWrite(target, key)) wrote = true;
    }
  }
  if (wrote) console.log("[LICENSE] License key written to persistent storage (volume + host backup)");
}

async function validateLicense() {
  try {
    // Sync the two persistence tiers BEFORE anything else, so a wiped
    // volume can be repopulated from the host backup (or vice versa).
    syncLicensePersistenceTiers();

    const machineId = await getMachineId();
    console.log(`[LICENSE] Machine ID: ${machineId}`);
    // Mirror any new/regenerated machine_id back to host backup
    const hostMid = path.join(LICENSE_HOST_BACKUP_DIR, "machine_id");
    if (_safeRead(hostMid) !== machineId) _safeWrite(hostMid, machineId);

    // Resolve active key: env var → volume → host backup
    let licenseKey = (process.env.LICENSE_KEY || "").trim();
    if (!licenseKey) licenseKey = _safeRead(path.join(LICENSE_VOLUME_DIR, "license_key"));
    if (!licenseKey) licenseKey = _safeRead(path.join(LICENSE_HOST_BACKUP_DIR, "license_key"));
    if (licenseKey) {
      process.env.LICENSE_KEY = licenseKey;
      console.log("[LICENSE] Active license key resolved");
    }
    if (!licenseKey) {
      return {
        valid: false,
        error: "No license key provided",
        machine_id: machineId,
      };
    }

    return new Promise((resolve) => {
      const python = spawn("python3", ["license_validator_simple.py", machineId, licenseKey]);
      let output = "";
      python.stdout.on("data", (data) => {
        output += data.toString();
      });
      python.stderr.on("data", (data) => {
        console.error(`[LICENSE] Validation error: ${data}`);
      });
      python.on("close", (code) => {
        try {
          const result = JSON.parse(output.trim());
          console.log(`[LICENSE] Validation result:`, result);
          resolve(result);
        } catch (e) {
          console.error(`[LICENSE] Failed to parse validation result: ${e}`);
          resolve({
            valid: false,
            error: "License validation failed",
            machine_id: machineId,
          });
        }
      });
    });
  } catch (error) {
    console.error(`[LICENSE] License check failed: ${error}`);
    return {
      valid: false,
      error: error.message,
      machine_id: "unknown",
    };
  }
}

async function initializeLicense() {
  console.log("[LICENSE] Initializing license validation...");
  licenseState = await validateLicense();
  // Bulletproof persistence: any successful validation writes the key to
  // BOTH tiers so it survives rebuilds, volume destruction, factory reset.
  if (licenseState && licenseState.valid) {
    persistLicenseKey((process.env.LICENSE_KEY || "").trim());
  }
}

// License status endpoint
app.get("/api/license_status", (req, res) => {
  res.json(licenseState);
});

// License validation endpoint (re-check)
app.post("/api/validate_license", async (req, res) => {
  await initializeLicense();
  res.json(licenseState);
});

// Activate license key via web UI
app.post("/api/activate_license", express.json(), async (req, res) => {
  const { license_key } = req.body;
  if (!license_key || !license_key.trim()) {
    return res.status(400).json({ valid: false, error: "No license key provided" });
  }

  const key = license_key.trim();

  // Validate the pasted key. On success: persist via persistLicenseKey() to
  // both tiers. On failure: silently restore the previously-persisted key
  // so the running app stays valid until next paste/restart. The response
  // reflects the paste attempt, not the recovered state.
  process.env.LICENSE_KEY = key;
  await initializeLicense();
  const pasteResult = licenseState;

  if (!pasteResult || !pasteResult.valid) {
    const persisted = _safeRead(path.join(LICENSE_VOLUME_DIR, "license_key"))
                   || _safeRead(path.join(LICENSE_HOST_BACKUP_DIR, "license_key"));
    if (persisted && persisted !== key) {
      process.env.LICENSE_KEY = persisted;
      await initializeLicense();
    }
  }

  res.json(pasteResult);
});

// Initialize license on startup
initializeLicense();

// Stop a specific team's cue
app.post("/api/stop/:team", (req, res) => {
  const teamId = req.params.team.toLowerCase();
  if (!TEAMS[teamId]) {
    return res.status(400).json({ success: false, message: "Invalid team. Use 'anthems' or 'icons'." });
  }
  stopQLabCue(teamId);
  console.log(`[API] STOP command sent to ${TEAMS[teamId].name}`);
  
  // Log activity
  logActivity('stop', teamId, 'Stop command sent', 'api');
  
  res.json({ success: true, message: `STOP command sent to ${TEAMS[teamId].name}` });
});

// Stop both teams' cues
app.post("/api/stop", (req, res) => {
  stopQLabCue("anthems");
  stopQLabCue("icons");
  console.log("[API] STOP command sent to both teams");
  
  // Log activity
  logActivity('stop', 'all', 'Stop command sent to both teams', 'api');
  
  res.json({ success: true, message: "STOP command sent to both teams" });
});

// =============================================================================
// QLab Playback Tracking (countdown from bridge)
// =============================================================================

// Receive playback data from the bridge (QLab actionElapsed)
app.post("/api/qlab-playback", (req, res) => {
  const { teamId, actionElapsed } = req.body;
  if (!teamId || !TEAMS[teamId] || typeof actionElapsed !== "number") {
    return res.status(400).json({ error: "Invalid playback data" });
  }

  const team = gameState[teamId];
  const countdown = countdownState[teamId];

  if (!countdown.active) {
    return res.json({ ok: true, ignored: true });
  }

  // On first tick, capture the starting offset (the loadActionAt position)
  // QLab reports actionElapsed as the absolute playhead position, so if
  // the cue was loaded at 70s, the first actionElapsed will be ~70.
  if (countdown.startOffset === null) {
    countdown.startOffset = actionElapsed;
    console.log(`[COUNTDOWN] ${TEAMS[teamId].name} baseline offset: ${actionElapsed.toFixed(2)}s`);
  }

  // Calculate remaining countdown time using the delta from the start offset
  const playedSoFar = actionElapsed - countdown.startOffset;
  const remaining = Math.max(0, team.earnedTime - playedSoFar);

  countdown.elapsed = playedSoFar;
  countdown.remaining = remaining;

  // Emit countdown tick to all connected clients
  io.emit("countdownTick", {
    teamId,
    remaining: Math.round(remaining),
    elapsed: Math.round(playedSoFar),
    earnedTime: team.earnedTime,
  });

  // Auto-stop when countdown reaches zero
  if (remaining <= 0 && countdown.active) {
    countdown.active = false;
    io.emit("countdownComplete", teamId);
    stopBridgePoll(teamId);
    console.log(`[COUNTDOWN] ${TEAMS[teamId].name} countdown complete`);
  }

  res.json({ ok: true });
});

// Tell the bridge to start polling QLab for a cue's playback position
function startBridgePoll(teamId) {
  const cueName = TEAMS[teamId].cueName;
  const payload = JSON.stringify({ teamId, cueName });

  const bridgeUrl = new URL("/poll/start", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[COUNTDOWN] Bridge poll started for ${teamId} (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[COUNTDOWN] Bridge poll start error: ${err.message}`);
  });

  req.write(payload);
  req.end();

  // Update countdown state
  countdownState[teamId].active = true;
  countdownState[teamId].elapsed = 0;
  countdownState[teamId].remaining = gameState[teamId].earnedTime;
  countdownState[teamId].startOffset = null; // Will be set on first tick from QLab
}

// Tell the bridge to stop polling
function stopBridgePoll(teamId) {
  const payload = JSON.stringify({ teamId });

  const bridgeUrl = new URL("/poll/stop", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[COUNTDOWN] Bridge poll stopped for ${teamId} (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[COUNTDOWN] Bridge poll stop error: ${err.message}`);
  });

  req.write(payload);
  req.end();

  countdownState[teamId].active = false;
}

io.on("connection", (socket) => {
  console.log("[WEB] Dashboard client connected");
  socket.emit("stateUpdate", gameState);

  // Send current round state to newly connected clients
  socket.emit("roundUpdate", roundState);

  // Send current countdown state to newly connected clients
  for (const teamId of Object.keys(countdownState)) {
    if (countdownState[teamId].active) {
      socket.emit("countdownTick", {
        teamId,
        remaining: countdownState[teamId].remaining,
        elapsed: countdownState[teamId].elapsed,
        earnedTime: gameState[teamId].earnedTime,
      });
    }
  }

  socket.on("correct", (teamId) => {
    if (!TEAMS[teamId]) return;
    const state = registerCorrectAnswer(teamId, 'socket');
    if (state) {
      io.emit("stateUpdate", state);
      sendQLabLoadCue(teamId, state[teamId].remainingTime);
    }
  });

  socket.on("goldenRecord", (teamId) => {
    if (teamId && TEAMS[teamId]) {
      const state = activateGoldenRecord(teamId, 'socket');
      if (state) {
        io.emit("stateUpdate", state);
        io.emit("goldenRecordActivated", teamId);
      }
    }
  });

  socket.on("undo", (teamId) => {
    if (!teamId || !TEAMS[teamId]) return;
    const state = undoLastAnswer(teamId, 'socket');
    if (state) {
      io.emit("stateUpdate", state);
    }
  });

  socket.on("reset", (teamId) => {
    if (teamId && TEAMS[teamId]) {
      playResetCue(teamId);
      console.log(`[SOCKET] Reset ${TEAMS[teamId].name} - playing ${teamId === "anthems" ? "AT" : "IT"} cue`);
      // Actually reset the team state and update text cue
      resetTeam(teamId, 'socket');
      io.emit("stateUpdate", gameState);
      // Emit reset event to client so it can clear tracking
      io.emit("teamReset", teamId);
    } else {
      playResetCue("anthems");
      playResetCue("icons");
      console.log("[SOCKET] Reset all teams - playing AT and IT cues");
      // Actually reset both teams and update text cues
      resetAll('socket');
      io.emit("stateUpdate", gameState);
      // Emit reset event for both teams
      io.emit("teamReset", "anthems");
      io.emit("teamReset", "icons");
    }
  });

  socket.on("stop", (teamId) => {
    if (teamId && TEAMS[teamId]) {
      stopQLabCue(teamId);
      console.log(`[SOCKET] STOP command sent to ${TEAMS[teamId].name}`);
      
      // Log activity
      logActivity('stop', teamId, 'Stop command sent', 'socket');
    } else {
      stopQLabCue("anthems");
      stopQLabCue("icons");
      console.log("[SOCKET] STOP command sent to both teams");
      
      // Log activity
      logActivity('stop', 'all', 'Stop command sent to both teams', 'socket');
    }
  });

  socket.on("setRound", (roundNum) => {
    const num = parseInt(roundNum);
    if (!isNaN(num) && num >= 0 && num <= TOTAL_ROUNDS) {
      setRound(num, 'socket');
    }
  });

  socket.on("nextRound", () => {
    const next = roundState.currentRound + 1;
    if (next <= TOTAL_ROUNDS) {
      setRound(next, 'socket');
    }
  });

  socket.on("resetRounds", () => {
    resetRounds('socket');
  });
});

// =============================================================================
// Self-Test Endpoints
// =============================================================================

app.get("/api/selftest", async (req, res) => {
  const results = [];

  const addResult = (category, test, passed, details) => {
    results.push({ category, test, passed, details });
  };

  // 1. OSC bridge reachable (async)
  const bridgeOk = await new Promise((resolve) => {
    const bridgeUrl = new URL("/", BRIDGE_URL);
    const testReq = http.request(
      {
        hostname: bridgeUrl.hostname,
        port: bridgeUrl.port || 80,
        path: "/",
        method: "GET",
        timeout: 3000,
      },
      (testRes) => {
        testRes.on("data", () => {});
        testRes.on("end", () => resolve(true));
      }
    );
    testReq.on("error", () => resolve(false));
    testReq.on("timeout", () => { testReq.destroy(); resolve(false); });
    testReq.end();
  });
  addResult(
    "Infrastructure",
    "OSC bridge reachable",
    bridgeOk,
    bridgeOk ? `Connected to ${BRIDGE_URL}` : `Cannot reach ${BRIDGE_URL}`
  );

  // 2. Pack data loaded
  const packCount = Object.keys(packData).length;
  const packDetails = Object.entries(packData)
    .map(([name, data]) => {
      const trackCounts = [1, 2, 3, 4]
        .map((r) => `R${r}:${(data.rounds && data.rounds[r] && data.rounds[r].tracks ? data.rounds[r].tracks.length : 0)}`)
        .join(", ");
      return `${name} (${trackCounts})`;
    })
    .join("; ");
  addResult(
    "Infrastructure",
    "Pack data loaded",
    packCount > 0,
    packCount > 0 ? packDetails : "No packs loaded"
  );

  // 3. License valid
  const licenseKey = process.env.LICENSE_KEY;
  const licenseOk = !!(licenseKey && licenseKey.trim().length > 0);
  addResult(
    "Infrastructure",
    "License valid",
    licenseOk,
    licenseOk ? "Key present" : "No license key configured"
  );

  // 3a-c. Dual-tier license persistence (non-destructive runtime checks)
  const volKey = _safeRead(path.join(LICENSE_VOLUME_DIR, "license_key"));
  const hostKey = _safeRead(path.join(LICENSE_HOST_BACKUP_DIR, "license_key"));
  addResult(
    "License Persistence",
    "Volume copy present",
    !!volKey,
    volKey ? `${LICENSE_VOLUME_DIR}/license_key (${volKey.length} bytes)` : "Missing — license will not survive container recreate"
  );
  addResult(
    "License Persistence",
    "Host backup present",
    !!hostKey,
    hostKey ? `${LICENSE_HOST_BACKUP_DIR}/license_key (${hostKey.length} bytes)` : "Missing — license will not survive volume destruction"
  );
  addResult(
    "License Persistence",
    "Tiers in sync",
    !!(volKey && hostKey && volKey === hostKey),
    (volKey && hostKey && volKey === hostKey) ? "Volume and host backup identical" :
      (!volKey || !hostKey) ? "One or both tiers missing" : "Tiers diverge — will resolve on next boot"
  );

  // 4. Buzzer connected
  const buzzerOk = (Date.now() - lastBuzzerHeartbeat) < BUZZER_TIMEOUT_MS;
  addResult(
    "Infrastructure",
    "Buzzer connected",
    buzzerOk,
    buzzerOk ? "Heartbeat recent" : `No heartbeat in ${BUZZER_TIMEOUT_MS}ms`
  );

  // 5-8. Round scoring
  addResult("Scoring Logic", "R1 scoring (4s per correct)", CONFIG.ROUND_SCORING[1] === 4, `Value: ${CONFIG.ROUND_SCORING[1]}`);
  addResult("Scoring Logic", "R2 scoring (6s per correct)", CONFIG.ROUND_SCORING[2] === 6, `Value: ${CONFIG.ROUND_SCORING[2]}`);
  addResult("Scoring Logic", "R3 scoring (8s per correct)", CONFIG.ROUND_SCORING[3] === 8, `Value: ${CONFIG.ROUND_SCORING[3]}`);
  addResult("Scoring Logic", "R4 scoring (1pt per correct)", CONFIG.ROUND_SCORING[4] === 1, `Value: ${CONFIG.ROUND_SCORING[4]}`);

  // 9. Video offset
  addResult(
    "Scoring Logic",
    "Video offset configured",
    CONFIG.VIDEO_OFFSET > 0,
    `Value: ${CONFIG.VIDEO_OFFSET}`
  );

  // 10. Max time
  addResult(
    "Scoring Logic",
    "Max time configured",
    CONFIG.MAX_TIME > 0,
    `Value: ${CONFIG.MAX_TIME}`
  );

  // 11-18. Goto cue configuration
  addResult("Goto Cue Configuration", "R2GO2 configured",        !!CONFIG.QLAB_CUE_R2GO2,         `Value: ${CONFIG.QLAB_CUE_R2GO2}`);
  addResult("Goto Cue Configuration", "R2COINFLIP configured",   !!CONFIG.QLAB_CUE_R2_COINFLIP,   `Value: ${CONFIG.QLAB_CUE_R2_COINFLIP}`);
  addResult("Goto Cue Configuration", "R3COINFLIP configured",   !!CONFIG.QLAB_CUE_R3_COINFLIP,   `Value: ${CONFIG.QLAB_CUE_R3_COINFLIP}`);
  addResult("Goto Cue Configuration", "R4NEXT configured",       !!CONFIG.QLAB_CUE_R4NEXT,        `Value: ${CONFIG.QLAB_CUE_R4NEXT}`);
  addResult("Goto Cue Configuration", "LEADERSD configured",     !!CONFIG.QLAB_CUE_LEADER_SD,     `Value: ${CONFIG.QLAB_CUE_LEADER_SD}`);

  // 19-20. Team configuration
  addResult("Team Configuration", "Team Anthems cue", !!CONFIG.QLAB_CUE_ANTHEMS, `Value: ${CONFIG.QLAB_CUE_ANTHEMS}`);
  addResult("Team Configuration", "Team Icons cue",   !!CONFIG.QLAB_CUE_ICONS,   `Value: ${CONFIG.QLAB_CUE_ICONS}`);

  const passed = results.filter((r) => r.passed).length;
  res.json({
    success: true,
    version: PACKAGE_VERSION,
    timestamp: new Date().toISOString(),
    machineName: os.hostname(),
    machineId: (licenseState && licenseState.machine_id) || null,
    licensee: (licenseState && licenseState.licensee) || null,
    results,
    summary: { total: results.length, passed, failed: results.length - passed },
  });
});

app.get("/api/selftest/checklist", (req, res) => {
  const baseChecklist = [
      { id: 1,  round: "R1",      item: "Team Anthems wins coin toss → genre loads → 6 tracks appear in QLab" },
      { id: 2,  round: "R1",      item: "Score correct answers → earned time increases on dashboard" },
      { id: 3,  round: "R1",      item: "Both teams played → R1 advances to R2" },
      { id: 4,  round: "R1",      item: "Undo last answer → earned time decreases correctly" },
      { id: 5,  round: "R1",      item: "Cue notes on .2 slots show correct answer (uppercase)" },
      { id: 6,  round: "R1",      item: "Cue notes on .1 slots are empty" },
      { id: 7,  round: "R2",      item: "Leader goes first (no coin flip) → StreamDeck on correct page" },
      { id: 8,  round: "R2",      item: "Draw scenario → coin flip fires (R2COINFLIP → CF2)" },
      { id: 9,  round: "R2",      item: "Coin flip winner picks genre → tracks load" },
      { id: 10, round: "R2",      item: "Buzzers locked out entire round (IBUZZ/ABUZZ disarmed)" },
      { id: 11, round: "R2",      item: "/playing/ OSC → StreamDeck navigates to team page" },
      { id: 12, round: "R3",      item: "Leader goes first (no coin flip) → StreamDeck on correct page" },
      { id: 13, round: "R3",      item: "Draw scenario → coin flip fires (R3COINFLIP → CF3)" },
      { id: 14, round: "R3",      item: "Buzzers arm/disarm correctly per track" },
      { id: 15, round: "R3",      item: "/playing/ OSC → StreamDeck navigates to team page" },
      { id: 16, round: "R3",      item: "R3SCORES cue notes populated" },
      { id: 17, round: "R4",      item: "Loser plays first → R4NEXT points to correct team" },
      { id: 18, round: "R4",      item: "Countdown videos load with correct remaining time" },
      { id: 19, round: "R4",      item: "Panic all cues → re-enter R4 → load-to-time re-sent correctly" },
      { id: 20, round: "R4",      item: "R4TF cue notes show correct answers (uppercase)" },
      { id: 21, round: "R4",      item: "Tiebreak scenario → DUALGO points to TIEBREAK" },
      { id: 22, round: "General", item: "StreamDeck genre pages correct per round (7/8/9)" },
      { id: 23, round: "General", item: "Full game reset clears all state and goto cues" },
      { id: 24, round: "General", item: "Pack switching loads correct tracks for all rounds" },
  ];

  const qaItems = qaCompletions.map((c, i) => {
    const packName = packData[c.packId]?.name || c.packId;
    const when = new Date(c.completedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    return {
      id: 100 + i,
      round: `R${c.round}`,
      item: `Track QA: ${packName} — Round ${c.round} verified (${c.verifiedCount}/${c.total} tracks)`,
      passed: true,
      notes: `Completed ${when} via Track QA tool`,
    };
  });

  res.json({
    success: true,
    version: PACKAGE_VERSION,
    checklist: [...baseChecklist, ...qaItems],
  });
});

// =============================================================================
// OSC - Receive from Bitfocus Companion (raw dgram for Docker reliability)
// =============================================================================
function parseOscAddress(buf) {
  let end = buf.indexOf(0);
  if (end === -1) end = buf.length;
  return buf.toString("utf8", 0, end);
}

function parseOscFloat(buf, offset) {
  if (offset + 4 <= buf.length) {
    return buf.readFloatBE(offset);
  }
  return null;
}

const udpServer = dgram.createSocket({ type: "udp4", reuseAddr: true });

function handleOscAddress(address, args) {
  // Team correct answers: /chart-toppers/correct/anthems or /chart-toppers/correct/icons
  const correctMatch = address.match(/^\/chart-toppers\/correct\/(anthems|icons)$/);
  if (correctMatch) {
    const teamId = correctMatch[1];
    console.log(`[OSC DEBUG] Processing correct answer for team: ${teamId}`);
    const state = registerCorrectAnswer(teamId, 'osc');
    if (state) {
      console.log(`[OSC DEBUG] Emitting stateUpdate to ${io.engine.clientsCount} clients`);
      io.emit("stateUpdate", state);
      sendQLabLoadCue(teamId, state[teamId].remainingTime);
    } else {
      console.log(`[OSC DEBUG] registerCorrectAnswer returned null for team: ${teamId}`);
    }
    // Round 3: go back to 4-choice page and stop active mashup track
    if (roundState.currentRound === 3) {
      navigateStreamDeck(12);
      if (r3ActiveTrack > 0) {
        setCompanionVariable(`r3_track_${r3ActiveTrack}_played`, '1');
        sendBridgeOsc(`/cue/R3T${r3ActiveTrack}/stop`, 0, `→ stop R3T${r3ActiveTrack} after correct`);
        // Re-arm both buzzers for the next track
        sendBridgeOsc('/cue/IBUZZ/armed', 1, '→ arm IBUZZ after R3 correct');
        sendBridgeOsc('/cue/ABUZZ/armed', 1, '→ arm ABUZZ after R3 correct');
        console.log(`[R3] Stopped R3T${r3ActiveTrack} after correct answer — both buzzers re-armed`);
        r3ActiveTrack = 0;
        r3WrongCount = 0;
        r3LastBuzzTeam = null;
      }
    }
    // R2 + R4: defensive disarm — these rounds have no buzzers during normal
    // play. A stray Companion/QLab button may have armed them; disarm after
    // every correct. R4 exception: during an active tiebreaker the buzzers are
    // intentionally armed by /dualscreen, so skip the disarm if tiebreakActive.
    if (roundState.currentRound === 2) {
      sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ after R2 correct (defensive)');
      sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ after R2 correct (defensive)');
    } else if (roundState.currentRound === 4 && !tiebreakActive) {
      sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ after R4 correct (defensive)');
      sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ after R4 correct (defensive)');
    }
    return;
  }

  // R3 track started playing: /chart-toppers/r3play/1 through /chart-toppers/r3play/4
  const r3PlayMatch = address.match(/^\/chart-toppers\/r3play\/([1-4])$/);
  if (r3PlayMatch) {
    // Defensive auto-advance: r3play is unmistakably an R3 signal. If the server
    // is still on a previous round (e.g. QLab moved to R3 without firing
    // /chart-toppers/round/3), advance now so all subsequent R3 logic works.
    if (roundState.currentRound !== 3) {
      console.warn(`[R3] r3play received while currentRound=${roundState.currentRound} — auto-advancing to R3`);
      setRound(3, 'r3play-auto');
    }
    r3ActiveTrack = parseInt(r3PlayMatch[1]);
    r3WrongCount = 0;
    r3LastBuzzTeam = null;
    // Re-arm both buzzers for the new track
    sendBridgeOsc('/cue/IBUZZ/armed', 1, '→ arm IBUZZ for new R3 track');
    sendBridgeOsc('/cue/ABUZZ/armed', 1, '→ arm ABUZZ for new R3 track');
    console.log(`[R3] Track R3T${r3ActiveTrack} now playing — both buzzers armed`);
    logActivity('r3play', 'all', `R3 track ${r3ActiveTrack} started`, 'osc');
    return;
  }

  // Buzzer fired — pause active R3 mashup track
  if (address === '/chart-toppers/buzz') {
    const buzzTeam = args.length > 0 ? (args[0].value || args[0]) : null;
    console.log(`[OSC] Buzz received${buzzTeam ? ` (${buzzTeam})` : ''}`);
    logActivity('buzz', buzzTeam || 'all', 'Buzzer fired', 'osc');
    if (buzzTeam) {
      io.emit("buzzerFired", { team: buzzTeam });
    }
    if (roundState.currentRound === 3 && r3ActiveTrack > 0) {
      // Ignore buzz from a locked-out team (already got it wrong on this track)
      if (buzzTeam && buzzTeam === r3LastBuzzTeam) {
        console.log(`[R3] Ignoring buzz from locked-out team ${buzzTeam}`);
        return;
      }
      r3LastBuzzTeam = buzzTeam;
      sendBridgeOsc(`/cue/R3T${r3ActiveTrack}/pause`, 0, `→ pause R3T${r3ActiveTrack} on buzz`);
      console.log(`[R3] Paused R3T${r3ActiveTrack} on buzz`);
    }
    return;
  }

  // Incorrect answer — Round 3: resume only if not both teams got it wrong
  if (address === '/chart-toppers/incorrect') {
    console.log(`[OSC] Incorrect answer`);
    logActivity('incorrect', 'all', 'Incorrect answer via OSC', 'osc');
    if (roundState.currentRound === 3) {
      r3WrongCount++;
      if (r3WrongCount < 2 && r3ActiveTrack > 0) {
        // First wrong answer — lock out the buzzer for the team that got it wrong
        if (r3LastBuzzTeam && TEAM_BUZZER_CUE[r3LastBuzzTeam]) {
          sendBridgeOsc(`/cue/${TEAM_BUZZER_CUE[r3LastBuzzTeam]}/armed`, 0, `→ disarm ${TEAM_BUZZER_CUE[r3LastBuzzTeam]} after incorrect`);
          console.log(`[R3] Locked out ${r3LastBuzzTeam} buzzer (${TEAM_BUZZER_CUE[r3LastBuzzTeam]})`);
        }
        // Resume the track after a short delay
        const track = r3ActiveTrack;
        setTimeout(() => {
          sendBridgeOsc(`/cue/R3T${track}/start`, 0, `→ resume R3T${track} after incorrect`);
          console.log(`[R3] Resumed R3T${track} after incorrect (delayed 500ms)`);
        }, 1000);
      } else if (r3ActiveTrack > 0) {
        // Both teams got it wrong — stop the track and go back to choices
        setCompanionVariable(`r3_track_${r3ActiveTrack}_played`, '1');
        sendBridgeOsc(`/cue/R3T${r3ActiveTrack}/stop`, 0, `→ stop R3T${r3ActiveTrack} both wrong`);
        // Re-arm both buzzers for the next track
        sendBridgeOsc('/cue/IBUZZ/armed', 1, '→ arm IBUZZ after R3 both wrong');
        sendBridgeOsc('/cue/ABUZZ/armed', 1, '→ arm ABUZZ after R3 both wrong');
        console.log(`[R3] Both teams wrong — stopped R3T${r3ActiveTrack} — both buzzers re-armed`);
        navigateStreamDeck(12);
        r3ActiveTrack = 0;
        r3WrongCount = 0;
        r3LastBuzzTeam = null;
      }
    }

    // R1-R3: advance stage host to next answer on pass/incorrect
    if (roundState.currentRound >= 1 && roundState.currentRound <= 3 && stageHostAnswers.length > 0) {
      stageHostAnswerIndex++;
      if (stageHostAnswerIndex < stageHostAnswers.length) {
        io.emit('currentTrack', { trackNumber: stageHostAnswerIndex + 1, total: stageHostAnswers.length });
        console.log(`[STAGE HOST] iPad advanced to answer ${stageHostAnswerIndex + 1}/${stageHostAnswers.length} (incorrect/pass)`);
      } else {
        // All answers exhausted — clear the iPad until next genre load
        stageHostAnswers = [];
        stageHostAnswerIndex = 0;
        io.emit('clearAnswer');
        console.log(`[STAGE HOST] All R${roundState.currentRound} answers shown — iPad cleared`);
      }
    }

    // R1/R3: navigate StreamDeck back to SDE1 after incorrect
    if (roundState.currentRound === 1 || roundState.currentRound === 3) {
      navigateStreamDeck(1);
    }

    // R2 + R4: defensive disarm — no buzzers during normal play in these rounds.
    // R4 exception: skip if tiebreakActive so the tiebreaker flow keeps buzzers armed.
    if (roundState.currentRound === 2) {
      sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ after R2 incorrect (defensive)');
      sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ after R2 incorrect (defensive)');
    } else if (roundState.currentRound === 4 && !tiebreakActive) {
      sendBridgeOsc('/cue/IBUZZ/armed', 0, '→ disarm IBUZZ after R4 incorrect (defensive)');
      sendBridgeOsc('/cue/ABUZZ/armed', 0, '→ disarm ABUZZ after R4 incorrect (defensive)');
    }

    // R4: advance stage host but don't auto-clear
    if (roundState.currentRound === 4 && stageHostAnswers.length > 0) {
      stageHostAnswerIndex++;
      if (stageHostAnswerIndex < stageHostAnswers.length) {
        io.emit('currentTrack', { trackNumber: stageHostAnswerIndex + 1, total: stageHostAnswers.length });
        console.log(`[STAGE HOST] iPad advanced to answer ${stageHostAnswerIndex + 1}/${stageHostAnswers.length} (incorrect/pass)`);
      }
    }

    return;
  }

  // Clear iPad answers: /chart-toppers/clearanswers
  if (address === '/chart-toppers/clearanswers') {
    stageHostAnswers = [];
    stageHostAnswerIndex = 0;
    io.emit('clearAnswer');
    console.log(`[OSC] iPad answers cleared`);
    logActivity('clearanswers', 'all', 'iPad answers cleared via OSC', 'osc');
    return;
  }

  // Round 4 track play: /chart-toppers/r4/1 through /chart-toppers/r4/40
  const r4Match = address.match(/^\/chart-toppers\/r4\/(\d+)$/);
  if (r4Match) {
    const trackNum = parseInt(r4Match[1]);
    const result = playR4Track(trackNum, 'osc');
    if (!result) {
      console.log(`[OSC] Round 4 track ${trackNum} rejected`);
    }
    return;
  }

  // Golden Record: /chart-toppers/golden-record/anthems or /chart-toppers/golden-record/icons
  const goldenMatch = address.match(/^\/chart-toppers\/golden-record\/(anthems|icons)$/);
  if (goldenMatch) {
    const teamId = goldenMatch[1];
    console.log(`[OSC] Golden Record activation for ${TEAMS[teamId].name}`);
    const state = activateGoldenRecord(teamId, 'osc');
    if (state) {
      io.emit("stateUpdate", state);
      io.emit("goldenRecordActivated", teamId);
    }
    return;
  }

  // Team reset: /chart-toppers/reset/anthems or /chart-toppers/reset/icons
  const resetMatch = address.match(/^\/chart-toppers\/reset\/(anthems|icons)$/);
  if (resetMatch) {
    const teamId = resetMatch[1];
    playResetCue(teamId);
    console.log(`[OSC] Reset ${TEAMS[teamId].name} - playing ${teamId === "anthems" ? "AT" : "IT"} cue`);
    
    // Actually reset the team state and update text cue
    resetTeam(teamId, 'osc');
    io.emit("stateUpdate", gameState);
    io.emit("teamReset", teamId);
    
    // Log activity
    logActivity('reset', teamId, `Reset via OSC - playing ${teamId === "anthems" ? "AT" : "IT"} cue`, 'osc');
    
    return;
  }

  // Reset all
  if (address === "/chart-toppers/reset") {
    playResetCue("anthems");
    playResetCue("icons");
    console.log("[OSC] Reset all teams - playing AT and IT cues");
    
    // Actually reset both teams and update text cues
    resetAll('osc');
    io.emit("stateUpdate", gameState);
    io.emit("teamReset", "anthems");
    io.emit("teamReset", "icons");
    
    // Log activity
    logActivity('reset', 'all', 'Reset all teams via OSC - playing AT and IT cues', 'osc');
    
    return;
  }

  // Team stop: /chart-toppers/stop/anthems or /chart-toppers/stop/icons
  const stopMatch = address.match(/^\/chart-toppers\/stop\/(anthems|icons)$/);
  if (stopMatch) {
    const teamId = stopMatch[1];
    stopQLabCue(teamId);
    console.log(`[OSC] STOP command sent to ${TEAMS[teamId].name} via OSC`);
    
    // Log activity
    logActivity('stop', teamId, 'Stop command sent via OSC', 'osc');
    
    return;
  }

  // Stop all
  if (address === "/chart-toppers/stop") {
    stopQLabCue("anthems");
    stopQLabCue("icons");
    console.log("[OSC] STOP command sent to both teams via OSC");
    
    // Log activity
    logActivity('stop', 'all', 'Stop command sent to both teams via OSC', 'osc');
    
    return;
  }

  // Team playing status: /chart-toppers/playing/anthems or /chart-toppers/playing/icons
  const playingMatch = address.match(/^\/chart-toppers\/playing\/(anthems|icons)$/);
  if (playingMatch) {
    const teamId = playingMatch[1];
    console.log(`[OSC] ${TEAMS[teamId].name} is now playing`);

    // R4 auto-retarget: when a team starts playing in Round 4, schedule a
    // retarget of R4NEXT to the OTHER team so the operator's next GO fires
    // that team's group.
    if (roundState.currentRound === 4) {
      // Retarget R4SINGLESCORE based on first or second team
      const otherPlayed = r4PlayedTeams.has(otherTeam(teamId));
      if (otherPlayed) {
        // Second team starting — disarm the R4TG{N} cue matching the last
        // track the first team played, so QLab skips it on this team's pass.
        if (lastR4TrackPlayed != null) {
          sendBridgeOsc(`/cue/R4TG${lastR4TrackPlayed}/armed`, 0, `→ disarm R4TG${lastR4TrackPlayed} for second team`);
          console.log(`[R4 FLOW] Disarmed R4TG${lastR4TrackPlayed} (last track from first team) before ${TEAMS[teamId].name} starts`);
          lastR4TrackPlayed = null;
        }
        // Second team — scoreboard goes to dual SCOREBOARD
        updateQLabCueTarget('R4SINGLESCORE', 'SCOREBOARD');
        console.log(`[R4 FLOW] R4SINGLESCORE → SCOREBOARD (second team playing)`);
        updateQLabCueTarget('R4GOTO', 'R5');
        console.log(`[R4 FLOW] R4GOTO → R5 (second team now playing)`);
        // Re-send first team's R4 points to their standard cue so dual scoreboard is fresh
        const firstTeamId = otherTeam(teamId);
        const firstCue = firstTeamId === 'anthems' ? '1' : '2';
        const firstR4Cue = firstTeamId === 'anthems' ? '1.1' : '2.2';
        const firstPoints = String(gameState[firstTeamId]?.points || 0);
        sendBridgeOsc(`/cue/${firstCue}/text`, firstPoints, `→ ${firstCue} refresh ${firstTeamId} R4 points: ${firstPoints}`);
        sendBridgeOsc(`/cue/${firstR4Cue}/text`, firstPoints, `→ ${firstR4Cue} refresh ${firstTeamId} R4 points: ${firstPoints}`);
        console.log(`[R4 FLOW] Refreshed ${firstTeamId} scores: cue ${firstCue}+${firstR4Cue} = ${firstPoints} points`);
      } else {
        // First team — individual scoreboard
        const scoreCue = teamId === 'anthems' ? 'R4SANTHEM' : 'R4SICON';
        updateQLabCueTarget('R4SINGLESCORE', scoreCue);
        console.log(`[R4 FLOW] R4SINGLESCORE → ${scoreCue} (first team playing)`);
        // R4GOTO points at other team's block
        const otherBlock = teamId === 'anthems' ? 'R4ICON' : 'R4ANTHEM';
        updateQLabCueTarget('R4GOTO', otherBlock);
        console.log(`[R4 FLOW] R4GOTO → ${otherBlock} (first team playing)`);
      }
      r4PlayedTeams.add(teamId);
      scheduleR4AutoRetarget(teamId, 'osc');
    }

    // R2 flow: track who's played, retarget R2GO2 after the second team plays.
    // Don't force-navigate the StreamDeck — the QLab Auto StreamDeck (Re-Target)
    // cue uses LEADERSD's target to land on the right team page after the
    // genre picker. Server stays on SDE1 between genre pick and team answers.
    if (roundState.currentRound === 2) {
      r2PlayedTeams.add(teamId);
      retargetR2GO2('osc-playing');
    }

    // R3 flow: don't force-navigate the StreamDeck. Same as R2 — after the
    // coin flip and genre pick, SD stays on SDE1. The QLab Auto StreamDeck
    // (Re-Target) cue using LEADERSD drives any team-page nav when needed.

    // Auto coin-toss: if no coin toss set yet, first playing command establishes turn order
    if (!turnState.firstTeam) {
      turnState.firstTeam = teamId;
      turnState.currentTeam = teamId;
      turnState.phase = 'playing-first';
      console.log(`[TURN] Auto coin-toss from playing: ${TEAMS[teamId].name} goes first`);
      io.emit('turnUpdate', turnState);
      logActivity('cointoss', teamId, `Auto coin-toss: ${TEAMS[teamId].name} goes first (from playing)`, 'osc');
      // Update LEADERSD now that we have a winner — covers tied-score case
      // (e.g. R2 entry 0-0) where retargetLeaderSD would otherwise bail.
      retargetLeaderSD('auto-cointoss-osc');
    } else if (turnState.currentTeam !== teamId) {
      // Sync currentTeam to whoever is actually playing — /playing/{team} is
      // the authoritative signal. Keeps nextteam from switching the wrong way
      // when the operator plays a team other than the auto-set leader/loser.
      console.log(
        `[TURN] Sync currentTeam ${turnState.currentTeam ? TEAMS[turnState.currentTeam].name : 'none'} → ${TEAMS[teamId].name} (from /playing/)`
      );
      turnState.currentTeam = teamId;
      io.emit('turnUpdate', turnState);
      setCompanionVariable('current_team', TEAMS[teamId].name);
      // Re-evaluate LEADERSD against the new currentTeam (matters for tied scores)
      retargetLeaderSD('playing-sync');
    }

    // Broadcast to all dashboard clients with simple emit
    console.log(`[SOCKET] Emitting teamPlaying for ${teamId}`);
    io.emit("teamPlaying", teamId);

    // Also broadcast a simple command for direct function call
    console.log(`[SOCKET] Emitting triggerPlaying for ${teamId}`);
    io.emit("triggerPlaying", teamId);

    console.log(`[SOCKET] Events emitted to ${io.engine.clientsCount} clients`);

    // Re-send loadActionAt in case the group reset the cue position (only if team has earned time)
    if (gameState[teamId].earnedTime > 0) {
      sendQLabLoadCue(teamId, gameState[teamId].remainingTime);
      console.log(`[COUNTDOWN] Re-sent loadActionAt for ${TEAMS[teamId].name} (${gameState[teamId].remainingTime}s remaining)`);
    }

    // Start polling QLab for this cue's playback position (countdown)
    // Only start if not already counting down (avoid double-trigger from rapid OSC)
    if (gameState[teamId].earnedTime > 0 && !countdownState[teamId].active) {
      startBridgePoll(teamId);
      console.log(`[COUNTDOWN] Started countdown tracking for ${TEAMS[teamId].name} (${gameState[teamId].earnedTime}s earned)`);
    } else if (countdownState[teamId].active) {
      console.log(`[COUNTDOWN] Countdown already active for ${TEAMS[teamId].name}, ignoring duplicate`);
    }

    // Log activity
    logActivity('playing', teamId, 'Team started playing via OSC', 'osc');

    return;
  }

  // Team stop playing: /chart-toppers/stopPlaying/anthems or /chart-toppers/stopPlaying/icons
  const stopPlayingMatch = address.match(/^\/chart-toppers\/stopPlaying\/(anthems|icons)$/);
  if (stopPlayingMatch) {
    const teamId = stopPlayingMatch[1];
    console.log(`[OSC] ${TEAMS[teamId].name} stopped playing`);

    // Broadcast to all dashboard clients
    io.emit("teamStopPlaying", teamId);

    // Also broadcast a simple command for direct function call
    io.emit("triggerStop", teamId);

    // Stop polling QLab for this cue's playback position
    if (countdownState[teamId].active) {
      stopBridgePoll(teamId);
      io.emit("countdownStop", teamId);
      console.log(`[COUNTDOWN] Stopped countdown tracking for ${TEAMS[teamId].name}`);
    }

    // Log activity
    logActivity('stopPlaying', teamId, 'Team stopped playing via OSC', 'osc');

    // StreamDeck navigation: after team stops, route to next step
    if (turnState.phase === 'playing-first' && turnState.currentTeam === teamId) {
      // First team finished → switch to second team's page
      const next = otherTeam(teamId);
      turnState.currentTeam = next;
      turnState.phase = 'playing-second';
      navigateStreamDeck(TEAM_PAGES[next]);
      setCompanionVariable('current_team', TEAMS[next].name);
      io.emit('turnUpdate', turnState);
      console.log(`[TURN] First team done → ${TEAMS[next].name} page (${TEAM_PAGES[next]})`);
    } else if (turnState.phase === 'playing-second' && turnState.currentTeam === teamId) {
      // Second team finished → back to genre page for next pick
      turnState.currentTeam = turnState.firstTeam; // reset to first team for next genre
      turnState.phase = 'genre-pick';
      const genrePage = GENRE_PAGES[roundState.currentRound];
      if (genrePage) {
        navigateStreamDeck(genrePage);
        console.log(`[TURN] Both teams done → back to genre page (${genrePage})`);
      }
      setCompanionVariable('current_team', '');
      io.emit('turnUpdate', turnState);
    }

    return;
  }

  // Round control: /chart-toppers/round/1 through /chart-toppers/round/4
  const roundMatch = address.match(/^\/chart-toppers\/round\/(\d+)$/);
  if (roundMatch) {
    const roundNum = parseInt(roundMatch[1]);
    if (roundNum >= 0 && roundNum <= TOTAL_ROUNDS) {
      setRound(roundNum, 'osc');
    } else {
      console.log(`[OSC] Invalid round number: ${roundNum}`);
    }
    return;
  }

  // Round next: /chart-toppers/round/next
  if (address === "/chart-toppers/round/next") {
    const next = roundState.currentRound + 1;
    if (next <= TOTAL_ROUNDS) {
      setRound(next, 'osc');
    } else {
      console.log("[OSC] Already at final round, ignoring next");
    }
    return;
  }

  // Round reset: /chart-toppers/round/reset
  if (address === "/chart-toppers/round/reset") {
    resetRounds('osc');
    return;
  }

  // Team switch: /chart-toppers/nextteam
  // Flips currentTeam to the other team.
  // Use between the first team's scoreboard and the second team starting, and
  // again between the second team finishing and the next genre pick.
  if (address === "/chart-toppers/nextteam") {
    if (!turnState.currentTeam) {
      console.warn("[NEXT TEAM] triggered but no currentTeam set — ignoring");
      return;
    }
    const leavingTeam = turnState.currentTeam;
    const next = otherTeam(leavingTeam);
    console.log(
      `[NEXT TEAM] Team switch: ${TEAMS[leavingTeam].name} → ${TEAMS[next].name} (osc)`
    );
    // Mark the team that just played in the current round's played-team set.
    // This drives R2GO2 retarget and mirrors the R4 tracking.
    if (roundState.currentRound === 2) {
      r2PlayedTeams.add(leavingTeam);
    } else if (roundState.currentRound === 4) {
      r4PlayedTeams.add(leavingTeam);
      // Retarget R4SINGLESCORE to the incoming team's score cue
      const scoreCue = next === 'anthems' ? 'R4SANTHEM' : 'R4SICON';
      updateQLabCueTarget('R4SINGLESCORE', scoreCue);
      console.log(`[R4 FLOW] R4SINGLESCORE → ${scoreCue} (${TEAMS[next].name} now playing)`);
      // Retarget R4GOTO: team 2's block if first team done, R5 if both done
      const bothPlayed = r4PlayedTeams.has('anthems') && r4PlayedTeams.has('icons');
      if (bothPlayed) {
        updateQLabCueTarget('R4GOTO', 'R5');
        console.log(`[R4 FLOW] R4GOTO → R5 (both teams played)`);
      } else {
        const nextBlock = next === 'anthems' ? 'R4ANTHEM' : 'R4ICON';
        updateQLabCueTarget('R4GOTO', nextBlock);
        console.log(`[R4 FLOW] R4GOTO → ${nextBlock} (${TEAMS[next].name} still to play)`);
      }
      // Don't call scheduleR4AutoRetarget — it's for /playing/ signals
    }
    turnState.currentTeam = next;
    if (turnState.phase === 'playing-first') {
      turnState.phase = 'playing-second';
    } else if (turnState.phase === 'playing-second') {
      turnState.phase = 'genre-pick';
    }
    navigateStreamDeck(TEAM_PAGES[next]);
    setCompanionVariable('current_team', TEAMS[next].name);
    // Move the dashboard glow to the new team
    io.emit("teamStopPlaying", leavingTeam);
    io.emit("triggerStop", leavingTeam);
    io.emit("teamPlaying", next);
    io.emit("triggerPlaying", next);
    io.emit('turnUpdate', turnState);
    logActivity('turn', next, `Next team: ${TEAMS[next].name}`, 'osc');
    return;
  }

  // Single scores screen: fired by the QLab cue that shows each team's
  // individual R4 scoreboard. This is the prep step right before DUALGO
  // plays — ARM DUALGO now so it's ready when QLab fires it. Target is
  // already kept live by retargetDUALGO, so by the time DUALGO plays the
  // target will match the current score state (R5 or TIEBREAK).
  if (address === '/chart-toppers/singlescores') {
    // Refresh target one more time for freshness
    retargetDUALGO('singlescores');
    sendBridgeOsc('/cue/DUALGO/armed', 1, '→ arm DUALGO on single-scores');
    console.log(`[SINGLESCORES] DUALGO armed — ready to fire whenever it plays`);
    return;
  }


  // Dual scoreboard screen: operator-triggered. Expected flow:
  //   1. /singlescores already fired → DUALGO is armed, target is live
  //   2. /dualscreen → refresh target → fire /start
  // Safety net: we still arm DUALGO here via the awaitable path in case
  // /singlescores wasn't fired. The await guarantees the arm reaches QLab
  // before /start (previously these raced and /start arrived first).
  if (address === '/chart-toppers/dualscreen') {
    if (roundState.currentRound !== 4) {
      console.log(`[DUALSCREEN] Round ${roundState.currentRound} — ignoring (DUALGO only active in R4)`);
      return;
    }
    // Refresh target against live scores
    retargetDUALGO('dualscreen');
    const ranking = teamRanking();
    (async () => {
      if (ranking.tie) {
        console.log(`[TIEBREAK] Tie detected (${ranking.aScore} each) — firing DUALGO → TIEBREAK`);
        tiebreakActive = true;
        // Tiebreaker needs the buzzers armed (R4 otherwise keeps them off)
        sendBridgeOsc('/cue/IBUZZ/armed', 1, '→ arm IBUZZ for tiebreaker');
        sendBridgeOsc('/cue/ABUZZ/armed', 1, '→ arm ABUZZ for tiebreaker');
        logActivity('tiebreak', 'all', `Tiebreaker triggered (${ranking.aScore} each)`, 'osc');
      } else {
        console.log(`[DUALSCREEN] No tie (a=${ranking.aScore} i=${ranking.iScore}) — firing DUALGO → R5 (winner reveal)`);
      }
      // Arm (safety net) → wait for ACK → fire /start in order.
      await sendBridgeOscAwait('/cue/DUALGO/armed', 1, '→ arm DUALGO (dualscreen safety)');
      sendBridgeOsc('/cue/DUALGO/start', 0, `→ start DUALGO (${ranking.tie ? 'tiebreaker' : 'winner reveal'})`);
    })();
    return;
  }

  // Coin toss: /chart-toppers/cointoss/anthems or /chart-toppers/cointoss/icons
  // Works in R2/R3 (standard coin-flip after a tied previous round) and R4
  // (final coin flip when scores are tied going into R4 — rare, but possible).
  const cointossMatch = address.match(/^\/chart-toppers\/cointoss\/(anthems|icons)$/);
  if (cointossMatch) {
    const teamId = cointossMatch[1];
    turnState.firstTeam = teamId;
    turnState.currentTeam = teamId;
    turnState.phase = roundState.currentRound === 4 ? 'playing-first' : 'genre-pick';
    console.log(`[TURN] Coin toss: ${TEAMS[teamId].name} goes first`);
    io.emit('turnUpdate', turnState);
    logActivity('cointoss', teamId, `Coin toss: ${TEAMS[teamId].name} goes first`, 'osc');

    if (roundState.currentRound === 4) {
      // R4 tied entry: set R4NEXT to the winner's block so the operator's
      // next GO plays the correct team's countdown.
      retargetR4NextToTeam(teamId, 'cointoss-osc');
    } else {
      // R2/R3: navigate StreamDeck to the genre picker page for the round
      const genrePage = GENRE_PAGES[roundState.currentRound];
      if (genrePage) {
        navigateStreamDeck(genrePage);
      }
    }
    // Update LEADERSD to the cointoss winner so the QLab Auto StreamDeck cue
    // points to the right team page even when scores are tied.
    retargetLeaderSD('cointoss-osc');
    return;
  }

  // Load genre tracks: /chart-toppers/loadgenre/1, /2, /3
  const genreMatch = address.match(/^\/chart-toppers\/loadgenre\/(\d+)$/);
  if (genreMatch) {
    const genreIndex = parseInt(genreMatch[1]);
    if (genreIndex >= 1 && genreIndex <= 3) {
      const result = loadGenreTracks(genreIndex);
      console.log(`[OSC] Load genre ${genreIndex}: ${result.success ? result.genre : result.error}`);
      // Navigate StreamDeck to page 1 after genre pick
      if (result.success) {
        navigateStreamDeck(1);
        console.log(`[OSC] StreamDeck → SDE1 after genre load`);
      }
    } else {
      console.log(`[OSC] Invalid genre index: ${genreIndex} (must be 1-3)`);
    }
    return;
  }

  // Refresh genre: reload the same genre with fresh tracks (dedup ensures no repeats)
  if (address === '/chart-toppers/refreshgenre') {
    if (!lastLoadedGenre.genreIndex) {
      console.warn(`[OSC] refreshgenre — no genre loaded yet, ignoring`);
      return;
    }
    console.log(`[GENRE REFRESH] Reloading genre index ${lastLoadedGenre.genreIndex} for Round ${lastLoadedGenre.round}`);
    const result = loadGenreTracks(lastLoadedGenre.genreIndex);
    console.log(`[OSC] Refresh genre: ${result.success ? result.genre + ' (fresh tracks)' : result.error}`);
    // Match /loadgenre behaviour — return SD to SDE1 so the operator sees
    // the track-picker page after a refresh (important in R1 where the SD
    // may have been left on a team answer page by /r1teamdone).
    if (result.success) {
      navigateStreamDeck(1);
      console.log(`[OSC] StreamDeck → SDE1 after refreshgenre`);
    }
    return;
  }

  // Refresh tracks: state-based, idempotent. Driven by r2PlayedTeams membership
  // so repeated calls (operator double-press, QLab firing it twice, etc) don't
  // prematurely advance R2GO2 to AWO.
  //   - 0 teams played: ignore
  //   - 1 team played: swap tracks for the opponent, force LEADERSD → opponent
  //   - 2 teams played: both done → retarget R2GO2 → AWO
  if (address === '/chart-toppers/refreshtracks') {
    handleRefreshTracks('osc');
    return;
  }

  // Second team answer: retarget R2GO2 → R3 and switch turn if possible
  if (address === '/chart-toppers/secondteamanswer') {
    // Always retarget R2GO2 → R3
    r2PlayedTeams.add('anthems');
    r2PlayedTeams.add('icons');
    retargetR2GO2('secondteamanswer');

    // Switch turn state if a team is set
    if (turnState.currentTeam) {
      const next = otherTeam(turnState.currentTeam);
      turnState.currentTeam = next;
      turnState.phase = 'playing-second';
      setCompanionVariable('current_team', TEAMS[next].name);
      io.emit('turnUpdate', turnState);
      console.log(`[OSC] Second team answer → ${TEAMS[next].name}`);
    }
    return;
  }

  // R1 second team: navigate SD to the other team's answer page
  if (address === '/chart-toppers/r1secondteam') {
    if (turnState.currentTeam) {
      const next = otherTeam(turnState.currentTeam);
      navigateStreamDeck(TEAM_PAGES[next]);
      console.log(`[OSC] R1 second team → SD page ${TEAM_PAGES[next]} (${TEAMS[next].name})`);
    } else {
      console.warn(`[OSC] r1secondteam — no current team set`);
    }
    return;
  }

  // R1 team done: advance R1 played count and navigate SD to next team
  if (address === '/chart-toppers/r1teamdone') {
    r1PlayedTeams += 1;
    console.log(`[R1 FLOW] Team done (${r1PlayedTeams}/2)`);

    // First team done → navigate SD to second team's answer page
    if (r1PlayedTeams === 1 && turnState.currentTeam) {
      const next = otherTeam(turnState.currentTeam);
      navigateStreamDeck(TEAM_PAGES[next]);
      console.log(`[R1 FLOW] SD → ${TEAMS[next].name} answer page (${TEAM_PAGES[next]})`);
    }
    return;
  }

  console.log(`[OSC] Unhandled address: ${address}`);
}

udpServer.on("message", (msg, rinfo) => {
  console.log(`[OSC RAW] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
  try {
    const oscMsg = osc.readPacket(msg, { metadata: true });
    console.log(`[OSC IN] ${oscMsg.address}`, oscMsg.args || [], `from ${rinfo.address}:${rinfo.port}`);
    handleOscAddress(oscMsg.address, oscMsg.args || []);
  } catch (err) {
    console.log(`[OSC IN RAW] ${msg.length} bytes from ${rinfo.address}:${rinfo.port} (parse error: ${err.message})`);
    const addr = parseOscAddress(msg);
    console.log(`[OSC IN RAW] Extracted address: "${addr}"`);
    handleOscAddress(addr, []);
  }
});

udpServer.on("listening", () => {
  const addr = udpServer.address();
  console.log(`[OSC] UDP socket listening on ${addr.address}:${addr.port}`);
});

udpServer.on("error", (err) => {
  console.error("[OSC] UDP error:", err);
});

udpServer.bind(CONFIG.OSC_LISTEN_PORT, "0.0.0.0");

// =============================================================================
// OSC - Send to QLab via HTTP bridge (Docker macOS UDP workaround)
// =============================================================================

console.log(`[QLAB] Will send OSC via bridge at ${BRIDGE_URL}`);
console.log(`[COMPANION] HTTP API at ${COMPANION_URL}`);

// Low-level helper: POST any OSC address+value via the bridge.
function sendBridgeOsc(address, value, logLabel) {
  const payload = JSON.stringify({ address, value });
  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };
  const req = http.request(options, (res) => {
    res.on("data", () => {});
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address}${logLabel ? " " + logLabel : ""} (bridge: ${res.statusCode})`);
    });
  });
  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error (${address}): ${err.message}`);
  });
  req.write(payload);
  req.end();
}

// Promise-returning version of sendBridgeOsc. Resolves when the bridge
// HTTP response ends, so callers can chain operations that MUST arrive at
// QLab in order (e.g. arm-then-start for a disarmed cue). Without this,
// two sendBridgeOsc calls in quick succession can arrive out of order.
function sendBridgeOscAwait(address, value, logLabel) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ address, value });
    const bridgeUrl = new URL("/send", BRIDGE_URL);
    const options = {
      hostname: bridgeUrl.hostname,
      port: bridgeUrl.port,
      path: bridgeUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = http.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => {
        console.log(`[QLAB OUT] ${address}${logLabel ? " " + logLabel : ""} (bridge: ${res.statusCode})`);
        resolve(res.statusCode);
      });
    });
    req.on("error", (err) => {
      console.error(`[QLAB OUT] Bridge error (${address}): ${err.message}`);
      resolve(0);
    });
    req.write(payload);
    req.end();
  });
}

function sendQLabLoadCue(teamId, remainingSeconds) {
  const cueName = TEAMS[teamId].cueName;
  // Add video offset to account for intro before countdown starts
  const loadPosition = remainingSeconds + CONFIG.VIDEO_OFFSET;
  sendBridgeOsc(
    `/cue/${cueName}/loadActionAt`,
    loadPosition,
    `→ ${loadPosition}s (${remainingSeconds}s remaining + ${CONFIG.VIDEO_OFFSET}s offset)`
  );
}

function clearQLabLoadPosition(teamId) {
  const cueName = TEAMS[teamId].cueName;
  const address = `/cue/${cueName}/loadActionAt`;
  const payload = JSON.stringify({ address, value: -1 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → CLEARED (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

function stopQLabCue(teamId) {
  const cueName = TEAMS[teamId].cueName;
  const address = `/cue/${cueName}/stop`;
  const payload = JSON.stringify({ address, value: 0 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → STOPPED (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

function updateQLabTextCue(teamId, earnedTime) {
  const isR4 = roundState.currentRound === 4;
  const standardCue = teamId === "anthems" ? "1" : "2";
  const r4Cue = teamId === "anthems" ? "1.1" : "2.2";

  if (isR4) {
    // R4: update BOTH standard and R4 cues with points value
    const text = String(gameState[teamId]?.points || 0);
    sendBridgeOsc(`/cue/${r4Cue}/text`, text, `→ ${r4Cue} R4 points: ${text}`);
    sendBridgeOsc(`/cue/${standardCue}/text`, text, `→ ${standardCue} R4 points: ${text}`);
    console.log(`[QLAB TEXT] R4 updating cues ${r4Cue} + ${standardCue} (${teamId}) to "${text}" points`);
    return;
  }

  const cueNumber = standardCue;
  const address = `/cue/${cueNumber}/text`;
  const text = String(earnedTime);
  const payload = JSON.stringify({ address, value: text });

  console.log(`[QLAB TEXT] Updating cue ${cueNumber} (${teamId}) text content to "${text}" seconds`);

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → "${text}" (bridge: ${res.statusCode})`);
      if (res.statusCode !== 200) {
        console.log(`[QLAB ERROR] Bridge response: ${body}`);
      }
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

function playResetCue(teamId) {
  // Play specific cue for each team: AT for Anthems, IT for Icons
  const cueName = teamId === "anthems" ? "AT" : "IT";
  const address = `/cue/${cueName}/start`;
  const payload = JSON.stringify({ address, value: 0 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB OUT] ${address} → STARTED (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

function playGoldenRecordCue(teamId) {
  const cueName = teamId === "anthems" ? "GRA" : "GRI";
  const address = `/cue/${cueName}/start`;
  const payload = JSON.stringify({ address, value: 0 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB] Golden Record cue ${cueName} fired for ${TEAMS[teamId].name}: ${body}`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB] Error firing Golden Record cue ${cueName}:`, err.message);
  });

  req.write(payload);
  req.end();
}

// Cues that must stay disarmed after armAllQLabCues — the server arms them
// on demand when it's actually time to fire them.
//   - IBUZZ/ABUZZ: armed by R3 track start, R4 tiebreaker, undone on events
//   - DUALGO: disarmed until R4 single-scores screen fires /singlescores,
//     which arms it. /dualscreen then fires /start. Prevents DUALGO from
//     accidentally firing during R1-R3 when "start scores (dual)" plays.
const BASE_DISARMED_CUES = ['IBUZZ', 'ABUZZ', 'DUALGO'];
function getDisarmedCues() {
  return BASE_DISARMED_CUES;
}

function armAllQLabCues() {
  const address = `/cue/*/armed`;
  const payload = JSON.stringify({ address, value: 1 });

  const bridgeUrl = new URL("/send", BRIDGE_URL);
  const options = {
    hostname: bridgeUrl.hostname,
    port: bridgeUrl.port,
    path: bridgeUrl.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[QLAB] Armed all cues in workspace: ${body}`);
      // Re-disarm cues that must stay disarmed
      getDisarmedCues().forEach(cueName => {
        const disarmPayload = JSON.stringify({ address: `/cue/${cueName}/armed`, value: 0 });
        const disarmReq = http.request(options, (disarmRes) => {
          let disarmBody = "";
          disarmRes.on("data", (chunk) => (disarmBody += chunk));
          disarmRes.on("end", () => {
            console.log(`[QLAB] Re-disarmed ${cueName}: ${disarmBody}`);
          });
        });
        disarmReq.on("error", (err) => {
          console.error(`[QLAB] Error re-disarming ${cueName}:`, err.message);
        });
        disarmReq.write(disarmPayload);
        disarmReq.end();
      });
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB] Error arming all cues:`, err.message);
  });

  req.write(payload);
  req.end();
}

// =============================================================================
// Start Server
// =============================================================================
server.listen(CONFIG.WEB_PORT, "0.0.0.0", () => {
  console.log(`[WEB] Dashboard running at http://localhost:${CONFIG.WEB_PORT}`);
  console.log("=== Ready for scoring ===");
});
