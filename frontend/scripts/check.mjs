// Syntax check of the connector scripts and a check that index.html loads all of them.
import { readFileSync, existsSync } from 'fs';
const files = ['medilink-live.js', 'medilink-owner.js', 'medilink-sync.js', 'vendor/qrcode.js', 'vendor/jsQR.js', 'medilink-device.js', 'medilink-stitch.js', 'medilink-layout.js'];
const html = readFileSync('www/index.html', 'utf8');
for (const f of files) {
  if (!existsSync('www/' + f)) throw new Error('Missing www/' + f);
  new Function(readFileSync('www/' + f, 'utf8'));
  if (!html.includes(`<script src="${f}"></script>`)) throw new Error('index.html does not load ' + f);
  console.log(f + ' OK');
}
