const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const osc = require("osc");
const dgram = require("dgram");
const path = require("path");
const fs = require('fs');
const { spawn } = require("child_process");

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
  POINTS_PER_CORRECT: parseInt(process.env.POINTS_PER_CORRECT) || 5,

  // QLab cue numbers for each team's LOAD time cue
  QLAB_CUE_ANTHEMS: process.env.QLAB_CUE_ANTHEMS || "ANTHEMS",
  QLAB_CUE_ICONS: process.env.QLAB_CUE_ICONS || "ICONS",

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
// Game State
// =============================================================================
function createTeamState() {
  return {
    correctAnswers: 0,
    earnedTime: 0,
    remainingTime: CONFIG.MAX_TIME,
    maxTime: CONFIG.MAX_TIME,
    pointsPerCorrect: CONFIG.POINTS_PER_CORRECT,
    isActive: true,
    history: [],
  };
}

let gameState = {
  anthems: createTeamState(),
  icons: createTeamState(),
};

function resetTeam(teamId, source = 'system') {
  gameState[teamId] = createTeamState();
  console.log(`[GAME] ${TEAMS[teamId].name} reset to defaults`);
  // Update QLab text cue to show 0 seconds
  updateQLabTextCue(teamId, 0);
  
  // Log activity
  logActivity('reset', teamId, 'Team reset', source);
}

function resetAll(source = 'system') {
  gameState = {
    anthems: createTeamState(),
    icons: createTeamState(),
  };
  console.log("[GAME] All teams reset to defaults");
  // Update both QLab text cues to show 0 seconds
  updateQLabTextCue("anthems", 0);
  updateQLabTextCue("icons", 0);
  
  // Log activity
  logActivity('reset', 'all', 'All teams reset', source);
}

function registerCorrectAnswer(teamId, source = 'system') {
  const team = gameState[teamId];
  if (!team || !team.isActive) {
    console.log(`[GAME] ${teamId} is not active, ignoring correct answer`);
    return null;
  }

  // Check if team has already reached the maximum time limit
  if (team.earnedTime >= CONFIG.MAX_TIME) {
    console.log(`[GAME] ${TEAMS[teamId].name} has already reached ${CONFIG.MAX_TIME}s limit, ignoring correct answer`);
    return null;
  }

  team.correctAnswers += 1;
  team.earnedTime = Math.min(team.correctAnswers * team.pointsPerCorrect, CONFIG.MAX_TIME);
  team.remainingTime = team.maxTime - team.earnedTime;

  if (team.remainingTime < 0) {
    team.remainingTime = 0;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    answer: team.correctAnswers,
    earnedTime: team.earnedTime,
    remainingTime: team.remainingTime,
  };
  team.history.push(entry);

  // Log activity
  logActivity('correct', teamId, `Correct answer #${team.correctAnswers} (+${team.pointsPerCorrect}s, ${team.earnedTime}s total)`, source);

  console.log(
    `[GAME] ${TEAMS[teamId].name} Correct #${team.correctAnswers} | Earned: ${team.earnedTime}s | Remaining: ${team.remainingTime}s`
  );

  // Update QLab text cue with current earned time
  updateQLabTextCue(teamId, team.earnedTime);

  return gameState;
}

// =============================================================================
// Express + Socket.IO (Web Dashboard)
// =============================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/state", (req, res) => {
  res.json(gameState);
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

// QLab Track cue configuration (T1-T4)
const TRACK_CUE_NUMBERS = ["T1", "T2", "T3", "T4"];
const TRACK_BASE_PATH = process.env.TRACK_BASE_PATH || "/Users/chrisdevlin/Library/Mobile Documents/com~apple~CloudDocs/Twisted Melon/Installs/MSC/MSC Poesia/QLab Files/Chart Toppers/audio";

// Pack-specific audio file mappings for each track
const PACK_AUDIO_FILES = {
  'uk-usa-german': [
    { fileName: 'Track 1 - American.mp3', cueName: 'Track 1 - USA / UK' },
    { fileName: 'Track 2 - American.mp3', cueName: 'Track 2 - USA / UK' },
    { fileName: 'Track 3 - American.mp3', cueName: 'Track 3 - USA / UK' },
    { fileName: 'Track 4 - American.mp3', cueName: 'Track 4 - USA / UK' }
  ],
  'european': [
    { fileName: 'Track 1 - American.mp3', cueName: 'Track 1 - USA / UK' },
    { fileName: 'Track 2 - American.mp3', cueName: 'Track 2 - USA / UK' },
    { fileName: 'Track 3 - American.mp3', cueName: 'Track 3 - USA / UK' },
    { fileName: 'Track 4 - American.mp3', cueName: 'Track 4 - USA / UK' }
  ],
  'teens': [
    { fileName: 'Track 1 - Asian.mp3', cueName: 'Track 1 - Asian' },
    { fileName: 'Track 2 - Asian.mp3', cueName: 'Track 2 - Asian' },
    { fileName: 'Track 3 - Asian.mp3', cueName: 'Track 3 - Asian' },
    { fileName: 'Track 4 - Asian.mp3', cueName: 'Track 4 - Asian' }
  ]
};

// Load pack settings from file or use defaults
let packSettings = {
  currentPack: 'uk-usa-german',
  lastChanged: null
};

// Function to load pack settings
function loadPackSettings() {
  try {
    if (fs.existsSync(PACK_SETTINGS_FILE)) {
      const data = fs.readFileSync(PACK_SETTINGS_FILE, 'utf8');
      packSettings = JSON.parse(data);
      console.log(`[PACK] Loaded pack settings: ${packSettings.currentPack}`);
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

// Function to update all track cues (T1-T4) based on selected pack
function trackBasePathAvailable() {
  if (!TRACK_BASE_PATH) {
    console.warn('[PACK] TRACK_BASE_PATH is not defined. Skipping cue file updates.');
    return false;
  }

  if (!fs.existsSync(TRACK_BASE_PATH)) {
    console.warn(`[PACK] TRACK_BASE_PATH does not exist: ${TRACK_BASE_PATH}. Skipping cue file updates.`);
    return false;
  }

  return true;
}

function updateTrackCuesForPack(pack) {
  const packTracks = PACK_AUDIO_FILES[pack];
  if (!packTracks) {
    console.log(`[PACK] No audio configuration for pack: ${pack}`);
    return;
  }

  if (!trackBasePathAvailable()) {
    return;
  }

  console.log(`[PACK] Updating ${packTracks.length} track cues for ${pack} pack:`);
  
  packTracks.forEach((trackConfig, index) => {
    const cueNumber = TRACK_CUE_NUMBERS[index];
    const fullFilePath = path.join(TRACK_BASE_PATH, trackConfig.fileName);

    if (!fs.existsSync(fullFilePath)) {
      console.warn(`[PACK] Missing audio file for ${cueNumber}: ${fullFilePath}. Skipping file target update.`);
    } else {
      console.log(`[PACK]   ${cueNumber}: File: ${fullFilePath}`);
      // Update file path only when file exists
      updateQLabCueFilePath(cueNumber, fullFilePath);
    }

    console.log(`[PACK]   ${cueNumber}: Name: ${trackConfig.cueName}`);
    updateQLabCueName(cueNumber, trackConfig.cueName);
  });
}

app.get("/api/pack-settings", (req, res) => {
  res.json(packSettings);
});

app.post("/api/pack-settings", (req, res) => {
  const { currentPack, lastChanged } = req.body;
  
  if (!currentPack || !['uk-usa-german', 'european', 'teens'].includes(currentPack)) {
    return res.status(400).json({ success: false, message: "Invalid pack selection" });
  }
  
  const oldPack = packSettings.currentPack;
  packSettings = {
    currentPack,
    lastChanged: lastChanged || new Date().toISOString()
  };
  
  // Save to persistent storage
  savePackSettings();
  
  // Update QLab track cues (T1-T4) file paths and names based on selected pack
  updateTrackCuesForPack(currentPack);
  
  // Broadcast pack change to all connected dashboard clients
  io.emit("packChanged", currentPack);
  
  // Log activity
  logActivity('system', 'all', `Question pack changed from ${oldPack} to ${currentPack}`, 'api');
  console.log(`[PACK] Question pack changed to: ${currentPack}`);
  
  res.json({ success: true, ...packSettings });
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

async function validateLicense() {
  try {
    const machineId = await getMachineId();
    console.log(`[LICENSE] Machine ID: ${machineId}`);
    
    const licenseKey = process.env.LICENSE_KEY || "";
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

io.on("connection", (socket) => {
  console.log("[WEB] Dashboard client connected");
  socket.emit("stateUpdate", gameState);

  socket.on("correct", (teamId) => {
    if (!TEAMS[teamId]) return;
    const state = registerCorrectAnswer(teamId, 'socket');
    if (state) {
      io.emit("stateUpdate", state);
      sendQLabLoadCue(teamId, state[teamId].remainingTime);
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

function handleOscAddress(address) {
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
    
    // Broadcast to all dashboard clients with simple emit
    console.log(`[SOCKET] Emitting teamPlaying for ${teamId}`);
    io.emit("teamPlaying", teamId);
    
    // Also broadcast a simple command for direct function call
    console.log(`[SOCKET] Emitting triggerPlaying for ${teamId}`);
    io.emit("triggerPlaying", teamId);
    
    console.log(`[SOCKET] Events emitted to ${io.engine.clientsCount} clients`);
    
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
    
    // Log activity
    logActivity('stopPlaying', teamId, 'Team stopped playing via OSC', 'osc');
    
    return;
  }

  console.log(`[OSC] Unhandled address: ${address}`);
}

udpServer.on("message", (msg, rinfo) => {
  console.log(`[OSC RAW] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
  try {
    const oscMsg = osc.readPacket(msg, { metadata: true });
    console.log(`[OSC IN] ${oscMsg.address}`, oscMsg.args || [], `from ${rinfo.address}:${rinfo.port}`);
    handleOscAddress(oscMsg.address);
  } catch (err) {
    console.log(`[OSC IN RAW] ${msg.length} bytes from ${rinfo.address}:${rinfo.port} (parse error: ${err.message})`);
    const addr = parseOscAddress(msg);
    console.log(`[OSC IN RAW] Extracted address: "${addr}"`);
    handleOscAddress(addr);
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

function sendQLabLoadCue(teamId, remainingSeconds) {
  const cueName = TEAMS[teamId].cueName;
  const address = `/cue/${cueName}/loadActionAt`;
  const payload = JSON.stringify({ address, value: remainingSeconds });

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
      console.log(`[QLAB OUT] ${address} → ${remainingSeconds}s (bridge: ${res.statusCode})`);
    });
  });

  req.on("error", (err) => {
    console.error(`[QLAB OUT] Bridge error: ${err.message}`);
  });

  req.write(payload);
  req.end();
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
  const cueNumber = teamId === "anthems" ? "1" : "2";  // Use numeric cue numbers
  const address = `/cue/${cueNumber}/text`;  // Remove /live to update text content, not cue name
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

// =============================================================================
// Start Server
// =============================================================================
server.listen(CONFIG.WEB_PORT, "0.0.0.0", () => {
  console.log(`[WEB] Dashboard running at http://localhost:${CONFIG.WEB_PORT}`);
  console.log("=== Ready for scoring ===");
});
