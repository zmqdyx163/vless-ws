// VLESS over WebSocket proxy (blitz.cloud build of the Layero template).
// Public: GET / (launch probe), GET /generate_204 (acceptance check).
// VLESS-WS on path /vless. The UUID in the VLESS header is the auth.
// Listens on 0.0.0.0:$PORT (platform sets $PORT). Uses the `ws` package.
// The /flclash.yaml subscription derives the hostname from the request Host
// header, so it stays correct no matter what domain the platform assigns.
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const WS_PATH = process.env.VLESS_PATH || '/vless';
const UUID = process.env.VLESS_UUID || '9b0a5ec6-1d06-4099-8eae-8dc9ae947d4d';
const UUID_BYTES = Buffer.from(UUID.replace(/-/g, ''), 'hex');
const NODE_NAME = '欧洲-德国';

function flclashYaml(host) {
  return `proxies:
  - name: ${NODE_NAME}
    type: vless
    server: ${host}
    port: 443
    uuid: ${UUID}
    tls: true
    servername: ${host}
    network: ws
    ws-opts:
      path: /vless
      headers:
        Host: ${host}
`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('layero-proxy ok\n');
    return;
  }
  if (req.url === '/generate_204') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/flclash.yaml') {
    const host = (req.headers.host || '').split(':')[0] || 'localhost';
    res.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' });
    res.end(flclashYaml(host));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws) => {
  let target = null;
  let headerParsed = false;
  let closed = false;

  const closeAll = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch (e) {}
    if (target) { try { target.destroy(); } catch (e) {} }
  };

  ws.on('message', (data) => {
    if (closed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!headerParsed) {
      headerParsed = true;
      try {
        if (buf.length < 18) throw new Error('header too short');
        const uuid = buf.subarray(1, 17);
        if (!uuid.equals(UUID_BYTES)) throw new Error('bad uuid');
        const addonLen = buf[17];
        let off = 18 + addonLen;
        if (buf.length < off + 4) throw new Error('header truncated');
        const cmd = buf[off];
        const port = buf.readUInt16BE(off + 1);
        const atyp = buf[off + 3];
        off += 4;
        let addr;
        if (atyp === 0x01) {
          if (buf.length < off + 4) throw new Error('ipv4 truncated');
          addr = Array.from(buf.subarray(off, off + 4)).join('.');
          off += 4;
        } else if (atyp === 0x02) {
          const len = buf[off];
          off += 1;
          if (buf.length < off + len) throw new Error('domain truncated');
          addr = buf.subarray(off, off + len).toString();
          off += len;
        } else if (atyp === 0x03) {
          if (buf.length < off + 16) throw new Error('ipv6 truncated');
          const parts = [];
          for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(off + i).toString(16));
          addr = parts.join(':');
          off += 16;
        } else {
          throw new Error('bad atyp');
        }
        if (cmd !== 0x01) throw new Error('only TCP supported');
        const initial = buf.subarray(off);
        target = net.connect(port, addr, () => {
          ws.send(Buffer.from([0x00, 0x00]));
          if (initial.length) target.write(initial);
        });
        target.on('data', (chunk) => {
          if (!closed && ws.readyState === ws.OPEN) ws.send(chunk);
        });
        target.on('error', () => closeAll());
        target.on('close', () => closeAll());
      } catch (e) {
        closeAll();
      }
      return;
    }
    if (target && !target.destroyed) target.write(buf);
  });

  ws.on('close', closeAll);
  ws.on('error', closeAll);
});

server.listen(PORT, HOST, () => {
  console.log(`blitz-proxy (vless-ws) listening on ${HOST}:${PORT} path ${WS_PATH}`);
});
