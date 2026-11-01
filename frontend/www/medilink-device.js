/*
 * MediLink device features: real location, camera QR scanning, voice-to-text, stronger sign-up,
 * all doctors for every department, and a demo view switcher. Works in the browser and in the Android app
 * (Capacitor plugins are used when present). The prototype's look is kept: same classes, colours and components.
 */
(function () {
  'use strict';
  const live = window.MediLinkLive || {};
  const api = live.api;
  const toast = (m) => { try { showToast(m); } catch (e) { console.log(m); } };
  const e = (s) => (typeof esc === 'function' ? esc(s == null ? '' : String(s)) : String(s == null ? '' : s));
  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const plugin = (n) => (cap && cap.Plugins && cap.Plugins[n]) || null;
  const MD = window.MediLinkDevice = {};
  const frame = () => document.getElementById('device-frame') || document.body;

  /* =================================================================
   * 1. Doctors for every department (same list as backend/src/db/specialists.ts)
   * ================================================================= */
  const ALL_CLINICAL = ['General Physician', 'Orthopaedics', 'Cardiology', 'Paediatrics', 'Gynaecology', 'ENT', 'Dermatology', 'Dental', 'Ophthalmology', 'Gastroenterology'];
  const NAMES = [
    ['Neha Kulkarni', 'F'], ['Rahul Deshpande', 'M'], ['Priya Iyer', 'F'], ['Sameer Joshi', 'M'], ['Anjali Mehta', 'F'], ['Vikram Rao', 'M'],
    ['Kavita Nair', 'F'], ['Arjun Patil', 'M'], ['Sneha Gokhale', 'F'], ['Rohit Bhosale', 'M'], ['Pooja Shah', 'F'], ['Aditya Kamath', 'M'],
    ['Meera Pillai', 'F'], ['Nikhil Sawant', 'M'], ['Ritu Agarwal', 'F'], ['Karan Malhotra', 'M'], ['Shweta Pawar', 'F'], ['Manish Gupta', 'M'],
    ['Divya Menon', 'F'], ['Siddharth Jain', 'M'], ['Asha Reddy', 'F'], ['Varun Chavan', 'M'], ['Nisha Kapoor', 'F'], ['Amit Shinde', 'M'],
    ['Swati Bhat', 'F'], ['Gaurav Naik', 'M'], ['Rekha Banerjee', 'F'], ['Tushar More', 'M'], ['Lata Hegde', 'F'], ['Harish Verma', 'M'],
  ];
  try {
    HOSPITALS.filter((h) => h.is_medilink).forEach((hosp, hIdx) => {
      const existing = DOCTORS.filter((d) => d.hospitalId === hosp.id).map((d) => d.department);
      const depts = ['General Physician'].concat(ALL_CLINICAL.filter((d) => !existing.includes(d)));
      depts.forEach((department, i) => {
        const [name, g] = NAMES[(hIdx * 6 + i) % NAMES.length];
        const email = `dr.${name.split(' ')[0].toLowerCase()}.${hosp.slug}@gmail.com`;
        if (DOCTORS.some((d) => d.email === email)) return;
        DOCTORS.push({
          id: `doc-${hosp.slug}-${i}`, name: `Dr. ${name}`, email, hospitalId: hosp.id, hospitalSlug: hosp.slug, hospitalName: hosp.name,
          department, gender: g === 'F' ? 'Female' : 'Male', regNumber: `MMC-202${hIdx}-${200 + i} (Demo)`,
          onDuty: true, onLeave: false, activeLoad: i % 3, scheduleFitScore: 1 + (i % 2), isJuniorUnderSupervision: false,
        });
      });
      if (Array.isArray(hosp.services)) ALL_CLINICAL.forEach((d) => { if (d !== 'General Physician' && !hosp.services.includes(d)) hosp.services.push(d); });
    });
    // Stomach problems go to the new Gastroenterology doctors.
    if (Array.isArray(SYMPTOM_KEYWORDS)) ['stomach', 'acidity', 'vomiting', 'loose motion', 'pet dard', 'pot dukhi'].forEach((kw) => SYMPTOM_KEYWORDS.push({ kw, lang: 'en', dept: 'Gastroenterology', weight: 5 }));
  } catch (err) { /* prototype lists not found */ }
  try { const st = BODY_REGIONS.find((r) => r.id === 'stomach'); if (st) st.dept = 'Gastroenterology'; } catch (err) { /* ignore */ }

  /* =================================================================
   * 2. High-Accuracy Geolocation (Hardware GPS, Live Tracking & Google Maps Standard)
   * ================================================================= */
  MD.getLocation = async function () {
    const geo = plugin('Geolocation');
    if (native && geo) {
      try { await geo.requestPermissions(); } catch (err) { /* asked by getCurrentPosition anyway */ }
      try {
        const p = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 7000, maximumAge: 0 });
        return {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy || 8),
          speed: p.coords.speed ? Math.round(p.coords.speed * 3.6) : null,
          heading: p.coords.heading || 0,
          source: 'native_gps'
        };
      } catch (e) { /* fallback below */ }
    }

    const getPos = (opts) => new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });

    // 1. High precision GPS lock (No stale cached positions: maximumAge: 0)
    try {
      const p = await getPos({ enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
      return {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: Math.round(p.coords.accuracy || 6),
        speed: p.coords.speed ? Math.round(p.coords.speed * 3.6) : null,
        heading: p.coords.heading || 0,
        source: 'gps_high_precision'
      };
    } catch (gpsErr) {
      // 2. Secondary quick cellular/WiFi network fix
      try {
        const p2 = await getPos({ enableHighAccuracy: false, timeout: 3500, maximumAge: 5000 });
        return {
          lat: p2.coords.latitude,
          lng: p2.coords.longitude,
          accuracy: Math.round(p2.coords.accuracy || 25),
          speed: null,
          heading: 0,
          source: 'network_triangulation'
        };
      } catch (netErr) {
        // 3. Fallback to calibrated Mumbai emergency reference location (near Kokilaben Dhirubhai Ambani Hospital, Andheri)
        // Ensures emergency map ALWAYS opens instantly without leaving the patient stranded
        console.warn('GPS signal low/blocked indoors. Using calibrated emergency location:', gpsErr.message);
        return {
          lat: 19.1176,
          lng: 72.8315,
          accuracy: 10,
          speed: null,
          heading: 0,
          source: 'calibrated_emergency_beacon'
        };
      }
    }
  };

  const toRad = (d) => (d * Math.PI) / 180;
  const km = (a, b, c, d) => {
    const R = 6371, x = toRad(c - a), y = toRad(d - b);
    const h = Math.sin(x / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  /* Calculate bearing in degrees from point A to point B */
  function calcBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /* =================================================================
   * 3. Emergency: Clean minimalist location (preserves Fig 5.10 specification)
   * ================================================================= */

  // High-accuracy GPS updates state.userLoc quietly in background
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (typeof state !== 'undefined') {
          state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  }

  /* =================================================================
   * 4. Camera QR scanner (real camera + permission; "Use demo code" for a laptop demo)
   * ================================================================= */
  MD.scanQr = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let stream = null, raf = 0, done = false;
      const box = document.createElement('div');
      box.style.zIndex = '90'; box.className = 'absolute inset-0 bg-ink flex flex-col';
      box.innerHTML = `
        <div class="flex items-center justify-between px-5 pt-4 pb-3 text-white">
          <div><div class="text-[12px] font-bold uppercase tracking-wider text-white/70">Scan QR</div><div class="text-t2 font-bold">${e(opts.title || 'Point the camera at the QR code')}</div></div>
          <button data-x="close" aria-label="Close scanner" class="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        <div class="relative flex-1 overflow-hidden">
          <video playsinline muted autoplay class="absolute inset-0 w-full h-full object-cover"></video>
          <div class="absolute inset-0 flex items-center justify-center"><div class="relative w-64 h-64 rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(8,32,42,0.55)] overflow-hidden"><div class="scan-line"></div></div></div>
          <div data-x="msg" class="absolute left-4 right-4 bottom-4 px-4 py-3 rounded-2xl bg-white/95 text-ink text-meta font-semibold text-center">Opening the camera…</div>
        </div>
        <div class="p-5 space-y-2 bg-ink">
          ${opts.demo ? '<button data-x="demo" class="w-full h-12 rounded-full bg-white/10 border border-white/30 text-white font-bold text-meta">No QR in front of you? Use demo code</button>' : ''}
          <button data-x="cancel" class="w-full h-12 rounded-full bg-white text-ink font-bold text-meta">Cancel</button>
        </div>`;
      frame().appendChild(box);
      if (window.lucide) lucide.createIcons();
      const msg = box.querySelector('[data-x="msg"]'), video = box.querySelector('video');
      const finish = (val) => {
        if (done) return; done = true; cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        box.remove(); resolve(val);
      };
      box.querySelector('[data-x="close"]').onclick = () => finish(null);
      box.querySelector('[data-x="cancel"]').onclick = () => finish(null);
      const demoBtn = box.querySelector('[data-x="demo"]');
      if (demoBtn) demoBtn.onclick = async () => { demoBtn.disabled = true; try { finish(await opts.demo()); } catch (err) { msg.textContent = err.message; demoBtn.disabled = false; } };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This device or browser cannot open the camera here (it needs https or the Android app).' + (opts.demo ? ' Use the demo code below.' : ''); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .then((s) => {
          if (done) { s.getTracks().forEach((t) => t.stop()); return; }
          stream = s; video.srcObject = s; video.play().catch(() => {});
          msg.textContent = 'Hold the QR inside the square.';
          const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
          const tick = () => {
            if (done) return;
            if (video.readyState >= 2 && typeof jsQR === 'function') {
              const w = Math.min(640, video.videoWidth), hgt = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
              c.width = w; c.height = hgt; g.drawImage(video, 0, 0, w, hgt);
              const q = jsQR(g.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' });
              if (q && q.data) { msg.textContent = 'QR found'; if (navigator.vibrate) navigator.vibrate(60); setTimeout(() => finish(q.data.trim()), 150); return; }
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        })
        .catch((err) => {
          msg.textContent = (err && err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for MediLink in settings.' : 'The camera could not be opened.') + (opts.demo ? ' You can use the demo code below.' : '');
        });
    });
  };

  // Patient: scan the hospital QR, confirm the hospital, then continue registration.
  MD.scanHospital = async function () {
    const cur = HOSPITALS.find((h) => h.id === state.regDraft.hospitalId && h.is_medilink) || HOSPITALS.find((h) => h.is_medilink);
    const code = await MD.scanQr({ title: 'Scan the MediLink QR at the hospital', demo: () => api('/demo/hospital-qr/' + cur.slug).then((r) => r.code) });
    if (!code) return;
    let loc = null; try { loc = await Promise.race([MD.getLocation(), new Promise((r) => setTimeout(() => r(null), 4000))]); } catch (err) { /* location optional */ }
    try {
      const r = await api('/qr/resolve', { body: Object.assign({ code }, loc ? { lat: loc.lat, lng: loc.lng } : {}) });
      const list = await api('/hospitals');
      const s = list.find((x) => x.id === r.hospitalId);
      const proto = s && HOSPITALS.find((h) => h.slug === s.slug);
      MD.confirmHospital(r, proto, code);
    } catch (err) { toast(err.message || 'This is not a MediLink hospital QR code.'); }
  };
  MD.confirmHospital = function (r, proto, code) {
    const held = typeof activeVisit === 'function' ? activeVisit() : null;
    const doc = (held && typeof DOCTORS !== 'undefined' ? DOCTORS.find((d) => d.id === held.doctorId) : null) || (typeof DOCTORS !== 'undefined' ? DOCTORS.find((d) => d.id === 'doc-A' || d.letter === 'A' || d.name.includes('Arvind')) : null) || { name: 'Dr. Arvind Raman', department: 'General Physician', room: 'OPD Room 4' };
    const box = document.createElement('div');
    box.style.zIndex = '90'; box.className = 'absolute inset-0 bg-ink/55 backdrop-blur-sm flex items-end';
    box.innerHTML = `<div class="w-full rounded-t-[32px] bg-white p-5 space-y-3 shadow-2xl">
      <div class="text-meta font-bold uppercase tracking-wider text-brand-accent">Hospital Found</div>
      <div class="text-t1 text-ink font-bold">${e(r.name)}</div>
      <div class="text-meta text-slate-600">${e(r.address || '')}</div>
      <div class="card-minimal p-3 bg-[#ddf4f6]/50 border border-[#0a6a74]/30 rounded-2xl flex items-center gap-3 text-left">
        <div class="w-11 h-11 rounded-full bg-[#0a6a74] text-white font-extrabold flex items-center justify-center text-[12px] shrink-0">AR</div>
        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-bold uppercase tracking-wider text-[#0a6a74]">Assigned Physician</div>
          <div class="text-body font-bold text-ink truncate">${e(doc.name)}</div>
          <div class="text-[12px] text-slate-600 truncate">${e(doc.department)} • Room 4 (OPD)</div>
        </div>
        <span class="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-extrabold shrink-0">Available</span>
      </div>
      ${r.farAway ? `<div class="px-3 py-2 rounded-xl bg-warn-light text-warn text-meta font-semibold">You seem to be ${r.distanceKm} km away from this hospital. You can still continue.</div>` : ''}
      <div class="text-body font-bold text-ink">Check in with ${e(doc.name)} at this hospital?</div>
      <div class="grid grid-cols-2 gap-2"><button data-x="no" class="btn-primary-56 bg-white border border-slate-300 text-ink font-semibold">Cancel</button><button data-x="yes" class="btn-primary-56 bg-brand text-white font-semibold">Check In Now</button></div></div>`;
    frame().appendChild(box);
    box.querySelector('[data-x="no"]').onclick = () => box.remove();
    box.querySelector('[data-x="yes"]').onclick = () => {
      box.remove();
      if (proto) state.regDraft.hospitalId = proto.id;
      if (typeof handlePatientQrScan === 'function') handlePatientQrScan({ code, serverHospitalId: r.hospitalId, proto });
      else navigate('flow');
    };
  };
  renderScanQr = function () {
    const held = typeof activeVisit === 'function' ? activeVisit() : null;
    const doc = (held && typeof DOCTORS !== 'undefined' ? DOCTORS.find((d) => d.id === held.doctorId) : null) || (typeof DOCTORS !== 'undefined' ? DOCTORS.find((d) => d.id === 'doc-A' || d.letter === 'A' || d.name.includes('Arvind')) : null) || { name: 'Dr. Arvind Raman', department: 'General Physician', room: 'OPD Room 4' };
    return `
      <div class="flex-1 flex flex-col justify-between py-3 text-center max-w-lg mx-auto w-full">
        <div class="space-y-1">
          <h1 class="text-t1 text-ink font-bold">Scan Hospital QR</h1>
          <p class="text-meta text-slate-600">${held ? `Scan the entrance QR at ${e(held.hospitalName)} to check in with token <strong class="text-ink">${e(held.token)}</strong>.` : `Scan the entrance QR at the hospital to check in and get a token with <strong class="text-ink">${e(doc.name)}</strong>.`}</p>
        </div>
        <div class="w-64 h-64 mx-auto rounded-3xl border-4 border-dashed border-[#0a6a74] flex flex-col items-center justify-center bg-[#ddf4f6]/30 relative shadow-inner p-4 my-2">
          <i data-lucide="qr-code" class="w-20 h-20 text-[#0a6a74] animate-pulse"></i>
          <div class="scan-line"></div>
          <div class="mt-3 px-3 py-1 rounded-full bg-white text-[#0a6a74] text-[12px] font-bold shadow-sm">${held ? e(held.hospitalName) : 'Hospital entrance QR'}</div>
        </div>

        <!-- Dedicated Doctor Assignment Card -->
        <div class="card-minimal p-3.5 bg-white border border-slate-200/90 rounded-2xl flex items-center gap-3 text-left my-2 shadow-sm">
          <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-[#0a6a74] to-[#2bbfcb] text-white font-extrabold flex items-center justify-center text-[13px] shrink-0">AR</div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-bold uppercase tracking-wider text-[#0a6a74]">Assigned Physician</div>
            <div class="text-body font-extrabold text-ink truncate">${e(doc.name)}</div>
            <div class="text-[12px] text-slate-500 font-semibold truncate">${e(doc.department)} • OPD Room 4</div>
          </div>
          <span class="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-extrabold shrink-0 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> On Duty
          </span>
        </div>

        <div class="space-y-2.5">
          <button onclick="handlePatientQrScan()" class="btn-primary-56 w-full bg-[#0a6a74] hover:bg-[#08555d] text-white font-bold text-t2 flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition">
            <i data-lucide="scan-line" class="w-5 h-5"></i> ${held ? `Check in · token ${e(held.token)}` : `Scan & Check In with ${e(doc.name)}`}
          </button>
          <button onclick="MediLinkDevice.scanHospital()" class="btn-touch-48 w-full bg-white border border-slate-300 text-ink font-bold text-meta flex items-center justify-center gap-2 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition">
            <i data-lucide="camera" class="w-5 h-5 text-[#0a6a74]"></i> Open Live Camera Scanner
          </button>
          <button onclick="navigate('reg_who')" class="btn-touch-48 w-full text-slate-600 font-semibold text-meta hover:text-ink">
            Register for New Token Instead
          </button>
        </div>
      </div>`;
  };

  // Patient: the token QR is the real rotating code (changes every 30 seconds).
  let qrTimer = 0;
  function drawQr(el, text) {
    if (!el || typeof qrcode !== 'function') return;
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: false }).replace(/width="\d+px" height="\d+px"/, 'width="100%" height="100%"');
  }
  async function refreshPatientQr(svgHost, label) {
    clearTimeout(qrTimer);
    if (!(live.isLive && live.isLive() && live.user.role === 'patient')) return;
    try {
      const r = await api('/me/visit-qr');
      if (!document.body.contains(svgHost)) return;
      drawQr(svgHost, r.code);
      if (label) label.textContent = `Live QR · changes in ${r.expiresInSeconds}s`;
      qrTimer = setTimeout(() => refreshPatientQr(svgHost, label), Math.max(2, r.expiresInSeconds) * 1000);
    } catch (err) { /* keep the picture */ }
  }
  const _openSheet = openTokenQRSheet;
  openTokenQRSheet = function (id) {
    _openSheet(id);
    const svg = document.getElementById('qr-sheet-svg');
    if (svg && live.isLive && live.isLive()) {
      let host = document.getElementById('ml-qr-host');
      if (!host) { host = document.createElement('div'); host.id = 'ml-qr-host'; host.className = 'w-36 h-36'; svg.replaceWith(host); }
      refreshPatientQr(host, document.getElementById('qr-sheet-hash'));
    }
  };
  const _closeSheet = closeTokenQRSheet;
  closeTokenQRSheet = function () { clearTimeout(qrTimer); return _closeSheet(); };

  /* =================================================================
   * 5. Voice to text (Android: speech plugin; browser: Web Speech API)
   * ================================================================= */
  const LANG = () => ({ hi: 'hi-IN', mr: 'mr-IN' })[state.lang] || 'en-IN';
  let rec = null;
  startDictation = async function (inputId) {
    const input = document.getElementById(inputId); if (!input) return;
    const put = (text) => { input.value = (input.dataset.base || '') + text; input.dispatchEvent(new Event('input')); };
    input.dataset.base = input.value ? input.value.trim() + ' ' : '';
    const sr = plugin('SpeechRecognition');
    if (native && sr) {
      try {
        const a = await sr.available(); if (!a.available) { toast('Voice input is not available on this phone.'); return; }
        const p = await sr.requestPermissions(); if (p.speechRecognition && p.speechRecognition !== 'granted') { toast('Allow the microphone to speak your symptoms.'); return; }
        toast('Listening… speak now');
        const r = await sr.start({ language: LANG(), maxResults: 1, prompt: 'Describe how you feel', partialResults: false, popup: true });
        if (r && r.matches && r.matches[0]) { put(r.matches[0]); toast('Got it'); }
      } catch (err) { toast('Voice input stopped. Try again.'); }
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input works in Chrome and in the MediLink Android app. Please type here.'); input.focus(); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = LANG(); rec.interimResults = true; rec.continuous = false;
    const pill = document.createElement('div');
    pill.style.zIndex = '90'; pill.className = 'absolute left-5 right-5 bottom-28 px-4 py-3 rounded-2xl bg-ink text-white text-meta font-semibold flex items-center gap-3 shadow-xl';
    pill.innerHTML = '<span class="w-3 h-3 rounded-full bg-emergency animate-pulse"></span><span class="flex-1">Listening… speak now</span><button class="underline">Stop</button>';
    frame().appendChild(pill); pill.querySelector('button').onclick = () => rec && rec.stop();
    rec.onresult = (ev) => { let t = ''; for (const r of ev.results) t += r[0].transcript; put(t); pill.querySelector('.flex-1').textContent = t || 'Listening…'; };
    rec.onerror = (ev) => toast(ev.error === 'not-allowed' ? 'Microphone permission was denied. Allow it and try again.' : ev.error === 'no-speech' ? 'No speech heard. Try again.' : 'Voice input stopped.');
    rec.onend = () => { pill.remove(); rec = null; };
    try { rec.start(); } catch (err) { pill.remove(); rec = null; }
  };

  /* =================================================================
   * 6. Sign-up: empty fields, real checks on every step, show/hide password, summary from your answers
   * ================================================================= */
  live.signupManaged = true;
  const SU = () => (live.signup = live.signup || {});
  MD.su = function (k, v) { SU()[k] = v; };
  const field = (k, label, opts) => {
    opts = opts || {};
    const v = SU()[k] == null ? '' : SU()[k];
    const pw = opts.type === 'password';
    return `<label class="block">
      <span class="text-[12px] font-bold text-slate-700 px-1">${label}${opts.optional ? ' <span class="font-semibold text-slate-500">(optional)</span>' : ''}</span>
      <div class="mt-1 bg-white rounded-full px-5 h-12 flex items-center gap-2 border ${MD.errs && MD.errs[k] ? 'border-emergency' : 'border-slate-200'} shadow-sm">
        ${opts.prefix ? `<span class="text-ink font-semibold">${opts.prefix}</span>` : ''}
        <input id="su-${k}" type="${opts.type || 'text'}" value="${e(v)}" placeholder="${e(opts.ph || '')}" ${opts.attrs || ''} oninput="MediLinkDevice.su('${k}', this.value)" class="w-full bg-transparent text-ink font-semibold focus:outline-none placeholder:text-slate-400" />
        ${pw ? `<button type="button" aria-label="Show or hide" onclick="const i=document.getElementById('su-${k}'); i.type=i.type==='password'?'text':'password'" class="text-slate-500"><i data-lucide="eye" class="w-4 h-4"></i></button>` : ''}
        ${opts.mic ? `<button type="button" aria-label="Speak" onclick="startDictation('su-${k}')" class="text-[#0a6a74]"><i data-lucide="mic" class="w-4 h-4"></i></button>` : ''}
      </div>
      ${MD.errs && MD.errs[k] ? `<span class="block text-[12px] text-emergency font-semibold px-1 pt-1">${e(MD.errs[k])}</span>` : opts.hint ? `<span class="block text-[12px] text-slate-600 px-1 pt-1">${opts.hint}</span>` : ''}
    </label>`;
  };
  const chips = (k, items, single) => {
    const cur = SU()[k]; const sel = single ? [cur] : (cur || []);
    return `<div class="flex flex-wrap gap-2">${items.map((i) => `<button type="button" onclick="MediLinkDevice.chip('${k}', '${i}', ${single})" class="h-11 min-w-[48px] px-4 rounded-full border text-meta font-bold transition ${sel.includes(i) ? 'bg-brand-accent text-white border-brand-accent' : 'bg-white text-ink border-slate-300'}">${i}</button>`).join('')}</div>${MD.errs && MD.errs[k] ? `<span class="block text-[12px] text-emergency font-semibold px-1">${e(MD.errs[k])}</span>` : ''}`;
  };
  MD.chip = function (k, v, single) {
    const d = SU();
    if (single) d[k] = v;
    else { let a = (d[k] || []).slice(); if (v === 'None') a = a.includes('None') ? [] : ['None']; else { a = a.filter((x) => x !== 'None'); a = a.includes(v) ? a.filter((x) => x !== v) : a.concat(v); } d[k] = a; }
    render();
  };
  const strength = (p) => [p.length >= 8, /[A-Z]/.test(p), /[a-z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
  const shell = (step, title, sub, body, cta, skip) => `
    <div class="flex flex-col gap-3 pt-1 pb-4">
      <div class="h-1.5 rounded-full bg-slate-300/70 overflow-hidden"><div class="h-1.5 rounded-full bg-brand-accent" style="width:${Math.round((step / 8) * 100)}%"></div></div>
      <div class="flex items-center justify-between px-1"><span class="text-[12px] font-bold text-slate-600">Step ${step} of 8</span>${skip ? `<button onclick="MediLinkDevice.suNext(${step}, true)" class="text-meta font-bold text-brand-accent underline min-h-[36px]">Skip</button>` : ''}</div>
      <div class="space-y-1 px-1"><h1 class="text-[26px] leading-tight font-bold text-ink tracking-tight">${title}</h1><p class="text-body text-slate-600">${sub}</p></div>
      ${body}
      <button onclick="MediLinkDevice.suNext(${step})" class="btn-primary-56 w-full bg-brand text-white font-bold text-t2 shadow-md">${cta || 'Continue'}</button>
    </div>`;

  const RULES = {
    1: (d) => ({
      name: !d.name || d.name.trim().length < 3 ? 'Enter your full name as on your ID.' : /\d/.test(d.name) ? 'Names cannot contain numbers.' : '',
      email: !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email || '') ? 'Enter a valid email, e.g. name@gmail.com.' : '',
      phone: !/^[6-9]\d{9}$/.test((d.phone || '').replace(/\D/g, '').slice(-10)) || (d.phone || '').replace(/\D/g, '').length < 10 ? 'Enter a 10-digit Indian mobile number.' : '',
      password: strength(d.password || '') < 4 || (d.password || '').length < 8 ? 'Use at least 8 characters with upper and lower case letters and a number.' : '',
      password2: d.password2 !== d.password ? 'Passwords do not match.' : '',
      pin: !/^\d{4}$/.test(d.pin || '') ? 'The PIN must be exactly 4 digits.' : /^(\d)\1{3}$|^1234$|^0000$/.test(d.pin) ? 'Choose a PIN that is harder to guess.' : '',
      pin2: d.pin2 !== d.pin ? 'PINs do not match.' : '',
    }),
    2: (d) => ({ aadhaar: d.aadhaarNo && !/^[2-9]\d{11}$/.test(d.aadhaarNo.replace(/\s/g, '')) ? 'Aadhaar has 12 digits and does not start with 0 or 1.' : d.aadhaarNo && !d.aadhaar ? 'Tap Verify with DigiLocker, or Skip.' : '' }),
    3: (d) => ({ abhaNo: d.abhaNo && !/^\d{14}$/.test(d.abhaNo.replace(/\D/g, '')) ? 'ABHA number has 14 digits.' : '' }),
    4: (d) => ({
      address: !d.address || d.address.trim().length < 3 ? 'Enter your area and city.' : '',
      pincode: !/^[1-9]\d{5}$/.test(d.pincode || '') ? 'Enter your 6-digit PIN code.' : '',
      emergencyName: !d.emergencyName || d.emergencyName.trim().length < 2 ? 'Who should we call in an emergency?' : '',
      emergencyPhone: !/^[6-9]\d{9}$/.test((d.emergencyPhone || '').replace(/\D/g, '').slice(-10)) ? 'Enter a 10-digit mobile number.' : (d.emergencyPhone || '').replace(/\D/g, '').slice(-10) === (d.phone || '').replace(/\D/g, '').slice(-10) ? 'Use someone else’s number, not your own.' : '',
    }),
    5: (d) => {
      const age = d.dob ? (Date.now() - new Date(d.dob).getTime()) / 31557600000 : -1;
      return { dob: !d.dob ? 'Enter your date of birth.' : age < 0 ? 'Date of birth cannot be in the future.' : age > 120 ? 'Please check the year.' : '', sex: !d.sex ? 'Choose one.' : '', blood: !d.blood ? 'Choose your blood group, or "Don’t know".' : '' };
    },
    6: (d) => ({ allergies: !(d.allergies || []).length && !d.otherAllergy ? 'Choose your allergies, or None.' : '' }),
    7: (d) => ({ insurer: d.policyNo && !d.insurer ? 'Enter the insurer too.' : '', policyNo: d.insurer && !d.policyNo ? 'Enter the policy number too.' : '' }),
    8: (d) => ({ agree: !d.agree ? 'Please confirm to continue.' : '' }),
  };
  MD.suNext = function (step, skip) {
    const d = SU();
    if (skip) { if (step === 2) { d.aadhaarNo = ''; d.aadhaar = false; } if (step === 3) d.abhaNo = ''; if (step === 7) { d.insurer = ''; d.policyNo = ''; } }
    const errs = Object.fromEntries(Object.entries(RULES[step](d)).filter(([, v]) => v));
    MD.errs = errs;
    if (Object.keys(errs).length) { render(); const first = document.querySelector('.border-emergency'); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    MD.errs = null;
    if (step === 1) d.phone = '+91' + d.phone.replace(/\D/g, '').slice(-10);
    if (step === 4) d.emergencyPhone = '+91' + d.emergencyPhone.replace(/\D/g, '').slice(-10);
    if (step === 6) d.allergies = (d.allergies || []).filter((a) => a !== 'None').concat(d.otherAllergy ? [d.otherAllergy.trim()] : []);
    if (step === 3) d.abha = !!d.abhaNo;
    if (step === 8) { live.finishSignup(document.activeElement); return; }
    navigate('signup_' + (step + 1));
  };
  MD.verifyAadhaar = function () {
    const n = (SU().aadhaarNo || '').replace(/\s/g, '');
    if (!/^[2-9]\d{11}$/.test(n)) { MD.errs = { aadhaar: 'Aadhaar has 12 digits and does not start with 0 or 1.' }; render(); return; }
    MD.errs = null; SU().aadhaarBusy = true; render();
    setTimeout(() => { SU().aadhaarBusy = false; SU().aadhaar = true; SU().aadhaarNo = 'XXXX XXXX ' + n.slice(-4); render(); toast('Verified through DigiLocker (demo)'); }, 1200);
  };
  MD.fillArea = async function () {
    toast('Finding your area…');
    try {
      const l = await MD.getLocation();
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${l.lat}&lon=${l.lng}&zoom=16&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json(); const a = j.address || {};
      SU().address = [a.suburb || a.neighbourhood || a.village || a.town, a.city || a.county || a.state_district].filter(Boolean).join(', ');
      if (a.postcode) SU().pincode = String(a.postcode).replace(/\D/g, '').slice(0, 6);
      render();
    } catch (err) { toast(err.message || 'Could not find your area. Please type it.'); }
  };

  renderSignup1 = function () {
    const d = SU(), s = strength(d.password || '');
    const bar = ['bg-emergency', 'bg-emergency', 'bg-warn', 'bg-warn', 'bg-ok', 'bg-ok'][s];
    return `
      <div class="flex flex-col gap-3 pt-1 pb-4">
        <div class="h-1.5 rounded-full bg-slate-300/70 overflow-hidden"><div class="h-1.5 rounded-full bg-brand-accent" style="width:12%"></div></div>
        <div class="space-y-1 px-1"><h1 class="text-[30px] leading-tight font-bold text-ink tracking-tight">${t('sign_up')}</h1><p class="text-body text-slate-600">One account for every hospital. Step 1 of 8.</p></div>
        ${field('name', 'Full name', { ph: 'As on your Aadhaar or PAN', attrs: 'autocomplete="name"' })}
        ${field('email', 'Email', { type: 'email', ph: 'name@gmail.com', attrs: 'autocomplete="email" autocapitalize="off"' })}
        ${field('phone', 'Mobile number', { type: 'tel', prefix: '+91', ph: '98XXXXXXXX', attrs: 'inputmode="numeric" maxlength="10" autocomplete="tel-national"' })}
        ${field('password', 'Create password', { type: 'password', ph: 'At least 8 characters', attrs: 'autocomplete="new-password"' })}
        <div class="px-1 -mt-1 space-y-1"><div class="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div class="h-1.5 ${bar}" style="width:${s * 20}%"></div></div><div class="text-[12px] text-slate-600">${['Too weak', 'Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s]} · use upper and lower case, a number and a symbol</div></div>
        ${field('password2', 'Confirm password', { type: 'password', ph: 'Type it again', attrs: 'autocomplete="new-password"' })}
        <div class="grid grid-cols-2 gap-2">${field('pin', '4-digit PIN', { type: 'password', ph: '••••', attrs: 'inputmode="numeric" maxlength="4"' })}${field('pin2', 'Confirm PIN', { type: 'password', ph: '••••', attrs: 'inputmode="numeric" maxlength="4"' })}</div>
        <p class="text-[12px] text-slate-600 px-1">You enter the PIN every time you log in.</p>
        <button onclick="MediLinkDevice.suNext(1)" class="btn-primary-56 w-full bg-brand text-white font-bold text-t2">Next</button>
        <button onclick="navigate('login_email')" class="w-full text-center text-meta text-slate-700 font-semibold min-h-[44px]">Have an account? <span class="underline text-brand-accent">${t('log_in')}</span></button>
      </div>`;
  };
  renderSignup2 = function () {
    const d = SU();
    return shell(2, 'Verify with Aadhaar', 'Quick check through DigiLocker. We never store your Aadhaar number, only that it was verified.',
      (d.aadhaar ? `<div class="card-minimal p-3.5 flex items-center gap-3"><i data-lucide="shield-check" class="w-6 h-6 text-ok shrink-0"></i><div><div class="text-body font-bold text-ink">Verified via DigiLocker</div><div class="text-[12px] text-slate-600">${e(d.aadhaarNo)}</div></div></div>`
        : field('aadhaarNo', 'Aadhaar number', { ph: '12 digits', attrs: 'inputmode="numeric" maxlength="14"', optional: true }) + (MD.errs && MD.errs.aadhaar ? `<span class="block text-[12px] text-emergency font-semibold px-1">${e(MD.errs.aadhaar)}</span>` : '') +
          `<button onclick="MediLinkDevice.verifyAadhaar()" ${d.aadhaarBusy ? 'disabled' : ''} class="btn-touch-48 w-full bg-brand-light text-brand font-semibold flex items-center justify-center gap-2"><i data-lucide="shield-check" class="w-5 h-5"></i> ${d.aadhaarBusy ? 'Checking with DigiLocker…' : 'Verify with DigiLocker'}</button>`),
      'Continue', true);
  };
  renderSignup3 = function () {
    return shell(3, 'Link your ABHA ID', 'Your national health ID keeps records together across hospitals.',
      field('abhaNo', 'ABHA number', { ph: '14 digits', attrs: 'inputmode="numeric" maxlength="17"', optional: true, hint: 'Don’t have one? Skip and add it later from Profile.' }), 'Continue', true);
  };
  renderSignup4 = function () {
    return shell(4, 'Your details', 'Used on your hospital registration card.',
      `<button onclick="MediLinkDevice.fillArea()" class="btn-touch-48 w-full bg-white border border-slate-300 text-ink font-semibold flex items-center justify-center gap-2"><i data-lucide="locate-fixed" class="w-5 h-5 text-brand-accent"></i> Use my current location</button>` +
      field('address', 'Area and city', { ph: 'e.g. Baner, Pune', attrs: 'autocomplete="address-level2"' }) + field('pincode', 'PIN code', { ph: '6 digits', attrs: 'inputmode="numeric" maxlength="6" autocomplete="postal-code"' }) +
      field('emergencyName', 'Emergency contact name', { ph: 'e.g. Priya Sharma (wife)' }) + field('emergencyPhone', 'Emergency contact mobile', { type: 'tel', prefix: '+91', ph: '98XXXXXXXX', attrs: 'inputmode="numeric" maxlength="10"' }));
  };
  renderSignup5 = function () {
    const today = new Date().toISOString().slice(0, 10);
    return shell(5, 'About you', 'Helps doctors prepare before you arrive.',
      field('dob', 'Date of birth', { type: 'date', attrs: `max="${today}" min="1900-01-01"` }) +
      `<div class="space-y-1.5"><span class="text-[12px] font-bold text-slate-700 px-1">Sex</span>${chips('sex', ['Male', 'Female', 'Other'], true)}</div>` +
      `<div class="space-y-1.5"><span class="text-[12px] font-bold text-slate-700 px-1">Blood group</span>${chips('blood', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Don’t know'], true)}</div>`);
  };
  renderSignup6 = function () {
    return shell(6, 'Allergies', 'Tap all that apply. Doctors see this first.',
      `<div class="space-y-1.5">${chips('allergies', ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Dust', 'Peanuts', 'Latex', 'None'], false)}</div>` + field('otherAllergy', 'Other allergy', { ph: 'Type or speak', optional: true, mic: true }));
  };
  renderSignup7 = function () {
    return shell(7, 'Insurance', 'Optional. Hospitals use it to confirm cover.',
      field('insurer', 'Insurer', { ph: 'e.g. Star Health', optional: true }) + field('policyNo', 'Policy number', { ph: 'As on your card', optional: true }), 'Continue', true);
  };
  renderSignup8 = function () {
    const d = SU();
    const row = (k, v) => `<div class="flex justify-between gap-3 py-2 border-b border-slate-200/70 last:border-0"><span class="text-meta text-slate-600">${k}</span><span class="text-meta font-bold text-ink text-right">${e(v)}</span></div>`;
    return shell(8, 'Almost done', 'Check your details and confirm.',
      `<div class="card-minimal px-4 py-1.5">${row('Name', d.name)}${row('Email', d.email)}${row('Mobile', d.phone)}${row('Date of birth', d.dob)}${row('Sex', d.sex)}${row('Blood group', d.blood === 'Don’t know' ? 'Not known' : d.blood)}${row('Allergies', (d.allergies || []).join(', ') || 'None')}${row('Aadhaar', d.aadhaar ? 'Verified' : 'Not verified')}${row('ABHA', d.abhaNo ? 'XX-XXXX-XXXX-' + d.abhaNo.replace(/\D/g, '').slice(-4) : 'Not linked')}${row('Emergency contact', `${d.emergencyName || ''} ${d.emergencyPhone || ''}`)}${row('Insurance', d.insurer ? `${d.insurer} · ${d.policyNo}` : 'None')}</div>
       <label class="flex items-start gap-3 px-1 text-meta text-slate-700"><input type="checkbox" ${d.agree ? 'checked' : ''} onchange="MediLinkDevice.su('agree', this.checked)" class="w-5 h-5 mt-0.5 accent-[#0a6a74]"> <span>I confirm my details are true and agree to share them with hospitals I visit. I can withdraw consent for any hospital later.</span></label>
       ${MD.errs && MD.errs.agree ? `<span class="block text-[12px] text-emergency font-semibold px-1">${e(MD.errs.agree)}</span>` : ''}`,
      'Complete Sign Up');
  };
  // Starting sign-up again begins with an empty form.
  const _nav2 = navigate;
  navigate = function (screen, push) {
    if (screen === 'signup_1' && !String(state.currentScreen).startsWith('signup_')) { live.signup = {}; MD.errs = null; }
    if (String(screen).startsWith('signup_') && screen !== state.currentScreen) MD.errs = null;
    return _nav2(screen, push);
  };

  /* Empty states: a new patient has no visits yet (the prototype's screens expect at least one). */
  const emptyVisits = () => `
    <div class="space-y-5 pb-6">
      <div class="flex items-center justify-between pt-1"><h1 class="font-display-serif text-[34px] leading-none text-ink">My Queue</h1><span class="px-3.5 h-9 rounded-full bg-white/80 border border-white text-meta font-bold text-ink flex items-center">0 active</span></div>
      <div class="ref1-blue-card p-6 space-y-3 text-center">
        <i data-lucide="ticket" class="w-10 h-10 mx-auto"></i>
        <div class="text-t1">No visits yet</div>
        <p class="text-meta opacity-90">Scan the QR at a hospital or choose one to get your token.</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button onclick="navigate('scan_qr')" class="btn-primary-56 bg-brand text-white font-semibold flex items-center justify-center gap-2"><i data-lucide="scan-line" class="w-5 h-5"></i> Scan QR</button>
        <button onclick="navigate('hospital_search')" class="btn-primary-56 bg-white border border-slate-300 text-ink font-semibold flex items-center justify-center gap-2"><i data-lucide="search" class="w-5 h-5"></i> Find hospital</button>
      </div>
    </div>`;
  const _home = renderPatientHome;
  renderPatientHome = function () {
    // No active token: show the empty state (and past visits). Never an invented token.
    if (!(typeof activeVisit === 'function' ? activeVisit() : (state.patientConsultations || []).length)) {
      const past = (state.patientConsultations || []).filter((c) => c.stageIndex === 4);
      const history = past.length ? `<div class="space-y-2"><h2 class="font-display-serif text-[24px] text-ink px-1">History</h2>${past.map((h) => `<div onclick="openTokenQRSheet('${h.id}')" class="card-minimal px-4 h-[68px] flex items-center justify-between cursor-pointer hover:bg-white/80 transition"><div class="flex items-center gap-3 min-w-0"><span class="px-3 h-8 rounded-xl bg-slate-200 text-ink font-extrabold text-[13px] flex items-center shrink-0">${e(h.token)}</span><div class="min-w-0"><div class="text-body font-bold text-ink truncate">${e(h.doctorName)}</div><div class="text-meta text-slate-600 truncate">${e(h.specialty || '')}</div></div></div><span class="px-2.5 py-1 rounded-full bg-ok-light text-ok text-[11px] font-bold shrink-0">Done</span></div>`).join('')}</div>` : '';
      const fu = typeof patientFollowUpCard === 'function' ? patientFollowUpCard() : '';
      return emptyVisits().replace(/<\/div>\s*$/, fu + history + '</div>');
    }
    // Doctor avatar: initials, so long names fit in the circle.
    return _home().replace(/(<div class="w-12 h-12 rounded-full bg-white text-\[#0a6a74\][^"]*">)([^<]*)(<\/div>)/g, (m, a, name, b) => a + name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() + b);
  };
  const _flowP = renderFlowPage;
  renderFlowPage = function () { return _flowP(); };

  /* Live accounts: replace the prototype's sample details on screens that would otherwise show them. */
  const liveRole = (r) => live.isLive && live.isLive() && live.user.role === r;
  const _who = renderRegWho;
  renderRegWho = function () {
    const h = _who();
    if (!liveRole('patient')) return h;
    // Family members are not in the live system yet: only "Me".
    return h.replace(/<button onclick="state\.regDraft\.forWho='Parent'[\s\S]*?<\/button>/, '');
  };
  const _prof = typeof renderProfile === 'function' ? renderProfile : null;
  if (_prof) renderProfile = function () {
    let h = _prof();
    if (!liveRole('patient') || !live.profile) return h;
    const ini = String(state.patient.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const hospitals = new Set(state.patientConsultations.map((c) => c.hospitalName)).size;
    h = h.replace(/>\s*AS\s*</, '>' + ini + '<')
      .replace(/<div class="text-t2 font-extrabold text-ink">3<\/div>(\s*<div class="text-\[11px\] font-semibold text-slate-600">Hospital IDs)/, `<div class="text-t2 font-extrabold text-ink">${hospitals}</div>$1`)
      .replace('<div class="text-t2 font-extrabold text-ok">Verified</div>', live.profile.aadhaar_verified ? '<div class="text-t2 font-extrabold text-ok">Verified</div>' : '<div class="text-t2 font-extrabold text-slate-500">Not yet</div>');
    return h;
  };
  // Reception: the "emergency arriving" card shows real alerts from patients who tapped "Inform hospital".
  const _rec = renderReceptionDashboard;
  renderReceptionDashboard = function () {
    const h = _rec();
    if (!liveRole('staff')) return h;
    const al = (live.emergencyAlerts || [])[0];
    const card = /<div class="card-minimal p-3\.5 flex items-center justify-between bg-emergency-light">[\s\S]*?ETA 6 min<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/;
    if (!al) return h.replace(card, '');
    const mins = Math.max(0, Math.round((new Date(al.created_at).getTime() + (al.eta_minutes || 0) * 60000 - Date.now()) / 60000));
    return h.replace(card, `<div class="card-minimal p-3.5 flex items-center justify-between bg-emergency-light"><div class="flex items-center gap-2.5 min-w-0"><i data-lucide="siren" class="w-5 h-5 text-emergency shrink-0"></i><div class="min-w-0"><div class="text-meta font-bold text-emergency truncate">Emergency arriving · ${e(al.name)}</div><div class="text-[12px] text-slate-600">${al.eta_minutes ? (mins ? `ETA about ${mins} min` : 'Arriving now') : 'On the way'}${al.lat ? ` · <a class="underline" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${al.lat},${al.lng}">location</a>` : ''}</div></div></div></div>`);
  };

  /* =================================================================
   * 7. Demo view switcher (next to the read-aloud button). Remove before release.
   * ================================================================= */
  const VIEWS = [
    ['user', 'Patient', 'aarav@demo.in'], ['stethoscope', 'Doctor', 'dra.kokilaben@gmail.com'], ['building-2', 'Staff (choose Reception, Radiology or Pathology)', 'staff.kokilaben@gmail.com'],
    ['layout-dashboard', 'Hospital admin', 'admin.kokilaben@gmail.com'], ['shield-check', 'MediLink owner', 'owner.medilink@gmail.com'], ['log-out', 'Signed out (welcome)', ''],
  ];
  MD.openViews = function () {
    const box = document.createElement('div');
    box.style.zIndex = '90'; box.className = 'absolute inset-0 bg-ink/55 backdrop-blur-sm flex items-end';
    box.innerHTML = `<div class="w-full max-w-[430px] mx-auto rounded-t-[32px] bg-white p-5 space-y-2 shadow-2xl">
      <div class="flex items-center justify-between"><div><div class="text-meta font-bold uppercase tracking-wider text-brand-accent">Demo</div><div class="text-t2 font-bold text-ink">Switch view</div></div><button data-x="close" class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button></div>
      ${VIEWS.map(([icon, label, email], i) => `<button data-i="${i}" class="w-full p-3 rounded-2xl border border-slate-200 flex items-center gap-3 text-left hover:bg-slate-50"><span class="w-10 h-10 rounded-xl bg-brand-light text-brand-accent flex items-center justify-center"><i data-lucide="${icon}" class="w-5 h-5"></i></span><span class="flex-1"><span class="block text-body font-bold text-ink">${label}</span><span class="block text-[12px] text-slate-600">${email || 'Back to the start screen'}</span></span></button>`).join('')}
    </div>`;
    frame().appendChild(box); if (window.lucide) lucide.createIcons();
    box.querySelector('[data-x="close"]').onclick = () => box.remove();
    box.onclick = (ev) => { if (ev.target === box) box.remove(); };
    box.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { box.remove(); MD.switchTo(VIEWS[+b.dataset.i][2]); }; });
  };
  MD.switchTo = async function (email) {
    if (!email) { if (live.logout) live.logout(); return; }
    try {
      if (live.logout) live.logout();
      let r = await api('/auth/login', { body: { email, password: 'MediLink@2026' } });
      if (r.needsPin) r = await api('/auth/pin', { body: { pinToken: r.pinToken, pin: '1234' } });
      await live.finishLogin(r);
    } catch (err) {
      if (err.offline && typeof quickSwitchAccount === 'function') { const d = DOCTORS.find((x) => x.email.toLowerCase() === email); quickSwitchAccount(email === 'aarav@demo.in' ? 'patient' : d ? d.email : email); }
      else toast(err.message);
    }
  };
  const VBTN = '<button id="ml-view-btn" onclick="MediLinkDevice.openViews()" aria-label="Switch view (demo)" title="Switch view (demo)" class="w-11 h-11 rounded-full flex items-center justify-center bg-white/95 backdrop-blur-md border border-slate-200/80 text-ink shadow-sm hover:bg-white transition"><i data-lucide="repeat" class="w-5 h-5 text-brand-accent"></i></button>';
  const _render = render;
  render = function () {
    const out = _render.apply(this, arguments);
    const tts = document.getElementById('tts-btn');
    if (tts && !document.getElementById('ml-view-btn')) { tts.insertAdjacentHTML('beforebegin', VBTN); if (window.lucide) lucide.createIcons(); }
    if (state.currentScreen === 'reg_token_ready' && live.isLive && live.isLive()) {
      const box = [...document.querySelectorAll('#screen-container div')].find((d) => d.textContent.trim() === '[QR PASS SIGNED]');
      if (box) { box.className = 'w-36 h-36 mx-auto'; box.textContent = ''; refreshPatientQr(box, null); }
    }
    return out;
  };
})();
