// ─────────────────────────────────────────────────────────────
//  Iron Hand WebSocket Relay  —  node server.js
//
//  Also serves tracker & remote over HTTP on port 8765
//  so there's no mixed-content (https → ws://) issue.
//
//  Open on PC:     http://YOUR_IP:8765/
//  Open on phone:  http://YOUR_IP:8765/remote.html
// ─────────────────────────────────────────────────────────────
const { WebSocketServer } = require('ws');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const PORT = 8765;

// ── Find local IPs ────────────────────────────────────────────
function getLocalIPs(){
  const ifaces = os.networkInterfaces();
  return Object.values(ifaces).flat()
    .filter(i => i.family==='IPv4' && !i.internal)
    .map(i => i.address);
}

// ── Resolve file paths (server.js sits next to tracker/remote) ─
// Looks for index.html / remote.html in same dir, then parent dir
function findFile(name){
  const here = path.join(__dirname, name);
  if(fs.existsSync(here)) return here;
  const up = path.join(__dirname, '..', name);
  if(fs.existsSync(up)) return up;
  return null;
}

const MIME = {
  '.html':'text/html', '.js':'application/javascript',
  '.css':'text/css',   '.json':'application/json',
  '.png':'image/png',  '.ico':'image/x-icon'
};

// ── HTTP server — serves tracker + remote files ───────────────
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');

  // Health check / info
  if(req.url === '/status'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok:true, clients:wss.clients.size}));
  }

  // Map URLs to files
  let filePath;
  const url = req.url.split('?')[0];
  if(url==='/' || url==='/index.html'){
    filePath = findFile('index.html') || findFile('tracker.html');
  } else {
    filePath = findFile(url.slice(1)); // strip leading /
  }

  if(!filePath){
    res.writeHead(404); return res.end('Not found: ' + url);
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';
  res.writeHead(200,{'Content-Type': mime});
  fs.createReadStream(filePath).pipe(res);
});

// ── WebSocket server ──────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const ip = req.socket.remoteAddress;
  clients.set(ws, { role:'unknown', id, ip });
  console.log(`[+] #${id} connected from ${ip}  (total: ${wss.clients.size})`);

  ws.on('message', raw => {
    let msg; try{ msg=JSON.parse(raw); }catch{ return; }
    const client = clients.get(ws);

    if(msg.type==='hello'){
      client.role = msg.role;
      console.log(`    #${id} → ${msg.role}`);
      ws.send(JSON.stringify({type:'welcome', id, role:msg.role}));
      if(msg.role==='remote') broadcast({type:'remote_connected'}, 'tracker');
      return;
    }

    // tracker → remotes, remote → tracker
    const target = client.role==='tracker' ? 'remote' : 'tracker';
    broadcast(msg, target);
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    console.log(`[-] #${c?.id} (${c?.role}) left  (total: ${wss.clients.size-1})`);
    clients.delete(ws);
  });

  ws.on('error', e => console.error(`[!] #${clients.get(ws)?.id}:`, e.message));
});

function broadcast(msg, role){
  const data = JSON.stringify(msg);
  for(const [ws, info] of clients)
    if(ws.readyState===1 && info.role===role) ws.send(data);
}

// ── Start ─────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  const ip  = ips[0] || 'YOUR_IP';
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║        Iron Hand Relay + File Server  🖐          ║');
  console.log('╠══════════════════════════════════════════════════╣');
  ips.forEach(i => {
    console.log(`║  PC (tracker)   →  http://${i}:${PORT}/`);
    console.log(`║  Phone (remote) →  http://${i}:${PORT}/remote.html`);
    console.log(`║  WebSocket      →  ws://${i}:${PORT}`);
    console.log('║');
  });
  console.log('║  1. Open tracker URL on your PC browser          ║');
  console.log('║  2. Open remote URL on your phone browser        ║');
  console.log('║  3. Enter  ' + ip + '  in the remote IP box    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log('Waiting for connections…\n');
});
