// "Attack your own app": tries common attacks against a running MediLink API. Every check must be blocked.
// Usage: node scripts/security-test.mjs [http://localhost:4000/api]
const API = process.argv[2] || 'http://localhost:4000/api';
const PW = 'MediLink@2026';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function call(method, path, body, token, raw) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return raw ? { status: r.status, data, text, headers: r.headers } : { status: r.status, data, text };
}
async function login(email, password = PW) {
  const a = await call('POST', '/auth/login', { email, password });
  if (a.data?.needsPin) return (await call('POST', '/auth/pin', { pinToken: a.data.pinToken, pin: '1234' })).data;
  return a.data;
}
async function newPatient(tag) {
  const r = await call('POST', '/auth/signup', { email: `${tag}${Date.now()}@sec.test`, password: 'Secret123', pin: '1234', name: 'Sec ' + tag });
  return r.data;
}

console.log('MediLink security test →', API);
console.log('\n1-2. Secrets and headers');
const h = await call('GET', '/health', null, null, true);
ok(!h.headers.get('x-powered-by'), 'no X-Powered-By header');
ok(h.headers.get('x-content-type-options') === 'nosniff' && !!h.headers.get('strict-transport-security'), 'security headers (nosniff, HSTS) present');

console.log('\n10. Unauthenticated routes are blocked');
for (const p of ['/me/profile', '/me/drive', '/doctor/queue', '/reception/board', '/diagnostics/worklist', '/admin/overview', '/admin/audit', '/platform/overview'])
  ok((await call('GET', p)).status === 401, `GET ${p} without login → 401`);

console.log('\n17. Session tampering');
const pa = await newPatient('a');
const forged = pa.token.slice(0, -4) + (pa.token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
ok((await call('GET', '/me/profile', null, forged)).status === 401, 'forged / altered token rejected');
ok((await call('GET', '/me/profile', null, 'eyJhbGciOiJub25lIn0.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.')).status === 401, 'unsigned "alg:none" token rejected');

console.log('\n5. Admin and role routes are locked');
ok((await call('GET', '/admin/overview', null, pa.token)).status === 403, 'patient cannot open admin panel');
ok((await call('GET', '/doctor/queue', null, pa.token)).status === 403, 'patient cannot open doctor queue');
ok((await call('GET', '/platform/overview', null, pa.token)).status === 403, 'patient cannot open owner console');
const admin = await login('admin.kokilaben@gmail.com');
ok((await call('GET', '/platform/hospitals', null, admin.token)).status === 403, 'hospital admin cannot open owner console');

console.log('\n13. Field tampering (mass assignment)');
await call('PUT', '/me/profile', { fullName: 'Sec a', role: 'admin', user_id: 1, medilink_id: 'ML-000001', hospital_id: 1 }, pa.token);
const me = await call('GET', '/auth/me', null, pa.token);
const prof = await call('GET', '/me/profile', null, pa.token);
ok(me.data.user.role === 'patient' && prof.data.medilink_id !== 'ML-000001', 'extra fields (role, IDs) ignored');

console.log('\n3, 6, 19. IDOR and user isolation');
const pb = await newPatient('b');
const vb = await call('POST', '/me/visits', { hospitalId: 1, symptoms: 'fever and cough' }, pb.token);
ok(vb.status === 201, '(setup) patient B books a visit');
ok((await call('GET', `/me/visits/${vb.data.visit.id}`, null, pa.token)).status === 404, "patient A cannot read patient B's visit");
ok((await call('POST', `/me/visits/${vb.data.visit.id}/cancel`, {}, pa.token)).status === 400, "patient A cannot cancel patient B's visit");
const rohanDrive = await call('GET', '/me/drive', null, (await login('rohan@demo.in')).token);
const someVersion = rohanDrive.data.documents?.[0]?.versions?.[0]?.id || 1;
ok((await call('GET', `/me/files/${someVersion}`, null, pa.token)).status === 404, "patient A cannot download another patient's file");

console.log('\n6. Hospital (tenant) isolation');
const recL = await login('reception.lilavati@gmail.com');
ok((await call('POST', `/reception/visits/${vb.data.visit.id}/approve`, {}, recL.token)).status === 404, "Lilavati reception cannot touch a Kokilaben visit");
const admL = await login('admin.lilavati@gmail.com');
ok((await call('POST', `/admin/patients/${pb.user.id}/record`, { reason: 'Quality audit' }, admL.token)).status === 403, "Lilavati admin cannot open a Kokilaben-only patient");
const radK = await login('radiology.kokilaben@gmail.com');
ok((await call('GET', '/reception/board', null, radK.token)).status === 403, 'radiology desk cannot open reception');

console.log('\n11. SQL injection');
const inj = await call('GET', `/hospitals?q=${encodeURIComponent("' OR 1=1 --")}`);
ok(Array.isArray(inj.data) && inj.data.length === 0, 'search injection returns nothing');
ok((await call('POST', '/auth/login', { email: "' OR '1'='1", password: "' OR '1'='1" })).status === 401, 'login injection rejected');
ok((await call('GET', "/hospitals/1;DROP TABLE users")).status === 400, 'non-numeric id rejected');

console.log('\n9, 14. Input validation and file uploads');
ok((await call('POST', '/auth/signup', { email: 'not-an-email', password: 'x', pin: 'abcd', name: '' })).status === 400, 'bad sign-up input rejected');
ok((await call('POST', '/me/visits', { hospitalId: 'abc', symptoms: 'x' }, pa.token)).status === 400, 'bad visit input rejected');
const big = 'x'.repeat(30 * 1024 * 1024);
ok([400, 413].includes((await call('POST', '/auth/login', { email: big, password: 'x' })).status), 'oversized body rejected');

console.log('\n12, 16. No sensitive data in responses');
const people = await call('GET', '/admin/people', null, admin.token);
ok(!people.text.includes('password_hash') && !people.text.includes('pin_hash') && !people.text.includes('$2a$'), 'no password or PIN hashes in API responses');
const bad = await call('GET', '/hospitals/999999999999');
ok(!/at \w+ \(|node_modules|SELECT /i.test(bad.text), 'errors do not leak stack traces or SQL');

console.log('\n15. Server-side rules hold');
const doc = await login('dra.kokilaben@gmail.com');
ok((await call('GET', `/me/files/${someVersion}`, null, doc.token)).status === 404, 'doctor cannot download a patient file');
ok((await call('POST', '/doctor/scan', { code: 'ML-P.' + pb.user.id + '.1.forged' }, doc.token)).status === 400 || (await call('POST', '/doctor/scan', { code: 'ML-P.' + pb.user.id + '.1.forged' }, doc.token)).status === 403, 'forged patient QR rejected');

console.log('\n7. Rate limiting');
let limited = false;
for (let i = 0; i < 100 && !limited; i++) if ((await call('POST', '/auth/login', { email: 'brute@force.test', password: 'guess' + i })).status === 429) limited = true;
ok(limited, 'repeated login attempts are rate limited (429)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
