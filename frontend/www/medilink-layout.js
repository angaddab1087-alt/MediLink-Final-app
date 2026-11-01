/* MediLink layout module (v1.7.0)
 *
 * Which screen layout each kind of person can use:
 *   Patient (plain)          phone only
 *   Doctor                   phone or desktop (tablet / laptop)
 *   Doctor in patient mode   phone or desktop
 *   Hospital staff           phone or desktop (Reception, Radiology, Pathology desks)
 *   Hospital admin / owner   desktop only (unchanged)
 *
 * The choice is remembered on the device. Everything here wraps the existing
 * switchViewport() and render(); no prototype screen is rewritten.
 */
(function () {
  'use strict';
  if (typeof state === 'undefined' || typeof switchViewport !== 'function' || typeof render !== 'function') return;

  const KEY = 'medilink.layout';
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ } },
  };

  function getAutoLayout() {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 ? 'desktop' : 'phone';
    }
    return 'phone';
  }

  // Layout dynamically responds to screen size by default
  state.layout = (typeof window !== 'undefined' && window.innerWidth) ? getAutoLayout() : (store.get() || 'phone');

  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const DESKTOP_ONLY = ['admin', 'owner'];
  const canDesktop = () => true;
  const canChoose = () => !isNative();
  const effective = () => {
    if (isNative()) return 'phone';
    // Truly dynamic to screen size: if screen is desktop width, render desktop. If phone width, render phone.
    if (typeof window !== 'undefined' && window.innerWidth) {
      if (window.innerWidth < 768) return 'phone';
      return state.layout === 'phone' ? 'phone' : 'desktop';
    }
    return state.layout || 'phone';
  };

  window.MediLinkLayout = { effective, canChoose, canDesktop, renderDesktopNav, navItems };

  /* 'admin' is the prototype's name for its wide frame. A request for 'mobile' now means
     "the right layout for whoever is signed in". */
  const _switchViewport = switchViewport;
  switchViewport = function (mode) {
    const want = mode === 'admin' ? 'desktop' : effective();
    return _switchViewport(want === 'desktop' ? 'admin' : 'mobile');
  };

  window.MediLinkLayout.toggle = function () {
    state.layout = state.layout === 'desktop' ? 'phone' : 'desktop';
    store.set(state.layout);
    switchViewport('mobile');
  };

  // Dynamic viewport resize listener to adapt layout dynamically to any screen size
  let lastDynamicWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  let dynamicResizeTimer = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      clearTimeout(dynamicResizeTimer);
      dynamicResizeTimer = setTimeout(() => {
        const curW = window.innerWidth;
        const wasDesk = lastDynamicWidth >= 768;
        const isDesk = curW >= 768;
        lastDynamicWidth = curW;
        if (wasDesk !== isDesk) {
          state.layout = isDesk ? 'desktop' : 'phone';
          store.set(state.layout);
          if (typeof switchViewport === 'function') {
            _switchViewport(isDesk ? 'admin' : 'mobile');
          }
          if (typeof render === 'function') render();
        }
      }, 75);
    });
  }

  /* ---------- collapse desktop navigation to single tiny bar (Spotify rail style) ---------- */
  const COLLAPSE_KEY = 'medilink_desktop_nav_collapsed';
  function isNavCollapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch (e) { return false; }
  }

  window.toggleDesktopNavCollapse = function () {
    const cur = isNavCollapsed();
    try { localStorage.setItem(COLLAPSE_KEY, cur ? 'false' : 'true'); } catch (e) {}
    document.body.dataset.navCollapsed = cur ? 'false' : 'true';
    if (typeof render === 'function') render();
  };

  window.MediLinkLayout.isCollapsed = isNavCollapsed;
  window.MediLinkLayout.toggleCollapse = window.toggleDesktopNavCollapse;

  /* ---------- desktop navigation bar (replaces the phone dock) ---------- */
  const SCREENS_VISITOR = ['splash', 'welcome', 'walkthrough', 'role_select', 'doctor_signup', 'unique_account_select', 'auth_choice', 'login_email', 'login_pin',
    'signup_1', 'signup_2', 'signup_3', 'signup_4', 'signup_5', 'signup_6', 'signup_7', 'signup_8', 'staff_login', 'emergency_home', 'emergency_map', 'emergency_call', 'waiting_display', 'design_gallery'];

  function navItems() {
    const sc = state.currentScreen;
    if (state.role === 'doctor') {
      return [
        ['Queue', 'users', 'doctor_dashboard', ['doctor_dashboard', 'doctor_patient_view', 'doctor_refer', 'doctor_scan'].includes(sc)],
        ['Alerts', 'bell', 'notifications', sc === 'notifications'],
        ['Profile', 'user-round', 'doctor_profile', sc === 'doctor_profile'],
      ];
    }
    if (state.role === 'patient') {
      return [
        ['Home', 'home', 'home', sc === 'home'],
        ['Flow', 'activity', 'flow', sc === 'flow'],
        ['Scan QR', 'qr-code', 'scan_qr', sc === 'scan_qr'],
        ['Drive', 'folder-heart', 'drive', sc === 'drive'],
        ['Notifications', 'bell', 'notifications', sc === 'notifications'],
        ['Profile', 'user-round', 'profile', sc === 'profile'],
      ];
    }
    if (state.role === 'staff') {
      if (state.activeDesk === 'Reception') {
        return [
          ['Dashboard', 'layout-dashboard', 'reception_dashboard', sc === 'reception_dashboard'],
          ['Patient lookup', 'search', 'rec_lookup', sc === 'rec_lookup'],
          ['Vitals', 'activity', 'rec_vitals', sc === 'rec_vitals'],
        ];
      }
      if (state.activeDesk) {
        return [
          ['Dashboard', 'layout-dashboard', 'diag_dashboard', sc === 'diag_dashboard'],
          ['Send reports', 'send', 'staff_send_docs', sc === 'staff_send_docs'],
        ];
      }
    }
    if (state.role === 'admin') {
      return [
        ['Overview', 'layout-dashboard', 'admin_dashboard', sc === 'admin_dashboard'],
        ['Hospital Setup', 'building-2', 'admin_hosp_setup', sc === 'admin_hosp_setup'],
        ['Audit Log', 'shield-check', 'admin_audit', sc === 'admin_audit'],
        ['Alerts & Safety', 'siren', 'admin_conduct', sc === 'admin_conduct'],
      ];
    }
    if (state.role === 'owner') {
      return [
        ['Console', 'layout-dashboard', 'owner_console', sc === 'owner_console'],
        ['Hospitals', 'building-2', 'owner_hospitals', sc === 'owner_hospitals'],
        ['Compliance', 'clock', 'owner_compliance', sc === 'owner_compliance'],
        ['Incidents', 'alert-triangle', 'owner_incidents', sc === 'owner_incidents'],
        ['Settings', 'settings', 'owner_settings', sc === 'owner_settings'],
      ];
    }
    return [];
  }

  function staffDeskCount() {
    try { const a = typeof myAcct === 'function' ? myAcct() : null; return a ? a.desks.length : 0; } catch (e) { return 0; }
  }

  function renderDesktopNav(frame, show) {
    let bar = document.getElementById('ml-desktop-nav');
    if (!show) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('aside');
      bar.id = 'ml-desktop-nav';
      bar.setAttribute('aria-label', 'Main navigation sidebar');
      document.body.appendChild(bar);
    }
    const collapsed = isNavCollapsed();
    document.body.dataset.navCollapsed = collapsed ? 'true' : 'false';

    const items = navItems();
    const sc = state.currentScreen;
    const isDoctor = state.role === 'doctor';
    const isStaff = state.role === 'staff';
    const isPatient = state.role === 'patient';
    const isRoleAdmin = state.role === 'admin';
    const isRoleOwner = state.role === 'owner';

    // User info for bottom badge
    let userName = 'User';
    let userRole = 'Patient';
    let userInitials = 'ME';
    if (isDoctor) {
      const doc = (typeof DOCTORS !== 'undefined' ? DOCTORS.find(d => d.email === state.currentAccountEmail) : null) || (typeof DOCTORS !== 'undefined' ? DOCTORS[0] : null) || { name: 'Doctor', department: 'Medicine' };
      userName = doc.name;
      userRole = doc.department;
      userInitials = doc.name.replace('Dr. ', '').slice(0, 2).toUpperCase();
    } else if (isStaff) {
      const a = typeof myAcct === 'function' ? myAcct() : null;
      userName = (a && a.name) || 'Hospital Staff';
      userRole = state.activeDesk ? `${state.activeDesk} Desk` : 'Staff';
      userInitials = 'ST';
    } else if (isPatient) {
      userName = (state.patient && state.patient.name) || 'Aarav Sharma';
      userRole = 'Patient';
      userInitials = userName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'AS';
    } else if (isRoleAdmin) {
      userName = 'Hospital Admin';
      userRole = typeof hospName === 'function' && typeof hid === 'function' ? hospName(hid()) : 'Kokilaben Hospital';
      userInitials = 'AD';
    } else if (isRoleOwner) {
      userName = 'Platform Owner';
      userRole = 'MediLink Root';
      userInitials = 'ML';
    }

    const isRegistered = typeof isFlowRegistered === 'function' ? isFlowRegistered() : (typeof state !== 'undefined' && (state.activeQrScanned || (state.activeToken && state.activeToken.number && state.activeToken.state !== 'Cancelled')));
    const tabsHtml = items.map(([label, icon, screen, active]) => {
      const isFlow = screen === 'flow';
      const showLive = isFlow && isRegistered;
      return `
        <button type="button" onclick="navigate('${screen}')" title="${label}" class="ml-sb-item${active ? ' is-active' : ''}">
          ${active ? '<span class="ml-sb-active-indicator"></span>' : ''}
          <div class="ml-sb-icon-wrap"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
          <span class="ml-sb-label">${label}</span>
          ${showLive ? '<span class="ml-sb-badge-live">LIVE</span>' : ''}
          ${screen === 'notifications' && (typeof state !== 'undefined' && state.notifications && state.notifications.some(n => !n.read)) ? '<span class="ml-sb-badge-dot"></span>' : ''}
        </button>
      `;
    }).join('');

    const switchHospitalBtn = (isStaff || state.role === 'admin') ? `
      <button type="button" onclick="window.openHospitalSwitcherModal()" title="Switch Hospital" class="ml-sb-item ml-sb-action">
        <div class="ml-sb-icon-wrap"><i data-lucide="building-2" class="w-5 h-5 text-brand-accent"></i></div>
        <span class="ml-sb-label">Switch Hospital</span>
      </button>` : '';

    const switchDeskBtn = isStaff ? `
      <button type="button" onclick="navigate('desk_choose')" title="Switch Desk" class="ml-sb-item ml-sb-action">
        <div class="ml-sb-icon-wrap"><i data-lucide="repeat" class="w-5 h-5 text-brand-accent"></i></div>
        <span class="ml-sb-label">Switch Desk</span>
      </button>` : '';

    const switchDoctorBtn = isDoctor ? `
      <button type="button" onclick="window.openDoctorSwitcherModal()" title="Switch Doctor" class="ml-sb-item ml-sb-action">
        <div class="ml-sb-icon-wrap"><i data-lucide="stethoscope" class="w-5 h-5 text-brand-accent"></i></div>
        <span class="ml-sb-label">Switch Doctor</span>
      </button>` : '';

    const emergencyBtn = isPatient ? `
      <button type="button" onclick="navigate('emergency_home')" title="Emergency" class="ml-sb-item ml-sb-emergency">
        <div class="ml-sb-icon-wrap"><i data-lucide="phone-call" class="w-5 h-5 text-rose-600"></i></div>
        <span class="ml-sb-label font-bold text-rose-600">Emergency</span>
      </button>` : '';

    const html = `
      <!-- Top Window Decor & Logo with Collapse Toggle Button (Spotify-style) -->
      <div class="ml-sb-top">
        <div class="ml-sb-top-header">
          <div class="ml-sb-dots">
            <span class="ml-sb-dot ml-sb-dot-red"></span>
            <span class="ml-sb-dot ml-sb-dot-yellow"></span>
            <span class="ml-sb-dot ml-sb-dot-green"></span>
          </div>
          <button type="button" onclick="window.toggleDesktopNavCollapse()" class="ml-sb-collapse-btn" title="${collapsed ? 'Expand navigation sidebar' : 'Collapse to tiny bar'}" aria-label="Toggle navigation sidebar collapse">
            <i data-lucide="${collapsed ? 'chevrons-right' : 'chevrons-left'}" class="w-4 h-4"></i>
          </button>
        </div>
        <div class="ml-sb-brand" title="MediLink">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0a6a74] to-[#2bbfcb] text-white flex items-center justify-center font-bold shadow-sm shrink-0">
            <i data-lucide="cross" class="w-5 h-5"></i>
          </div>
          <div class="min-w-0 ml-sb-brand-text">
            <div class="text-t2 font-extrabold text-ink leading-tight tracking-tight">MediLink</div>
            <div class="text-[11px] font-semibold text-[#0a6a74]">Live Health Portal</div>
          </div>
        </div>
      </div>

      <!-- Navigation Section -->
      <div class="ml-sb-nav-section">
        <div class="ml-sb-heading">MENU</div>
        <div class="space-y-1">
          ${tabsHtml}
        </div>

        <div class="ml-sb-heading pt-4">ACTIONS</div>
        <div class="space-y-1">
          ${switchDoctorBtn}
          ${switchHospitalBtn}
          ${switchDeskBtn}
          ${emergencyBtn}
        </div>
      </div>

      <!-- Bottom User Profile Pill -->
      <div class="ml-sb-footer">
        <div class="ml-sb-user-card" title="${esc(userName)} (${esc(userRole)})" onclick="navigate('${isDoctor ? 'doctor_profile' : (isStaff ? 'desk_choose' : 'profile')}')">
          <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0a6a74] to-[#2bbfcb] text-white font-extrabold flex items-center justify-center text-[12px] shadow-sm shrink-0">
            ${userInitials}
          </div>
          <div class="min-w-0 flex-1 ml-sb-user-text">
            <div class="text-[13px] font-bold text-ink leading-tight truncate">${esc(userName)}</div>
            <div class="text-[11px] font-medium text-slate-500 truncate">${esc(userRole)}</div>
          </div>
          <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 shrink-0 ml-sb-user-text"></i>
        </div>
      </div>
    `;

    if (bar.dataset.sig !== html) {
      bar.innerHTML = html;
      bar.dataset.sig = html;
      if (window.lucide) lucide.createIcons();
    }
  }

  /* ---------- phone <-> desktop toggle in the top bar ---------- */
  function renderToggle(show) {
    const old = document.getElementById('ml-layout-btn');
    if (!show || isNative()) { if (old) old.remove(); return; }
    const desktop = effective() === 'desktop';
    const label = desktop ? 'Switch to phone view' : 'Switch to desktop view';
    const icon = desktop ? 'smartphone' : 'monitor';
    if (old && old.dataset.mode === (desktop ? 'd' : 'p')) return;
    if (old) old.remove();
    const bar = document.querySelector('#app-top-bar > div:last-child');
    if (!bar) return;
    bar.insertAdjacentHTML('afterbegin',
      `<button id="ml-layout-btn" data-mode="${desktop ? 'd' : 'p'}" type="button" onclick="MediLinkLayout.toggle()" aria-label="${label}" title="${label}" class="w-11 h-11 rounded-full flex items-center justify-center bg-white/95 backdrop-blur-md border border-slate-200/80 text-ink shadow-sm hover:bg-white transition"><i data-lucide="${icon}" class="w-5 h-5"></i></button>`);
    if (window.lucide) lucide.createIcons();
  }

  const _render = render;
  render = function () {
    const out = _render.apply(this, arguments);
    try {
      const frame = document.getElementById('device-frame');
      const desktop = effective() === 'desktop';
      document.body.dataset.layout = desktop ? 'desktop' : 'phone';
      document.body.dataset.role = state.role || 'visitor';
      document.body.dataset.navCollapsed = isNavCollapsed() ? 'true' : 'false';
      const loggedIn = state.role && state.role !== 'visitor' && !SCREENS_VISITOR.includes(state.currentScreen);
      const needsNav = desktop && loggedIn && navItems().length > 0;
      document.body.dataset.hasDesktopNav = needsNav ? 'true' : 'false';
      if (frame) renderDesktopNav(frame, needsNav);
      renderToggle(canChoose() && loggedIn);
      if (window.__mlLastScreen !== state.currentScreen) {
        window.__mlLastScreen = state.currentScreen;
        window.scrollTo(0, 0);
        const sc = document.getElementById('screen-container'); if (sc) sc.scrollTop = 0;
      }
      // Patients (including doctors in patient mode) keep the emergency button on desktop too.
      const fe = document.getElementById('floating-emergency-btn');
      if (fe && desktop && state.role === 'patient' && loggedIn && !String(state.currentScreen).startsWith('emergency_')) fe.classList.remove('hidden');
    } catch (e) { /* layout chrome must never break a screen */ }
    return out;
  };

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
    /* Truly dynamic screen behavior */
    @media (max-width: 639px) {
      body[data-layout="phone"] > main {
        padding: 0 !important;
        margin: 0 !important;
      }
      body[data-layout="phone"] #device-frame {
        width: 100vw !important;
        max-width: 100vw !important;
        min-height: 100vh !important;
        height: auto !important;
        max-height: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
    }

    /* Desktop layout with Spotify-inspired Left Sidebar placement */
    body[data-layout="desktop"] {
      background: #f8fafc;
      overflow-x: hidden;
    }
    body[data-layout="desktop"] > main {
      padding: 0 !important;
      width: 100vw !important;
      max-width: 100vw !important;
      min-height: 100vh;
    }
    body[data-layout="desktop"] #ml-desktop-nav {
      position: fixed !important;
      left: 18px !important;
      top: 18px !important;
      bottom: 18px !important;
      width: 250px !important;
      height: calc(100vh - 36px) !important;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(247, 251, 252, 0.96) 100%) !important;
      backdrop-filter: blur(24px) !important;
      -webkit-backdrop-filter: blur(24px) !important;
      border: 1px solid rgba(10, 106, 116, 0.18) !important;
      border-radius: 26px !important;
      box-shadow: 0 16px 40px -8px rgba(7, 25, 43, 0.08), 0 0 0 rgba(0,0,0,0) !important;
      z-index: 50 !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      padding: 18px 14px !important;
      margin: 0 !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      scrollbar-width: none !important;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s ease !important;
    }
    body:not([data-layout="desktop"]) #ml-desktop-nav {
      display: none !important;
    }
    body[data-layout="desktop"] #device-frame {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 100% !important;
      height: auto !important;
      min-height: 100vh !important;
      max-height: none !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      display: flex !important;
      flex-direction: column !important;
      padding-left: 0 !important;
      transition: padding-left 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="true"] #device-frame {
      padding-left: 286px !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="true"][data-nav-collapsed="true"] #device-frame {
      padding-left: 104px !important;
    }
    body[data-layout="desktop"]:not([data-has-desktop-nav="true"]) #device-frame,
    body[data-layout="desktop"][data-has-desktop-nav="false"] #device-frame {
      padding-left: 0 !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="false"] #screen-container,
    body[data-layout="desktop"]:not([data-has-desktop-nav="true"]) #screen-container {
      max-width: 480px !important;
      margin: 0 auto !important;
      padding: 24px 20px 48px !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="false"] #app-top-bar,
    body[data-layout="desktop"]:not([data-has-desktop-nav="true"]) #app-top-bar {
      max-width: 480px !important;
      margin: 0 auto !important;
      padding: 12px 16px !important;
    }
    body[data-layout="desktop"] #screen-container {
      width: 100% !important;
      max-width: 1100px !important;
      margin: 0 auto !important;
      padding: 24px 32px 72px !important;
      flex: 1 !important;
      transition: max-width 0.25s ease !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="true"][data-nav-collapsed="true"] #screen-container {
      max-width: 1200px !important;
    }
    body[data-layout="desktop"][data-role="admin"] #screen-container,
    body[data-layout="desktop"][data-role="owner"] #screen-container {
      max-width: 1280px !important;
      padding: 24px 28px 72px !important;
    }
    body[data-layout="desktop"] #app-top-bar {
      width: 100% !important;
      max-width: 1100px !important;
      margin: 0 auto !important;
      padding: 12px 32px !important;
      transition: max-width 0.25s ease !important;
    }
    body[data-layout="desktop"][data-has-desktop-nav="true"][data-nav-collapsed="true"] #app-top-bar {
      max-width: 1200px !important;
    }
    body[data-layout="desktop"] #bottom-nav {
      display: none !important;
    }
    body[data-layout="desktop"] #switch-desk-btn {
      display: none !important;
    }
    body[data-layout="desktop"][data-role="patient"] #floating-emergency-btn,
    body[data-layout="desktop"] #floating-emergency-btn {
      bottom: 32px;
      right: 36px;
    }


    #ml-desktop-nav::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    body[data-layout="desktop"] #ml-desktop-nav { clip-path: inset(0 round 26px); }

    /* Popups, sheets and dialogs: pinned to the visible window (not the tall page), above the sidebar.
       Applies on desktop and on a real phone; the 390px mockup inside a big browser keeps them inside the frame. */
    body[data-layout="desktop"] #device-frame > .absolute.inset-0,
    body[data-layout="desktop"] #docs-modal {
      position: fixed !important;
      z-index: 500 !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 16px !important;
    }
    body[data-layout="desktop"] #device-frame > .absolute.inset-0 > div:not(.absolute) {
      width: 100% !important;
      max-width: 480px !important;
      max-height: calc(100vh - 32px) !important;
      overflow-y: auto !important;
      border-radius: 24px !important;
      position: relative;
    }
    /* Toasts and queue popups: always the topmost layer, centred, never behind the sidebar or the top-right buttons. */
    body[data-layout="desktop"] #app-toast, body[data-layout="phone"] #app-toast.hidden + * { }
    body[data-layout="desktop"] #app-toast {
      position: fixed !important; z-index: 1000 !important;
      top: 18px !important; left: 0 !important; right: 0 !important; margin: 0 auto !important;
      width: min(520px, calc(100vw - 48px)) !important;
    }
    @media (max-width: 639px) {
      body[data-layout="phone"] #app-toast { position: fixed !important; z-index: 1000 !important; top: 12px !important; }
      body[data-layout="phone"] #device-frame > .absolute.inset-0 { position: fixed !important; z-index: 500 !important; }
      body[data-layout="phone"] #device-frame > .absolute.inset-0 > div:not(.absolute) { max-height: 90vh; overflow-y: auto; }
    }

    /* Sidebar Items & Mac Window Controls (Spotify layout - Gold-White Palette) */
    .ml-sb-top { display: flex; flex-direction: column; gap: 14px; padding: 4px 6px 14px; border-bottom: 1px solid rgba(10, 106, 116, 0.2); }
    .ml-sb-top-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
    .ml-sb-dots { display: flex; align-items: center; gap: 7px; }
    .ml-sb-dot { width: 11px; height: 11px; border-radius: 9999px; display: inline-block; box-shadow: 0 0 4px rgba(0,0,0,0.15); }
    .ml-sb-dot-red { background: #94a3b8; }
    .ml-sb-dot-yellow { background: #94a3b8; }
    .ml-sb-dot-green { background: #27c93f; }
    .ml-sb-collapse-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: #f1f5f9;
      color: #475569;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(10, 106, 116, 0.22);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ml-sb-collapse-btn:hover { background: #e2e8f0; color: #0f172a; border-color: rgba(10, 106, 116, 0.4); }
    .ml-sb-brand { display: flex; align-items: center; gap: 10px; }
    .ml-sb-nav-section { flex: 1; padding: 14px 2px; }
    .ml-sb-heading { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #64748b; padding: 8px 10px 6px; text-transform: uppercase; }
    .ml-sb-item {
      position: relative;
      width: 100%;
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 12px;
      border-radius: 14px;
      font-size: 13.5px;
      font-weight: 600;
      color: #475569;
      transition: all 0.15s ease;
      cursor: pointer;
      text-align: left;
    }
    .ml-sb-item:hover { background: rgba(10, 106, 116, 0.08); color: #0a6a74; }
    .ml-sb-item.is-active {
      background: #06212a;
      color: #ffffff;
      font-weight: 700;
      box-shadow: 0 4px 14px rgba(6, 33, 42, 0.18);
    }
    .ml-sb-active-indicator {
      position: absolute;
      left: 0px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 22px;
      background: #0a6a74;
      border-radius: 0 4px 4px 0;
      box-shadow: 0 0 10px rgba(10, 106, 116, 0.55);
    }
    .ml-sb-badge-live {
      margin-left: auto;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 9999px;
      background: #10b981;
      color: #ffffff;
      letter-spacing: 0.05em;
    }
    .ml-sb-badge-dot {
      margin-left: auto;
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: #e11d48;
    }
    .ml-sb-footer { padding-top: 12px; border-top: 1px solid rgba(10, 106, 116, 0.2); }
    .ml-sb-user-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 16px;
      background: #ffffff;
      border: 1px solid rgba(10, 106, 116, 0.25);
      box-shadow: 0 2px 8px rgba(7, 25, 43, 0.04);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ml-sb-user-card:hover { background: #f1f8f9; border-color: rgba(10, 106, 116, 0.35); }

    /* COLLAPSED TINY BAR (Matching Left Column in Spotify Screenshot) */
    body[data-layout="desktop"][data-nav-collapsed="true"] #ml-desktop-nav {
      width: 68px !important;
      padding: 16px 8px !important;
      align-items: center !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-top-header {
      justify-content: center !important;
      width: 100% !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-dots {
      display: none !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-brand {
      justify-content: center !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-brand-text,
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-heading,
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-label,
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-badge-live,
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-user-text {
      display: none !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-item {
      width: 48px !important;
      height: 48px !important;
      padding: 0 !important;
      justify-content: center !important;
      margin: 4px auto !important;
      border-radius: 14px !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-active-indicator {
      left: 0px !important;
      width: 4px !important;
      height: 24px !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-user-card {
      width: 44px !important;
      height: 44px !important;
      padding: 0 !important;
      justify-content: center !important;
      border-radius: 9999px !important;
      background: #ffffff !important;
      border: 1px solid rgba(10, 106, 116, 0.3) !important;
    }
    body[data-layout="desktop"][data-nav-collapsed="true"] .ml-sb-badge-dot {
      position: absolute !important;
      top: 8px !important;
      right: 8px !important;
    }

    /* Dark Mode Desktop Sidebar */
    html[data-theme="dark"] body[data-layout="desktop"] #ml-desktop-nav {
      background: #0b1522 !important;
      border-color: rgba(255,255,255,0.08) !important;
      box-shadow: 4px 0 24px rgba(0,0,0,0.4) !important;
    }
    html[data-theme="dark"] .ml-sb-collapse-btn {
      background: rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      border-color: rgba(255, 255, 255, 0.1);
    }
    html[data-theme="dark"] .ml-sb-collapse-btn:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #f8fafc;
    }
    html[data-theme="dark"] .ml-sb-item { color: #94a3b8; }
    html[data-theme="dark"] .ml-sb-item:hover { background: rgba(255,255,255,0.06); color: #f8fafc; }
    html[data-theme="dark"] .ml-sb-item.is-active { background: #0a6a74; color: #ffffff; }
    html[data-theme="dark"] .ml-sb-user-card { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
  `;
  document.head.appendChild(css);
})();
