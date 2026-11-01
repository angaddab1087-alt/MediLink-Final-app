// Copies the app (www/) into dist/, which is what the web server and the Android app use.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('www', 'dist', { recursive: true });
// Optional: bake a default server address into the build, e.g. API_URL=https://my-server/api npm run build
if (process.env.API_URL) {
  const f = 'dist/index.html';
  writeFileSync(f, readFileSync(f, 'utf8').replace('<script src="medilink-live.js"></script>', `<script>window.MEDILINK_API_URL=${JSON.stringify(process.env.API_URL)};</script>\n  <script src="medilink-live.js"></script>`));
}
// Sync to Android public assets directly for immediate APK compilation
const androidAssets = 'android/app/src/main/assets';
if (existsSync(androidAssets)) {
  const androidPublic = 'android/app/src/main/assets/public';
  rmSync(androidPublic, { recursive: true, force: true });
  mkdirSync(androidPublic, { recursive: true });
  cpSync('dist', androidPublic, { recursive: true });
  console.log('Synced web bundle to Android assets: ' + androidPublic);
}
console.log('Built dist/' + (process.env.API_URL ? ` (server ${process.env.API_URL})` : ''));
