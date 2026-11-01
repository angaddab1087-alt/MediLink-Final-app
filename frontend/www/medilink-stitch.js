/*
 * MediLink Live connector, part 3: every remaining screen stitched to the server, and reliable back navigation.
 * Same rule as the other connector files: the prototype's screens and styles are kept; this file fills the
 * prototype's own lists from the server and sends the prototype's actions to the server first.
 *   Patient:   family members, follow-ups, consents, referrals, profile edit, correction requests
 *   Doctor:    follow-ups, treatment completion, referrals, incident reports, notifications
 *   Reception: follow-up desk, patient lookup, vitals, waiting-room display
 *   Admin:     people, doctors, patients, conduct alerts, tests, setup, reports, requests, approvals, follow-ups
 *   Everyone:  Back button, browser back and Android back follow one predictable history.
 */
(function () {
  'use strict';
  const live = window.MediLinkLive;
  if (!live) return;
  const api = live.api;
  const toast = (m) => { try { showToast(m); } catch (e) { console.log(m); } };
  const e = (s) => esc(s == null ? '' : String(s));
  const on = (role) => live.isLive && live.isLive() && live.user.role === role;
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const dateOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const ageOf = (dob) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000) : '');
  const S = window.MediLinkStitch = {};
  const fail = (err) => { if (!err.offline) toast(err.message); };
  const sid = (id, prefix) => (String(id).startsWith(prefix) ? Number(String(id).slice(prefix.length)) : null);
  async function protoHospital(serverId) { await live.hospitals(); return live.protoHospital(serverId); }

  /* ======================= PATIENT ======================= */
  state.family = [];
  live.onPatientLoaded = async function () {
    const [fam, fus, cons, refs] = await Promise.all([api('/me/family'), api('/me/follow-ups'), api('/me/consents'), api('/me/referrals')]);
    state.family = fam;
    // Follow-ups: the patient's own, from the server (prototype sample follow-ups for this name are removed in medilink-live.js).
    const mine = [];
    for (const f of fus) {
      mine.push({ id: 'api-f' + f.id, hospitalId: await protoHospital(f.hospital_id), patientName: state.patient.name, mlId: f.medilink_id, doctorName: f.doctor_name, department: f.department, date: f.due, reason: f.reason, status: f.status, setAt: f.set_at });
    }
    state.followUps = state.followUps.filter((f) => !String(f.id).startsWith('api-f') && f.patientName !== state.patient.name).concat(mine);
    state.consents = cons.map((c) => ({ id: 'api-c' + c.id, hospitalId: c.hospital_id, hospitalName: c.hospital_name, purpose: 'OPD consultation and diagnostics', scope: c.scope || 'Profile, allergies, prescriptions, reports', expires: 'you withdraw it', revoked: !!c.revoked_at, grantedAt: c.granted_at }));
    const open = refs.find((r) => r.status === 'Proposed') || refs.find((r) => r.status === 'Accepted');
    state.activeReferral = open
      ? { id: 'api-r' + open.id, serverId: open.id, toHospitalServerId: open.to_hospital_id, toHospitalName: open.to_hospital_name, toDepartment: open.to_department, fromDoctorName: open.from_doctor_name, reason: open.reason, status: open.status }
      : { status: 'Declined', toHospitalName: '' };
    try { S.access = await api('/me/access-history'); } catch (err) { S.access = []; }
  };

  // Who is this for: me or a family member on my account (stored on the server), plus a form to add one.
  const _who = renderRegWho;
  renderRegWho = function () {
    if (!on('patient')) return _who();
    const p = state.patient, sel = state.regDraft.memberId || null, f = S.newMember;
    const card = (onclick, initials, title, sub, active) => `<button onclick="${onclick}" class="card-minimal p-5 w-full text-left flex items-center gap-3 ${active ? 'ring-2 ring-brand-accent' : ''}"><div class="w-12 h-12 rounded-2xl bg-brand-light text-brand flex items-center justify-center font-bold">${initials}</div><div><div class="text-t2">${e(title)}</div><div class="text-meta text-slate-500">${e(sub)}</div></div></button>`;
    return `
      <div class="flex-1 flex flex-col justify-between py-3">
        <div class="space-y-1"><h1 class="text-t1">${t('who_is_this_for')}</h1></div>
        <div class="space-y-3 my-auto">
          ${card("MediLinkStitch.pickWho(null)", 'Me', p.name, `Self${p.age && p.age !== '—' ? ' • ' + p.age + 'y' : ''}`, !sel)}
          ${state.family.map((m) => card(`MediLinkStitch.pickWho(${m.id})`, e(m.name.split(' ').map((w) => w[0]).join('').slice(0, 2)), `${m.name} (${m.relation})`, `${m.relation}${m.age != null ? ' • ' + m.age + 'y' : ''}`, sel === m.id)).join('')}
          ${f ? `<div class="card-minimal p-4 space-y-2">
              <div class="text-meta font-bold text-ink">Add a family member</div>
              <input id="fm-name" value="${e(f.name || '')}" placeholder="Full name" class="w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta">
              <div class="grid grid-cols-2 gap-2"><select id="fm-rel" class="h-11 bg-slate-50 rounded-xl px-2 border border-slate-200 text-meta">${['Parent', 'Child', 'Spouse', 'Sibling', 'Grandparent', 'Other'].map((r) => `<option>${r}</option>`).join('')}</select>
              <select id="fm-sex" class="h-11 bg-slate-50 rounded-xl px-2 border border-slate-200 text-meta">${['Female', 'Male', 'Other'].map((r) => `<option>${r}</option>`).join('')}</select></div>
              <label class="block text-[12px] font-semibold text-slate-600">Date of birth<input id="fm-dob" type="date" max="${new Date().toISOString().slice(0, 10)}" class="mt-1 w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta"></label>
              <p class="text-[12px] text-slate-600">For a child, you confirm you are their parent or guardian.</p>
              <div class="grid grid-cols-2 gap-2"><button onclick="MediLinkStitch.newMember=null;render()" class="btn-touch-48 bg-white border border-slate-300 text-ink font-semibold">Cancel</button><button onclick="MediLinkStitch.addMember(this)" class="btn-touch-48 bg-brand text-white font-semibold">Save</button></div>
            </div>` : `<button onclick="MediLinkStitch.newMember={};render()" class="w-full h-12 rounded-2xl border-2 border-dashed border-slate-300 text-ink font-semibold text-meta flex items-center justify-center gap-2"><i data-lucide="user-plus" class="w-4 h-4"></i> Someone else</button>`}
        </div>
        <button onclick="navigate('reg_why')" class="btn-primary-56 w-full bg-brand text-white font-semibold text-t2">Next</button>
      </div>`;
  };
  S.pickWho = function (id) {
    state.regDraft.memberId = id; const m = state.family.find((x) => x.id === id);
    state.regDraft.forWho = m ? m.relation : 'Me'; navigate('reg_why');
  };
  S.addMember = async function (btn) {
    const v = (id) => (document.getElementById(id) || {}).value || '';
    if (v('fm-name').trim().length < 2) { toast('Enter their full name'); return; }
    btn.disabled = true;
    try {
      const m = await api('/me/family', { body: { name: v('fm-name').trim(), relation: v('fm-rel'), sex: v('fm-sex'), dob: v('fm-dob') || undefined } });
      m.age = m.dob ? ageOf(m.dob) : null; state.family.push(m); S.newMember = null; toast(`${m.name} added to your account`); render();
    } catch (err) { fail(err); btn.disabled = false; }
  };
  // A booking starts as "for me" unless a family member is chosen again.
  const _scanHospitalNav = navigate;
  navigate = function (screen, push) {
    if (screen === 'reg_who' && state.currentScreen !== 'reg_who') state.regDraft.memberId = null;
    return _scanHospitalNav(screen, push);
  };

  // Profile edit is saved on the server.
  const _saveProfile = savePatientProfile;
  savePatientProfile = async function () {
    if (!on('patient')) return _saveProfile();
    const g = (id) => (document.getElementById('pe-' + id)?.value || '').trim();
    if (!g('name')) { toast('Name is required'); return; }
    const p = live.profile || {};
    const phone = g('phone') ? g('phone').replace(/[^\d+]/g, '') : p.phone;
    try {
      live.profile = await api('/me/profile', { method: 'PUT', body: {
        fullName: g('name'), dob: g('dob') || day(p.dob) || null, sex: ['Male', 'Female', 'Other'].includes(g('sex')) ? g('sex') : p.sex, phone: phone || null,
        address: p.address, bloodGroup: g('blood') || p.blood_group, emergencyContactName: p.emergency_contact_name,
        emergencyContactPhone: g('emergency') ? g('emergency').replace(/[^\d+]/g, '').slice(-13) || p.emergency_contact_phone : p.emergency_contact_phone,
        allergies: g('allergies').split(',').map((x) => x.trim()).filter(Boolean), insurance: p.insurance,
      } });
    } catch (err) { fail(err); return; }
    _saveProfile();
  };

  // Consent centre: real consents, withdraw on the server, and who opened my records.
  const _consents = renderConsentCentre;
  renderConsentCentre = function () {
    if (!on('patient')) return _consents();
    const acc = S.access || [];
    return `
      <div class="space-y-3">
        <h1 class="text-t1">Consent Centre</h1>
        <p class="text-meta text-slate-600">Control which hospitals can view your records.</p>
        ${state.consents.length ? state.consents.map((c) => `
          <div class="card-minimal p-4 space-y-2">
            <div class="flex items-center justify-between"><span class="text-body font-semibold">${e(c.hospitalName)}</span><span class="text-meta ${c.revoked ? 'text-emergency' : 'text-ok'} font-semibold">${c.revoked ? 'Withdrawn' : 'Active'}</span></div>
            <p class="text-meta text-slate-600">${e(c.scope)} • Until ${e(c.expires)}</p>
            ${!c.revoked ? `<button onclick="MediLinkStitch.revokeConsent('${c.id}')" class="btn-touch-48 w-full border-2 border-emergency text-emergency font-semibold">Withdraw access</button>` : ''}
          </div>`).join('') : '<div class="card-minimal p-4 text-meta text-slate-600">No hospital has your consent yet. It is asked the first time you register at a hospital.</div>'}
        <div class="card-minimal p-4 space-y-2"><div class="text-meta text-slate-600 uppercase font-bold">Who opened your records</div>
          ${acc.length ? acc.map((a) => `<div class="text-meta"><b>${e(a.by_name || a.role)}</b> · ${e(a.action === 'ADMIN_RECORD_VIEWED' ? 'Hospital admin (view only)' : a.action === 'EMERGENCY_RECORD_VIEWED' ? 'Emergency access' : 'Doctor, by scanning your QR')}<div class="text-[12px] text-slate-600">${new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${a.detail ? ' · ' + e(a.detail) : ''}</div></div>`).join('') : '<p class="text-meta text-slate-600">No one has opened your records yet.</p>'}
        </div>
      </div>`;
  };
  S.revokeConsent = function (id) {
    const c = state.consents.find((x) => x.id === id); if (!c) return;
    openConfirmDialog('Withdraw hospital access?', `${c.hospitalName} will no longer see your records. Emergency care is never affected.`, async () => {
      try { await api(`/me/consents/${sid(id, 'api-c')}/revoke`, { body: {} }); c.revoked = true; toast('Access withdrawn'); render(); } catch (err) { fail(err); }
    });
  };

  // Referrals: accept or decline on the server; "Get token" books at the referred hospital and department.
  const _respond = respondToReferral;
  respondToReferral = async function (accepted) {
    const r = state.activeReferral;
    if (on('patient') && r && r.serverId) {
      try { await api(`/me/referrals/${r.serverId}/respond`, { body: { status: accepted ? 'Accepted' : 'Declined' } }); } catch (err) { fail(err); return; }
    }
    return _respond(accepted);
  };
  const _referToken = referToNewDoctorWithToken;
  referToNewDoctorWithToken = async function () {
    const r = state.activeReferral;
    if (!(on('patient') && r && r.serverId)) return _referToken();
    try {
      if (r.status === 'Proposed') { await api(`/me/referrals/${r.serverId}/respond`, { body: { status: 'Accepted' } }); r.status = 'Accepted'; }
      try { closeTokenQRSheet(); } catch (err) { /* sheet closed */ }
      state.regDraft.hospitalId = await protoHospital(r.toHospitalServerId);
      state.regDraft.suggestedDept = r.toDepartment; state.regDraft.symptomText = 'Referral: ' + (r.reason || r.toDepartment); state.regDraft.memberId = null;
      toast('Referral accepted. Choose a doctor for your token.');
      navigate('reg_doctor_pick');
    } catch (err) { fail(err); }
  };

  const _explain = requestExplanation;
  requestExplanation = async function () {
    if (!on('patient')) return _explain();
    try { await api('/me/data-requests', { body: { kind: 'correction', note: 'Correction or explanation requested from the app' } }); toast('Request sent to the hospital'); navigate('home'); } catch (err) { fail(err); }
  };

  /* ======================= DOCTOR ======================= */
  live.onDoctorLoaded = async function () {
    const doc = typeof currentDoctor === 'function' ? currentDoctor() : null;
    const [cls, notes] = await Promise.all([api('/doctor/closures'), api('/me/notifications')]);
    state.closures = state.closures.filter((c) => !String(c.id).startsWith('api-cl') && c.doctorEmail !== state.currentAccountEmail)
      .concat(cls.map((c) => ({ id: 'api-cl' + c.id, hospitalId: doc ? doc.hospitalId : hid(), patientName: c.patient_name, token: c.token_no, doctorName: doc ? doc.name : '', doctorEmail: state.currentAccountEmail, department: doc ? doc.department : '', note: c.note, status: c.status, requestedAt: new Date(c.created_at).toLocaleString('en-IN'), decidedBy: '', decidedAt: c.decided_at ? new Date(c.decided_at).toLocaleString('en-IN') : '', ack: false })));
    state.notifications = notes.map((n) => ({ id: 'n-' + n.id, title: n.title, body: n.body, time: new Date(n.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) }));
  };
  const _consultDone = commitConsultDone;
  commitConsultDone = async function (id) {
    const d = state.fuDraft || {};
    if (on('doctor') && String(id).startsWith('api-') && d.needed) {
      try { await api(`/doctor/visits/${String(id).slice(4)}/follow-up`, { body: { date: d.date, reason: (d.reason || '').trim() || 'Follow-up review' } }); } catch (err) { fail(err); return; }
    }
    return _consultDone(id);
  };
  const _treatDone = commitTreatmentComplete;
  commitTreatmentComplete = async function (id) {
    if (on('doctor') && String(id).startsWith('api-')) {
      try { await api(`/doctor/visits/${String(id).slice(4)}/close-treatment`, { body: { note: (state.fuDraft.finalNote || '').trim() } }); } catch (err) { fail(err); return; }
    }
    return _treatDone(id);
  };
  const _ack = ackClosure;
  ackClosure = async function (id) {
    if (on('doctor') && String(id).startsWith('api-cl')) { try { await api(`/doctor/closures/${sid(id, 'api-cl')}/ack`, { body: {} }); } catch (err) { fail(err); return; } }
    return _ack(id);
  };

  // Referral form: real MediLink hospitals and departments; sent to the server.
  S.refer = { hospital: '', dept: '', reason: '' };
  const _refer = renderDoctorRefer;
  renderDoctorRefer = function () {
    if (!on('doctor')) return _refer();
    if (!S.referHospitals) { live.hospitals().then((l) => { S.referHospitals = l.filter((h) => h.on_medilink); render(); }); }
    const hs = S.referHospitals || [], qp = currentConsultPatient(), f = S.refer;
    const depts = ['General Physician', 'Orthopaedics', 'Cardiology', 'Paediatrics', 'Gynaecology', 'ENT', 'Dermatology', 'Dental', 'Ophthalmology', 'Gastroenterology'];
    return `
      <div class="flex-1 flex flex-col justify-between py-2 space-y-3">
        <div><h1 class="text-t2">Referral &amp; Transfer Form</h1><p class="text-meta text-slate-600">${e(qp ? qp.name + ' · ' + qp.token : '')}</p></div>
        <div class="card-minimal p-4 space-y-2.5">
          <label class="block"><span class="text-meta text-slate-600 font-semibold">Hospital</span>
            <select onchange="MediLinkStitch.refer.hospital=this.value" class="mt-1 w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta"><option value="">Choose a hospital</option>${hs.map((h) => `<option value="${h.id}" ${String(f.hospital) === String(h.id) ? 'selected' : ''}>${e(h.name)}</option>`).join('')}</select></label>
          <label class="block"><span class="text-meta text-slate-600 font-semibold">Department</span>
            <select onchange="MediLinkStitch.refer.dept=this.value" class="mt-1 w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta"><option value="">Choose a department</option>${depts.map((d) => `<option ${f.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="block"><span class="text-meta text-slate-600 font-semibold">Reason for referral</span>
            <input value="${e(f.reason)}" oninput="MediLinkStitch.refer.reason=this.value" placeholder="e.g. Specialist review and echocardiogram" class="mt-1 w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta" /></label>
          <p class="text-[12px] text-slate-600">The patient accepts or declines in their app. Accepting shares this visit's summary with that hospital.</p>
        </div>
        <button onclick="MediLinkStitch.sendReferral(this)" class="btn-primary-56 w-full bg-brand text-white font-semibold text-t2">Send Referral Pass</button>
      </div>`;
  };
  S.sendReferral = async function (btn) {
    const qp = currentConsultPatient(), f = S.refer;
    if (!qp || !String(qp.id).startsWith('api-')) { toast('Open the patient from your queue first'); return; }
    if (!f.hospital || !f.dept || f.reason.trim().length < 3) { toast('Choose a hospital, a department and write a reason'); return; }
    btn.disabled = true;
    try {
      await api(`/doctor/visits/${qp.id.slice(4)}/refer`, { body: { toHospitalId: Number(f.hospital), toDepartment: f.dept, reason: f.reason.trim() } });
      qp.status = 'Done'; S.refer = { hospital: '', dept: '', reason: '' };
      toast('Referral sent. The patient will see it in their app.');
      state.history = []; navigate('doctor_dashboard', false);
    } catch (err) { fail(err); btn.disabled = false; }
  };

  // Incident reports (doctor, reception, diagnostics) go to the server.
  const _incident = submitIncident;
  submitIncident = async function () {
    const f = V3.inc || {};
    const pid = sid(f.patientId || '', 'api-p');
    if (live.isLive() && pid) {
      if (!f.place || !f.place.trim() || (f.note || '').trim().length < 10) { toast('Add patient, place and a short note'); return; }
      if (/\b(crazy|idiot|mad|stupid|lunatic|useless|animal|psycho)\b/i.test(f.note)) { toast('Please keep to facts, no judgement words'); return; }
      try { await api('/incidents', { body: { patientId: pid, category: f.category, date: f.date, place: f.place.trim(), note: f.note.trim(), witness: (f.witness || '').trim() || undefined } }); }
      catch (err) { fail(err); return; }
    }
    return _incident();
  };

  /* ======================= RECEPTION ======================= */
  const fuShape = (f) => ({ id: 'api-f' + f.id, hospitalId: hid(), patientName: f.patient_name, age: f.age || '', sex: (f.sex || '')[0] || '', mlId: f.medilink_id, origToken: '', doctorName: f.doctor_name, doctorEmail: f.doctor_email, department: f.department, date: f.due, reason: f.reason, status: f.status, setAt: f.set_at, callAttempts: f.call_attempts, rescheduled: f.rescheduled });
  live.onReceptionLoaded = async function (board) {
    S.board = board;
    board.queue.forEach((v) => live.upsertPatient({ patient_id: v.patient_id, full_name: v.full_name, sex: v.sex, medilink_id: v.medilink_id, phone_last4: v.phone_last4 }));
    if (state.activeDesk !== 'Reception') return;
    const fus = await api('/reception/follow-ups');
    state.followUps = state.followUps.filter((f) => f.hospitalId !== hid()).concat(fus.map(fuShape));
    V3.walkins = V3.walkins.filter((w) => w.hospitalId !== hid());
  };
  const reloadReception = () => { if (live.extraLoaders && typeof render === 'function') { /* refresh through the normal loader */ } navigate(state.currentScreen, false); };
  const fuAct = async (id, action, body) => { await api(`/reception/follow-ups/${sid(id, 'api-f')}/${action}`, { body: body || {} }); };
  const _fuIn = receptionFollowUpCheckIn;
  receptionFollowUpCheckIn = async function (id) {
    if (!String(id).startsWith('api-f')) return _fuIn(id);
    try { const r = await api(`/reception/follow-ups/${sid(id, 'api-f')}/checkin`, { body: {} }); const f = state.followUps.find((x) => x.id === id); if (f) f.status = 'Checked in'; toast(`${f ? f.patientName : 'Patient'} checked in as ${r.token}`); reloadReception(); } catch (err) { fail(err); }
  };
  const _fuCall = receptionFollowUpCall;
  receptionFollowUpCall = async function (id) {
    if (!String(id).startsWith('api-f')) return _fuCall(id);
    try { await fuAct(id, 'call'); } catch (err) { fail(err); return; }
    return _fuCall(id);
  };
  const _fuMiss = receptionFollowUpMissed;
  receptionFollowUpMissed = function (id) {
    if (!String(id).startsWith('api-f')) return _fuMiss(id);
    const f = state.followUps.find((x) => x.id === id); if (!f) return;
    openConfirmDialog('Mark follow-up as missed?', `${f.patientName} did not come. Admin will see it.`, async () => {
      try { await fuAct(id, 'missed'); f.status = 'Missed'; render(); } catch (err) { fail(err); }
    });
  };
  const _fuSave = saveReschedule;
  saveReschedule = async function (id) {
    if (!String(id).startsWith('api-f')) return _fuSave(id);
    const v = (document.getElementById('rs-date') || {}).value;
    if (!v || v < isoDay(0)) { toast('Pick a date from today onwards'); return; }
    try { await fuAct(id, 'reschedule', { date: v }); } catch (err) { fail(err); return; }
    return _fuSave(id);
  };

  // Patient lookup searches the server (identity only).
  const _lookup = renderRecLookup;
  renderRecLookup = function () {
    const q = (V3.lookupQ || '').trim();
    if (on('staff') && q.length >= 2 && S.lookedUp !== q) {
      S.lookedUp = q;
      api('/reception/lookup?q=' + encodeURIComponent(q)).then((rows) => {
        rows.forEach((r) => { const p = live.upsertPatient({ patient_id: r.id, full_name: r.full_name, sex: r.sex, medilink_id: r.medilink_id, phone_last4: r.phone_last4 }); p.age = r.age ?? ''; p.todayToken = r.today_token || ''; });
        S.lookupIds = rows.map((r) => 'api-p' + r.id); render();
      }).catch(fail);
    }
    if (on('staff')) {
      const keep = state.hospitalPatients; state.hospitalPatients = keep.filter((p) => !p.livePatientId || (S.lookupIds || []).includes(p.id) || p.hospitalId === hid());
      const out = _lookup(); state.hospitalPatients = keep; return out;
    }
    return _lookup();
  };

  // Vitals are saved on today's visit.
  const _vitals = saveVitals;
  saveVitals = async function () {
    const v = V3.vit || {};
    const pid = sid(v.pid || '', 'api-p');
    if (on('staff') && pid) {
      const visit = (S.board ? S.board.queue : []).find((q) => q.patient_id === pid);
      if (!visit) { toast('This patient has no visit today. Check them in first.'); return; }
      if (!v.bp) { toast('Choose a patient and add BP'); return; }
      try { await api(`/reception/visits/${visit.id}/vitals`, { body: { bp: v.bp, pulse: v.pulse, temp: v.temp, spo2: v.spo2, weight: v.wt } }); } catch (err) { fail(err); return; }
    }
    return _vitals();
  };
  const _vitalsScreen = renderRecVitals;
  renderRecVitals = function () {
    if (!on('staff') || !S.board) return _vitalsScreen();
    const keep = state.hospitalPatients, today = S.board.queue.map((q) => 'api-p' + q.patient_id);
    state.hospitalPatients = keep.filter((p) => today.includes(p.id));
    const out = _vitalsScreen(); state.hospitalPatients = keep; return out;
  };

  // Waiting-room display from today's real queue.
  const _display = renderWaitingDisplay;
  renderWaitingDisplay = function () {
    if (!on('staff')) return _display();
    if (!S.displayAt || Date.now() - S.displayAt > 10000) { S.displayAt = Date.now(); api('/reception/display').then((d) => { S.display = d; if (state.currentScreen === 'waiting_display') render(); }).catch(fail); }
    const d = S.display || { calling: [], next: [] }, now = d.calling[0];
    return `
      <div class="space-y-4 text-center py-6">
        <h1 class="text-t1">Waiting Area Queue Display</h1>
        <div class="card-minimal p-8 space-y-3">
          ${now ? `<div class="text-[48px] font-extrabold text-brand">${e(now.token_no)}</div><div class="text-t2">Now calling</div><p class="text-meta text-slate-600">${e(now.doctor_name)} • ${e(now.department || '')}</p>` : '<div class="text-t2 text-slate-600">No token is being called right now</div>'}
        </div>
        ${d.next.length ? `<div class="card-minimal p-4 space-y-2"><div class="text-meta text-slate-600 uppercase font-bold">Next</div><div class="flex flex-wrap justify-center gap-2">${d.next.map((n) => `<span class="px-3 py-1.5 rounded-xl bg-brand-light text-brand-accent font-extrabold">${e(n.token_no)}</span>`).join('')}</div></div>` : ''}
        <p class="text-[12px] text-slate-600">Names are never shown on this screen.</p>
      </div>`;
  };

  /* ======================= HOSPITAL ADMIN ======================= */
  const A = S.admin = {};
  const REQ_TYPE = { export: 'Data export', erasure: 'Erasure', correction: 'Correction / explanation' };
  const REQ_STATUS = { Pending: 'Received', 'In review': 'In review', Done: 'Completed', 'Refused (legal hold)': 'Completed' };
  const TEST_STATUS = (s, dept) => ({ Advised: 'Advised', Booked: 'Booked', CheckedIn: 'Checked in', SampleCollected: String(dept).startsWith('Pathology') ? 'Sample collected' : 'Scan done', ReportReady: 'Report ready', Sent: 'Sent', Cancelled: 'Cancelled' }[s] || s);
  async function loadAdminAll() {
    if (!on('admin')) return;
    const h = hid();
    // Each list loads on its own, so one failure never leaves the panel half-filled with sample data.
    const got = await Promise.allSettled(['/admin/people', '/admin/doctors', '/admin/incidents', '/admin/alerts', '/admin/test-orders', '/admin/setup', '/admin/qr', '/admin/data-requests', '/admin/closures', '/admin/follow-ups'].map((u) => api(u)));
    const bad = got.find((g) => g.status === 'rejected'); if (bad) throw bad.reason;
    const [people, docs, inc, alerts, orders, setup, qr, reqs, cls, fus] = got.map((g) => g.value);
    A.people = people; A.setup = setup;
    const pat = (id, name, sex, ml, dob) => live.upsertPatient({ patient_id: id, full_name: name, sex, medilink_id: ml, dob });
    // People
    V3.accounts = V3.accounts.filter((a) => a.hospitalId !== h).concat(people.map((p) => ({ email: p.email, role: p.role, hospitalId: h, desks: p.desks || [], active: p.active, name: p.name, department: p.department || '', serverId: p.id })));
    people.forEach((p) => { V3.sessions[p.email] = V3.sessions[p.email] || []; V3.login[p.email] = p.last_login ? [{ at: new Date(p.last_login).getTime(), device: 'MediLink app', ok: true }] : []; });
    // Doctors
    docs.forEach((d) => {
      let pd = DOCTORS.find((x) => x.email.toLowerCase() === String(d.email).toLowerCase());
      if (!pd) { pd = { id: 'doc-api-' + d.id, name: d.name, email: d.email, hospitalId: h, department: d.department, gender: d.gender || 'Other', scheduleFitScore: 1, activeLoad: 0 }; DOCTORS.push(pd); }
      Object.assign(pd, { serverId: d.id, department: d.department, onLeave: d.on_leave, bookingsOpen: d.bookings_open, onDuty: d.on_duty, seen: d.patients_today, activeLoad: d.patients_today,
        clockIn: d.on_duty && d.last_clock_in ? new Date(d.last_clock_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—' });
    });
    // Incidents, decisions, alerts
    inc.forEach((i) => pat(i.patient_id, i.full_name));
    V3.incidents = V3.incidents.filter((x) => x.hospitalId !== h).concat(inc.map((i) => ({ id: 'IR-' + i.id, serverId: i.id, hospitalId: h, patientId: 'api-p' + i.patient_id, category: i.category, date: day(i.happened_on), place: i.place || '', note: i.note, witness: i.witness || '', reportedBy: i.reported_by_name, desk: '', at: new Date(i.created_at || Date.now()).getTime() })));
    V3.decisions = V3.decisions.filter((x) => !String(x.id).startsWith('api-d') && V3.incidents.some((i) => i.id === x.incidentId))
      .concat(inc.filter((i) => i.status !== 'Pending').map((i) => ({ id: 'api-d' + i.id, incidentId: 'IR-' + i.id, type: i.status === 'Dismissed' ? 'dismissed' : 'alerted', reason: i.decision_reason || '', by: '', at: Date.now() })));
    alerts.forEach((a) => pat(a.patient_id, a.full_name));
    V3.alerts = V3.alerts.filter((x) => x.hospitalId !== h).concat(alerts.map((a) => {
      const ev = [{ type: 'placed', by: a.set_by_name, at: new Date(a.created_at).getTime() }];
      if (a.approved_by_name) ev.push({ type: 'approved', by: a.approved_by_name, at: new Date(a.created_at).getTime() + 1 });
      if (a.status === 'Lifted') ev.push({ type: 'lifted', by: '', at: Date.now() });
      if (a.status === 'Expired') ev.push({ type: 'expired', by: 'system', at: Date.now() });
      return { id: 'CA-' + a.id, serverId: a.id, hospitalId: h, patientId: 'api-p' + a.patient_id, category: a.category, summary: a.summary, start: day(a.created_at), reviewAt: day(a.review_date), setBy: a.set_by_name, needsSecond: a.status === 'PendingApproval' || !!a.approved_by_name && a.approved_by !== a.set_by, basedOn: [], events: ev };
    }));
    // Tests and report versions
    V3.orders = V3.orders.filter((o) => o.hospitalId !== h || String(o.id).startsWith('api-t'));
    V3.versions = V3.versions.filter((v) => V3.orders.some((o) => o.id === v.orderId));
    V3.criticalNotes = V3.criticalNotes.filter((c) => V3.versions.some((v) => v.id === c.versionId));
    orders.forEach((t) => {
      pat(t.patient_id, t.full_name, t.sex, t.medilink_id, t.dob);
      const status = TEST_STATUS(t.status, t.department), created = new Date(t.created_at).getTime(), updated = new Date(t.updated_at || t.created_at).getTime();
      const steps = ['Advised', 'Booked', 'Checked in', String(t.department).startsWith('Pathology') ? 'Sample collected' : 'Scan done', 'Report ready', 'Sent'];
      const n = status === 'Cancelled' ? 2 : Math.max(1, steps.indexOf(status) + 1);
      const history = steps.slice(0, n).map((s, i) => ({ status: s, at: i === n - 1 ? updated : created + i * 60000, by: '', desk: '' }));
      if (status === 'Cancelled') history.push({ status: 'Cancelled', at: updated, by: '', desk: '' });
      const id = 'api-t' + t.id;
      V3.orders = V3.orders.filter((o) => o.id !== id).concat({ id, hospitalId: h, patientId: 'api-p' + t.patient_id, test: t.test_name, dept: t.department, priority: 'Normal', advisedBy: t.advised_by_name || 'Doctor', history, liveTestId: t.id });
      (t.versions || []).forEach((v) => {
        V3.versions = V3.versions.filter((x) => x.id !== 'api-v' + v.id).concat({ id: 'api-v' + v.id, orderId: id, patientId: 'api-p' + t.patient_id, dept: t.department, test: t.test_name, version: v.version, file: v.file, reason: v.reason, by: v.by || '', at: new Date(v.at).getTime(), critical: !!v.critical });
        if (v.critical) V3.criticalNotes = V3.criticalNotes.filter((c) => c.versionId !== 'api-v' + v.id).concat({ id: 'api-cn' + v.id, versionId: 'api-v' + v.id, orderId: id, informed: v.critical, informedAt: new Date(v.at).getTime(), recordedBy: v.by || '', readyAt: new Date(v.at).getTime() });
      });
    });
    // Setup
    const st = setup.settings || {};
    V3.setup[h] = Object.assign(V3.setup[h] || {}, { slotMin: st.slotMinutes ?? 15, walk: st.walkInSharePct ?? 30, grace: st.graceMinutes ?? 15, fee: st.fee ?? 500,
      fields: Array.isArray(setup.extra_fields) ? setup.extra_fields : [], qrVersion: qr.version, qrAt: V3.setup[h] && V3.setup[h].qrAt || Date.now(),
      depts: setup.departments.map((d) => ({ name: d.name, active: d.active, serverId: d.id, kind: d.kind })), connector: 'MediLink Lite · live server' });
    // Data requests
    reqs.forEach((r) => pat(r.patient_id, r.full_name));
    V3.requests = V3.requests.filter((r) => r.hospitalId !== h).concat(reqs.map((r) => ({ id: 'api-q' + r.id, serverId: r.id, hospitalId: h, patientId: 'api-p' + r.patient_id, type: REQ_TYPE[r.kind] || r.kind, status: REQ_STATUS[r.status] || r.status, at: new Date(r.created_at).getTime(), note: r.note })));
    // Treatment completion approvals and the follow-up tracker
    state.closures = state.closures.filter((c) => c.hospitalId !== h).concat(cls.map((c) => ({ id: 'api-cl' + c.id, hospitalId: h, patientName: c.patient_name, age: c.age || '', sex: (c.sex || '')[0] || '', token: c.token_no, doctorName: c.doctor_name, doctorEmail: '', department: c.department, note: c.note, status: c.status, requestedAt: new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }), decidedBy: c.decided_by_email || '', decidedAt: c.decided_at ? new Date(c.decided_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '' })));
    state.followUps = state.followUps.filter((f) => f.hospitalId !== h).concat(fus.map(fuShape));
    // Demo-only sample notices are not shown on a live panel.
    V3.notices = V3.notices.filter((n) => n.hospitalId !== h);
  }
  const _adminLoader = live.extraLoaders.admin_dashboard;
  live.extraLoaders.admin_dashboard = async () => { if (_adminLoader) await _adminLoader(); try { await loadAdminAll(); } catch (err) { fail(err); } };
  const reloadAdmin = async () => { try { await live.extraLoaders.admin_dashboard(); } finally { render(); } };
  const acc = (email) => V3.accounts.find((a) => a.email === email);

  // People
  const _toggleDesk = toggleDesk;
  toggleDesk = async function (email, d) {
    const a = acc(email); if (!on('admin') || !a || !a.serverId) return _toggleDesk(email, d);
    const desks = a.desks.includes(d) ? a.desks.filter((x) => x !== d) : a.desks.concat(d);
    if (!desks.length) { toast('A staff account needs at least one desk'); return; }
    try { await api(`/admin/people/${a.serverId}/desks`, { body: { desks } }); } catch (err) { fail(err); return; }
    return _toggleDesk(email, d);
  };
  const _toggleActive = toggleActive;
  toggleActive = async function (email) {
    const a = acc(email); if (!on('admin') || !a || !a.serverId) return _toggleActive(email);
    if (email === live.user.email) { toast('You cannot deactivate yourself'); return; }
    try { await api(`/admin/people/${a.serverId}/active`, { body: { active: !a.active } }); } catch (err) { fail(err); return; }
    return _toggleActive(email);
  };
  const _forceLogout = forceLogout;
  forceLogout = async function (email) {
    const a = acc(email); if (!on('admin') || !a || !a.serverId) return _forceLogout(email);
    try { await api(`/admin/people/${a.serverId}/logout`, { body: {} }); } catch (err) { fail(err); return; }
    return _forceLogout(email);
  };
  resetPass = async function (email) {
    const a = acc(email); if (!on('admin') || !a || !a.serverId) { toast('Reset link sent to ' + email); return; }
    openConfirmDialog('Reset this password?', `${email} will be signed out everywhere and get a one-time password.`, async () => {
      try { const r = await api(`/admin/people/${a.serverId}/reset-password`, { body: {} }); openConfirmDialog('One-time password', `Give ${email} this password: ${r.temporaryPassword}. ${r.note}`, () => {}); } catch (err) { fail(err); }
    });
  };
  const _setDocDept = setDocDept;
  setDocDept = async function (email, dept) {
    const a = acc(email); if (!on('admin') || !a || !a.serverId) return _setDocDept(email, dept);
    try { await api(`/admin/doctors/${a.serverId}/department`, { body: { department: dept } }); } catch (err) { fail(err); render(); return; }
    return _setDocDept(email, dept);
  };
  const _create = createAccount;
  createAccount = async function () {
    if (!on('admin')) return _create();
    const n = V3.newAcct, h = HOSPITALS.find((x) => x.id === hid());
    if (!/^[a-z0-9]+$/i.test(n.local || '')) { toast('Use letters and numbers for the name'); return; }
    if (n.role === 'staff' && !n.desks.length) { toast('Tick at least one desk'); return; }
    const email = `${n.local.toLowerCase()}.${h.slug}@gmail.com`, temp = 'ML-' + Math.random().toString(36).slice(2, 8) + 'A1';
    const gp = (A.setup && A.setup.departments || []).find((d) => d.name === 'General Physician');
    try {
      await api('/admin/people', { body: { role: n.role, email, name: n.local, password: temp, desks: n.desks, departmentId: gp ? gp.id : undefined, registrationNo: 'To be added', gender: 'Other' } });
      V3.newAcct = { local: '', role: 'staff', desks: [] };
      openConfirmDialog('Account created', `${email} can sign in with the one-time password ${temp}${n.role === 'doctor' ? ' and PIN 1234' : ''}. Ask them to change it.`, () => {});
      reloadAdmin();
    } catch (err) { fail(err); }
  };

  // Doctors
  const docBy = (id) => DOCTORS.find((x) => x.id === id);
  const _leave = toggleLeave;
  toggleLeave = async function (id) {
    const d = docBy(id); if (!on('admin') || !d || !d.serverId) return _leave(id);
    try { await api(`/admin/doctors/${d.serverId}/leave`, { body: { onLeave: !d.onLeave } }); } catch (err) { fail(err); return; }
    return _leave(id);
  };
  const _bookings = toggleBookings;
  toggleBookings = async function (id) {
    const d = docBy(id); if (!on('admin') || !d || !d.serverId) return _bookings(id);
    try { await api(`/admin/doctors/${d.serverId}/bookings`, { body: { open: !d.bookingsOpen } }); } catch (err) { fail(err); return; }
    d.bookingsOpen = !d.bookingsOpen; appendAuditLog(myEmail(), d.bookingsOpen ? 'DOCTOR_BOOKINGS_REOPENED' : 'DOCTOR_PAUSED_FROM_BOOKINGS', d.name); render();
  };

  // Patients: search on the server; opening a record needs a reason and is shown to the patient.
  const _admPatients = admPatients;
  admPatients = function () {
    if (!on('admin')) return _admPatients();
    const q = (V3.patQuery || '').trim();
    if (q.length >= 2 && A.patQ !== q) {
      A.patQ = q;
      api('/admin/patients?q=' + encodeURIComponent(q)).then((rows) => { A.patRows = rows; rows.forEach((r) => live.upsertPatient({ patient_id: r.id, full_name: r.full_name, sex: r.sex, medilink_id: r.medilink_id })); render(); }).catch(fail);
    }
    const rows = q.length >= 2 ? (A.patRows || []) : [];
    const p = V3.patSel ? state.hospitalPatients.find((x) => x.id === V3.patSel) : null;
    const os = p ? V3.orders.filter((o) => o.patientId === p.id) : [];
    return `<div class="card-minimal p-4 space-y-2"><input value="${e(V3.patQuery)}" onchange="V3.patQuery=this.value;V3.patSel=null;render()" placeholder="Search by name or MediLink ID" class="w-full h-11 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta">
        <div class="flex flex-wrap gap-2">${rows.map((r) => `<button onclick="V3.patSel='api-p${r.id}';render()" class="${V3.patSel === 'api-p' + r.id ? BTP : BTS}">${e(r.full_name)} · ${e(r.medilink_id)} · ${r.visits} visit${r.visits === 1 ? '' : 's'}</button>`).join('') || (q.length >= 2 ? '<span class="text-meta text-slate-600">No patient with visits at this hospital matches.</span>' : '<span class="text-meta text-slate-600">Type at least 2 letters.</span>')}</div></div>
      ${p ? `<div class="card-minimal p-4 space-y-3">
        <div><div class="text-t2">${e(p.name)}</div><div class="text-meta text-slate-600">${e(p.sex || '')} · ${e(p.medilinkId)}</div></div>
        <div><div class="text-[12px] font-bold uppercase text-slate-500">Test orders</div>${os.map((o) => `<div class="text-meta">${e(o.test)} · ${ordStatus(o)}</div>`).join('') || '<div class="text-meta text-slate-600">None</div>'}</div>
        <div class="border-t border-slate-200 pt-3 space-y-2"><div class="text-meta text-slate-600 uppercase font-bold">Open clinical content (reason needed, view only, logged, shown to the patient)</div>
          <select onchange="V3.viewReason=this.value;render()" class="h-10 bg-white rounded-xl px-2 border border-slate-300 text-meta"><option value="">Choose a reason</option>${VIEW_REASONS.map((r) => `<option ${V3.viewReason === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <div><button onclick="MediLinkStitch.openRecord('${p.id}')" class="${BTS}">Visits, prescriptions and tests</button></div></div></div>` : ''}`;
  };
  S.openRecord = async function (pid) {
    if (!V3.viewReason) { toast('Choose a reason first'); return; }
    try {
      const r = await api(`/admin/patients/${sid(pid, 'api-p')}/record`, { body: { reason: V3.viewReason } });
      const lines = [r.watermark, '', 'VISITS'].concat(r.visits.map((v) => `${day(v.visit_date)} · ${v.token_no} · ${v.doctor_name || ''} · ${v.status}\n  ${v.symptoms}`),
        ['', 'PRESCRIPTIONS'], r.prescriptions.map((x) => `${dateOf(x.created_at)} · ${x.doctor_name}\n  ${x.text}`), ['', 'TESTS'], r.tests.map((x) => `${x.test_name} · ${x.department} · ${x.status}`));
      V3.viewer = { pid, title: 'Clinical record', body: lines.join('\n') }; render();
    } catch (err) { fail(err); }
  };

  // Conduct alerts
  const incBy = (id) => V3.incidents.find((x) => x.id === id);
  const _dismiss = dismissIncident;
  dismissIncident = async function (id) {
    const i = incBy(id); if (!on('admin') || !i || !i.serverId) return _dismiss(id);
    const r = V3.alertDraft.reason.trim(); if (r.length < 5) { toast('Add a reason to dismiss'); return; }
    try { await api(`/admin/incidents/${i.serverId}/dismiss`, { body: { reason: r } }); } catch (err) { fail(err); return; }
    return _dismiss(id);
  };
  const _place = placeAlert;
  placeAlert = async function () {
    const d = V3.alertDraft;
    const ids = d.sel.map((x) => (incBy(x) || {}).serverId).filter(Boolean);
    if (!on('admin') || !ids.length) return _place();
    if (d.summary.trim().length < 10) { toast('Add a short summary (10+ characters)'); return; }
    const days = d.review ? Math.round((new Date(d.review) - new Date(cToday())) / 86400000) : 90;
    try { const a = await api('/admin/alerts', { body: { incidentIds: ids, summary: d.summary.trim(), reviewDays: days } }); toast(a.status === 'PendingApproval' ? 'Placed. A second Admin must approve.' : 'Alert is active at this hospital'); }
    catch (err) { fail(err); return; }
    V3.alertDraft = { sel: [], category: '', summary: '', start: '', review: '', reason: '' }; reloadAdmin();
  };
  const alertBy = (id) => V3.alerts.find((x) => x.id === id);
  const alertAct = (orig, path) => async function (id) {
    const a = alertBy(id); if (!on('admin') || !a || !a.serverId) return orig(id);
    if (path === 'lift' && V3.alertDraft.reason.trim().length < 5) { toast('Add a reason in the box above'); return; }
    try { await api(`/admin/alerts/${a.serverId}/${path}`, { body: {} }); toast(path === 'approve' ? 'Approved' : path === 'lift' ? 'Alert lifted' : 'Renewed for 90 days after review'); } catch (err) { fail(err); return; }
    V3.alertDraft.reason = ''; reloadAdmin();
  };
  approveAlert = alertAct(approveAlert, 'approve');
  liftAlert = alertAct(liftAlert, 'lift');
  renewAlert = alertAct(renewAlert, 'renew');
  renewExpired = alertAct(renewExpired, 'renew');

  // Setup
  const _suAdj = suAdj;
  suAdj = async function (k, n) {
    if (!on('admin')) return _suAdj(k, n);
    const s = SU(), next = Object.assign({ slotMin: s.slotMin, walk: s.walk, grace: s.grace, fee: s.fee }, { [k]: Math.max(0, s[k] + n) });
    try { await api('/admin/setup', { method: 'PUT', body: { slotMinutes: next.slotMin, walkInSharePct: next.walk, graceMinutes: next.grace, fee: next.fee } }); } catch (err) { fail(err); return; }
    return _suAdj(k, n);
  };
  const _rotate = suRotateQr;
  suRotateQr = async function () {
    if (!on('admin')) return _rotate();
    openConfirmDialog('Rotate the hospital QR codes?', 'The printed hospital and duty QR codes stop working. Print the new ones straight away.', async () => {
      try { await api('/admin/qr/rotate', { body: {} }); } catch (err) { fail(err); return; }
      _rotate();
    });
  };
  const _addField = suAddField;
  suAddField = async function () {
    if (!on('admin')) return _addField();
    const v = (V3.newField || '').trim(); if (!v) return;
    const s = SU();
    try { await api('/admin/setup', { method: 'PUT', body: { slotMinutes: s.slotMin, walkInSharePct: s.walk, graceMinutes: s.grace, fee: s.fee, extraFields: s.fields.concat(v) } }); } catch (err) { fail(err); return; }
    return _addField();
  };
  const _addDept = suAddDept;
  suAddDept = async function () {
    if (!on('admin')) return _addDept();
    const v = (V3.newDept || '').trim(); if (!v) return;
    try { const d = await api('/admin/departments', { body: { name: v, kind: /radiolog|patholog|lab|diagnost|scan|x-ray/i.test(v) ? 'diagnostic' : 'clinical' } }); _addDept(); const last = SU().depts[SU().depts.length - 1]; if (last) last.serverId = d.id; } catch (err) { fail(err); }
  };
  const _toggleDept = suToggleDept;
  suToggleDept = async function (i) {
    const d = SU().depts[i]; if (!on('admin') || !d || !d.serverId) return _toggleDept(i);
    try { await api(`/admin/departments/${d.serverId}/active`, { body: { active: !d.active } }); } catch (err) { fail(err); return; }
    return _toggleDept(i);
  };

  // Reports: live numbers instead of samples.
  const _ops = opsMetrics;
  opsMetrics = function () {
    const rows = _ops(); const o = live.admin && live.admin.ov;
    if (!on('admin') || !o) return rows;
    return rows.map(([k, v]) => [k, k.startsWith('Registrations') ? o.registrationsToday : k.startsWith('Average wait') ? o.averageWaitMinutes : v]);
  };

  // Data requests
  const _advance = advanceRequest;
  advanceRequest = async function (id) {
    const r = V3.requests.find((x) => x.id === id); if (!on('admin') || !r || !r.serverId) return _advance(id);
    try { await api(`/admin/data-requests/${r.serverId}/advance`, { body: {} }); } catch (err) { fail(err); return; }
    return _advance(id);
  };

  // Treatment completion approvals
  const _decide = adminDecideClosure;
  adminDecideClosure = async function (id, approve) {
    if (!(on('admin') && String(id).startsWith('api-cl'))) return _decide(id, approve);
    try { await api(`/admin/closures/${sid(id, 'api-cl')}/${approve ? 'approve' : 'return'}`, { body: {} }); } catch (err) { fail(err); return; }
    const c = state.closures.find((x) => x.id === id); if (c) { c.status = approve ? 'Approved' : 'Returned to doctor'; c.decidedBy = live.user.email; c.decidedAt = 'Just now'; }
    toast(approve ? 'Treatment approved. The summary is in the patient’s Drive.' : 'Returned to doctor'); render();
  };

  /* ======================= BACK NAVIGATION ======================= */
  const ROOT = () => ({
    patient: 'home',
    doctor: 'doctor_dashboard',
    staff: (state.activeDesk ? deskHome() : 'desk_choose'),
    admin: 'admin_dashboard',
    owner: 'owner_console'
  })[state.role] || 'welcome';

  const ROOTS = ['home', 'doctor_dashboard', 'reception_dashboard', 'diag_dashboard', 'admin_dashboard', 'owner_console', 'welcome', 'desk_choose'];
  const TABS = ['flow', 'drive', 'profile', 'notifications', 'doctor_profile', 'hospital_search'];
  const ENTRY = ['splash', 'welcome', 'auth_choice', 'login_email', 'login_pin', 'signup_1', 'signup_2', 'signup_3', 'signup_4', 'signup_5', 'signup_6', 'signup_7', 'signup_8'];
  const ONE_WAY = ['reg_slot_pay', 'reg_token_ready', 'scan_qr', 'doctor_scan', 'doctor_clockin', 'booking_desk_only', 'staff_send_docs', 'diag_correct', 'incident_form'];
  const loggedIn = () => state.role && state.role !== 'visitor';
  const skip = (s) => (loggedIn() && ENTRY.includes(s)) || ONE_WAY.includes(s);

  let syncingBrowser = false;

  const _navigate = navigate;
  navigate = function (screen, push) {
    const isPush = push === undefined ? true : !!push;
    const prev = state.currentScreen;
    const out = _navigate(screen, isPush);
    const h = state.history || [];

    if (ROOTS.includes(screen)) {
      state.history = [];
    } else if (TABS.includes(screen) && loggedIn()) {
      state.history = [ROOT()];
    } else if (isPush && prev && prev !== screen && !skip(prev)) {
      if (!h.includes(prev)) h.push(prev);
      state.history = h.filter((s) => !skip(s) && s !== screen).slice(-25);
    }
    if (screen === 'reg_token_ready') state.history = ['home'];

    // Update browser history
    if (!syncingBrowser && window.history && window.history.pushState) {
      try {
        if (!window.history.state || window.history.state.ml !== screen) {
          window.history.pushState({ ml: screen }, '', '');
        }
      } catch (err) {}
    }

    updateBackButtonVisibility();
    return out;
  };

  goBack = function () {
    if (closeOverlay()) return;
    let prev = null;
    while (state.history && state.history.length) {
      const s = state.history.pop();
      if (!skip(s) && s !== state.currentScreen) {
        prev = s;
        break;
      }
    }
    const target = prev || (state.currentScreen !== ROOT() ? ROOT() : null);
    if (!target) return;

    state.navDir = 'back';
    state.currentScreen = target;
    render();

    // Replace browser state - DO NOT pushState when going back!
    if (window.history && window.history.replaceState) {
      try { window.history.replaceState({ ml: target }, '', ''); } catch (err) {}
    }
    updateBackButtonVisibility();
  };

  function updateBackButtonVisibility() {
    const btn = document.getElementById('top-back-btn');
    if (!btn) return;
    const isRoot = ROOTS.includes(state.currentScreen) || state.currentScreen === ROOT();
    const canGo = (state.history && state.history.length > 0) || !isRoot;
    if (['splash', 'welcome'].includes(state.currentScreen)) {
      btn.style.display = 'none';
    } else if (canGo) {
      btn.style.display = 'flex';
      btn.style.visibility = 'visible';
      document.body.dataset.mlNoback = '0';
    } else {
      btn.style.visibility = 'hidden';
      document.body.dataset.mlNoback = '1';
    }
  }

  // Close an open sheet or dialog first (QR sheet, Drive sheets, confirm dialog, scanner, view switcher).
  function closeOverlay() {
    const docModal = document.getElementById('doctor-switch-modal');
    if (docModal && !docModal.classList.contains('hidden') && docModal.offsetParent !== null) {
      if (window.closeDoctorSwitcherModal) window.closeDoctorSwitcherModal();
      else docModal.classList.add('hidden');
      return true;
    }
    const sheet = document.getElementById('token-qr-sheet');
    if (sheet && !sheet.classList.contains('hidden') && sheet.offsetParent !== null) { closeTokenQRSheet(); return true; }
    const help = document.getElementById('help-sheet');
    if (help && !help.classList.contains('hidden') && help.offsetParent !== null) { closeHelpSheet(); return true; }
    const dlg = document.getElementById('confirm-dialog');
    if (dlg && !dlg.classList.contains('hidden') && dlg.offsetParent !== null) { try { closeConfirmDialog(); } catch (err) { dlg.classList.add('hidden'); } return true; }
    const ov = document.getElementById('drive-overlay');
    if (ov && ov.innerHTML.trim() && !ov.classList.contains('hidden') && ov.offsetParent !== null) { try { closeDriveOverlay(); } catch (err) { /* ignore */ } return true; }
    const top = [...document.querySelectorAll('#device-frame > div')].reverse().find((d) => d.style.zIndex === '90' && d.offsetParent !== null);
    if (top) { const x = top.querySelector('[data-x="close"],[data-x="cancel"],[data-x="no"]'); if (x) x.click(); else top.remove(); return true; }
    return false;
  }

  // Browser back/forward (popstate)
  window.addEventListener('popstate', (event) => {
    syncingBrowser = true;
    try {
      if (closeOverlay()) {
        if (window.history && window.history.replaceState) {
          window.history.replaceState({ ml: state.currentScreen }, '', '');
        }
        return;
      }
      const target = event.state && event.state.ml ? event.state.ml : (state.history && state.history.length ? state.history.pop() : ROOT());
      if (target && target !== state.currentScreen) {
        state.navDir = 'back';
        state.currentScreen = target;
        render();
        updateBackButtonVisibility();
      }
    } finally {
      syncingBrowser = false;
    }
  });

  try {
    if (window.history && window.history.replaceState && (!window.history.state || !window.history.state.ml)) {
      window.history.replaceState({ ml: state.currentScreen || 'welcome' }, '', '');
    }
  } catch (err) {}

  // Android back gesture / button (Capacitor App plugin): back, and leave the app from a home screen.
  const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (app && app.addListener) {
    app.addListener('backButton', () => {
      if (closeOverlay()) return;
      if (ROOTS.includes(state.currentScreen) && !state.history.length) { if (app.minimizeApp) app.minimizeApp(); else app.exitApp(); return; }
      goBack();
    });
  }
})();
