/*
 * MediLink Live connector, part 2: tests, reports, Drive and the hospital admin panel.
 * Same rule as medilink-live.js: the prototype's screens are not changed. This file fills the prototype's own
 * data lists (V3.orders, V3.versions, state.driveFiles, state.auditLog, admin KPIs) from the server and sends
 * the prototype's actions (book, check in, scan done, report ready, send, correct, advise) to the server.
 */
(function () {
  'use strict';
  const live = window.MediLinkLive;
  if (!live) return;
  const api = live.api, toast = live.toast, isLive = live.isLive;
  const staffDesk = () => isLive() && live.user.role === 'staff';

  /* ---------- test orders: server status <-> prototype status ---------- */
  const isPath = (dept) => String(dept || '').startsWith('Pathology');
  const TO_PROTO = (s, dept) => ({ Advised: 'Advised', Booked: 'Booked', CheckedIn: 'Checked in', SampleCollected: isPath(dept) ? 'Sample collected' : 'Scan done', ReportReady: 'Report ready', Sent: 'Sent', Cancelled: 'Cancelled' }[s] || s);
  const FLOW = ['Advised', 'Booked', 'Checked in', 'MID', 'Report ready', 'Sent'];
  function historyFor(status, dept, at) {
    const mid = isPath(dept) ? 'Sample collected' : 'Scan done';
    const steps = FLOW.map((x) => (x === 'MID' ? mid : x));
    const n = status === 'Cancelled' ? 2 : steps.indexOf(status) + 1;
    const h = steps.slice(0, Math.max(1, n)).map((s, i) => ({ status: s, at: new Date(at || Date.now()).getTime() + i * 1000, by: i === 0 ? 'Doctor' : 'MediLink', desk: i === 0 ? 'Doctor' : (i < 3 ? 'Reception' : dept) }));
    if (status === 'Cancelled') h.push({ status: 'Cancelled', at: Date.now(), by: 'MediLink', desk: dept });
    return h;
  }
  function putOrder(t, extra) {
    const id = 'api-t' + t.id;
    const p = live.upsertPatient({ patient_id: t.patient_id, full_name: t.full_name, dob: t.dob, sex: t.sex, medilink_id: t.medilink_id });
    const status = TO_PROTO(t.status, t.department);
    let o = V3.orders.find((x) => x.id === id);
    if (!o) { o = { id, history: [] }; V3.orders.push(o); }
    const cur = o.history.length ? o.history[o.history.length - 1].status : null;
    Object.assign(o, { hospitalId: hid(), patientId: p.id, test: t.test_name, dept: t.department, priority: 'Normal', advisedBy: 'Doctor', liveTestId: t.id }, extra || {});
    if (cur !== status) o.history = historyFor(status, t.department, t.created_at);
    return o;
  }
  // In live mode the prototype's sample orders for this hospital are replaced by the real ones.
  function dropSamples() { const h = hid(); V3.orders = V3.orders.filter((o) => o.hospitalId !== h || String(o.id).startsWith('api-')); V3.versions = V3.versions.filter((v) => V3.orders.some((o) => o.id === v.orderId)); V3.criticalNotes = V3.criticalNotes.filter((c) => V3.versions.some((v) => v.id === c.versionId)); }

  // Reception board (called by medilink-live.js after /reception/board)
  live.onBoard = function (b) {
    dropSamples();
    const keep = new Set(b.testsToBook.map((t) => 'api-t' + t.id));
    b.testsToBook.forEach((t) => putOrder(t));
    // orders that left Advised/Booked are no longer on the board: mark them checked in locally if we had them
    V3.orders.forEach((o) => { if (String(o.id).startsWith('api-t') && !keep.has(o.id) && ['Advised', 'Booked'].includes(o.history[o.history.length - 1].status)) o.history.push({ status: 'Checked in', at: Date.now(), by: 'MediLink', desk: 'Reception' }); });
  };

  // Diagnostics worklist
  async function loadDiag() {
    if (!staffDesk() || !state.activeDesk || state.activeDesk === 'Reception') return;
    try {
      const w = await api('/diagnostics/worklist');
      dropSamples();
      V3.versions = V3.versions.filter((v) => !String(v.orderId).startsWith('api-') || String(v.id).startsWith('api-'));
      w.open.forEach((t) => putOrder(t));
      w.sent.forEach((d) => {
        const o = putOrder({ id: d.test_order_id || ('d' + d.document_id), patient_id: d.patient_id, full_name: d.full_name, dob: d.dob, sex: d.sex, test_name: d.title, department: w.department, status: 'Sent', created_at: d.created_at }, { liveDocumentId: d.document_id });
        const vid = 'api-v' + d.version_id;
        V3.versions = V3.versions.filter((v) => !(v.orderId === o.id && v.id !== vid && v.version >= d.version && String(v.id).startsWith('api-v')));
        if (!V3.versions.some((v) => v.id === vid)) V3.versions.push({ id: vid, orderId: o.id, patientId: o.patientId, dept: w.department, test: d.title, version: d.version, file: d.file_name, reason: null, by: 'server', at: new Date(d.created_at).getTime(), liveDocumentId: d.document_id });
      });
    } catch (e) { if (!e.offline) console.warn('MediLink live:', e.message); }
  }
  live.extraLoaders.diag_dashboard = loadDiag;

  // Moving an order along: Reception books / checks in; the department marks scan done / report ready / cancelled.
  const _orderMove = orderMove;
  orderMove = async function (id, to) {
    const o = V3.orders.find((x) => x.id === id);
    if (o && o.liveTestId && staffDesk()) {
      const tid = o.liveTestId;
      try {
        if (to === 'Booked') await api(`/reception/tests/${tid}/book`, { body: {} });
        else if (to === 'Checked in') await api(`/reception/tests/${tid}/checkin`, { body: {} });
        else if (to === 'Sample collected' || to === 'Scan done') await api(`/diagnostics/tests/${tid}/advance`, { body: { status: 'SampleCollected' } });
        else if (to === 'Report ready') await api(`/diagnostics/tests/${tid}/advance`, { body: { status: 'ReportReady' } });
        else if (to === 'Cancelled') await api(`/diagnostics/tests/${tid}/advance`, { body: { status: 'Cancelled' } });
      } catch (e) { toast(e.message); return; }
    }
    return _orderMove(id, to);
  };

  /* ---------- report files: keep the real file the staff member picked ---------- */
  const picked = live.picked = {};
  const _v3PickFile = v3PickFile;
  v3PickFile = function (el, target) { const f = el.files && el.files[0]; if (f) picked[target] = f; return _v3PickFile(el, target); };
  function samplePdf(title) {
    const lines = [`MediLink sample report: ${title}`, `Generated ${new Date().toLocaleString('en-IN')}`, 'Demo file for the university project. No real patient data.'];
    try { return makeDemoPdf(title, lines); } catch (e) { return new Blob(['%PDF-1.4\n%sample\n'], { type: 'application/pdf' }); }
  }
  function sampleDicom() { const b = new Uint8Array(132 + 256); b.set([0x44, 0x49, 0x43, 0x4D], 128); return new Blob([b], { type: 'application/dicom' }); }
  // The prototype's "use a sample file" button calls v3CheckFile with a sample name; create a real sample file for it.
  const _v3CheckFile = v3CheckFile;
  v3CheckFile = function (name, size, target) {
    if ((name === 'scan_sample.dcm' || name === 'report_sample.pdf') && (!picked[target] || picked[target].name !== name || picked[target]._sample)) {
      const blob = name.endsWith('.dcm') ? sampleDicom() : samplePdf('Sample report');
      picked[target] = new File([blob], name, { type: blob.type }); picked[target]._sample = true;
    }
    return _v3CheckFile(name, size, target);
  };
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  const _sendReport = sendReport;
  sendReport = async function () {
    const s = V3.send; const o = s.orderId ? V3.orders.find((x) => x.id === s.orderId) : null;
    if (o && o.liveTestId && staffDesk()) {
      const f = picked.send; if (!f) { toast('Choose the report file again'); return; }
      try {
        await api(`/diagnostics/tests/${o.liveTestId}/send`, { body: { fileName: f.name, dataBase64: await toB64(f), critical: !!s.critical, criticalNote: s.critical ? `${s.informed} at ${s.informedAt}` : undefined } });
      } catch (e) { toast(e.message); return; }
      delete picked.send;
      _sendReport();
      loadDiag().then(() => { if (state.currentScreen === 'diag_dashboard') render(); });
      return;
    }
    if (!o && staffDesk() && String(s.patientId).startsWith('api-p')) { toast('Older reports without a test order are not supported on the live server yet. Send from a test order.'); return; }
    return _sendReport();
  };

  const _submitCorrection = submitCorrection;
  submitCorrection = async function () {
    const c = V3.corr; const v = V3.versions.find((x) => x.id === c.versionId);
    if (v && v.liveDocumentId && staffDesk()) {
      const f = picked.corr; if (!f) { toast('Choose the corrected file again'); return; }
      try { await api(`/diagnostics/documents/${v.liveDocumentId}/correct`, { body: { reason: c.reason.trim(), fileName: f.name, dataBase64: await toB64(f) } }); }
      catch (e) { toast(e.message); return; }
      delete picked.corr;
      _submitCorrection();
      loadDiag().then(() => { if (state.currentScreen === 'diag_dashboard') render(); });
      return;
    }
    return _submitCorrection();
  };

  /* ---------- doctor advises a test ---------- */
  const _adviseTest = adviseTest;
  adviseTest = async function (pid) {
    if (isLive() && live.user.role === 'doctor' && String(pid).startsWith('api-p')) {
      const patientId = Number(String(pid).slice(5));
      const cur = typeof currentConsultPatient === 'function' ? currentConsultPatient() : null;
      const qp = (cur && cur.livePatientId === patientId) ? cur : state.doctorQueuePatients.find((q) => q.livePatientId === patientId && String(q.id).startsWith('api-'));
      const sel = document.getElementById('advise-test'); const t = sel && V3_TESTS[+sel.value];
      if (!t || !qp) { toast('Open the patient from your queue first'); return; }
      try { await api(`/doctor/visits/${qp.id.slice(4)}/tests`, { body: { department: t.dept, testName: t.test } }); }
      catch (e) { toast(e.message); return; }
    }
    return _adviseTest(pid);
  };

  /* ---------- patient Drive: prescriptions and every report version ---------- */
  const fmtDate = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtOf = (mime) => (/dicom/.test(mime) ? 'DICOM' : /png/.test(mime) ? 'PNG' : /jpe?g/.test(mime) ? 'JPEG' : 'PDF');
  async function loadDrive() {
    if (!isLive() || live.user.role !== 'patient') return;
    try {
      const d = await api('/me/drive');
      await live.api('/hospitals').then((l) => { live._hosp = l; }).catch(() => {});
      const protoHosp = (name) => { const h = HOSPITALS.find((x) => x.name === name); return h ? h.id : ''; };
      const items = [];
      d.prescriptions.forEach((p) => items.push({
        id: 'api-rx-' + p.id, category: 'prescriptions', title: 'Prescription: ' + p.text.split('\n')[0].slice(0, 60), department: 'Prescription',
        doctorName: p.doctor_name, doctorReg: 'NMC registered', hospitalId: protoHosp(p.hospital_name), hospitalName: p.hospital_name,
        format: 'Digital Rx', isDicom: false, sentAt: fmtDate(p.created_at), ts: new Date(p.created_at).getTime(), size: '', rxText: p.text, followUp: p.follow_up,
      }));
      d.documents.forEach((doc) => (doc.versions || []).forEach((v, i) => items.push({
        id: 'api-doc-' + v.id, category: 'reports', title: `${doc.title}${v.version > 1 ? ` (corrected, v${v.version})` : ''}`, department: doc.department, hospitalId: protoHosp(doc.hospital_name), hospitalName: doc.hospital_name,
        docType: doc.title, format: fmtOf(v.mime), isDicom: /dicom/.test(v.mime), sentBy: doc.department, sentAt: fmtDate(v.createdAt), ts: new Date(v.createdAt).getTime(),
        version: v.version, versionId: 'api-v' + v.id, superseded: i > 0, correctionReason: v.reason, size: '', liveVid: v.id, fileName: v.fileName,
      })));
      // Keep the patient's own uploads; replace the prototype's sample files with the real ones.
      state.driveFiles = state.driveFiles.filter((f) => f.category === 'uploads' && !/^file-\d+$/.test(f.id)).concat(items);
      try { driveSave(); } catch (e) { /* storage blocked */ }
    } catch (e) { if (!e.offline) console.warn('MediLink live:', e.message); }
  }
  live.extraLoaders.drive = loadDrive;
  const _driveGetBlob = driveGetBlob;
  driveGetBlob = async function (f) {
    if (f && f.liveVid && isLive()) {
      const r = await fetch(`${live.server}/me/files/${f.liveVid}`, { headers: { Authorization: 'Bearer ' + live.token } });
      if (!r.ok) throw new Error('Could not download the file');
      return await r.blob();
    }
    if (f && f.rxText) {
      return makeDemoPdf(f.title, [`Patient: ${state.patient.name}   MediLink ID: ${state.patient.medilinkId}`, `Hospital: ${f.hospitalName}`, `Doctor: ${f.doctorName}`, `Date: ${f.sentAt}`, '', ...f.rxText.split('\n'), '', f.followUp ? 'Follow-up: ' + f.followUp : '']);
    }
    return _driveGetBlob(f);
  };

  /* ---------- hospital admin panel: live KPIs, people and the audit trail ---------- */
  const A = live.admin = { ov: null, people: null, audit: null };
  async function loadAdmin() {
    if (!isLive() || live.user.role !== 'admin') return;
    try {
      [A.ov, A.people, A.audit] = await Promise.all([api('/admin/overview'), api('/admin/people'), api('/admin/audit')]);
      // Server audit entries in the prototype's own audit-log shape, newest last (the prototype reverses).
      state.auditLog = A.audit.slice().reverse().map((a) => ({
        seq: a.id, actor: a.user_email || a.role || 'system', role: a.role || 'system', desk: a.desk || '', action: a.action, target: a.detail || '',
        patient: a.patient_id ? 'api-p' + a.patient_id : '', time: new Date(a.at).toTimeString().slice(0, 8), date: new Date(a.at).toISOString().slice(0, 10),
        device: 'MediLink server', hash: 'server-chain', prevHash: '',
      }));
    } catch (e) { if (!e.offline) console.warn('MediLink live:', e.message); }
  }
  live.extraLoaders.admin_dashboard = loadAdmin;
  if (typeof admOverview === 'function') {
    const _admOverview = admOverview;
    admOverview = function () {
      const out = _admOverview();
      const o = A.ov; if (!o || !isLive()) return out;
      const bs = (k) => ((o.byStatus || []).filter((x) => k.includes(x.status)).reduce((a, x) => a + x.n, 0));
      o.waiting = bs(['Requested', 'Approved', 'Arrived']); o.called = bs(['Called']); o.inConsultation = bs(['InConsultation']);
      // Replace the prototype's two KPI rows with live numbers; everything after them is kept.
      const cut = out.indexOf('</div>\n        <div class="grid grid-cols-4 gap-3">');
      const end = cut > 0 ? out.indexOf('</div>', out.indexOf('<div class="grid grid-cols-4 gap-3">', cut + 6) + 1) : -1;
      const rows = `<div class="grid grid-cols-4 gap-3">${kpiC(o.registrationsToday, 'Registrations today', 'text-brand')}${kpiC(`${o.waiting ?? 0} / ${o.called ?? 0} / ${o.inConsultation ?? 0}`, 'Tokens: waiting / called / in room')}${kpiC(o.waiting ?? 0, 'Waiting now')}${kpiC((o.averageWaitMinutes ?? 0) + 'm', 'Average wait', 'text-ok')}</div>
        <div class="grid grid-cols-4 gap-3">${kpiC(o.testsPending ?? 0, 'Tests pending', 'text-warn')}${kpiC(o.reportsSent ?? 0, 'Reports sent', 'text-ok')}${kpiC(o.doctorsOnDuty ?? 0, 'Doctors on duty')}${kpiC(`${o.activeAlerts ?? 0} · ${o.pendingIncidents ?? 0}`, 'Active alerts · new incident reports', o.pendingIncidents ? 'text-emergency' : 'text-ink')}</div>`;
      if (cut < 0 || end < 0) return rows + out;
      // find the end of the second KPI row: the closing tag after its 4 cards
      const second = out.indexOf('<div class="grid grid-cols-4 gap-3">', cut);
      let depth = 0, i = second;
      for (; i < out.length; i++) { if (out.startsWith('<div', i)) depth++; else if (out.startsWith('</div>', i)) { depth--; if (depth === 0) { i += 6; break; } } }
      return rows + out.slice(i);
    };
  }
  if (typeof admPeople === 'function') {
    const _admPeople = admPeople;
    admPeople = function () {
      const out = _admPeople();
      if (!A.people || !isLive()) return out;
      const card = `<div class="card-minimal p-4 space-y-2"><div class="text-meta text-slate-600 uppercase font-bold">Accounts on the live server</div><table class="w-full"><thead><tr><th class="${TH}">Account</th><th class="${TH}">Name</th><th class="${TH}">Role</th><th class="${TH}">Desks / department</th><th class="${TH}">Status</th></tr></thead><tbody class="divide-y divide-slate-200/70">${A.people.map((p) => `<tr><td class="${TD} font-bold">${esc(p.email)}</td><td class="${TD}">${esc(p.name || '')}</td><td class="${TD}">${esc(p.role)}</td><td class="${TD}">${esc((p.desks || []).join(', ') || p.department || '—')}</td><td class="${TD}"><span class="px-2.5 py-1 rounded-full text-[12px] font-bold ${p.active ? 'bg-ok-light text-ok' : 'bg-slate-200 text-slate-600'}">${p.active ? 'Active' : 'Deactivated'}</span></td></tr>`).join('')}</tbody></table></div>`;
      return card + out;
    };
  }

  // Load once when the matching screen is first shown after sign-in.
  const _render = render;
  let lastScreen = null;
  render = function () {
    const out = _render.apply(this, arguments);
    const sc = state.currentScreen;
    if (sc !== lastScreen) {
      lastScreen = sc;
      const fn = live.extraLoaders[sc];
      if (fn && isLive()) fn().then(() => { if (state.currentScreen === sc) render(); });
    }
    return out;
  };
  setInterval(() => { const sc = state.currentScreen; if (isLive() && ['diag_dashboard', 'drive', 'admin_dashboard'].includes(sc)) { const fn = live.extraLoaders[sc]; if (fn) fn().then(() => { if (state.currentScreen === sc && !document.activeElement.matches('input,textarea,select')) render(); }); } }, 20000);
})();
