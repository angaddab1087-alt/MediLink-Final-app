/*
 * MediLink Live connector
 * ------------------------------------------------------------
 * The app UI is the original MediLink prototype (index.html), unchanged.
 * This file loads after it and connects the prototype's screens to the real
 * MediLink API. Nothing in the design is replaced: the connector only
 *   1. sends actions (log in, sign up, book a token, check in, clock in, scan, prescribe, verify audit) to the server, and
 *   2. fills the prototype's own data lists with live data from the server, then lets the prototype render them.
 * If the server cannot be reached, the prototype keeps working with its built-in demo data.
 */
(function () {
  'use strict';

  /* ---------- server address, session ---------- */
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const defaultServer = window.MEDILINK_API_URL
    || (isNative ? 'http://10.0.2.2:4000/api' : (location.protocol.startsWith('http') ? `${location.protocol}//${location.hostname || 'localhost'}:4000/api` : 'http://localhost:4000/api'));

  const live = window.MediLinkLive = {
    server: LS.get('medilink.server') || defaultServer,
    token: LS.get('medilink.token'),
    user: null,
    pinToken: null,
    signup: {},
    online: false,
  };

  async function api(path, opts) {
    opts = opts || {};
    let r;
    try {
      r = await fetch(live.server + path, {
        method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
        headers: Object.assign({ 'Content-Type': 'application/json' }, live.token ? { Authorization: 'Bearer ' + live.token } : {}),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      live.online = false;
      const err = new Error('Cannot reach the MediLink server.'); err.offline = true; throw err;
    }
    live.online = true;
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      const msg = (data && (Array.isArray(data.message) ? data.message.join(' ') : data.message)) || ('Request failed (' + r.status + ')');
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return data;
  }
  live.api = api;
  live.hospitals = () => hospitalsBySlug();
  live.protoHospital = (serverId) => protoHospitalIdFromServer(serverId);
  live.serverHospitalId = (protoId) => serverHospitalId(protoId);
  live.extraLoaders = {};
  // A live patient in the prototype's hospitalPatients list (used by reception, diagnostics and doctor screens).
  live.upsertPatient = function (r) {
    const id = 'api-p' + r.patient_id;
    let p = state.hospitalPatients.find((x) => x.id === id);
    if (!p) { p = { id }; state.hospitalPatients.push(p); }
    Object.assign(p, { name: r.full_name, dob: r.dob ? String(r.dob).slice(0, 10) : '', age: ageOf(r.dob), sex: r.sex || '', phoneLast4: r.phone_last4 || '', medilinkId: r.medilink_id || '', uhid: r.medilink_id || '', abhaMasked: '', abhaNumber: '', hospitalId: (typeof hid === 'function' ? hid() : state.activeHospitalId) || 'hosp-1', verified: true, livePatientId: r.patient_id });
    return p;
  };
  const toast = (m) => { try { showToast(m); } catch (e) { console.log(m); } };
  const isLive = () => !!(live.token && live.user);
  live.isLive = isLive; live.toast = toast;

  /* ---------- id mapping between prototype data and the server ---------- */
  // Prototype hospitals are 'hosp-1'..'hosp-5' (Kokilaben, Lilavati, Nanavati, Hinduja, KEM); the server uses the same slugs.
  let serverHospitals = null;
  async function hospitalsBySlug() {
    if (!serverHospitals) serverHospitals = await api('/hospitals');
    return serverHospitals;
  }
  async function serverHospitalId(protoId) {
    const h = HOSPITALS.find((x) => x.id === protoId);
    const list = await hospitalsBySlug();
    const s = h && list.find((x) => x.slug === h.slug);
    return s ? s.id : null;
  }
  function protoHospitalIdFromServer(id) {
    const s = (serverHospitals || []).find((x) => x.id === id);
    const h = s && HOSPITALS.find((x) => x.slug === s.slug);
    return h ? h.id : 'hosp-1';
  }
  // Prototype doctor emails use a capital letter (drA.kokilaben@gmail.com); the server stores emails in lower case.
  function protoEmail(email) {
    const d = DOCTORS.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
    return d ? d.email : email;
  }
  const initials = (n) => String(n || '?').replace(/^Dr\.?\s*/i, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const ageOf = (dob) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000) : '');
  const sex1 = (s) => (s ? s[0] : '');
  const PALETTE = [['#ddf4f6', '#0a6a74'], ['#FCE7F3', '#BE185D'], ['#DCFCE7', '#15803D'], ['#FEF3C7', '#B45309'], ['#EDE9FE', '#6D28D9']];
  const timeOf = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  /* ---------- 1. Log in (email + password, then the 4-digit PIN screen) ---------- */
  const _renderLoginEmail = renderLoginEmail;
  renderLoginEmail = function () {
    return _renderLoginEmail()
      .replace('type="password" value="MediLink@2026"', 'id="login-password-input" type="password" value="MediLink@2026"')
      .replace(`onclick="state.role='patient'; state.currentAccountEmail='aarav@demo.in'; state.history=[]; navigate('home')"`, 'onclick="MediLinkLive.login(this)"')
      .replace(/(<button onclick="navigate\('signup_1'\)"[\s\S]*?<\/button>)/, `$1
            <button onclick="MediLinkLive.serverSettings()" class="w-full text-center text-[12px] text-white/80 font-semibold min-h-[36px]">Server: <span class="underline">${live.server.replace(/^https?:\/\//, '')}</span></button>`);
  };

  live.login = async function (btn) {
    const email = (document.getElementById('login-email-input') || {}).value || '';
    const password = (document.getElementById('login-password-input') || {}).value || '';
    if (btn) btn.disabled = true;
    try {
      const r = await api('/auth/login', { body: { email, password } });
      if (r.needsPin) { live.pinToken = r.pinToken; navigate('login_pin'); }
      else await finishLogin(r);
    } catch (e) {
      if (e.offline) { toast('Server not reachable — opening offline demo.'); demoLogin(email); }
      else toast(e.message);
    } finally { if (btn) btn.disabled = false; }
  };

  function demoLogin(email) {
    // Same behaviour as the original prototype button.
    if (/^(reception|radiology|pathology|staff|admin)\.|^dr/i.test(email)) { quickSwitchAccount(protoEmail(email)); return; }
    state.role = 'patient'; state.currentAccountEmail = 'aarav@demo.in'; state.history = []; navigate('home');
  }

  const _renderLoginPin = renderLoginPin;
  renderLoginPin = function () {
    return _renderLoginPin()
      .replace(/value="(\d)" aria-label="PIN digit (\d)"/g, 'value="$1" aria-label="PIN digit $2" id="pin-digit-$2" inputmode="numeric" oninput="if(this.value&&this.nextElementSibling)this.nextElementSibling.focus()"')
      .replace(`onclick="state.role='patient'; state.currentAccountEmail='aarav@demo.in'; navigate('home')"`, 'onclick="MediLinkLive.verifyPin(this)"');
  };

  live.finishLogin = (r) => finishLogin(r);
  live.verifyPin = async function (btn) {
    if (!live.pinToken) { demoLogin('aarav@demo.in'); return; }
    const pin = [1, 2, 3, 4].map((i) => (document.getElementById('pin-digit-' + i) || {}).value || '').join('');
    if (btn) btn.disabled = true;
    try { await finishLogin(await api('/auth/pin', { body: { pinToken: live.pinToken, pin } })); }
    catch (e) { toast(e.message); }
    finally { if (btn) btn.disabled = false; }
  };

  async function finishLogin(r) {
    live.token = r.token; live.user = r.user; live.pinToken = null;
    LS.set('medilink.token', r.token);
    // A different person signed in on this device: forget the previous person's saved Drive and history.
    if (LS.get('medilink.lastUser') !== r.user.email) {
      try { localStorage.removeItem(DRIVE_STORE_KEY); } catch (e) { /* storage blocked */ }
      state.driveFiles = state.driveFiles.filter((f) => !String(f.id).startsWith('api-') && !f.hasBlob);
      LS.set('medilink.lastUser', r.user.email);
    }
    if (r.user.role === 'patient') {
      state.patientConsultations = []; state.patientDeckIndex = 0; // real accounts start from the server's visits, not the sample ones
      state.driveFiles = state.driveFiles.filter((f) => !/^file-\d+$/.test(f.id));
    }
    const u = r.user;
    state.history = [];
    if (u.role === 'patient') {
      state.role = 'patient'; state.currentAccountEmail = u.email;
      await loadPatient();
      navigate('home');
    } else if (u.role === 'doctor') {
      const email = protoEmail(u.email);
      state.doctorEmail = email; state.currentAccountEmail = email; state.role = 'doctor';
      const d = DOCTORS.find((x) => x.email === email); if (d) state.activeHospitalId = d.hospitalId;
      switchViewport('mobile');
      await loadDoctor();
      navigate('doctor_dashboard');
    } else if (u.role === 'staff') {
      enterStaffAccount(u.email);           // prototype's own desk logic (chooser for multi-desk accounts)
      if (u.desk) await loadReception();
    } else if (u.role === 'admin') {
      quickSwitchAccount(u.email);           // opens the prototype's admin panel at 1280 px
    } else if (u.role === 'owner') {
      live.openOwner();                      // MediLink Owner Console (medilink-owner.js)
    }
    toast('Signed in · live server');
  }

  /* ---------- 2. Sign up (the prototype's 8 steps, with password + PIN added to step 1) ---------- */
  const _renderSignup1 = renderSignup1;
  renderSignup1 = function () {
    const extra = suField('Create password', '', 'password', 'At least 8 characters') + suField('4-digit security PIN', '', 'password', 'You enter it every time you log in');
    return _renderSignup1().replace(`<button onclick="navigate('signup_2')"`, extra + `\n          <button onclick="navigate('signup_2')"`);
  };
  const _renderSignup8 = renderSignup8;
  renderSignup8 = function () {
    const d = live.signup;
    let html = _renderSignup8()
      .replace(`onclick="state.role='patient'; state.currentAccountEmail='aarav@demo.in'; state.history=[]; navigate('home')"`, 'onclick="MediLinkLive.finishSignup(this)"');
    if (d.name) html = html.replace('>Aarav Sharma<', '>' + esc(d.name) + '<');
    if (d.blood) html = html.replace('>O+<', '>' + esc(d.blood) + '<');
    if (d.allergies) html = html.replace('>Penicillin, Sulfa<', '>' + esc(d.allergies.join(', ') || 'None') + '<');
    return html;
  };

  function collectSignup(screen) {
    if (live.signupManaged) return;   // medilink-device.js keeps the sign-up fields itself
    const box = document.getElementById('screen-container'); if (!box) return;
    const inputs = [...box.querySelectorAll('input')].map((i) => i.value.trim());
    const chipGroups = [...box.querySelectorAll('.flex.flex-wrap.gap-2')].map((g) => [...g.querySelectorAll('button')].filter((b) => b.className.includes('bg-brand-accent')).map((b) => b.textContent.trim()));
    const d = live.signup;
    if (screen === 'signup_1') [d.name, d.email, d.phone, d.password, d.pin] = inputs;
    if (screen === 'signup_2') d.aadhaar = !!inputs[0];
    if (screen === 'signup_3') d.abha = !!inputs[0];
    if (screen === 'signup_4') [d.address, d.emergencyPhone] = inputs;
    if (screen === 'signup_5') { d.dob = inputs[0]; d.sex = chipGroups[0] && chipGroups[0][0]; d.blood = chipGroups[1] && chipGroups[1][0]; }
    if (screen === 'signup_6') { d.allergies = (chipGroups[0] || []).filter((a) => a !== 'None'); if (inputs[0]) d.allergies.push(inputs[0]); }
    if (screen === 'signup_7') [d.insurer, d.policyNo] = inputs;
  }

  live.finishSignup = async function (btn) {
    const d = live.signup;
    if (!d.email || !d.password) { toast('Please complete step 1 (email and password).'); navigate('signup_1'); return; }
    if (btn) btn.disabled = true;
    try {
      const r = await api('/auth/signup', { body: { name: d.name, email: d.email, password: d.password, pin: d.pin } });
      live.token = r.token; live.user = r.user; LS.set('medilink.token', r.token);
      await api('/me/profile', { method: 'PUT', body: {
        fullName: d.name, dob: d.dob || null, sex: d.sex || null, phone: (d.phone || '').replace(/\s/g, '') || null, address: [d.address, d.pincode].filter(Boolean).join(' - ') || null,
        bloodGroup: d.blood && d.blood.length <= 3 ? d.blood : null, emergencyContactName: d.emergencyPhone ? (d.emergencyName || 'Emergency contact') : null, emergencyContactPhone: (d.emergencyPhone || '').replace(/\s/g, '') || null,
        allergies: d.allergies || [], insurance: d.insurer ? { insurer: d.insurer, policyNo: d.policyNo } : null, declaration: true,
      } });
      if (d.aadhaar) await api('/me/verify', { body: { kind: 'aadhaar' } });
      if (d.abha) await api('/me/verify', { body: { kind: 'abha' } });
      live.signup = {};
      state.role = 'patient'; state.currentAccountEmail = r.user.email; state.history = [];
      await loadPatient();
      toast('Welcome to MediLink!');
      navigate('home');
    } catch (e) {
      if (e.offline) { toast('Server not reachable — opening offline demo.'); demoLogin('aarav@demo.in'); }
      else toast(e.message);
    } finally { if (btn) btn.disabled = false; }
  };

  /* ---------- 3. Patient: profile, live tokens on "My Queue" ---------- */
  const STAGE = { Requested: 0, Approved: 0, Arrived: 1, Called: 2, InConsultation: 3, Completed: 4, Referred: 4, NoShow: 4, Cancelled: 4 };
  live.loadPatient = () => loadPatient();
  async function loadPatient() {
    if (!isLive() || live.user.role !== 'patient') return;
    try {
      const p = await api('/me/profile');
      Object.assign(state.patient, {
        id: 'pt-live-' + p.user_id, name: p.full_name, email: live.user.email, medilinkId: p.medilink_id,
        phone: p.phone || state.patient.phone, bloodGroup: p.blood_group || state.patient.bloodGroup,
        allergies: p.allergies && p.allergies.length ? p.allergies : [],
        dob: p.dob ? String(p.dob).slice(0, 10) : '', age: p.dob ? ageOf(p.dob) : '—', sex: p.sex || '—',
        abhaMasked: p.abha_linked ? 'Linked' : 'Not linked', aadhaarVerified: !!p.aadhaar_verified,
        emergencyContact: p.emergency_contact_phone ? `${p.emergency_contact_name || ''} ${p.emergency_contact_phone}`.trim() : 'Not added',
      });
      live.profile = p;
      // The prototype's sample follow-ups and family members are not this person's.
      state.followUps = state.followUps.filter((f) => f.patientName !== p.full_name || String(f.id).startsWith('api-'));
      const visits = await api('/me/visits');
      await hospitalsBySlug();
      if (visits && visits.length > 0) {
        const liveCons = visits.filter((v) => v.status !== 'Cancelled').map((v) => {
          const doc = typeof DOCTORS !== 'undefined' ? DOCTORS.find((d) => d.name === v.doctor_name) : null;
          const hosp = protoHospitalIdFromServer(v.hospital_id);
          return {
            id: 'api-' + v.id,
            token: v.token_no,
            doctorId: doc ? doc.id : null,
            doctorName: v.doctor_name || (doc && doc.name) || 'Doctor',
            specialty: v.department_name || (doc && doc.department) || 'General Physician',
            hospitalName: v.hospital_name || '',
            hospitalId: hosp || undefined,
            room: v.room || (doc && doc.room) || 'OPD',
            stageIndex: STAGE[v.status] ?? 1,
            aheadCount: typeof v.ahead === 'number' ? v.ahead : 0,
            estWaitMins: typeof v.estimatedWaitMinutes === 'number' ? v.estimatedWaitMinutes : 0,
            priority: v.priority ? 'Priority' : 'Normal',
            slotTime: timeOf(v.created_at),
            qrCodeId: 'LIVE-' + v.id,
            completedAt: v.completed_at || null,
            late: !!v.late,
            graceLeft: typeof v.graceMinutesLeft === 'number' ? v.graceMinutesLeft : undefined,
            cancelled: v.status === 'NoShow',
          };
        });
        // The server's visits ARE the patient's visits (a scan is saved on the server first).
        state.patientConsultations = liveCons;
      } else {
        state.patientConsultations = [];
      }
      try {
        const notes = await api('/me/notifications');
        if (Array.isArray(notes) && notes.length > 0) {
          state.notifications = notes.map((n) => ({
            id: 'n-' + n.id,
            title: n.title,
            body: n.body,
            time: timeOf(n.created_at),
            category: n.category || (/x-ray|report|prescrip|drive/i.test(n.title + ' ' + n.body) ? 'drive' : /queue|turn|token|wait/i.test(n.title + ' ' + n.body) ? 'queue' : 'hospital'),
            actionScreen: /x-ray|report|prescrip|drive/i.test(n.title + ' ' + n.body) ? 'drive' : 'flow',
            read: !!n.read
          }));
        } else if (!state.notifications || !state.notifications.length) {
          state.notifications = [
            { id: 'n-1', category: 'drive', actionScreen: 'drive', title: 'New X-ray from Radiology', body: 'Sent by Radiology, Kokilaben Hospital to your Drive.', time: 'Today 2:15 PM', read: false },
            { id: 'n-2', category: 'queue', actionScreen: 'flow', title: 'You are 3rd in queue', body: '2 people before you, about 12 minutes. Go to OPD Room 4.', time: 'Today 3:50 PM', read: false },
            { id: 'n-3', category: 'hospital', actionScreen: 'flow', title: 'Transfer recommended by Dr. Arvind Raman', body: 'Referral to Lilavati Hospital Cardiology awaiting your confirmation.', time: 'Today 3:45 PM', read: false }
          ];
        }
      } catch (e) {
        if (!state.notifications || !state.notifications.length) {
          state.notifications = [
            { id: 'n-1', category: 'drive', actionScreen: 'drive', title: 'New X-ray from Radiology', body: 'Sent by Radiology, Kokilaben Hospital to your Drive.', time: 'Today 2:15 PM', read: false },
            { id: 'n-2', category: 'queue', actionScreen: 'flow', title: 'You are 3rd in queue', body: '2 people before you, about 12 minutes. Go to OPD Room 4.', time: 'Today 3:50 PM', read: false },
            { id: 'n-3', category: 'hospital', actionScreen: 'flow', title: 'Transfer recommended by Dr. Arvind Raman', body: 'Referral to Lilavati Hospital Cardiology awaiting your confirmation.', time: 'Today 3:45 PM', read: false }
          ];
        }
      }
      if (live.onPatientLoaded) await live.onPatientLoaded();
    } catch (e) { if (!e.offline) console.warn('MediLink live:', e.message); }
  }

  /* ---------- 4. Booking a token goes to the real server ---------- */
  const _completeTokenBooking = completeTokenBooking;
  let booking = false;
  completeTokenBooking = async function () {
    if (!isLive() || state.role !== 'patient') return _completeTokenBooking();   // offline demo: local booking
    if (booking) return;
    booking = true;
    try {
      const hospitalId = await serverHospitalId(state.regDraft.hospitalId);
      if (!hospitalId) { toast('This hospital is not on the live server yet.'); return; }
      const hosp = await api('/hospitals/' + hospitalId);
      const protoDoc = DOCTORS.find((d) => d.id === state.regDraft.selectedDoctorId);
      const serverDoc = protoDoc && hosp.doctors.find((d) => d.name === protoDoc.name);
      const r = await api('/me/visits', { body: {
        hospitalId, symptoms: state.regDraft.symptomText || '', bodyArea: undefined,
        doctorId: serverDoc ? serverDoc.id : null, preferFemale: !!state.regDraft.preferFemale, memberId: state.regDraft.memberId || undefined,
      } });
      if (r.emergency) { toast(r.message); navigate('emergency_home'); return; }
      if (r.femaleNote) toast(r.femaleNote);
      await loadPatient();                          // Home, Flow and the token screen all read this
      const idx = state.patientConsultations.filter((c) => c.stageIndex < 4).findIndex((c) => c.id === 'api-' + r.visit.id);
      state.patientDeckIndex = Math.max(0, idx);
      toast('Token ' + r.visit.token_no + ' reserved');
      navigate('reg_token_ready');
    } catch (e) {
      // Nothing was booked, so stay on this screen and say why (for example "You already have token A-12 today").
      if (e.status === 403) { toast(e.message); navigate('booking_desk_only'); }
      else if (!e.offline) toast(e.message);
      else toast('Server not reachable. Your token was not booked.');
    } finally { booking = false; }
  };

  /* ---------- 5. Reception: live arrivals board, check-in ---------- */
  async function loadReception() {
    if (!isLive() || state.role !== 'staff') return;
    try {
      const b = await api('/reception/board');
      const __known = new Set((state.receptionArrivals || []).map((a) => a.id));
      const __first = !live.__receptionLoaded; live.__receptionLoaded = true;
      state.receptionArrivals = b.queue.map((v) => ({
        id: 'api-' + v.id, liveStatus: v.status, token: v.token_no, name: v.full_name, age: '', sex: sex1(v.sex), doctorName: v.doctor_name || '',
        reason: v.late ? 'Late: not arrived, behind walk-ins' : v.emergency ? 'Emergency' : (v.assignment === 'auto' ? 'Auto-assigned' : 'Chose doctor'), late: !!v.late,
        priority: v.priority ? 'Priority' : 'Normal', checkedIn: ['Arrived', 'Called', 'InConsultation'].includes(v.status),
      }));
      if (!__first && typeof showQueuePopup === 'function') {
        state.receptionArrivals.filter((a) => !__known.has(a.id)).forEach((a) => showQueuePopup('New patient: ' + a.name, 'Token ' + a.token + (a.checkedIn ? ' has arrived at the desk.' : ' is on the way.'), 'user-plus', a.checkedIn ? 'ok' : ''));
      }
      live.testsToBook = b.testsToBook;
      live.emergencyAlerts = b.alerts || [];
      if (live.onReceptionLoaded) await live.onReceptionLoaded(b);
      if (live.onBoard) live.onBoard(b);
    } catch (e) { if (!e.offline && e.status !== 403) console.warn('MediLink live:', e.message); }
  }
  const _receptionCheckIn = receptionCheckIn;
  receptionCheckIn = async function (id) {
    if (String(id).startsWith('api-') && isLive()) {
      const vid = id.slice(4);
      try { await api(`/reception/visits/${vid}/arrive`, { body: {} }); }
      catch (e) { toast(e.message); return; }
    }
    _receptionCheckIn(id);
  };

  /* ---------- 6. Doctor: duty clock-in, live queue, QR scan, prescription, finish ---------- */
  const STATUS = { Requested: 'Waiting', Approved: 'Waiting', Arrived: 'Waiting', Called: 'Waiting', InConsultation: 'In consultation' };
  async function loadDoctor() {
    if (!isLive() || live.user.role !== 'doctor') return;
    try {
      const st = await api('/doctor/status');
      state.doctorClockedIn = !!st.onDuty;
      { const dd = DOCTORS.find((d) => d.email === state.currentAccountEmail); if (dd) dd.onDuty = !!st.onDuty; }
      const q = await api('/doctor/queue');
      const doc = DOCTORS.find((d) => d.email === state.currentAccountEmail);
      const keepDone = state.doctorQueuePatients.filter((p) => p.status === 'Done' && String(p.id).startsWith('api-'));
      state.doctorQueuePatients = q.map((v, i) => ({
        id: 'api-' + v.id, token: v.token_no, name: v.full_name, age: ageOf(v.dob), sex: sex1(v.sex),
        avatarBg: PALETTE[i % PALETTE.length][0], avatarColor: PALETTE[i % PALETTE.length][1], initials: initials(v.full_name),
        reason: v.symptoms, priority: v.priority ? 'Priority' : 'Normal', status: STATUS[v.status] || 'Waiting', called: v.status === 'Called', late: !!v.late,
        waitTime: timeOf(v.created_at), slotTime: timeOf(v.created_at), doctorName: doc ? doc.name : '', specialty: doc ? doc.department : '',
        qrHash: 'LIVE-' + v.id, conductAlert: v.conduct_alert, livePatientId: v.patient_id, liveMedilinkId: v.medilink_id,
      })).concat(keepDone);
      // The prototype's patient view looks the patient up in hospitalPatients (tests card, conduct flag).
      if (live.onDoctorLoaded) await live.onDoctorLoaded(q);
      q.forEach((v) => live.upsertPatient({ patient_id: v.patient_id, full_name: v.full_name, dob: v.dob, sex: v.sex, medilink_id: v.medilink_id }));
    } catch (e) { if (!e.offline) console.warn('MediLink live:', e.message); }
  }

  // Opens the real camera (medilink-device.js). "Use demo code" asks the server for the code a camera would read.
  const scanCode = (title, demo) => (window.MediLinkDevice ? window.MediLinkDevice.scanQr({ title, demo }) : demo());
  const _doctorScanDeskQr = doctorScanDeskQr;
  doctorScanDeskQr = async function () {
    if (isLive() && live.user.role === 'doctor') {
      try {
        const code = await scanCode('Scan the duty QR in your room', () => api('/demo/duty-qr').then((x) => x.code));
        if (!code) return;
        await api('/doctor/clock-in', { body: { code } });
      } catch (e) { toast(e.message); return; }
    }
    _doctorScanDeskQr();
  };

  // Going off duty is saved on the server (closes the shift); calling a patient moves their token to "Called".
  window.doctorClockOutHook = async () => { if (isLive() && live.user.role === 'doctor') await api('/doctor/clock-out', { body: {} }); };
  window.doctorCallHook = async (qp) => { if (isLive() && String(qp.id).startsWith('api-')) await api('/doctor/visits/' + qp.id.slice(4) + '/status', { body: { status: 'Called' } }); };

  const _doctorScanQr = doctorScanQr;
  doctorScanQr = async function (wrong) {
    const qp = state.doctorQueuePatients.find((p) => p.id === state.scanTargetId) || state.doctorQueuePatients[0];
    if (!wrong && qp && String(qp.id).startsWith('api-') && isLive()) {
      try {
        const code = await scanCode(`Scan ${qp.name}'s QR`, () => api('/demo/patient-qr/' + qp.id.slice(4)).then((x) => x.code));
        if (!code) return;
        const rec = await api('/doctor/scan', { body: { code } });
        if (rec.profile && qp.liveMedilinkId && rec.profile.medilink_id !== qp.liveMedilinkId) {
          state.scanError = `This QR belongs to ${rec.profile.full_name}, not ${qp.name}. Record stays locked.`; render(); return;
        }
        live.record = rec;
        if (rec.profile) {
          qp.allergies = rec.profile.allergies; qp.bloodGroup = rec.profile.blood_group;
          if (rec.conductAlert) toast('Conduct alert: ' + rec.conductAlert.category + '. ' + rec.conductAlert.note);
        }
      } catch (e) { state.scanError = e.message; render(); return; }
    }
    _doctorScanQr(wrong);
  };

  const _uploadDoctorRx = uploadDoctorRx;
  uploadDoctorRx = async function (docName, regNum) {
    const qp = typeof currentConsultPatient === 'function' ? currentConsultPatient() : null;
    const text = ((document.getElementById('doc-rx-input') || {}).value || state.rxText || '').trim();
    if (qp && String(qp.id).startsWith('api-') && isLive()) {
      if (text.length < 3) { toast('Type the prescription first'); return; }
      try { await api(`/doctor/visits/${qp.id.slice(4)}/prescription`, { body: { text } }); }
      catch (e) { toast(e.message); return; }
    }
    _uploadDoctorRx(docName, regNum);
  };

  const _commitConsultDone = commitConsultDone;
  commitConsultDone = async function (id) {
    if (String(id).startsWith('api-') && isLive()) {
      const d = state.fuDraft || {};
      const text = (state.rxText || '').trim();
      try {
        if (text.length >= 3) await api(`/doctor/visits/${id.slice(4)}/prescription`, { body: { text, followUp: d.needed ? `Follow-up on ${d.date}${d.reason ? ': ' + d.reason : ''}` : null } });
        await api(`/doctor/visits/${id.slice(4)}/status`, { body: { status: 'Completed' } });
      } catch (e) { toast(e.message); return; }
    }
    _commitConsultDone(id);
  };

  /* ---------- 7. Admin: audit chain verification on the server ---------- */
  const _adminVerifyChain = adminVerifyChain;
  adminVerifyChain = async function () {
    if (isLive() && live.user.role === 'admin') {
      try {
        const r = await api('/admin/audit/verify');
        state.adminAuditNote = r.ok ? `Server audit chain intact: ${r.checked} entries verified (SHA-256).` : `Server audit chain broken at entry #${r.brokenAt}. Investigate.`;
        render(); return;
      } catch (e) { toast(e.message); }
    }
    _adminVerifyChain();
  };

  /* ---------- 8. Emergency: "Inform hospital" also alerts the live reception desk ---------- */
  const _informHospitalComing = informHospitalComing;
  informHospitalComing = function (hospName) {
    _informHospitalComing(hospName);
    (async () => {
      try {
        const list = await hospitalsBySlug();
        const h = list.find((x) => x.name === hospName || hospName.includes(x.name) || x.name.includes(hospName));
        if (h && h.on_medilink) await api('/emergency/inform', { body: { hospitalId: h.id, name: (state.patient && state.patient.name) || 'Unknown' } });
      } catch (e) { /* offline: the prototype's own message is already shown */ }
    })();
  };

  /* ---------- navigation hooks: collect sign-up fields, refresh live data when a screen opens ---------- */
  const _navigate = navigate;
  navigate = function (screen, push) {
    if (state.currentScreen && state.currentScreen.startsWith('signup_')) collectSignup(state.currentScreen);
    if (screen === 'welcome' && state.role === 'visitor' && live.token) { live.token = null; live.user = null; LS.set('medilink.token', null); }
    const out = _navigate(screen, push);
    refreshFor(state.currentScreen);
    return out;
  };
  const _chooseDesk = chooseDesk;
  chooseDesk = async function (d) {
    let norm = d || 'Reception';
    const s = String(norm).toLowerCase();
    if (s.includes('reception') || s.includes('registration') || s.includes('opd') || s.includes('front desk')) {
      norm = 'Reception';
    } else if (s.includes('radiology') || s.includes('x-ray') || s.includes('scan') || s.includes('mri')) {
      norm = 'Radiology';
    } else if (s.includes('pathology') || s.includes('blood') || s.includes('lab')) {
      norm = 'Pathology/Blood Tests';
    }
    if (isLive() && live.user && live.user.role === 'staff') {
      try {
        const r = await api('/auth/desk', { body: { desk: norm } });
        if (r && r.token) {
          live.token = r.token;
          live.user = r.user;
          LS.set('medilink.token', r.token);
        }
      } catch (e) {
        console.warn('Backend desk selection warning:', e);
      }
      if (norm === 'Reception') {
        try { await loadReception(); } catch (e) {}
      }
    }
    _chooseDesk(norm);
  };

  let refreshing = false;
  async function refreshFor(screen) {
    if (!isLive() || refreshing) return;
    const loaders = { home: loadPatient, flow: loadPatient, notifications: () => (live.user.role === 'doctor' ? loadDoctor() : loadPatient()), profile: loadPatient, consent_centre: loadPatient, reg_who: loadPatient, doctor_dashboard: loadDoctor, reception_dashboard: loadReception, waiting_display: loadReception, rec_lookup: loadReception, rec_vitals: loadReception };
    const fn = loaders[screen]; if (!fn) return;
    refreshing = true;
    try { await fn(); if (state.currentScreen === screen) render(); } finally { refreshing = false; }
  }
  // Keep queues fresh while a live screen is open.
  setInterval(() => { if (['home', 'flow', 'doctor_dashboard', 'reception_dashboard'].includes(state.currentScreen) && !document.hidden) refreshFor(state.currentScreen); }, 5000);

  /* ---------- log out clears the live session ---------- */
  const _qsa = quickSwitchAccount;
  quickSwitchAccount = function (val) {
    if (val === 'visitor') { live.token = null; live.user = null; LS.set('medilink.token', null); state.patientConsultations = []; state.patientDeckIndex = 0; try { localStorage.removeItem('medilink_patient_scanned'); localStorage.removeItem('medilink_scan_token'); } catch (e) { /* storage blocked */ } }
    return _qsa(val);
  };

  /* ---------- server address (needed on a real phone) ---------- */
  live.serverSettings = function () {
    const v = prompt('MediLink server address\n(on a phone use your computer\'s Wi-Fi address, e.g. http://192.168.1.5:4000/api)', live.server);
    if (!v) return;
    live.server = v.trim().replace(/\/+$/, ''); LS.set('medilink.server', live.server); serverHospitals = null;
    fetch(live.server + '/health').then((r) => r.ok ? toast('Connected to the MediLink server') : toast('Server answered with an error')).catch(() => toast('Cannot reach that address'));
    render();
  };

  /* ---------- final app layout: no demo workspace bar, no phone mockup, no fake status bar ----------
     Phone: the app fills the screen. Desktop: the same phone-shaped layout as a centred column.
     Admin panel: full width. The prototype's own screens and styles are not changed. */
  const css = document.createElement('style');
  css.textContent = `
    body > header { display: none !important; }
    body { background: #E2E8F0; }
    body > main { padding: 0 !important; display: block !important; min-height: 100dvh; }
    #ios-status-bar { display: none !important; }
    body:not([data-layout="desktop"]) #device-frame {
      width: 100% !important; max-width: 430px !important; margin: 0 auto !important;
      height: 100dvh !important; min-height: 100dvh !important; max-height: 100dvh !important;
      border: 0 !important; border-radius: 0 !important; box-shadow: 0 0 0 1px rgba(8,32,42,0.06) !important;
      padding-top: env(safe-area-inset-top);
    }
    body[data-layout="desktop"] #device-frame {
      width: 100% !important; max-width: 100% !important; margin: 0 auto !important;
      height: auto !important; min-height: 100dvh !important; max-height: none !important;
      border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
      padding-top: env(safe-area-inset-top);
    }
    body[data-vp="admin"] #device-frame { max-width: none !important; }
    @media (max-width: 500px) { #device-frame { box-shadow: none !important; } }
  `;
  document.head.appendChild(css);

  // Staff and admin have no account switcher any more, so add a Log out button in the prototype's own top-bar style.
  const LOGOUT_BTN = '<button id="ml-logout-btn" onclick="MediLinkLive.logout()" aria-label="Log out" title="Log out" class="w-11 h-11 rounded-full flex items-center justify-center bg-white/95 backdrop-blur-md border border-slate-200/80 text-ink shadow-sm hover:bg-white transition"><i data-lucide="log-out" class="w-5 h-5 text-brand-accent"></i></button>';
  live.logout = function () {
    live.token = null; live.user = null; LS.set('medilink.token', null);
    try { localStorage.removeItem(DRIVE_STORE_KEY); } catch (e) { /* storage blocked */ }
    state.role = 'visitor'; state.currentAccountEmail = null; state.doctorEmail = null; state.activeDesk = null; state.history = [];
    state.patientConsultations = []; state.patientDeckIndex = 0; state.activeReferral = null;
    try { localStorage.removeItem('medilink_patient_scanned'); localStorage.removeItem('medilink_scan_token'); } catch (e) { /* storage blocked */ }
    switchViewport('mobile');
    navigate('welcome', false);
  };
  const _renderFinal = render;
  render = function () {
    const out = _renderFinal.apply(this, arguments);
    document.body.dataset.vp = state.viewport;
    const bar = document.querySelector('#app-top-bar > div:last-child');
    const old = document.getElementById('ml-logout-btn');
    const wants = ['staff', 'admin', 'owner'].includes(state.role);
    if (wants && bar && !old) { bar.insertAdjacentHTML('beforeend', LOGOUT_BTN); if (window.lucide) lucide.createIcons(); }
    if (!wants && old) old.remove();
    return out;
  };
  // A plain open of the app starts at the splash screen, like an installed app.
  document.body.dataset.vp = state.viewport;

  /* ---------- resume a saved session ---------- */
  (async () => {
    if (!live.token) return;
    try {
      const r = await api('/auth/me');
      live.user = r.user;
      await finishLogin({ token: live.token, user: r.user });
    } catch (e) {
      if (!e.offline) { live.token = null; LS.set('medilink.token', null); }
    }
  })();
})();
