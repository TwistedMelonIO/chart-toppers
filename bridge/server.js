const http = require("http");
const dgram = require("dgram");
const url = require("url");

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT) || 3001;
const QLAB_HOST = process.env.QLAB_HOST || "127.0.0.1";
const QLAB_PORT = parseInt(process.env.QLAB_PORT) || 53000;

const udpSocket = dgram.createSocket("udp4");

// OSC helpers
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
  // Check if value is a number (float) or string
  if (typeof value === 'number') {
    return Buffer.concat([oscString(address), oscString(",f"), oscFloat(value)]);
  } else if (typeof value === 'string') {
    return Buffer.concat([oscString(address), oscString(",s"), oscString(value)]);
  } else {
    throw new Error(`Unsupported value type: ${typeof value}`);
  }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

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
  } else {
    res.writeHead(200);
    res.end("OSC Bridge running");
  }
});

server.listen(BRIDGE_PORT, "0.0.0.0", () => {
  console.log(`[BRIDGE] HTTP → OSC bridge listening on port ${BRIDGE_PORT}`);
  console.log(`[BRIDGE] Will send UDP to ${QLAB_HOST}:${QLAB_PORT}`);
});
