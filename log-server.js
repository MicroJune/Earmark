#!/usr/bin/env node
// Simple log receiver — run this on the laptop, then tap "Send to Laptop" in the app.
// Requires:  adb reverse tcp:8765 tcp:8765
const http = require('http');

const PORT = 8765;
const RESET = '\x1b[0m';
const COLORS = { DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/logs') {
    res.writeHead(404); res.end(); return;
  }
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    const lines = body.split('\n');
    console.log('\n\x1b[1m─── Logs from phone (' + new Date().toLocaleTimeString() + ') ───\x1b[0m');
    lines.forEach(line => {
      const m = line.match(/^\[[\d:.]+\]\[(DEBUG|INFO|WARN|ERROR)\]/);
      const color = m ? (COLORS[m[1]] ?? RESET) : RESET;
      console.log(color + line + RESET);
    });
    console.log('\x1b[1m─────────────────────────────────────────\x1b[0m');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m✓ Log server listening on :${PORT}\x1b[0m`);
  console.log(`  Make sure ADB reverse is set up:`);
  console.log(`  \x1b[90madb reverse tcp:${PORT} tcp:${PORT}\x1b[0m\n`);
});
