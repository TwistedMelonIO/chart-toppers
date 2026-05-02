const http = require("http");
const net = require("net");
const dgram = require("dgram");
const url = require("url");

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT) || 3001;
const QLAB_HOST = process.env.QLAB_HOST || "127.0.0.1";
const QLAB_PORT = parseInt(process.env.QLAB_PORT) || 53000;
const CALLBACK_URL = process.env.CALLBACK_URL || "http://chart-toppers:3000";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 200;

// UDP socket for fire-and-forget sends (loadActionAt, stop, text, etc.)
const udpSocket = dgram.createSocket("udp4");

// =============================================================================
// OSC helpers — build outbound messages
// =============================================================================
function oscString(str) {
  const buf = Buffer.from(str + "\0");
  const pad = 4 - (buf.length % 4);
  return pad < 4 ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
}

function oscFloat(val) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(val, 0);
  return buf;
}

function buildOscMessage(address, value) {
  // No-arg form: caller passed null/undefined (e.g. /cue/X/start)
  if (value === null || value === undefined) {
    return Buffer.concat([oscString(address), oscString(",")]);
  }
  // Multi-arg form: array of numbers / strings (e.g. RGBA color = 4 floats)
  if (Array.isArray(value)) {
    let typeTags = ",";
    const parts = [];
    for (const v of value) {
      if (typeof v === "number") { typeTags += "f"; parts.push(oscFloat(v)); }
      else if (typeof v === "string") { typeTags += "s"; parts.push(oscString(v)); }
      else throw new Error(`Unsupported array element type: ${typeof v}`);
    }
    return Buffer.concat([oscString(address), oscString(typeTags), ...parts]);
  }
  if (typeof value === "number") {
    return Buffer.concat([oscString(address), oscString(",f"), oscFloat(value)]);
  } else if (typeof value === "string") {
    return Buffer.concat([oscString(address), oscString(",s"), oscString(value)]);
  } else {
    throw new Error(`Unsupported value type: ${typeof value}`);
  }
}

// Build an OSC message with no arguments (used for QLab queries)
function buildOscQuery(address) {
  return Buffer.concat([oscString(address), oscString(",")]);
}

// =============================================================================
// OSC helpers — parse inbound replies from QLab
// =============================================================================
function parseOscMessage(buf) {
  let offset = 0;

  // Parse address (null-terminated, padded to 4-byte boundary)
  let end = buf.indexOf(0, offset);
  if (end === -1) end = buf.length;
  const address = buf.toString("utf8", offset, end);
  offset = end + 1;
  offset = Math.ceil(offset / 4) * 4;

  // Parse type tag
  if (offset >= buf.length) return { address, args: [] };
  end = buf.indexOf(0, offset);
  if (end === -1) end = buf.length;
  const typeTag = buf.toString("utf8", offset, end);
  offset = end + 1;
  offset = Math.ceil(offset / 4) * 4;

  // Parse arguments based on type tag
  const args = [];
  for (let i = 1; i < typeTag.length; i++) {
    switch (typeTag[i]) {
      case "f":
        if (offset + 4 <= buf.length) {
          args.push(buf.readFloatBE(offset));
          offset += 4;
        }
        break;
      case "i":
        if (offset + 4 <= buf.length) {
          args.push(buf.readInt32BE(offset));
          offset += 4;
        }
        break;
      case "s":
        end = buf.indexOf(0, offset);
        if (end === -1) end = buf.length;
        args.push(buf.toString("utf8", offset, end));
        offset = end + 1;
        offset = Math.ceil(offset / 4) * 4;
        break;
    }
  }

  return { address, args };
}

// =============================================================================
// SLIP encoding/decoding (QLab uses SLIP-framed OSC over TCP)
// =============================================================================
const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;
const SLIP_ESC_END = 0xdc;
const SLIP_ESC_ESC = 0xdd;

function slipEncode(data) {
  const encoded = [SLIP_END];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === SLIP_END) {
      encoded.push(SLIP_ESC, SLIP_ESC_END);
    } else if (data[i] === SLIP_ESC) {
      encoded.push(SLIP_ESC, SLIP_ESC_ESC);
    } else {
      encoded.push(data[i]);
    }
  }
  encoded.push(SLIP_END);
  return Buffer.from(encoded);
}

function slipDecode(data) {
  const messages = [];
  let current = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i] === SLIP_END) {
      if (current.length > 0) {
        messages.push(Buffer.from(current));
        current = [];
      }
    } else if (data[i] === SLIP_ESC) {
      i++;
      if (i < data.length) {
        if (data[i] === SLIP_ESC_END) {
          current.push(SLIP_END);
        } else if (data[i] === SLIP_ESC_ESC) {
          current.push(SLIP_ESC);
        }
      }
    } else {
      current.push(data[i]);
    }
  }

  return messages;
}

// =============================================================================
// TCP connection to QLab (for queries that need replies)
// =============================================================================
let tcpSocket = null;
let tcpConnected = false;
let tcpBuffer = Buffer.alloc(0);
let tcpReconnectTimer = null;

function connectTcp() {
  if (tcpSocket) {
    tcpSocket.destroy();
    tcpSocket = null;
  }

  tcpConnected = false;
  console.log(`[BRIDGE TCP] Connecting to QLab at ${QLAB_HOST}:${QLAB_PORT}...`);

  tcpSocket = new net.Socket();
  tcpSocket.connect(QLAB_PORT, QLAB_HOST, () => {
    tcpConnected = true;
    tcpBuffer = Buffer.alloc(0);
    console.log(`[BRIDGE TCP] Connected to QLab`);

    // Send /connect handshake
    const connectMsg = buildOscQuery("/connect");
    tcpSocket.write(slipEncode(connectMsg));
    console.log(`[BRIDGE TCP] Sent /connect`);
  });

  tcpSocket.on("data", (data) => {
    console.log(`[BRIDGE TCP] Received ${data.length} bytes from QLab`);
    // Accumulate data and decode SLIP frames
    tcpBuffer = Buffer.concat([tcpBuffer, data]);
    const messages = slipDecode(tcpBuffer);
    console.log(`[BRIDGE TCP] Decoded ${messages.length} SLIP messages`);

    // Keep any incomplete trailing data
    const lastEnd = tcpBuffer.lastIndexOf(SLIP_END);
    if (lastEnd >= 0 && lastEnd < tcpBuffer.length - 1) {
      tcpBuffer = tcpBuffer.slice(lastEnd + 1);
    } else {
      tcpBuffer = Buffer.alloc(0);
    }

    for (const msg of messages) {
      try {
        const parsed = parseOscMessage(msg);
        handleQLabReply(parsed);
      } catch (err) {
        console.error(`[BRIDGE TCP] Parse error:`, err.message);
      }
    }
  });

  tcpSocket.on("error", (err) => {
    console.error(`[BRIDGE TCP] Error: ${err.message}`);
  });

  tcpSocket.on("close", () => {
    tcpConnected = false;
    console.log(`[BRIDGE TCP] Connection closed`);
    // Auto-reconnect if we have active polls
    if (Object.keys(activePolls).length > 0) {
      scheduleTcpReconnect();
    }
  });
}

function scheduleTcpReconnect() {
  if (tcpReconnectTimer) return;
  tcpReconnectTimer = setTimeout(() => {
    tcpReconnectTimer = null;
    if (Object.keys(activePolls).length > 0 && !tcpConnected) {
      connectTcp();
    }
  }, 2000);
}

function sendTcpQuery(address) {
  if (!tcpSocket || !tcpConnected) {
    console.log(`[BRIDGE TCP] Cannot send query, not connected (socket: ${!!tcpSocket}, connected: ${tcpConnected})`);
    return;
  }
  console.log(`[BRIDGE TCP] Querying: ${address}`);
  const msg = buildOscQuery(address);
  tcpSocket.write(slipEncode(msg));
}

// =============================================================================
// Handle QLab replies (from TCP)
// =============================================================================
function handleQLabReply(parsed) {
  // QLab replies have addresses like /reply/cue/ANTHEMS/actionElapsed
  if (!parsed.address.startsWith("/reply/")) {
    console.log(`[BRIDGE TCP] QLab: ${parsed.address}`, parsed.args);
    return;
  }

  // Find which team this reply belongs to
  let matchedTeamId = null;
  for (const [teamId, poll] of Object.entries(activePolls)) {
    if (parsed.address.includes(`/cue/${poll.cueName}/`)) {
      matchedTeamId = teamId;
      break;
    }
  }

  if (!matchedTeamId) {
    console.log(`[BRIDGE TCP] Reply not matched to any team: ${parsed.address}`, parsed.args);
    return;
  }

  console.log(`[BRIDGE TCP] Matched reply for ${matchedTeamId}: ${parsed.address}`, parsed.args);

  // QLab sends the reply data as a JSON string argument or as a float
  let elapsed = null;

  if (parsed.args.length > 0) {
    const firstArg = parsed.args[0];

    if (typeof firstArg === "number") {
      elapsed = firstArg;
    } else if (typeof firstArg === "string") {
      // JSON string from QLab: {"data": 5.123, "status": "ok"}
      try {
        const json = JSON.parse(firstArg);
        if (json.status === "ok" && typeof json.data === "number") {
          elapsed = json.data;
        }
      } catch (e) {
        const num = parseFloat(firstArg);
        if (!isNaN(num)) elapsed = num;
      }
    }
  }

  if (elapsed !== null && elapsed >= 0) {
    console.log(`[BRIDGE TCP] Forwarding actionElapsed=${elapsed.toFixed(2)}s for ${matchedTeamId}`);
    forwardPlaybackData(matchedTeamId, elapsed);
  } else {
    console.log(`[BRIDGE TCP] Could not extract elapsed time from reply`, parsed.args);
  }
}

// =============================================================================
// QLab playback polling system
// =============================================================================
const activePolls = {};

function startPoll(teamId, cueName) {
  stopPoll(teamId);

  console.log(`[BRIDGE] Starting playback poll for ${teamId} (cue: ${cueName}) every ${POLL_INTERVAL_MS}ms`);

  // Ensure TCP connection to QLab (only if not already connected/connecting)
  if (!tcpConnected && !tcpSocket) {
    connectTcp();
  }

  const handle = setInterval(() => {
    sendTcpQuery(`/cue/${cueName}/actionElapsed`);
  }, POLL_INTERVAL_MS);

  activePolls[teamId] = { cueName, intervalHandle: handle };
}

function stopPoll(teamId) {
  if (activePolls[teamId]) {
    clearInterval(activePolls[teamId].intervalHandle);
    console.log(`[BRIDGE] Stopped playback poll for ${teamId}`);
    delete activePolls[teamId];
  }

  // Close TCP after a delay if no polls restart (avoids thrashing on rapid start/stop)
  if (Object.keys(activePolls).length === 0) {
    setTimeout(() => {
      if (Object.keys(activePolls).length === 0 && tcpSocket && tcpConnected) {
        console.log(`[BRIDGE TCP] No active polls, closing TCP connection`);
        tcpSocket.destroy();
        tcpSocket = null;
        tcpConnected = false;
      }
    }, 5000);
  }
}

// Forward playback data to the main chart-toppers server
function forwardPlaybackData(teamId, actionElapsed) {
  const payload = JSON.stringify({ teamId, actionElapsed });
  const callbackUrl = new URL("/api/qlab-playback", CALLBACK_URL);

  const options = {
    hostname: callbackUrl.hostname,
    port: callbackUrl.port,
    path: callbackUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
    res.on("data", () => {});
    res.on("end", () => {});
  });

  req.on("error", (err) => {
    console.error(`[BRIDGE] Callback error: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// =============================================================================
// HTTP server — handles /send (existing) + /poll/start and /poll/stop (new)
// =============================================================================
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Existing: send a single OSC message to QLab (fire-and-forget via UDP)
  if (req.method === "POST" && parsed.pathname === "/send") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { address, value } = JSON.parse(body);
        const msg = buildOscMessage(address, value);
        udpSocket.send(msg, 0, msg.length, QLAB_PORT, QLAB_HOST, (err) => {
          if (err) {
            console.error(`[BRIDGE] UDP send error:`, err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          } else {
            console.log(`[BRIDGE] OSC → ${QLAB_HOST}:${QLAB_PORT} ${address} = ${value}`);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          }
        });
      } catch (e) {
        console.error(`[BRIDGE] Parse error:`, e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Start polling QLab for a cue's playback position (via TCP)
  if (req.method === "POST" && parsed.pathname === "/poll/start") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { teamId, cueName } = JSON.parse(body);
        if (!teamId || !cueName) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "teamId and cueName required" }));
          return;
        }
        startPoll(teamId, cueName);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, polling: teamId }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Stop polling for a team
  if (req.method === "POST" && parsed.pathname === "/poll/stop") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { teamId } = JSON.parse(body);
        if (!teamId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "teamId required" }));
          return;
        }
        stopPoll(teamId);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, stopped: teamId }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  res.writeHead(200);
  res.end("OSC Bridge running (UDP send + TCP query)");
});

server.listen(BRIDGE_PORT, "0.0.0.0", () => {
  console.log(`[BRIDGE] HTTP → OSC bridge listening on port ${BRIDGE_PORT}`);
  console.log(`[BRIDGE] UDP sends → ${QLAB_HOST}:${QLAB_PORT}`);
  console.log(`[BRIDGE] TCP queries → ${QLAB_HOST}:${QLAB_PORT} (on demand)`);
  console.log(`[BRIDGE] Playback callbacks → ${CALLBACK_URL}`);
});
