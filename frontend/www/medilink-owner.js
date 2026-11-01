/*
 * MediLink Owner Console (the MediLink company team).
 * Built from the prototype's own admin-panel pieces (card-minimal, kpiC, TH/TD table styles, pill tabs, BTP/BTS buttons),
 * so it looks like the rest of the app. It shows platform metadata only: no patient names, records or reports.
 * Also adds the hospital-admin side of support access (Admin → Requests) and admin notifications.
 */
(function () {
  'use strict';
  const live = window.MediLinkLive;
  if (!live) return;
  const api = live.api;
  const toast = (m) => { try { showToast(m); } catch (e) { console.log(m); } };
  const e = (s) => (typeof esc === 'function' ? esc(s == null ? '' : String(s)) : String(s == null ? '' : s));
  const dt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
  const pill = (txt, cls) => `<span class="px-2.5 py-1 rounded-full text-[12px] font-bold ${cls}">${e(txt)}</span>`;
  const okPill = (s) => pill(s, ['active', 'up', 'Approved', 'Closed', 'Sent'].includes(s) ? 'bg-ok-light text-ok' : ['Pending', 'Open', 'Contained'].includes(s) ? 'bg-warn-light text-warn' : 'bg-emergency-light text-emergency');
  const card = (title, body) => `<div class="card-minimal p-4 space-y-2"><div class="text-meta text-slate-600 uppercase font-bold">${title}</div>${body}</div>`;
  const INPUT = 'h-10 bg-slate-50 rounded-xl px-3 border border-slate-200 text-meta';

  const O = live.owner = { tab: 'overview', data: {}, sel: null, wizard: null, created: null, loading: false };
  const TABS = [['overview', 'Overview'], ['hospitals', 'Hospitals'], ['health', 'System health'], ['settings', 'Settings'], ['compliance', 'Compliance'], ['audit', 'Audit'], ['announcements', 'Announcements']];

  /* ---------- data ---------- */
  async function load(tab) {
    O.loading = true;
    try {
      if (tab === 'overview') { O.data.overview = await api('/platform/overview'); O.data.hospitals = await api('/platform/hospitals'); }
      if (tab === 'hospitals') O.data.hospitals = await api('/platform/hospitals');
      if (tab === 'detail' && O.sel) O.data.detail = await api('/platform/hospitals/' + O.sel);
      if (tab === 'health') O.data.health = await api('/platform/health');
      if (tab === 'settings') O.data.settings = await api('/platform/settings');
      if (tab === 'compliance') O.data.compliance = await api('/platform/compliance');
      if (tab === 'audit') O.data.audit = await api('/platform/audit' + (O.auditFilter ? '?action=' + encodeURIComponent(O.auditFilter) : ''));
      if (tab === 'announcements') { O.data.announcements = await api('/platform/announcements'); if (!O.data.hospitals) O.data.hospitals = await api('/platform/hospitals'); }
    } catch (err) { toast(err.message); }
    O.loading = false;
    if (state.currentScreen === 'owner_console') render();
  }
  O.go = function (tab, id) { O.tab = tab; if (id) O.sel = id; O.created = tab === 'hospitals' ? O.created : null; render(); load(tab); };
  live.openOwner = function () {
    state.role = 'owner'; state.history = [];
    switchViewport('admin');
    navigate('owner_console');
    O.go('overview');
  };

  /* ---------- screens ---------- */
  function overview() {
    const o = O.data.overview; if (!o) return loadingCard();
    const hs = O.data.hospitals || [];
    return `<div class="grid grid-cols-4 gap-3">${kpiC(o.hospitals, 'Hospitals on MediLink', 'text-brand')}${kpiC(o.patients, 'Patients registered')}${kpiC(o.registrationsToday, 'Registrations today', 'text-ok')}${kpiC(o.documentsSent, 'Reports delivered')}</div>
      <div class="grid grid-cols-4 gap-3">${kpiC(o.emergencySearchesToday + ' / ' + o.emergencySearches, 'Emergency searches today / total')}${kpiC(o.suspended, 'Suspended hospitals', o.suspended ? 'text-warn' : 'text-ink')}${kpiC(o.openIncidents, 'Open security incidents', o.openIncidents ? 'text-emergency' : 'text-ink')}${kpiC(o.pendingSupport, 'Support requests waiting')}</div>
      ${card('System status', `<div class="flex items-center justify-between"><div class="text-t2 font-bold ${o.systemStatus === 'All systems normal' ? 'text-ok' : 'text-emergency'}">${e(o.systemStatus)}</div><button onclick="MediLinkLive.owner.go('health')" class="${BTS}">Open system health</button></div>`)}
      ${card('Most active hospitals (last 30 days)', hospitalTable(hs.slice().sort((a, b) => b.registrations_30d - a.registrations_30d).slice(0, 5), false))}`;
  }

  function hospitalTable(hs, actions) {
    if (!hs.length) return '<p class="text-meta text-slate-600">No hospitals yet.</p>';
    return `<table class="w-full"><thead><tr><th class="${TH}">Hospital</th><th class="${TH}">Type</th><th class="${TH}">Connector</th><th class="${TH}">Registrations (30d)</th><th class="${TH}">Staff</th><th class="${TH}">Last activity</th><th class="${TH}">Status</th>${actions ? `<th class="${TH}"></th>` : ''}</tr></thead><tbody class="divide-y divide-slate-200/70">
      ${hs.map((h) => `<tr><td class="${TD}"><button onclick="MediLinkLive.owner.go('detail', ${h.id})" class="font-bold underline text-left">${e(h.name)}</button><div class="text-[12px] text-slate-600">${e(h.area)} · ${e(h.slug)}</div></td><td class="${TD}">${e(h.type)}</td><td class="${TD}">${e(h.connector_mode)}</td><td class="${TD}">${h.registrations_30d}</td><td class="${TD}">${h.active_staff}</td><td class="${TD}">${dt(h.last_activity)}</td><td class="${TD}">${okPill(h.status)}</td>
      ${actions ? `<td class="${TD}"><div class="flex gap-1.5"><button onclick="MediLinkLive.owner.go('detail', ${h.id})" class="${BTS}">Open</button><button onclick="MediLinkLive.owner.setStatus(${h.id}, '${h.status === 'active' ? 'suspended' : 'active'}', '${e(h.name).replace(/'/g, '')}')" class="${BTS}">${h.status === 'active' ? 'Suspend' : 'Reactivate'}</button></div></td>` : ''}</tr>`).join('')}</tbody></table>`;
  }

  function hospitals() {
    const hs = O.data.hospitals; if (!hs) return loadingCard();
    return `${O.created ? createdCard() : ''}
      <div class="flex justify-end"><button onclick="MediLinkLive.owner.openWizard()" class="${BTP} flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i> Add hospital</button></div>
      ${O.wizard ? wizard() : ''}
      ${card('Hospitals on MediLink', hospitalTable(hs, true))}`;
  }

  /* Add-hospital wizard: details → location and connector → first admin → done (QR codes) */
  O.openWizard = function () { O.wizard = { step: 1, type: 'Private', connectorMode: 'MediLink Lite', lat: '19.07', lng: '72.88' }; O.created = null; render(); };
  O.w = function (k, v) { O.wizard[k] = v; };
  O.step = function (n) {
    const w = O.wizard;
    if (n > w.step) {
      if (w.step === 1 && (!(w.name || '').trim() || !/^[a-z0-9-]{3,30}$/.test(w.slug || '') || !(w.area || '').trim())) { toast('Enter the hospital name, a short name (3-30 lower-case letters, numbers or dashes) and the area.'); return; }
      if (w.step === 2) { const la = Number(w.lat), lo = Number(w.lng); if (!(la >= 6 && la <= 37 && lo >= 68 && lo <= 98)) { toast('Location must be inside India (latitude 6-37, longitude 68-98).'); return; } }
    }
    w.step = n; render();
  };
  function wizard() {
    const w = O.wizard;
    const f = (k, label, ph, type) => `<label class="block space-y-1"><span class="text-[12px] font-bold text-slate-600 uppercase">${label}</span><input ${type ? `type="${type}"` : ''} value="${e(w[k] || '')}" oninput="MediLinkLive.owner.w('${k}', this.value)" placeholder="${ph}" class="${INPUT} w-full"></label>`;
    const sel = (k, label, opts) => `<label class="block space-y-1"><span class="text-[12px] font-bold text-slate-600 uppercase">${label}</span><select onchange="MediLinkLive.owner.w('${k}', this.value)" class="${INPUT} w-full">${opts.map((o) => `<option ${w[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    const steps = ['Hospital details', 'Location and connector', 'First admin'];
    const body = w.step === 1 ? `<div class="grid grid-cols-2 gap-3">${f('name', 'Hospital name', 'e.g. Sunrise Multispeciality Hospital')}${f('slug', 'Short name (used in staff emails)', 'e.g. sunrise')}${f('area', 'Area', 'e.g. Andheri East')}${f('address', 'Full address', 'Street, city, PIN')}${sel('type', 'Type', ['Private', 'Government', 'Trust'])}${f('phone', 'Phone', 'e.g. 022 4000 0000')}</div>`
      : w.step === 2 ? `<div class="grid grid-cols-2 gap-3">${f('lat', 'Latitude', '19.07')}${f('lng', 'Longitude', '72.88')}${sel('connectorMode', 'How it connects', ['MediLink Lite', 'FHIR/REST', 'HL7 v2', 'File-drop agent'])}<div class="text-[12px] text-slate-600 self-end pb-2">MediLink Lite: the hospital uses MediLink screens directly. The others link to an existing hospital system.</div></div>`
        : `<div class="grid grid-cols-2 gap-3">${f('adminName', 'Admin name', 'e.g. Priya Nair')}${f('adminEmail', 'Admin email', 'admin.sunrise@gmail.com', 'email')}</div><p class="text-[12px] text-slate-600">A temporary password is created once and shown on the next screen. Default departments are added automatically.</p>`;
    return card(`Add hospital · step ${w.step} of 3 · ${steps[w.step - 1]}`, `${body}
      <div class="flex justify-between pt-2"><button onclick="${w.step === 1 ? 'MediLinkLive.owner.wizard=null;render()' : `MediLinkLive.owner.step(${w.step - 1})`}" class="${BTS}">${w.step === 1 ? 'Cancel' : 'Back'}</button>
      ${w.step < 3 ? `<button onclick="MediLinkLive.owner.step(${w.step + 1})" class="${BTP}">Next</button>` : `<button onclick="MediLinkLive.owner.create(this)" class="${BTP}">Create hospital</button>`}</div>`);
  }
  O.create = async function (btn) {
    const w = O.wizard; if (btn) btn.disabled = true;
    try {
      const r = await api('/platform/hospitals', { body: { name: w.name, slug: w.slug, area: w.area, address: w.address, type: w.type, phone: w.phone, lat: Number(w.lat), lng: Number(w.lng), connectorMode: w.connectorMode, adminName: w.adminName, adminEmail: w.adminEmail } });
      O.created = Object.assign({ name: w.name }, r); O.wizard = null; toast('Hospital created'); load('hospitals');
    } catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  };
  function qrSvg(text, size) {
    if (typeof qrcode !== 'function') return `<div class="text-[11px] break-all font-mono">${e(text)}</div>`;
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: Math.max(2, Math.floor(size / (q.getModuleCount() + 8))), margin: 4, scalable: false }).replace(/width="\d+px" height="\d+px"/, 'width="100%" height="100%"');
  }
  function createdCard() {
    const c = O.created;
    return `<div id="ml-print-qr" class="card-minimal p-4 space-y-3"><div class="flex items-center justify-between"><div class="text-meta text-slate-600 uppercase font-bold">${e(c.name)} is live</div><div class="flex gap-2"><button onclick="MediLinkLive.owner.printQr()" class="${BTP} flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i> Print QR codes</button><button onclick="MediLinkLive.owner.created=null;render()" class="${BTS}">Done</button></div></div>
      <div class="px-3 py-2 rounded-xl bg-warn-light text-warn text-meta font-semibold">Admin sign-in: <b>${e(c.admin.email)}</b> · temporary password <b class="font-mono">${e(c.admin.temporaryPassword)}</b>. ${e(c.admin.note)}</div>
      <div class="grid grid-cols-2 gap-4">${[['Hospital QR (entrance and reception)', c.hospitalQr, 'Patients scan this to register.'], ['Duty QR (doctors’ room)', c.dutyQr, 'Doctors scan this to clock in.']].map(([t, code, n]) => `<div class="rounded-2xl border border-slate-200 p-4 text-center space-y-2"><div class="font-bold text-ink">${t}</div><div class="mx-auto" style="width:192px;height:192px">${qrSvg(code, 192)}</div><div class="text-[12px] text-slate-600">${n}</div></div>`).join('')}</div></div>`;
  }
  O.printQr = function () {
    const el = document.getElementById('ml-print-qr'); if (!el) return;
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>MediLink QR codes</title><style>body{font-family:Inter,Arial,sans-serif;padding:24px}button,.bg-warn-light{display:none}.grid{display:flex;gap:24px}.grid>div{flex:1;border:1px solid #ccc;border-radius:16px;padding:16px;text-align:center}svg{width:240px;height:240px}</style></head><body>${el.innerHTML}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };
  O.setStatus = async function (id, status, name) {
    const reason = prompt(status === 'suspended' ? `Suspend ${name}?\nNew sign-ins, registrations and QR scans will be blocked. All data is kept.\n\nReason (required):` : `Reactivate ${name}?\n\nReason (required):`);
    if (!reason || reason.trim().length < 3) { if (reason !== null) toast('Please give a reason.'); return; }
    try { const r = await api(`/platform/hospitals/${id}/status`, { body: { status, reason } }); toast(r.message); load(O.tab === 'detail' ? 'detail' : 'hospitals'); }
    catch (err) { toast(err.message); }
  };

  function detail() {
    const d = O.data.detail; if (!d || d.id !== O.sel) return loadingCard();
    const max = Math.max(1, ...d.usage.map((u) => u.registrations));
    const mb = (d.storageBytes / 1048576).toFixed(d.storageBytes > 1048576 ? 1 : 3);
    return `<div class="flex items-center justify-between"><button onclick="MediLinkLive.owner.go('hospitals')" class="${BTS} flex items-center gap-1"><i data-lucide="arrow-left" class="w-4 h-4"></i> All hospitals</button>
        <div class="flex gap-2 items-center">${okPill(d.status)}<button onclick="MediLinkLive.owner.setStatus(${d.id}, '${d.status === 'active' ? 'suspended' : 'active'}', '${e(d.name).replace(/'/g, '')}')" class="${BTS}">${d.status === 'active' ? 'Suspend' : 'Reactivate'}</button></div></div>
      <div><h2 class="text-t2 font-bold text-ink">${e(d.name)}</h2><p class="text-meta text-slate-600">${e(d.address)} · ${e(d.type)} · plan ${e(d.plan)} · on MediLink since ${dt(d.created_at)}</p></div>
      <div class="grid grid-cols-5 gap-3">${kpiC(d.counts.doctors, 'Doctors')}${kpiC(d.counts.staff, 'Staff')}${kpiC(d.counts.registrations, 'Registrations', 'text-brand')}${kpiC(d.counts.tests, 'Tests')}${kpiC(mb + ' MB', 'Report storage')}</div>
      ${card('Registrations, last 14 days', `<div class="flex items-end gap-1.5 h-32">${d.usage.map((u) => `<div class="flex-1 flex flex-col items-center justify-end gap-1 h-full" title="${u.registrations} on ${new Date(u.day).toDateString()}"><div class="text-[11px] text-slate-600">${u.registrations || ''}</div><div class="w-full rounded-t-md bg-[#0a6a74]" style="height:${Math.max(2, (u.registrations / max) * 100)}%"></div><div class="text-[10px] text-slate-500">${new Date(u.day).getDate()}</div></div>`).join('')}</div>`)}
      <div class="grid grid-cols-2 gap-4">
        ${card('Connector health', `<div class="text-meta"><b>${e(d.connector.mode)}</b></div><div class="text-meta text-slate-600">${e(d.connector.note)}</div><div class="grid grid-cols-3 gap-2 pt-1 text-meta"><div>Last success<br><b>${dt(d.connector.lastSuccess)}</b></div><div>Error rate<br><b>${d.connector.errorRate}%</b></div><div>Retry queue<br><b>${d.connector.retryQueue}</b></div></div>`)}
        ${card('Hospital admins', d.admins.map((a) => `<div class="text-meta flex justify-between"><span><b>${e(a.name)}</b> · ${e(a.email)}</span>${okPill(a.active ? 'active' : 'Deactivated')}</div>`).join('') || '<p class="text-meta text-slate-600">No admin.</p>')}
      </div>
      ${card('Support access (break-glass)', `<p class="text-meta text-slate-600">MediLink staff never open hospital data on their own. You can only ask; the hospital admin approves, and access ends automatically.</p>
        <div class="flex flex-wrap gap-2 items-center"><input id="ml-sup-reason" placeholder="Reason, e.g. ticket #142: reports not reaching patients" class="${INPUT} flex-1 min-w-[280px]"><select id="ml-sup-hours" class="${INPUT}">${[2, 4, 8, 24].map((h) => `<option value="${h}" ${h === 4 ? 'selected' : ''}>${h} hours</option>`).join('')}</select><button onclick="MediLinkLive.owner.askSupport(${d.id})" class="${BTP}">Send request</button></div>
        ${d.support.length ? `<table class="w-full"><thead><tr><th class="${TH}">Asked</th><th class="${TH}">Reason</th><th class="${TH}">Hours</th><th class="${TH}">Status</th><th class="${TH}">Expires</th></tr></thead><tbody class="divide-y divide-slate-200/70">${d.support.map((g) => `<tr><td class="${TD}">${dt(g.created_at)}</td><td class="${TD}">${e(g.reason)}</td><td class="${TD}">${g.hours}</td><td class="${TD}">${okPill(g.status)}${g.approved_by_name ? `<div class="text-[11px] text-slate-600 pt-1">${e(g.approved_by_name)}</div>` : ''}</td><td class="${TD}">${dt(g.expires_at)}</td></tr>`).join('')}</tbody></table>` : ''}`)}`;
  }
  O.askSupport = async function (id) {
    const reason = (document.getElementById('ml-sup-reason') || {}).value || '';
    const hours = Number((document.getElementById('ml-sup-hours') || {}).value || 4);
    try { await api(`/platform/hospitals/${id}/support-access`, { body: { reason, hours } }); toast('Request sent to the hospital admin'); load('detail'); }
    catch (err) { toast(err.message); }
  };

  function health() {
    const h = O.data.health; if (!h) return loadingCard();
    return `<div class="grid grid-cols-3 gap-3">${kpiC(h.services.filter((s) => s.status === 'up').length + ' / ' + h.services.length, 'Services up', 'text-ok')}${kpiC(h.queueDepth, 'Patients in queues now')}${kpiC(h.deniedAccess24h, 'Blocked access attempts (24h)', h.deniedAccess24h ? 'text-warn' : 'text-ink')}</div>
      ${card(`Services · checked ${dt(h.checkedAt)}`, `<table class="w-full"><thead><tr><th class="${TH}">Service</th><th class="${TH}">Status</th><th class="${TH}">Detail</th></tr></thead><tbody class="divide-y divide-slate-200/70">${h.services.map((s) => `<tr><td class="${TD} font-bold">${e(s.name)}</td><td class="${TD}">${okPill(s.status)}</td><td class="${TD}">${e(s.detail)}</td></tr>`).join('')}</tbody></table>
        <div class="flex justify-end"><button onclick="MediLinkLive.owner.go('health')" class="${BTS}">Check again</button></div>`)}`;
  }

  const FEATURE_NAMES = { emergencyFinder: 'Emergency hospital finder', voiceInput: 'Voice input for symptoms', referrals: 'Referrals between hospitals', insuranceCards: 'Insurance cards in profile', smsFallback: 'SMS fallback for patients without the app' };
  function settings() {
    const s = O.data.settings; if (!s) return loadingCard();
    const num = (k, label, unit) => `<label class="block space-y-1"><span class="text-[12px] font-bold text-slate-600 uppercase">${label}</span><div class="flex items-center gap-2"><input id="ml-set-${k}" type="number" value="${s[k]}" class="${INPUT} w-32"><span class="text-meta text-slate-600">${unit}</span></div></label>`;
    return `${card('Storage and retention', `<div class="grid grid-cols-4 gap-3">${num('patientQuotaMb', 'Patient Drive quota', 'MB')}${num('maxFileMb', 'Largest upload', 'MB')}${num('retentionYears', 'Keep medical records', 'years')}${num('auditLogRetentionDays', 'Keep audit logs', 'days')}</div><p class="text-[12px] text-slate-600">Medical records are kept for at least 3 years; audit logs for at least 180 days (CERT-In).</p>`)}
      ${card('Features', Object.keys(s.features).map((k) => `<label class="flex items-center justify-between py-1.5 text-meta"><span>${e(FEATURE_NAMES[k] || k)}</span><input type="checkbox" id="ml-feat-${k}" ${s.features[k] ? 'checked' : ''} class="w-5 h-5 accent-[#0a6a74]"></label>`).join(''))}
      ${card('Plans', `<div class="flex gap-2 flex-wrap">${s.plans.map((p) => pill(p, 'bg-brand-light text-brand-accent')).join('')}</div>`)}
      <div class="flex justify-end"><button onclick="MediLinkLive.owner.saveSettings(this)" class="${BTP}">Save settings</button></div>`;
  }
  O.saveSettings = async function (btn) {
    const s = O.data.settings; const body = { features: {} };
    ['patientQuotaMb', 'maxFileMb', 'retentionYears', 'auditLogRetentionDays'].forEach((k) => { body[k] = Number(document.getElementById('ml-set-' + k).value); });
    Object.keys(s.features).forEach((k) => { body.features[k] = document.getElementById('ml-feat-' + k).checked; });
    if (btn) btn.disabled = true;
    try { O.data.settings = await api('/platform/settings', { method: 'PUT', body }); toast('Settings saved'); render(); }
    catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  };

  function countdown(deadline, doneAt) {
    if (doneAt) return pill('Reported ' + dt(doneAt), 'bg-ok-light text-ok');
    if (!deadline) return '<span class="text-[12px] text-slate-600">Not needed</span>';
    const ms = new Date(deadline).getTime() - Date.now();
    if (ms <= 0) return pill('Overdue', 'bg-emergency-light text-emergency');
    const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
    return pill(`${h}h ${m}m left`, h < 2 ? 'bg-emergency-light text-emergency' : 'bg-warn-light text-warn');
  }
  function compliance() {
    const c = O.data.compliance; if (!c) return loadingCard();
    const reqs = c.requests.map((r) => `${r.kind} · ${r.status}: <b>${r.n}</b>`).join('<br>') || 'None yet';
    return `<div class="grid grid-cols-4 gap-3">${kpiC(c.incidents.filter((i) => i.status !== 'Closed').length, 'Open incidents', 'text-emergency')}${kpiC(c.consents.active, 'Active patient consents', 'text-ok')}${kpiC(c.consents.revoked, 'Consents withdrawn')}${kpiC(c.auditChain.ok ? 'Intact' : 'Broken', 'Audit chain (' + c.auditChain.checked + ' entries)', c.auditChain.ok ? 'text-ok' : 'text-emergency')}</div>
      ${card('Security incidents · CERT-In 6-hour and DPDP Board 72-hour clocks', `<div class="flex flex-wrap gap-2 items-center"><input id="ml-inc-title" placeholder="What happened, e.g. unusual logins on reception account" class="${INPUT} flex-1 min-w-[260px]"><select id="ml-inc-kind" class="${INPUT}">${['Security breach', 'Data leak', 'Outage', 'Malware', 'Other'].map((k) => `<option>${k}</option>`).join('')}</select><select id="ml-inc-sev" class="${INPUT}">${['Low', 'Medium', 'High', 'Critical'].map((k) => `<option ${k === 'High' ? 'selected' : ''}>${k}</option>`).join('')}</select><label class="text-meta flex items-center gap-1.5"><input id="ml-inc-pd" type="checkbox" class="w-4 h-4"> Personal data involved</label><button onclick="MediLinkLive.owner.openIncident()" class="${BTP}">Open incident</button></div>
        ${c.incidents.length ? `<table class="w-full"><thead><tr><th class="${TH}">Incident</th><th class="${TH}">Detected</th><th class="${TH}">Status</th><th class="${TH}">CERT-In (6h)</th><th class="${TH}">DPDP Board (72h)</th><th class="${TH}"></th></tr></thead><tbody class="divide-y divide-slate-200/70">${c.incidents.map((i) => `<tr><td class="${TD}"><b>${e(i.title)}</b><div class="text-[12px] text-slate-600">${e(i.kind)} · ${e(i.severity)}</div></td><td class="${TD}">${dt(i.detected_at)}</td><td class="${TD}">${okPill(i.status)}</td><td class="${TD}">${countdown(i.certinDeadline, i.certin_reported_at)}</td><td class="${TD}">${countdown(i.dpbDeadline, i.dpb_reported_at)}</td>
          <td class="${TD}"><div class="flex gap-1.5 flex-wrap">${!i.certin_reported_at ? `<button onclick="MediLinkLive.owner.incident(${i.id},'certin')" class="${BTS}">CERT-In reported</button>` : ''}${i.personal_data && !i.dpb_reported_at ? `<button onclick="MediLinkLive.owner.incident(${i.id},'dpb')" class="${BTS}">Board reported</button>` : ''}${i.status === 'Open' ? `<button onclick="MediLinkLive.owner.incident(${i.id},'contain')" class="${BTS}">Contained</button>` : ''}${i.status !== 'Closed' ? `<button onclick="MediLinkLive.owner.incident(${i.id},'close')" class="${BTS}">Close</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<p class="text-meta text-slate-600">No incidents recorded.</p>'}`)}
      <div class="grid grid-cols-2 gap-4">${card('Patient data requests', `<div class="text-meta">${reqs}</div>`)}${card('Keys and rotation', c.keys.map((k) => `<div class="text-meta"><b>${e(k.name)}</b> · ${e(k.protects)}<div class="text-[12px] text-slate-600">${e(k.rotation)}</div></div>`).join(''))}</div>`;
  }
  O.openIncident = async function () {
    const v = (id) => document.getElementById(id);
    try { await api('/platform/incidents', { body: { title: v('ml-inc-title').value, kind: v('ml-inc-kind').value, severity: v('ml-inc-sev').value, personalData: v('ml-inc-pd').checked } }); toast('Incident opened. The 6-hour CERT-In clock has started.'); load('compliance'); }
    catch (err) { toast(err.message); }
  };
  O.incident = async function (id, action) {
    try { await api(`/platform/incidents/${id}/update`, { body: { action } }); load('compliance'); } catch (err) { toast(err.message); }
  };

  function audit() {
    const a = O.data.audit; if (!a) return loadingCard();
    return `${card('Platform activity (no patient details)', `<div class="flex flex-wrap gap-2 items-center"><input id="ml-aud-f" value="${e(O.auditFilter || '')}" placeholder="Filter by action, e.g. LOGIN, PLATFORM, DENIED" class="${INPUT} flex-1 min-w-[260px]"><button onclick="MediLinkLive.owner.auditFilter=document.getElementById('ml-aud-f').value.trim();MediLinkLive.owner.go('audit')" class="${BTS}">Filter</button><button onclick="MediLinkLive.owner.verify()" class="${BTP} flex items-center gap-1.5"><i data-lucide="shield-check" class="w-4 h-4"></i> Verify hash chain</button></div>
      ${O.verifyNote ? `<div class="px-3 py-2 rounded-xl ${O.verifyOk ? 'bg-ok-light text-ok' : 'bg-emergency-light text-emergency'} text-meta font-semibold">${e(O.verifyNote)}</div>` : ''}
      <table class="w-full"><thead><tr><th class="${TH}">#</th><th class="${TH}">When</th><th class="${TH}">Who</th><th class="${TH}">Action</th><th class="${TH}">Hospital</th></tr></thead><tbody class="divide-y divide-slate-200/70">${a.map((x) => `<tr><td class="${TD}">${x.id}</td><td class="${TD}">${dt(x.at)}</td><td class="${TD}">${e(x.user_email || 'system')}<div class="text-[12px] text-slate-600">${e(x.role || '')}${x.desk ? ' · ' + e(x.desk) : ''}</div></td><td class="${TD} font-mono text-[12px]">${e(x.action)}</td><td class="${TD}">${e(x.hospital_name || '—')}</td></tr>`).join('')}</tbody></table>`)}`;
  }
  O.verify = async function () {
    try { const r = await api('/platform/audit/verify'); O.verifyOk = r.ok; O.verifyNote = r.ok ? `Audit chain intact: ${r.checked} entries verified (SHA-256).` : `Audit chain broken at entry #${r.brokenAt}. Investigate now.`; render(); }
    catch (err) { toast(err.message); }
  };

  function announcements() {
    const a = O.data.announcements; if (!a) return loadingCard();
    const hs = O.data.hospitals || [];
    return `${card('Send an announcement to hospital admins and staff', `<div class="grid grid-cols-3 gap-3"><input id="ml-ann-title" placeholder="Title, e.g. Planned maintenance Sunday 2 am" class="${INPUT} col-span-2"><select id="ml-ann-h" class="${INPUT}"><option value="">All hospitals</option>${hs.map((h) => `<option value="${h.id}">${e(h.name)}</option>`).join('')}</select><textarea id="ml-ann-body" rows="3" placeholder="Message" class="col-span-3 bg-slate-50 rounded-xl p-3 border border-slate-200 text-meta"></textarea></div><div class="flex justify-end"><button onclick="MediLinkLive.owner.announce(this)" class="${BTP}">Send</button></div>`)}
      ${card('Sent', a.length ? a.map((x) => `<div class="py-2 border-b border-slate-200/70 last:border-0"><div class="text-meta font-bold text-ink">${e(x.title)}</div><div class="text-meta">${e(x.body)}</div><div class="text-[12px] text-slate-600">${dt(x.created_at)} · ${e(x.hospital_name || 'All hospitals')}</div></div>`).join('') : '<p class="text-meta text-slate-600">Nothing sent yet.</p>')}`;
  }
  O.announce = async function (btn) {
    const v = (id) => document.getElementById(id).value;
    if (btn) btn.disabled = true;
    try { const r = await api('/platform/announcements', { body: { title: v('ml-ann-title'), body: v('ml-ann-body'), hospitalId: v('ml-ann-h') || null } }); toast(`Sent to ${r.recipients} people`); load('announcements'); }
    catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  };

  const loadingCard = () => card('Loading', `<p class="text-meta text-slate-600">${live.online === false ? 'Cannot reach the MediLink server.' : 'Fetching the latest from the server…'}</p>`);

  function renderOwnerConsole() {
    const view = { overview, hospitals, detail, health, settings, compliance, audit, announcements }[O.tab] || overview;
    const activeTab = O.tab === 'detail' ? 'hospitals' : O.tab;
    return `<div class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div><h1 class="text-t1">MediLink Owner Console</h1><p class="text-meta font-semibold text-slate-600">${e((live.user && live.user.email) || '')}</p></div>
        <div class="px-3 py-2 rounded-xl bg-[#ddf4f6] text-[#0a6a74] text-[12px] font-bold flex items-center gap-1.5"><i data-lucide="eye-off" class="w-4 h-4"></i> Platform metadata only. No patient records are visible here.</div>
      </div>
      <div class="flex flex-wrap gap-2">${TABS.map(([k, l]) => `<button onclick="MediLinkLive.owner.go('${k}')" class="h-10 px-4 rounded-full text-meta font-bold ${activeTab === k ? 'bg-ink text-white' : 'bg-white border border-slate-300 text-ink'}">${l}</button>`).join('')}</div>
      ${view()}
    </div>`;
  }

  /* ---------- hospital admin: support access requests and notifications (added to the prototype's Requests tab) ---------- */
  const A = live.adminExtra = { support: null, notes: null };
  async function loadAdminExtra() {
    try { A.support = await api('/admin/support-requests'); A.notes = await api('/admin/notifications'); if (state.currentScreen === 'admin_dashboard') render(); } catch (err) { /* offline: prototype data only */ }
  }
  A.decide = async function (id, decision) {
    try { await api(`/admin/support-requests/${id}/${decision}`, { body: {} }); toast(decision === 'approve' ? 'Access approved. It ends automatically.' : 'Request rejected'); loadAdminExtra(); }
    catch (err) { toast(err.message); }
  };
  if (typeof admRequests === 'function') {
    const _admRequests = admRequests;
    admRequests = function () {
      let out = _admRequests();
      if (!(live.user && live.user.role === 'admin')) return out;
      if (!A.support) { loadAdminExtra(); return out; }
      const sup = card('MediLink support access requests (break-glass)', A.support.length ? `<table class="w-full"><thead><tr><th class="${TH}">From</th><th class="${TH}">Reason</th><th class="${TH}">Hours</th><th class="${TH}">Status</th><th class="${TH}"></th></tr></thead><tbody class="divide-y divide-slate-200/70">${A.support.map((g) => `<tr><td class="${TD}">${e(g.requested_by_email)}<div class="text-[12px] text-slate-600">${dt(g.created_at)}</div></td><td class="${TD}">${e(g.reason)}</td><td class="${TD}">${g.hours}</td><td class="${TD}">${okPill(g.status)}${g.expires_at ? `<div class="text-[11px] text-slate-600 pt-1">ends ${dt(g.expires_at)}</div>` : ''}</td><td class="${TD}">${g.status === 'Pending' ? `<div class="flex gap-2"><button onclick="MediLinkLive.adminExtra.decide(${g.id},'approve')" class="${BTP}">Approve</button><button onclick="MediLinkLive.adminExtra.decide(${g.id},'reject')" class="${BTS}">Reject</button></div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-meta text-slate-600">No requests from MediLink support.</p>');
      const notes = card('Messages from MediLink', (A.notes || []).slice(0, 8).map((n) => `<div class="text-meta py-1"><b>${e(n.title)}</b> · ${e(n.body)}<div class="text-[12px] text-slate-600">${dt(n.created_at)}</div></div>`).join('') || '<p class="text-meta text-slate-600">No messages.</p>');
      return sup + notes + out;
    };
  }

  /* ---------- hook into the prototype's render ---------- */
  const _render = render;
  render = function () {
    const out = _render.apply(this, arguments);
    if (state.currentScreen === 'owner_console') {
      const c = document.getElementById('screen-container');
      c.innerHTML = renderOwnerConsole();
      document.body.dataset.mlNoback = O.tab === 'detail' ? '0' : '1';
      if (window.lucide) lucide.createIcons();
    }
    if (state.currentScreen === 'admin_dashboard' && typeof V3 !== 'undefined' && V3.adminTab === 'requests' && live.user && live.user.role === 'admin' && !A._loaded) { A._loaded = true; loadAdminExtra(); }
    else if (state.role !== 'owner') document.body.dataset.mlNoback = '0';
    return out;
  };
  const st = document.createElement('style'); st.textContent = 'body[data-ml-noback="1"] #top-back-btn{visibility:hidden}'; document.head.appendChild(st);
  // Back from a hospital page returns to the list.
  const _goBack = goBack;
  goBack = function () { if (state.currentScreen === 'owner_console') { if (O.tab === 'detail') O.go('hospitals'); return; } return _goBack.apply(this, arguments); };
  setInterval(() => { if (state.currentScreen === 'owner_console' && ['overview', 'health', 'compliance'].includes(O.tab)) load(O.tab); }, 30000);
})();
