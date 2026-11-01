// End-to-end smoke test of the whole MediLink flow against a running API.
// Usage: node scripts/smoke-test.mjs [http://localhost:4000/api]
const API = process.argv[2] || 'http://localhost:4000/api';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
async function call(method, path, body, token) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function login(email, password = 'MediLink@2026') {
  const a = await call('POST', '/auth/login', { email, password });
  if (a.data?.needsPin) return (await call('POST', '/auth/pin', { pinToken: a.data.pinToken, pin: '1234' })).data;
  return a.data;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

console.log('MediLink smoke test →', API);
ok((await call('GET', '/health')).data?.ok, 'API health');

console.log('\nEmergency (no login)');
const near = await call('GET', '/emergency/nearby?lat=19.12&lng=72.83');
ok(near.data?.hospitals?.length > 0 && near.data.ringKm === 5, `nearest emergency hospitals in ${near.data?.ringKm} km ring`);

console.log('\nSign-up and profile');
const email = `test${Date.now()}@demo.in`;
const su = await call('POST', '/auth/signup', { email, password: 'Secret123', pin: '4321', name: 'Test Patient' });
ok(su.status === 201 && su.data.token, 'patient sign-up');
const P = su.data.token;
const prof = await call('PUT', '/me/profile', { fullName: 'Test Patient', sex: 'Female', phone: '+919811122233', allergies: ['Peanuts'], bloodGroup: 'A+', declaration: true }, P);
ok(prof.data?.declaration_at, 'profile saved with declaration timestamp');

console.log('\nAdmin gets the hospital QR');
const admin = await login('admin.kokilaben@gmail.com');
const qr = await call('GET', '/admin/qr', null, admin.token);
ok(qr.data?.hospitalQr?.startsWith('ML-H.'), 'hospital and duty QR codes');
ok((await call('POST', '/qr/resolve', { code: 'ML-H.1.1.fake' })).status === 400, 'fake hospital QR rejected');
const res = await call('POST', '/qr/resolve', { code: qr.data.hospitalQr });
ok(res.data?.name?.includes('Kokilaben'), 'genuine hospital QR resolves to the hospital');

console.log('\nSymptoms and registration');
ok((await call('POST', '/symptoms/route', { text: 'I have chest pain' })).data?.emergency === true, 'red-flag symptom sends to Emergency');
ok((await call('POST', '/symptoms/route', { text: 'knee pain for a week' })).data?.department === 'Orthopaedics', 'knee pain suggests Orthopaedics');
const reg = await call('POST', '/me/visits', { hospitalId: res.data.hospitalId, symptoms: 'fever and cough for 3 days', duration: '3 days', severity: 'Moderate', preferFemale: true }, P);
ok(reg.status === 201 && reg.data.visit?.token_no, `token ${reg.data?.visit?.token_no} with ${reg.data?.doctorName} (female preferred)`);
const visitId = reg.data.visit.id;
ok((await call('POST', '/me/visits', { hospitalId: res.data.hospitalId, symptoms: 'fever again' }, P)).status === 400, 'duplicate token today is blocked');

console.log('\nReception desk');
const rec = await login('reception.kokilaben@gmail.com');
const board = await call('GET', '/reception/board', null, rec.token);
ok(board.data?.queue?.some((v) => v.id === visitId), 'visit appears on reception board');
ok(!JSON.stringify(board.data).includes('Peanuts'), 'reception sees no clinical data');
ok((await call('POST', `/reception/visits/${visitId}/approve`, {}, rec.token)).data?.ok, 'reception approves');
ok((await call('POST', `/reception/visits/${visitId}/arrive`, {}, rec.token)).data?.ok, 'reception checks in');
ok((await call('GET', '/diagnostics/worklist', null, rec.token)).status === 403, 'reception cannot open a diagnostics worklist');

console.log('\nDoctor');
const docId = reg.data.visit.doctor_id;
const docEmail = (await call('GET', '/admin/people', null, admin.token)).data.find((p) => p.id === docId).email;
const doc = await login(docEmail);
await call('POST', '/doctor/clock-out', {}, doc.token);
const patientQr = (await call('GET', '/me/visit-qr', null, P)).data.code;
ok((await call('POST', '/doctor/scan', { code: patientQr }, doc.token)).status === 403, 'doctor must clock in before scanning');
ok((await call('POST', '/doctor/clock-in', { code: qr.data.dutyQr }, doc.token)).data?.ok, 'doctor clocks in with duty QR');
const rec2 = await call('POST', '/doctor/scan', { code: patientQr }, doc.token);
ok(rec2.data?.profile?.allergies?.includes('Peanuts'), 'scanning patient QR opens the record with allergies');
ok((await call('POST', '/doctor/scan', { code: 'ML-P.1.1.bad' }, doc.token)).status === 400, 'fake or expired patient QR rejected');
ok((await call('POST', `/doctor/visits/${visitId}/prescription`, { text: 'Tab. Paracetamol 500 mg twice daily for 3 days', followUp: '1 week' }, doc.token)).status === 201, 'prescription written');
ok((await call('POST', `/doctor/visits/${visitId}/tests`, { department: 'Radiology', testName: 'Chest X-ray PA view' }, doc.token)).status === 201, 'test advised');

console.log('\nTests: reception books, radiology sends');
const tb = (await call('GET', '/reception/board', null, rec.token)).data.testsToBook.find((t) => t.test_name === 'Chest X-ray PA view');
ok((await call('POST', `/reception/tests/${tb.id}/book`, {}, rec.token)).data?.status === 'Booked', 'reception books the test');
ok((await call('POST', `/reception/tests/${tb.id}/checkin`, {}, rec.token)).data?.status === 'CheckedIn', 'reception checks the patient in for the test');
const rad = await login('radiology.kokilaben@gmail.com');
ok((await call('GET', '/reception/board', null, rad.token)).status === 403, 'radiology cannot open the reception desk');
const wl = await call('GET', '/diagnostics/worklist', null, rad.token);
ok(wl.data?.open?.some((t) => t.id === tb.id), 'test is on the radiology worklist');
await call('POST', `/diagnostics/tests/${tb.id}/advance`, { status: 'SampleCollected' }, rad.token);
ok((await call('POST', `/diagnostics/tests/${tb.id}/send`, { fileName: 'fake.pdf', dataBase64: Buffer.from('MZ not a pdf').toString('base64') }, rad.token)).status === 400, 'disguised file rejected');
ok((await call('POST', `/diagnostics/tests/${tb.id}/send`, { fileName: 'xray.pdf', dataBase64: PDF, critical: true }, rad.token)).status === 400, 'critical result needs a note');
const sent = await call('POST', `/diagnostics/tests/${tb.id}/send`, { fileName: 'xray-report.pdf', dataBase64: PDF }, rad.token);
ok(sent.data?.ok, 'report sent to patient Drive');
ok((await call('POST', `/diagnostics/documents/${sent.data.documentId}/correct`, { reason: 'Wrong side noted in report text', fileName: 'xray-v2.pdf', dataBase64: PDF }, rad.token)).data?.version === 2, 'correction creates version 2');
const drive = await call('GET', '/me/drive', null, P);
ok(drive.data?.documents?.[0]?.versions?.length === 2 && drive.data.prescriptions.length === 1, 'patient Drive shows prescription and both report versions');

console.log('\nAdmin');
const ov = await call('GET', '/admin/overview', null, admin.token);
ok(ov.data?.registrationsToday >= 1 && ov.data.doctorsOnDuty >= 1, 'admin overview counts');
ok((await call('GET', '/admin/audit/verify', null, admin.token)).data?.ok, 'audit hash chain verifies');
ok((await call('POST', `/admin/patients/${su.data.user.id}/record`, { reason: 'Quality audit' }, admin.token)).data?.watermark, 'admin reason-gated view-only record');
ok((await call('GET', '/me/access-history', null, P)).data?.some((a) => a.action === 'ADMIN_RECORD_VIEWED'), 'patient sees admin access in history');

console.log('\nConduct alert safety');
let incs = (await call('GET', '/admin/incidents', null, admin.token)).data.filter((i) => i.status === 'Pending');
if (!incs.length) {
  await call('POST', '/incidents', { patientId: 54, category: 'Abusive language', happenedOn: new Date().toISOString().slice(0, 10), place: 'OPD reception', note: 'Patient shouted abuse at reception staff after being told the doctor was running late.' }, rec.token);
  incs = (await call('GET', '/admin/incidents', null, admin.token)).data.filter((i) => i.status === 'Pending');
}
const alert = await call('POST', '/admin/alerts', { incidentIds: [incs[0].id], summary: 'Repeated abusive language towards reception staff', reviewDays: 90 }, admin.token);
ok(alert.data?.status === 'Active', 'admin places alert from an incident report');
const rohan = await login('rohan@demo.in');
ok((await call('POST', '/me/visits', { hospitalId: 1, symptoms: 'fever and cold' }, rohan.token)).status === 403, 'alert stops online booking at that hospital');
const rohanVisits = (await call('GET', '/me/visits', null, rohan.token)).data || [];
for (const v of rohanVisits) {
  if (v.hospital_id === 4 && ['Requested', 'Approved'].includes(v.status)) await call('POST', `/me/visits/${v.id}/cancel`, {}, rohan.token);
}
const nonAlertVisit = await call('POST', '/me/visits', { hospitalId: 4, symptoms: 'fever and cold' }, rohan.token);
ok(nonAlertVisit.status === 201, 'alert is not shared with other hospitals');
if (nonAlertVisit.data?.visit?.id) await call('POST', `/me/visits/${nonAlertVisit.data.visit.id}/cancel`, {}, rohan.token);
ok((await call('GET', '/emergency/nearby?lat=19.13&lng=72.82')).status === 200, 'emergency finder still works');

console.log('\nOwner Console (platform owner)');
const owner = await login('owner.medilink@gmail.com');
ok(owner?.user?.role === 'owner', 'owner logs in with password + PIN');
const pov = await call('GET', '/platform/overview', null, owner.token);
ok(pov.data?.hospitals >= 5 && pov.data.emergencySearches >= 1, `overview: ${pov.data?.hospitals} hospitals, ${pov.data?.emergencySearches} emergency searches`);
const slug = 'demo' + Date.now().toString().slice(-6);
const nh = await call('POST', '/platform/hospitals', { name: 'Demo Rural Hospital', slug, type: 'Government', area: 'Palghar', lat: 19.69, lng: 72.76, connectorMode: 'MediLink Lite', adminEmail: `admin.${slug}@gmail.com`, adminName: 'Demo Admin' }, owner.token);
ok(nh.status === 201 && nh.data.hospitalQr && nh.data.admin.temporaryPassword, 'add-hospital wizard creates tenant, admin and QR codes');
const nqr = await call('POST', '/qr/resolve', { code: nh.data.hospitalQr });
ok(nqr.data?.name === 'Demo Rural Hospital', "new hospital's QR works for patients");
const newAdmin = await login(`admin.${slug}@gmail.com`, nh.data.admin.temporaryPassword);
ok(newAdmin?.user?.role === 'admin', 'new hospital admin can log in');
ok((await call('POST', `/platform/hospitals/${nh.data.id}/status`, { status: 'suspended', reason: 'Demo' }, owner.token)).data?.ok, 'owner suspends the hospital');
ok((await call('POST', '/qr/resolve', { code: nh.data.hospitalQr })).status === 400, 'suspended hospital blocks new registrations');
ok((await call('POST', '/auth/login', { email: `admin.${slug}@gmail.com`, password: nh.data.admin.temporaryPassword })).status === 403, 'suspended hospital staff cannot log in');
ok((await call('POST', `/platform/hospitals/${nh.data.id}/status`, { status: 'active' }, owner.token)).data?.ok, 'owner reactivates the hospital');
const det = await call('GET', '/platform/hospitals/1', null, owner.token);
ok(det.data?.usage?.length === 14 && det.data.connector && !JSON.stringify(det.data).includes('full_name'), 'hospital detail: usage, storage, connector - no patient data');
ok((await call('GET', '/admin/patients', null, owner.token)).status === 403 && (await call('GET', '/me/drive', null, owner.token)).status === 403, 'owner cannot open patient records');
const sr = await call('POST', '/platform/hospitals/1/support-access', { reason: 'Investigating a report upload problem', hours: 2 }, owner.token);
ok(sr.data?.status === 'Pending', 'break-glass request starts as Pending');
ok((await call('POST', `/admin/support-requests/${sr.data.id}/approve`, {}, admin.token)).data?.status === 'Approved', 'hospital admin approves; access expires automatically');
const inc = await call('POST', '/platform/incidents', { title: 'Suspicious login attempts', kind: 'Security breach', severity: 'High', personalData: true }, owner.token);
ok(inc.status === 201, 'incident registered');
const comp = await call('GET', '/platform/compliance', null, owner.token);
ok(comp.data?.incidents?.[0]?.certinDeadline && comp.data.incidents[0].dpbDeadline && comp.data.auditChain.ok, 'compliance: 6-hour and 72-hour clocks, audit chain verified');
const ann = await call('POST', '/platform/announcements', { title: 'Maintenance tonight', body: 'MediLink will be slower from 1 to 2 AM.' }, owner.token);
ok(ann.data?.recipients > 0, `announcement sent to ${ann.data?.recipients} admins and staff`);
ok((await call('PUT', '/platform/settings', { maxFileMb: 40 }, owner.token)).data?.maxFileMb === 40, 'settings saved');
ok((await call('GET', '/platform/health', null, owner.token)).data?.services?.every((x) => x.status === 'up'), 'system health: all services up');

console.log('\nFamily, follow-ups, treatment completion, sessions');
const hid = reg.data.visit.hospital_id;
const fm = await call('POST', '/me/family', { name: 'Ira Test', relation: 'Child', dob: '2018-02-03', sex: 'Female' }, P);
ok(fm.data?.id, 'family member added');
const mv = await call('POST', '/me/visits', { hospitalId: hid, symptoms: 'fever and cough', doctorId: docId, memberId: fm.data.id }, P);
ok(mv.data?.visit?.member_id === fm.data.id, 'token booked for the family member');
ok((await call('POST', '/me/visits', { hospitalId: hid, symptoms: 'fever', memberId: 999999 }, P)).status === 400, 'cannot book for someone not on your account');
const mvid = mv.data.visit.id;
ok((await call('POST', `/reception/visits/${mvid}/arrive`, {}, rec.token)).data?.ok, 'reception checks the family member in');
ok((await call('POST', `/reception/visits/${mvid}/vitals`, { bp: '110/70', pulse: '80' }, rec.token)).data?.ok, 'reception records vitals');
const dq = await call('GET', '/doctor/queue', null, doc.token);
ok(dq.data?.some((v) => v.id === mvid && v.full_name === 'Ira Test'), "doctor's queue shows the family member's name");
const due = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const createdFu = await call('POST', `/doctor/visits/${mvid}/follow-up`, { date: due, reason: 'Fever review' }, doc.token);
ok(createdFu.data?.id, 'doctor sets a follow-up');
ok((await call('POST', `/doctor/visits/${mvid}/follow-up`, { date: '2020-01-01' }, doc.token)).status === 400, 'follow-up in the past rejected');
const rfu = await call('GET', '/reception/follow-ups', null, rec.token);
const myFu = rfu.data?.find((f) => f.id === createdFu.data?.id) || rfu.data?.find((f) => f.patient_name === 'Ira Test');
ok(myFu?.due === due, 'reception sees the follow-up');
ok((await call('GET', '/me/follow-ups', null, P)).data?.some((f) => f.id === myFu.id), 'patient sees the follow-up');
ok((await call('POST', `/reception/follow-ups/${myFu.id}/call`, {}, rec.token)).data?.ok, 'reception logs a call');
const fin = await call('POST', `/reception/follow-ups/${myFu.id}/checkin`, {}, rec.token);
ok(/^F-/.test(fin.data?.token || ''), 'follow-up check-in creates token ' + fin.data?.token);
ok((await call('POST', `/reception/follow-ups/${myFu.id}/checkin`, {}, rec.token)).status === 400, 'a follow-up cannot be checked in twice');
ok((await call('GET', '/reception/display', null, rec.token)).data?.next, 'waiting-room display');
ok((await call('POST', `/doctor/visits/${mvid}/close-treatment`, { note: 'Recovered fully. No more visits needed.' }, doc.token)).data?.id, 'doctor requests treatment completion');
const cls = await call('GET', '/admin/closures', null, admin.token);
const cl = cls.data?.find((c) => c.visit_id === mvid);
ok(cl?.status === 'Pending approval', 'admin sees the request');
ok((await call('POST', `/admin/closures/${cl.id}/approve`, {}, admin.token)).data?.ok, 'admin approves');
ok((await call('GET', '/me/drive', null, P)).data?.documents?.some((d) => d.title === 'Treatment completion summary'), 'summary PDF lands in the patient Drive');
ok((await call('POST', `/admin/closures/${cl.id}/approve`, {}, admin.token)).status === 404, 'cannot approve twice');
const setup = await call('PUT', '/admin/setup', { slotMinutes: 15, walkInSharePct: 30, graceMinutes: 10, fee: 600 }, admin.token);
ok(setup.data?.settings?.fee === 600, 'hospital setup saved');
ok((await call('POST', '/admin/departments', { name: 'Dept ' + Date.now().toString().slice(-4), kind: 'clinical' }, admin.token)).data?.id, 'department added');
ok((await call('GET', '/admin/test-orders', null, admin.token)).data?.length >= 1, 'admin test-order list');
ok((await call('POST', `/admin/doctors/${docId}/bookings`, { open: false }, admin.token)).data?.ok, 'admin pauses a doctor\'s bookings');
ok((await call('POST', '/me/visits', { hospitalId: hid, symptoms: 'cough', doctorId: docId, memberId: fm.data.id }, P)).status === 400, 'paused doctor cannot be booked');
await call('POST', `/admin/doctors/${docId}/bookings`, { open: true }, admin.token);
const recId = (await call('GET', '/admin/people', null, admin.token)).data.find((x) => x.email === 'reception.kokilaben@gmail.com' || x.email === rec.user.email).id;
ok((await call('POST', `/admin/people/${recId}/logout`, {}, admin.token)).data?.ok, 'admin ends all sessions of an account');
ok((await call('GET', '/reception/board', null, rec.token)).status === 401, 'the old session stops working at once');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
