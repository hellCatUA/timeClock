/* ================================================================
   TimeClock — app.js  (English, full rewrite)
   ================================================================ */

/* ── State ──────────────────────────────────────────────────────── */
const state = {
  page: 'clock',
  currentEntry: null,
  lastCompletedEntry: null,
  organizations: [],
  clients: [],
  payRates: [],
  settings: {},
  elapsedInterval: null,
  breakElapsedInterval: null,
  reminderTimeout: null,
  breakReturnTimeout: null,
  showReminderBanner: false,
  showBreakReturnBanner: false,
  journalDate: new Date(),
  overviewPeriod: 'month',
};

/* ── Time helpers ───────────────────────────────────────────────── */
function roundTo5(date) {
  return new Date(Math.round(date.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000));
}
function adjustedTime(offsetMinutes) {
  return roundTo5(new Date(Date.now() + offsetMinutes * 60000));
}
function fmtHHMM(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtDecimalHours(totalSec) {
  return (totalSec / 3600).toFixed(2) + ' hrs';
}
function fmtMoney(amount) {
  if (amount == null || amount === '') return '—';
  const s = state.settings.currency_symbol || '$';
  return s + parseFloat(amount).toFixed(2);
}
function fmtTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDateFull(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateShort(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function localISOString(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toISOFull(localStr) { return new Date(localStr).toISOString(); }
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function parseMaterials(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}
function getNetSeconds(entry) {
  if (!entry.clock_out) return 0;
  const gross = Math.max(0, Math.floor((new Date(entry.clock_out) - new Date(entry.clock_in)) / 1000));
  return Math.max(0, gross - (entry.total_break_seconds || 0));
}
function calcLabor(entry, netSec) {
  const s = netSec !== undefined ? netSec : getNetSeconds(entry);
  if (entry.rate_type === 'flat') return parseFloat(entry.flat_amount) || 0;
  if (entry.hourly_rate) return (s / 3600) * entry.hourly_rate;
  return 0;
}
function calcTotalExpected(entry) {
  const labor = calcLabor(entry);
  const travel = parseFloat(entry.travel_reimb) || 0;
  const parking = parseFloat(entry.parking_tolls) || 0;
  return labor + travel + parking;
}
function getWeekBounds(date, weekStartDay) {
  // weekStartDay: 0=Sun, 1=Mon
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = (dow - weekStartDay + 7) % 7;
  const start = new Date(d); start.setDate(d.getDate() - diff);
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  return { start, end };
}
function getISOWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `Week ${Math.ceil(((d - yearStart) / 86400000 + 1) / 7)}`;
}

/* ── Icons ──────────────────────────────────────────────────────── */
function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const ICONS = {
  clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play:     '<polygon points="5 3 19 12 5 21 5 3"/>',
  stop:     '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
  coffee:   '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit:     '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  check:    '<polyline points="20 6 9 17 4 12"/>',
  copy:     '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  org:      '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  dollar:   '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  chevL:    '<polyline points="15 18 9 12 15 6"/>',
  chevR:    '<polyline points="9 18 15 12 9 6"/>',
  hash:     '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  return:   '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  wrench:   '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  alert:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  car:      '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
};
const svg = name => icon(ICONS[name] || '');

/* ── Toast ──────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type='', duration=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' '+type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ── Modal ──────────────────────────────────────────────────────── */
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

/* ── Navigation ─────────────────────────────────────────────────── */
function navigateTo(page) {
  state.page = page;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  renderPage();
}
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

function renderPage() {
  clearTimers();
  document.getElementById('page').innerHTML = '<div class="loading-page"><div class="spinner"></div></div>';
  switch (state.page) {
    case 'clock':    renderClockPage(); break;
    case 'journal':  renderJournalPage(); break;
    case 'overview': renderOverviewPage(); break;
    case 'settings': renderSettingsPage(); break;
  }
}

/* ── Live clock in header ────────────────────────────────────────── */
function startLiveClock() {
  const el = document.getElementById('live-clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true }); };
  tick(); setInterval(tick, 1000);
}

/* ── Timer cleanup ───────────────────────────────────────────────── */
function clearTimers() {
  clearInterval(state.elapsedInterval);
  clearInterval(state.breakElapsedInterval);
  clearTimeout(state.reminderTimeout);
  clearTimeout(state.breakReturnTimeout);
  state.elapsedInterval = null;
  state.breakElapsedInterval = null;
}

function startElapsedTimer(entry) {
  const isFlat = entry.rate_type === 'flat';
  const update = () => {
    const onBreak = !!entry.active_break;
    const breakSecs = onBreak
      ? Math.floor((Date.now() - new Date(entry.active_break.break_start)) / 1000)
      : 0;
    const paidBreaks = state.settings.paid_breaks === '1';
    const grossSec = Math.floor((Date.now() - new Date(entry.clock_in)) / 1000);
    const netSec = Math.max(0, grossSec - (entry.total_break_seconds || 0) - ((!paidBreaks && onBreak) ? breakSecs : 0));

    const ed = document.getElementById('elapsed-display');
    if (ed) ed.textContent = fmtDuration(netSec);

    if (!isFlat && entry.hourly_rate) {
      const earn = document.getElementById('earnings-display');
      if (earn) earn.textContent = fmtMoney((netSec / 3600) * entry.hourly_rate);
    }
  };
  update();
  state.elapsedInterval = setInterval(update, 1000);
}

function startBreakElapsedTimer(breakStart) {
  const update = () => {
    const el = document.getElementById('break-elapsed');
    if (el) el.textContent = fmtDuration(Math.floor((Date.now() - new Date(breakStart)) / 1000));
  };
  update();
  state.breakElapsedInterval = setInterval(update, 1000);
}

function scheduleBreakReminder() {
  clearTimeout(state.reminderTimeout);
  if (state.settings.breaks_enabled !== '1') return;
  const minutes = parseInt(state.settings.break_frequency_minutes || '120', 10);
  if (!minutes) return;
  state.reminderTimeout = setTimeout(() => {
    state.showReminderBanner = true;
    renderActiveClockPage();
  }, minutes * 60000);
}

function scheduleBreakReturnReminder(breakStart) {
  clearTimeout(state.breakReturnTimeout);
  const minutes = parseInt(state.settings.break_length_minutes || '15', 10);
  if (!minutes) return;
  const elapsed = (Date.now() - new Date(breakStart)) / 60000;
  const remaining = Math.max(0, minutes - elapsed);
  state.breakReturnTimeout = setTimeout(() => {
    state.showBreakReturnBanner = true;
    renderActiveClockPage();
  }, remaining * 60000);
}

/* ── Time Selector Widget ────────────────────────────────────────── */
function renderTimeSelector(containerId, label, onConfirm) {
  const container = document.getElementById(containerId);
  if (!container) return;

  function phase1() {
    container.innerHTML = `
      <div class="time-selector">
        <div class="time-sel-label">${label}</div>
        <div class="time-sel-row">
          <button class="btn btn-primary flex-1" id="ts-now">Now</button>
          <button class="btn btn-ghost flex-1" id="ts-later">Other time →</button>
        </div>
      </div>`;
    document.getElementById('ts-now').addEventListener('click', () => onConfirm(new Date().toISOString()));
    document.getElementById('ts-later').addEventListener('click', phase2);
  }

  function phase2() {
    const t = off => fmtHHMM(adjustedTime(off));
    container.innerHTML = `
      <div class="time-selector">
        <div class="time-sel-label">${label}</div>
        <div class="time-sel-grid">
          <button class="btn btn-ghost time-adj-btn" data-offset="-10">−10 min<span>${t(-10)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="-5">−5 min<span>${t(-5)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="5">+5 min<span>${t(5)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="10">+10 min<span>${t(10)}</span></button>
        </div>
        <button class="btn btn-ghost btn-full" id="ts-custom">Enter time manually...</button>
        <div id="ts-custom-group" class="hidden" style="margin-top:8px;">
          <input type="datetime-local" class="form-control" id="ts-custom-input" value="${localISOString()}">
          <button class="btn btn-primary btn-full" id="ts-custom-confirm" style="margin-top:8px;">Confirm</button>
        </div>
      </div>`;
    container.querySelectorAll('.time-adj-btn').forEach(btn => {
      btn.addEventListener('click', () => onConfirm(adjustedTime(parseInt(btn.dataset.offset)).toISOString()));
    });
    document.getElementById('ts-custom').addEventListener('click', () => {
      document.getElementById('ts-custom-group').classList.toggle('hidden');
    });
    document.getElementById('ts-custom-confirm').addEventListener('click', () => {
      const val = document.getElementById('ts-custom-input').value;
      if (!val) return showToast('Please select a time', 'error');
      onConfirm(toISOFull(val));
    });
  }
  phase1();
}

/* ================================================================
   CLOCK PAGE
   ================================================================ */
async function renderClockPage() {
  try { state.currentEntry = await api.getCurrentEntry(); } catch { state.currentEntry = null; }
  if (state.currentEntry) renderActiveClockPage();
  else if (state.lastCompletedEntry) renderSummaryPage(state.lastCompletedEntry);
  else renderIdleClockPage();
}

/* ── Idle (pre-clock-in) ─────────────────────────────────────────── */
function renderIdleClockPage() {
  const orgs  = state.organizations;
  const clis  = state.clients;
  const rates = state.payRates;
  const sym   = state.settings.currency_symbol || '$';

  const orgOpts  = orgs.map(o  => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  const cliOpts  = clis.map(c  => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  const rateOpts = rates.map(r => `<option value="${r.id}">${escHtml(r.name)} — ${sym}${r.rate}/hr</option>`).join('');

  document.getElementById('page').innerHTML = `
    <div class="p-16">
      <div class="section-label">New Work Order</div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">WO Title</label>
          <input type="text" class="form-control" id="wo-title-input" placeholder="Brief description of work...">
        </div>
        <div class="form-group">
          <label class="form-label">Company</label>
          <select class="form-control" id="company-select">
            <option value="">— Select Company —</option>
            ${orgOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Customer</label>
          <select class="form-control" id="customer-select">
            <option value="">— Select Customer —</option>
            ${cliOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <div class="input-row">
            <input type="text" class="form-control" id="addr-input" placeholder="Enter address...">
            <button class="btn btn-ghost btn-icon" id="geo-btn" title="Use current location">${svg('location')}</button>
          </div>
          <div id="geo-status" class="field-hint"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Pay Type</label>
          <div class="toggle-group" id="pay-type-toggle">
            <button class="toggle-btn active" data-type="hourly">Hourly</button>
            <button class="toggle-btn" data-type="flat">Flat</button>
          </div>
        </div>
        <div class="form-group" id="hourly-rate-group">
          <label class="form-label">Hourly Rate</label>
          <select class="form-control" id="rate-select">
            <option value="">— Select Rate —</option>
            ${rateOpts}
          </select>
        </div>
        <div class="form-group hidden" id="flat-rate-group">
          <label class="form-label">Flat Rate (${sym})</label>
          <input type="number" class="form-control" id="flat-amount-input" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Travel Reimbursement (${sym})</label>
          <input type="number" class="form-control" id="travel-reimb-input" min="0" step="0.01" placeholder="0.00">
        </div>
        <div id="clockin-time-selector"></div>
      </div>
    </div>`;

  let rateType = 'hourly';
  document.getElementById('pay-type-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    rateType = btn.dataset.type;
    document.querySelectorAll('#pay-type-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('hourly-rate-group').classList.toggle('hidden', rateType === 'flat');
    document.getElementById('flat-rate-group').classList.toggle('hidden', rateType === 'hourly');
  });

  let geoCoords = null;
  document.getElementById('geo-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('geo-status');
    statusEl.textContent = 'Locating...';
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      geoCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      statusEl.textContent = 'Fetching address...';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${geoCoords.lat}&lon=${geoCoords.lng}&format=json`, { headers: { 'Accept-Language': 'en' } });
        const data = await r.json();
        document.getElementById('addr-input').value = data.display_name || '';
        statusEl.textContent = '';
      } catch {
        document.getElementById('addr-input').value = `${geoCoords.lat.toFixed(5)}, ${geoCoords.lng.toFixed(5)}`;
        statusEl.textContent = 'Address lookup failed — coordinates saved';
      }
    } catch { statusEl.textContent = 'Geolocation unavailable or denied'; }
  });

  renderTimeSelector('clockin-time-selector', 'Clock-in time', async (clockInISO) => {
    const container = document.getElementById('clockin-time-selector');
    container.innerHTML = '<div class="saving-indicator">Saving...</div>';
    try {
      const org      = document.getElementById('company-select').value;
      const client   = document.getElementById('customer-select').value;
      const rate     = document.getElementById('rate-select').value;
      const flatAmt  = parseFloat(document.getElementById('flat-amount-input').value) || null;
      const addr     = document.getElementById('addr-input').value.trim();
      const woTitle  = document.getElementById('wo-title-input').value.trim();
      const travel   = parseFloat(document.getElementById('travel-reimb-input').value) || null;

      state.currentEntry = await api.clockIn({
        clock_in:        clockInISO,
        organization_id: org    ? Number(org)   : null,
        client_id:       client ? Number(client): null,
        pay_rate_id:     (rateType === 'hourly' && rate) ? Number(rate) : null,
        rate_type:       rateType,
        flat_amount:     rateType === 'flat' ? flatAmt : null,
        address:         addr    || null,
        latitude:        geoCoords?.lat || null,
        longitude:       geoCoords?.lng || null,
        wo_title:        woTitle || null,
        travel_reimb:    travel,
        status:          'pending',
      });
      state.showReminderBanner = false;
      state.showBreakReturnBanner = false;
      scheduleBreakReminder();
      renderActiveClockPage();
    } catch (err) {
      showToast(err.message || 'Error', 'error');
      renderTimeSelector('clockin-time-selector', 'Clock-in time', arguments.callee);
    }
  });
}

/* ── Active clock page ───────────────────────────────────────────── */
function renderActiveClockPage() {
  const entry = state.currentEntry;
  if (!entry) { renderIdleClockPage(); return; }

  const onBreak  = !!entry.active_break;
  const isFlat   = entry.rate_type === 'flat';
  const sym      = state.settings.currency_symbol || '$';
  const mats     = parseMaterials(entry.materials);
  const parkAmt  = parseFloat(entry.parking_tolls) || 0;
  const hasPark  = !!(entry.parking_tolls !== null && entry.parking_tolls !== undefined && entry.parking_tolls !== '');
  const hasMats  = mats.length > 0;

  document.getElementById('page').innerHTML = `
    ${state.showReminderBanner ? `
    <div class="reminder-banner">
      ${svg('bell')}
      <p>Time for a break!</p>
      <button class="btn btn-orange btn-sm" id="take-break-reminder">Take Break</button>
    </div>` : ''}
    ${state.showBreakReturnBanner ? `
    <div class="reminder-banner" style="border-color:var(--green);background:var(--green-bg);">
      ${svg('return')}
      <p style="color:var(--green);">Break time's up — back to work!</p>
      <button class="btn btn-primary btn-sm" id="end-break-banner-btn">Return</button>
    </div>` : ''}

    <div class="clock-hero">
      <div class="status-badge ${onBreak ? 'on-break' : 'working'}">
        <span class="dot"></span>${onBreak ? 'ON BREAK' : 'WORKING'}
      </div>
      <div class="elapsed-time" id="elapsed-display">00:00:00</div>
      ${isFlat && entry.flat_amount
        ? `<div class="earnings-display">${fmtMoney(entry.flat_amount)}</div><div class="earning-rate">Flat Rate</div>`
        : entry.hourly_rate
          ? `<div class="earnings-display" id="earnings-display">${fmtMoney(0)}</div><div class="earning-rate">${sym}${entry.hourly_rate}/hr</div>`
          : ''}
      ${onBreak ? `<div class="break-timer">Break: <span id="break-elapsed">00:00:00</span></div>` : ''}
      <div class="clock-meta">
        ${svg('clock')} Started ${fmtTime(entry.clock_in)}
        ${entry.org_name ? ` &nbsp;·&nbsp; ${escHtml(entry.org_name)}` : ''}
        ${entry.client_name ? ` &nbsp;·&nbsp; ${escHtml(entry.client_name)}` : ''}
        ${entry.wo_title ? ` &nbsp;·&nbsp; ${escHtml(entry.wo_title)}` : ''}
      </div>
    </div>

    <div class="clock-actions">
      ${onBreak
        ? `<button class="btn btn-primary btn-lg" id="end-break-btn">${svg('play')} Return from Break</button>`
        : state.settings.breaks_enabled === '1'
          ? `<button class="btn btn-orange btn-lg" id="start-break-btn">${svg('coffee')} Break</button>`
          : ''}
      <button class="btn btn-danger btn-lg" id="clockout-btn">${svg('stop')} Clock Out</button>
    </div>

    <!-- Assignment Details -->
    <div class="section-header collapsible" data-target="sec-assignment">
      <span>Assignment Details</span><span class="sec-chev">${svg('chevR')}</span>
    </div>
    <div id="sec-assignment" class="card sec-body">
      <div class="form-group">
        <label class="form-label">WO Title</label>
        <input type="text" class="form-control" id="jd-wo-title" value="${escHtml(entry.wo_title||'')}" placeholder="Work order title...">
      </div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">Company</label>
          <select class="form-control" id="jd-company">
            <option value="">— None —</option>
            ${state.organizations.map(o=>`<option value="${o.id}" ${entry.organization_id==o.id?'selected':''}>${escHtml(o.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Customer</label>
          <select class="form-control" id="jd-customer">
            <option value="">— None —</option>
            ${state.clients.map(c=>`<option value="${c.id}" ${entry.client_id==c.id?'selected':''}>${escHtml(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">Site ID</label>
          <input type="text" class="form-control" id="jd-site-id" value="${escHtml(entry.site_id||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Assignment ID <span class="req-star">*</span></label>
          <input type="text" class="form-control" id="jd-assignment" value="${escHtml(entry.assignment_id||'')}" placeholder="Required">
        </div>
      </div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">Ticket # <span class="opt-label">optional</span></label>
          <input type="text" class="form-control" id="jd-ticket" value="${escHtml(entry.ticket_num||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">INC # <span class="opt-label">optional</span></label>
          <input type="text" class="form-control" id="jd-inc" value="${escHtml(entry.inc_num||'')}">
        </div>
      </div>
      <button class="btn btn-ghost btn-sm btn-full" id="save-assignment-btn" style="margin-top:4px;">${svg('check')} Save</button>
    </div>

    <!-- POCs -->
    <div class="section-header collapsible" data-target="sec-pocs">
      <span>Points of Contact</span><span class="sec-chev">${svg('chevR')}</span>
    </div>
    <div id="sec-pocs" class="card sec-body">
      <div class="form-group">
        <label class="form-label">MOD Name <span class="req-star">*</span></label>
        <input type="text" class="form-control" id="jd-mod" value="${escHtml(entry.mod_name||'')}" placeholder="Required">
      </div>
      <div class="form-group">
        <label class="form-label">NOC Name <span class="opt-label">optional</span></label>
        <input type="text" class="form-control" id="jd-noc" value="${escHtml(entry.noc_name||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">PM/PC Name <span class="opt-label">optional</span></label>
        <input type="text" class="form-control" id="jd-pmpc" value="${escHtml(entry.pm_pc_name||'')}">
      </div>
      <button class="btn btn-ghost btn-sm btn-full" id="save-pocs-btn" style="margin-top:4px;">${svg('check')} Save</button>
    </div>

    <!-- Pictures -->
    <div class="section-header collapsible" data-target="sec-pictures">
      <span>Pictures</span><span class="sec-chev">${svg('chevR')}</span>
    </div>
    <div id="sec-pictures" class="card sec-body">
      <div class="photo-notice">${svg('camera')} Photo upload — configure FTP / NextCloud in Settings</div>
      <div class="subsection-label">Before</div>
      <div class="photo-placeholder"><span>${svg('camera')} Before Photo</span></div>
      <div class="photo-placeholder"><span>${svg('camera')} Serial Numbers <span class="opt-label">optional</span></span></div>
      <div class="form-group" style="margin-top:8px;">
        <label class="form-label">Issues / Additional Info <span class="opt-label">optional</span></label>
        <textarea class="form-control" id="jd-additional" rows="2" placeholder="Describe any issues...">${escHtml(entry.additional_info||'')}</textarea>
      </div>
      <div class="divider"></div>
      <div class="subsection-label">After</div>
      <div class="photo-placeholder"><span>${svg('camera')} After Photo</span></div>
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Removal / Replacement?</label>
          <label class="switch"><input type="checkbox" id="jd-replacement" ${entry.is_replacement?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="replacement-fields" class="${entry.is_replacement?'':'hidden'}">
        <div class="photo-placeholder"><span>${svg('camera')} New Serial Numbers</span></div>
        <div class="form-group">
          <label class="form-label">Old Serial Numbers</label>
          <textarea class="form-control" id="jd-old-serial" rows="2">${escHtml(entry.old_serial||'')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Return Track #</label>
          <div class="input-row">
            <input type="text" class="form-control" id="jd-return-track" value="${escHtml(entry.return_track||'')}" ${entry.no_return_track?'disabled':''}>
            <button class="btn btn-ghost btn-sm" id="no-return-btn" style="white-space:nowrap;">${entry.no_return_track?'Undo N/a':'No Return'}</button>
          </div>
          <div id="no-return-label" class="${entry.no_return_track?'':'hidden'} field-hint" style="color:var(--orange);">⚠ Marked as N/a</div>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm btn-full" id="save-pictures-btn" style="margin-top:8px;">${svg('check')} Save</button>
    </div>

    <!-- Work Performed -->
    <div class="section-header">
      <span>Work Performed / Comments <span class="req-star">*</span></span>
    </div>
    <div class="card">
      <textarea class="form-control" id="jd-work-summary" rows="4" placeholder="Describe work performed, SOW, issues...">${escHtml(entry.work_summary||'')}</textarea>
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        <span id="ws-counter" class="field-hint">${(entry.work_summary||'').length} chars</span>
        <button class="btn btn-ghost btn-sm" id="save-ws-btn">${svg('check')} Save</button>
      </div>
    </div>

    <!-- Reimbursements -->
    <div class="section-header collapsible" data-target="sec-reimb">
      <span>Reimbursements</span><span class="sec-chev">${svg('chevR')}</span>
    </div>
    <div id="sec-reimb" class="card sec-body">
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Parking / Tolls?</label>
          <label class="switch"><input type="checkbox" id="parking-toggle" ${hasPark?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="parking-amount-group" class="${hasPark?'':'hidden'} form-group">
        <label class="form-label">Amount (${sym})</label>
        <input type="number" class="form-control" id="parking-amount" min="0" step="0.01" value="${escHtml(String(entry.parking_tolls||''))}">
      </div>
      <div class="divider"></div>
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Add Materials?</label>
          <label class="switch"><input type="checkbox" id="materials-toggle" ${hasMats?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="materials-group" class="${hasMats?'':'hidden'}">
        <div id="materials-list">
          ${mats.map((m,i) => buildMaterialRow(i, m.name, m.price)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="add-material-btn" style="margin-top:8px;">${svg('plus')} Add Material</button>
      </div>
      <button class="btn btn-ghost btn-sm btn-full" id="save-reimb-btn" style="margin-top:12px;">${svg('check')} Save</button>
    </div>

    <div style="height:16px;"></div>`;

  /* ── Event wiring ─── */
  // Break buttons
  if (onBreak) {
    const endBreakAction = async () => {
      try {
        await api.endBreak(entry.id, { break_end: new Date().toISOString() });
        state.currentEntry = await api.getCurrentEntry();
        state.showBreakReturnBanner = false;
        clearTimeout(state.breakReturnTimeout);
        scheduleBreakReminder();
        renderActiveClockPage();
      } catch (e) { showToast(e.message, 'error'); }
    };
    document.getElementById('end-break-btn')?.addEventListener('click', endBreakAction);
    document.getElementById('end-break-banner-btn')?.addEventListener('click', endBreakAction);
    startBreakElapsedTimer(entry.active_break.break_start);
    scheduleBreakReturnReminder(entry.active_break.break_start);
  } else if (state.settings.breaks_enabled === '1') {
    document.getElementById('start-break-btn')?.addEventListener('click', async () => {
      try {
        const b = await api.startBreak(entry.id, { break_start: new Date().toISOString() });
        state.currentEntry = { ...entry, active_break: b };
        state.showReminderBanner = false;
        clearTimeout(state.reminderTimeout);
        renderActiveClockPage();
      } catch (e) { showToast(e.message, 'error'); }
    });
  }
  document.getElementById('take-break-reminder')?.addEventListener('click', () => document.getElementById('start-break-btn')?.click());

  document.getElementById('clockout-btn').addEventListener('click', () => initiateClockOut(entry));

  // Collapsible sections
  document.querySelectorAll('.section-header.collapsible').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const target = document.getElementById(hdr.dataset.target);
      if (!target) return;
      const isOpen = !target.classList.contains('collapsed');
      target.classList.toggle('collapsed', isOpen);
      hdr.querySelector('.sec-chev').innerHTML = isOpen ? svg('chevR') : svg('chevL').replace('chevL','chevD');
      hdr.querySelector('.sec-chev').innerHTML = isOpen ? svg('chevR') : svg('chevR');
      // simpler: just toggle a class
      hdr.classList.toggle('open', !isOpen);
    });
  });

  // Assignment Details save
  document.getElementById('save-assignment-btn').addEventListener('click', () => saveSection(entry, {
    wo_title:        document.getElementById('jd-wo-title').value.trim() || null,
    organization_id: document.getElementById('jd-company').value ? Number(document.getElementById('jd-company').value) : null,
    client_id:       document.getElementById('jd-customer').value ? Number(document.getElementById('jd-customer').value) : null,
    site_id:         document.getElementById('jd-site-id').value.trim() || null,
    assignment_id:   document.getElementById('jd-assignment').value.trim() || null,
    ticket_num:      document.getElementById('jd-ticket').value.trim() || null,
    inc_num:         document.getElementById('jd-inc').value.trim() || null,
  }));

  // POCs save
  document.getElementById('save-pocs-btn').addEventListener('click', () => saveSection(entry, {
    mod_name:  document.getElementById('jd-mod').value.trim() || null,
    noc_name:  document.getElementById('jd-noc').value.trim() || null,
    pm_pc_name:document.getElementById('jd-pmpc').value.trim() || null,
  }));

  // Replacement toggle
  let noReturn = !!entry.no_return_track;
  document.getElementById('jd-replacement').addEventListener('change', e => {
    document.getElementById('replacement-fields').classList.toggle('hidden', !e.target.checked);
  });
  document.getElementById('no-return-btn')?.addEventListener('click', () => {
    noReturn = !noReturn;
    document.getElementById('jd-return-track').disabled = noReturn;
    document.getElementById('jd-return-track').value = noReturn ? '' : (entry.return_track||'');
    document.getElementById('no-return-label').classList.toggle('hidden', !noReturn);
    document.getElementById('no-return-btn').textContent = noReturn ? 'Undo N/a' : 'No Return';
  });

  // Pictures save
  document.getElementById('save-pictures-btn').addEventListener('click', () => {
    const isReplacement = document.getElementById('jd-replacement').checked;
    saveSection(entry, {
      additional_info: document.getElementById('jd-additional').value.trim() || null,
      is_replacement:  isReplacement,
      old_serial:      isReplacement ? document.getElementById('jd-old-serial')?.value.trim() || null : null,
      return_track:    (!noReturn && isReplacement) ? document.getElementById('jd-return-track')?.value.trim() || null : null,
      no_return_track: noReturn && isReplacement,
    });
  });

  // Work summary
  document.getElementById('jd-work-summary').addEventListener('input', e => {
    document.getElementById('ws-counter').textContent = `${e.target.value.length} chars`;
  });
  document.getElementById('save-ws-btn').addEventListener('click', () => saveSection(entry, {
    work_summary: document.getElementById('jd-work-summary').value.trim() || null,
  }));

  // Parking toggle
  document.getElementById('parking-toggle').addEventListener('change', e => {
    document.getElementById('parking-amount-group').classList.toggle('hidden', !e.target.checked);
  });

  // Materials toggle
  document.getElementById('materials-toggle').addEventListener('change', e => {
    document.getElementById('materials-group').classList.toggle('hidden', !e.target.checked);
  });

  // Materials add
  setupMaterialsUI(mats);

  // Reimbursements save
  document.getElementById('save-reimb-btn').addEventListener('click', () => {
    const parkingOn = document.getElementById('parking-toggle').checked;
    const parkAmt = parkingOn ? (document.getElementById('parking-amount').value || '0') : null;
    const mats = readMaterialsFromDOM();
    saveSection(entry, {
      parking_tolls: parkAmt,
      materials: mats,
    });
  });

  startElapsedTimer(entry);
}

async function saveSection(entry, data) {
  try {
    state.currentEntry = await api.updateEntry(entry.id, data);
    showToast('Saved', 'success');
  } catch (e) { showToast(e.message || 'Save failed', 'error'); }
}

/* ── Materials helpers ───────────────────────────────────────────── */
function buildMaterialRow(index, name='', price='') {
  return `<div class="material-row" data-index="${index}">
    <input type="text" class="form-control mat-name" placeholder="Material name" value="${escHtml(name)}" style="flex:2;">
    <input type="number" class="form-control mat-price" placeholder="Price" value="${escHtml(String(price))}" min="0" step="0.01" style="flex:1;">
    <button class="btn btn-ghost btn-sm remove-mat" style="color:var(--red);" title="Remove">${svg('trash')}</button>
  </div>`;
}

function setupMaterialsUI(existing) {
  let rows = existing.map(m => ({ name: m.name || '', price: m.price || '' }));
  const list = document.getElementById('materials-list');
  if (!list) return;

  const syncFromDOM = () => {
    list.querySelectorAll('.material-row').forEach((row, i) => {
      if (rows[i] !== undefined) {
        rows[i].name  = row.querySelector('.mat-name')?.value  ?? rows[i].name;
        rows[i].price = row.querySelector('.mat-price')?.value ?? rows[i].price;
      }
    });
  };

  const rerender = () => {
    syncFromDOM();
    list.innerHTML = rows.map((m, i) => buildMaterialRow(i, m.name, m.price)).join('');
    list.querySelectorAll('.remove-mat').forEach((btn, i) => {
      btn.addEventListener('click', () => { syncFromDOM(); rows.splice(i, 1); rerender(); });
    });
  };

  rerender();
  document.getElementById('add-material-btn')?.addEventListener('click', () => {
    syncFromDOM();
    rows.push({ name: '', price: '' });
    rerender();
    // Focus the new name input
    const newRow = list.querySelectorAll('.material-row');
    newRow[newRow.length - 1]?.querySelector('.mat-name')?.focus();
  });
}

function readMaterialsFromDOM() {
  return [...document.querySelectorAll('.material-row')].map(row => ({
    name:  row.querySelector('.mat-name')?.value.trim()  || '',
    price: row.querySelector('.mat-price')?.value.trim() || '',
  })).filter(m => m.name || m.price);
}

/* ── Clock Out flow ─────────────────────────────────────────────── */
async function initiateClockOut(entry) {
  // Save current form state first
  const workSummary = document.getElementById('jd-work-summary')?.value.trim() || entry.work_summary || '';
  const assignId    = document.getElementById('jd-assignment')?.value.trim()   || entry.assignment_id || '';
  const modName     = document.getElementById('jd-mod')?.value.trim()          || entry.mod_name || '';

  const missing = [];
  if (!assignId)   missing.push('Assignment ID');
  if (!modName)    missing.push('MOD Name');
  if (!workSummary) missing.push('Work Performed / Comments');

  if (missing.length) {
    openModal(`
      <div class="modal-header">
        <h3>${svg('alert')} Missing Required Fields</h3>
      </div>
      <div class="modal-body">
        <p style="color:var(--text2);margin-bottom:12px;">The following required fields are empty:</p>
        ${missing.map(f => `<div class="missing-field-item">${svg('alert')} ${f}</div>`).join('')}
        <p style="color:var(--text3);font-size:13px;margin-top:12px;">Fill them in or use Override to mark as "OVERRIDE!"</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="co-cancel-btn">Cancel</button>
        <button class="btn btn-danger" id="co-override-btn">Override & Continue</button>
      </div>`);
    document.getElementById('co-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('co-override-btn').addEventListener('click', () => {
      closeModal();
      showClockOutModal(entry, workSummary, assignId, modName, missing);
    });
    return;
  }
  showClockOutModal(entry, workSummary, assignId, modName, []);
}

function showClockOutModal(entry, workSummary, assignId, modName, overrides) {
  const override = field => overrides.includes(field) ? 'OVERRIDE!' : null;

  openModal(`
    <div class="modal-header">
      <h3>${svg('stop')} Clock Out</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">WO Status</label>
        <div class="status-selector" id="wo-status-btns">
          <button class="status-btn completed" data-s="completed">✓ COMPLETED</button>
          <button class="status-btn fail"      data-s="fail">✗ FAIL</button>
          <button class="status-btn cancel"    data-s="cancel">⊘ CANCEL</button>
        </div>
      </div>
      <div id="revisit-group" class="form-group hidden">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Revisit Required?</label>
          <label class="switch"><input type="checkbox" id="revisit-toggle"><span class="slider"></span></label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Release Code</label>
        <div class="input-row">
          <input type="text" class="form-control" id="co-release-code" value="${escHtml(entry.release_code||'')}" placeholder="Enter release code...">
          <button class="btn btn-ghost btn-sm" id="no-code-btn" style="white-space:nowrap;">No Code</button>
        </div>
        <div id="no-code-label" class="hidden field-hint" style="color:var(--orange);">⚠ Marked as N/a</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="co-back-btn">Cancel</button>
      <button class="btn btn-primary" id="co-review-btn">Final Review →</button>
    </div>`);

  let selectedStatus = '';
  let noCode = !!(entry.no_release_code);
  if (noCode) {
    document.getElementById('co-release-code').disabled = true;
    document.getElementById('no-code-label').classList.remove('hidden');
    document.getElementById('no-code-btn').textContent = 'Undo N/a';
  }

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedStatus = btn.dataset.s;
      document.getElementById('revisit-group').classList.toggle('hidden', selectedStatus !== 'completed');
    });
  });

  document.getElementById('no-code-btn').addEventListener('click', () => {
    noCode = !noCode;
    document.getElementById('co-release-code').disabled = noCode;
    document.getElementById('co-release-code').value = noCode ? '' : (entry.release_code||'');
    document.getElementById('no-code-label').classList.toggle('hidden', !noCode);
    document.getElementById('no-code-btn').textContent = noCode ? 'Undo N/a' : 'No Code';
  });

  document.getElementById('co-back-btn').addEventListener('click', closeModal);

  document.getElementById('co-review-btn').addEventListener('click', () => {
    if (!selectedStatus) { showToast('Please select a WO status', 'error'); return; }
    const revisit = selectedStatus === 'completed' && document.getElementById('revisit-toggle').checked;
    const releaseCode = noCode ? null : (document.getElementById('co-release-code').value.trim() || null);
    showFinalReview(entry, {
      workSummary: revisit
        ? (workSummary || override('Work Performed / Comments') || '') + '\n\nREVISIT REQUIRED!'
        : (workSummary || override('Work Performed / Comments') || ''),
      assignId:    assignId    || override('Assignment ID')   || '',
      modName:     modName     || override('MOD Name')        || '',
      status:      selectedStatus,
      revisit,
      releaseCode,
      noCode,
    });
  });
}

function showFinalReview(entry, coData) {
  const sym = state.settings.currency_symbol || '$';
  const techName = state.settings.tech_name || '—';
  const netSec = getNetSeconds({ ...entry, clock_out: new Date().toISOString() });
  const labor = calcLabor(entry, netSec);
  const travel = parseFloat(entry.travel_reimb) || 0;
  const parking = parseFloat(entry.parking_tolls) || 0;
  const total = labor + travel + parking;

  openModal(`
    <div class="modal-header">
      <h3>${svg('check')} Final Review</h3>
    </div>
    <div class="modal-body review-body">
      <div class="review-row"><span>Tech:</span><span>${escHtml(techName)}</span></div>
      <div class="review-row"><span>WO Title:</span><span>${escHtml(entry.wo_title||'—')}</span></div>
      <div class="review-row"><span>Company:</span><span>${escHtml(entry.org_name||'—')}</span></div>
      <div class="review-row"><span>Customer:</span><span>${escHtml(entry.client_name||'—')}</span></div>
      <div class="review-row"><span>Assignment ID:</span><span>${escHtml(coData.assignId)}</span></div>
      <div class="review-row"><span>MOD Name:</span><span>${escHtml(coData.modName)}</span></div>
      <div class="review-row"><span>Address:</span><span>${escHtml(entry.address||'—')}</span></div>
      <div class="review-row"><span>Clock In:</span><span>${fmtTime(entry.clock_in)}</span></div>
      <div class="review-row"><span>Net Time:</span><span>${fmtDecimalHours(netSec)}</span></div>
      <div class="review-row"><span>Labor:</span><span>${fmtMoney(labor)}</span></div>
      ${travel ? `<div class="review-row"><span>Travel Reimb:</span><span>${fmtMoney(travel)}</span></div>` : ''}
      ${parking ? `<div class="review-row"><span>Parking/Tolls:</span><span>${fmtMoney(parking)}</span></div>` : ''}
      <div class="review-row total-row"><span>Total Expected:</span><span>${fmtMoney(total)}</span></div>
      <div class="review-row"><span>Status:</span><span class="status-chip ${coData.status}">${coData.status.toUpperCase()}${coData.revisit?' · REVISIT':''}</span></div>
      <div class="review-row"><span>Release Code:</span><span>${coData.noCode ? 'N/a' : escHtml(coData.releaseCode||'—')}</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="fr-back-btn">Back</button>
      <button class="btn btn-danger" id="fr-confirm-btn">Confirm Clock Out</button>
    </div>`);

  document.getElementById('fr-back-btn').addEventListener('click', () =>
    showClockOutModal(entry, coData.workSummary, coData.assignId, coData.modName, [])
  );

  document.getElementById('fr-confirm-btn').addEventListener('click', async () => {
    try {
      const clockOutISO = new Date().toISOString();
      const grossSec = Math.floor((new Date(clockOutISO) - new Date(entry.clock_in)) / 1000);
      const netS = Math.max(0, grossSec - (entry.total_break_seconds || 0));
      const totalExp = calcLabor(entry, netS) + (parseFloat(entry.travel_reimb)||0) + (parseFloat(entry.parking_tolls)||0);

      const completed = await api.clockOut(entry.id, {
        clock_out:       clockOutISO,
        status:          coData.status,
        work_summary:    coData.workSummary,
        assignment_id:   coData.assignId,
        mod_name:        coData.modName     || entry.mod_name,
        release_code:    coData.releaseCode,
        no_release_code: coData.noCode,
        revisit_required:coData.revisit ? 1 : 0,
        received_pay:    totalExp,
      });
      state.currentEntry = null;
      state.lastCompletedEntry = completed;
      closeModal();
      renderSummaryPage(completed);
    } catch (e) { showToast(e.message || 'Clock out failed', 'error'); }
  });
}

/* ── Summary page (post clock-out) ──────────────────────────────── */
function renderSummaryPage(entry) {
  const sym = state.settings.currency_symbol || '$';
  const netSec = getNetSeconds(entry);
  const labor = calcLabor(entry, netSec);
  const travel = parseFloat(entry.travel_reimb) || 0;
  const parking = parseFloat(entry.parking_tolls) || 0;
  const total = labor + travel + parking;

  document.getElementById('page').innerHTML = `
    <div class="p-16">
      <div class="summary-card">
        <div class="status-chip ${entry.status||'pending'}" style="margin-bottom:12px;">${(entry.status||'pending').toUpperCase()}</div>
        <div class="summary-title">${escHtml(entry.wo_title||'Work Order')}</div>
        <div class="summary-meta">${escHtml(entry.org_name||'')} ${entry.client_name?'/ '+escHtml(entry.client_name):''}</div>
        <div class="summary-times">${fmtTime(entry.clock_in)} → ${fmtTime(entry.clock_out)}</div>
        <div class="summary-duration">${fmtDecimalHours(netSec)}</div>
        <div class="summary-earnings">${fmtMoney(total)}</div>
        ${labor !== total ? `<div class="summary-earn-breakdown">Labor ${fmtMoney(labor)}${travel?` + Travel ${fmtMoney(travel)}`:''}${parking?` + P/T ${fmtMoney(parking)}`:''}</div>` : ''}
      </div>

      <div class="card" style="margin-top:12px;">
        <button class="btn btn-primary btn-full" id="copy-report-btn">${svg('copy')} Copy Text Report</button>
        <button class="btn btn-ghost btn-full" id="view-journal-btn" style="margin-top:8px;">${svg('clock')} View in Journal</button>
        <button class="btn btn-ghost btn-full" id="new-job-btn" style="margin-top:8px;">${svg('plus')} Start New Job</button>
      </div>
    </div>`;

  document.getElementById('copy-report-btn').addEventListener('click', () => {
    const text = buildTextReport(entry);
    navigator.clipboard.writeText(text).then(() => showToast('Report copied!', 'success')).catch(() => {
      openModal(`<div class="modal-header"><h3>Text Report</h3></div><div class="modal-body"><pre class="report-text">${escHtml(text)}</pre></div><div class="modal-footer"><button class="btn btn-ghost" id="close-report-btn">Close</button></div>`);
      document.getElementById('close-report-btn').addEventListener('click', closeModal);
    });
  });

  document.getElementById('view-journal-btn').addEventListener('click', () => {
    state.lastCompletedEntry = null;
    navigateTo('journal');
  });

  document.getElementById('new-job-btn').addEventListener('click', () => {
    state.lastCompletedEntry = null;
    renderIdleClockPage();
  });
}

/* ── Text Report builder ─────────────────────────────────────────── */
function buildTextReport(entry) {
  const techName = state.settings.tech_name || '';
  const netSec = getNetSeconds(entry);
  const totalHrs = fmtDecimalHours(netSec);

  const siteAndId = [entry.client_name, entry.site_id].filter(Boolean).join(' #');
  const mats = parseMaterials(entry.materials);
  const matsStr = mats.length
    ? mats.map(m => m.name + (m.price ? ` - ${state.settings.currency_symbol||'$'}${m.price}` : '')).join(', ')
    : 'N/a';

  const releaseCode = entry.no_release_code ? 'N/a' : (entry.release_code || 'N/a');
  const returnTrack = entry.no_return_track ? 'N/a' : (entry.return_track || 'N/a');
  const parking     = entry.parking_tolls ? (state.settings.currency_symbol||'$') + entry.parking_tolls : 'N/a';

  return `Tech name: ${techName}
Assignment ID: ${entry.assignment_id || ''}
Site name & ID: ${siteAndId}
Address: ${entry.address || ''}
Buyer/Representing company: ${entry.org_name || ''}
Onsite (Check in): ${fmtTime(entry.clock_in)}
Offsite (Check out): ${fmtTime(entry.clock_out)}
Total time: ${totalHrs}
Parking/Tolls: ${parking}
PM/PC name: ${entry.pm_pc_name || 'N/a'}
MOD name: ${entry.mod_name || 'N/a'}
NOC name: ${entry.noc_name || 'N/a'}
Ticket #: ${entry.ticket_num || 'N/a'}
Release code: ${releaseCode}
Return track #: ${returnTrack}
Materials used: ${matsStr}
Work summary: ${entry.work_summary || ''}`;
}

/* ================================================================
   JOURNAL PAGE
   ================================================================ */
async function renderJournalPage() {
  const page = document.getElementById('page');
  try {
    const entries = await api.getEntries();
    const weekStartDay = parseInt(state.settings.week_start || '1', 10) - 1; // 0=Sun, 1=Mon (settings stores 1 or 7)
    // Adjust: settings week_start: 1=Mon, 7=Sun
    const ws = state.settings.week_start === '7' ? 0 : 1; // 0=Sun, 1=Mon

    const d = state.journalDate;
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd   = new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59);

    const monthEntries = entries.filter(e => {
      const ci = new Date(e.clock_in);
      return ci >= monthStart && ci <= monthEnd;
    });

    // Group by week within month
    const weekGroups = {};
    for (const e of monthEntries) {
      const ci = new Date(e.clock_in);
      const { start, end } = getWeekBounds(ci, ws);
      const key = start.toISOString();
      if (!weekGroups[key]) weekGroups[key] = { start, end, entries: [] };
      weekGroups[key].entries.push(e);
    }

    const sortedWeeks = Object.values(weekGroups).sort((a,b) => a.start - b.start);

    // Month totals
    const mTotalExpected = monthEntries.filter(e=>e.clock_out).reduce((s,e) => s + calcTotalExpected(e), 0);
    const mTotalReceived = monthEntries.filter(e=>e.clock_out).reduce((s,e) => s + (parseFloat(e.received_pay) || calcTotalExpected(e)), 0);
    const mTotalHrs = monthEntries.filter(e=>e.clock_out).reduce((s,e) => s + getNetSeconds(e)/3600, 0);

    const sym = state.settings.currency_symbol || '$';

    page.innerHTML = `
      <div class="journal-header">
        <button class="btn btn-ghost btn-icon" id="j-prev">${svg('chevL')}</button>
        <div class="journal-month-title">${fmtMonthYear(d)}</div>
        <button class="btn btn-ghost btn-icon" id="j-next">${svg('chevR')}</button>
      </div>
      <div class="journal-month-totals">
        <span>${mTotalHrs.toFixed(2)} hrs</span>
        <span>${sym}${mTotalExpected.toFixed(2)} expected</span>
        <span>${sym}${mTotalReceived.toFixed(2)} received</span>
        <a class="btn btn-ghost btn-sm" href="${api.getExportUrl(monthStart.toISOString(), monthEnd.toISOString())}">${svg('download')} Export CSV</a>
      </div>
      <div id="journal-body">
        ${sortedWeeks.length === 0 ? '<div class="empty-state">No work orders this month</div>' :
          sortedWeeks.map(wg => renderWeekGroup(wg, ws, sym)).join('')}
      </div>`;

    document.getElementById('j-prev').addEventListener('click', () => {
      state.journalDate = new Date(d.getFullYear(), d.getMonth()-1, 1);
      renderJournalPage();
    });
    document.getElementById('j-next').addEventListener('click', () => {
      state.journalDate = new Date(d.getFullYear(), d.getMonth()+1, 1);
      renderJournalPage();
    });

    // Entry card click handlers
    document.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        const eid = parseInt(card.dataset.id);
        const entry = entries.find(en => en.id === eid);
        if (entry) openEntryDetail(entry);
      });
    });

    document.querySelectorAll('.entry-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const eid = parseInt(btn.dataset.id);
        const entry = entries.find(en => en.id === eid);
        if (entry) openEntryEdit(entry);
      });
    });

    document.querySelectorAll('.entry-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this work order?')) return;
        try {
          await api.deleteEntry(parseInt(btn.dataset.id));
          renderJournalPage();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

  } catch (err) {
    page.innerHTML = `<div class="empty-state">Error loading journal</div>`;
  }
}

function renderWeekGroup(wg, ws, sym) {
  const weekLabel = getISOWeekLabel(wg.start);
  const dateRange = `${fmtDateShort(wg.start.toISOString())} – ${fmtDateShort(wg.end.toISOString())}`;
  const completed = wg.entries.filter(e => e.clock_out);
  const wHrs = completed.reduce((s,e) => s + getNetSeconds(e)/3600, 0);
  const wExp = completed.reduce((s,e) => s + calcTotalExpected(e), 0);
  const wRec = completed.reduce((s,e) => s + (parseFloat(e.received_pay) || calcTotalExpected(e)), 0);

  return `
    <div class="week-group">
      <div class="week-header">
        <div class="week-label">${weekLabel} <span class="week-dates">${dateRange}</span></div>
        <div class="week-totals">${wHrs.toFixed(2)}h · ${sym}${wExp.toFixed(2)}</div>
      </div>
      ${wg.entries.map(e => renderEntryCard(e)).join('')}
      <div class="week-summary">
        <span>Expected: <b>${sym}${wExp.toFixed(2)}</b></span>
        <span>Received: <b>${sym}${wRec.toFixed(2)}</b></span>
        <span class="${wRec >= wExp ? 'pos' : 'neg'}">Δ ${sym}${Math.abs(wRec-wExp).toFixed(2)}</span>
      </div>
    </div>`;
}

function renderEntryCard(entry) {
  const netSec = getNetSeconds(entry);
  const labor  = calcLabor(entry, netSec);
  const total  = calcTotalExpected(entry);
  const statusClass = entry.status || 'pending';

  return `
    <div class="entry-card" data-id="${entry.id}">
      <div class="entry-card-top">
        <div class="entry-card-left">
          <div class="entry-title">${escHtml(entry.wo_title || entry.assignment_id || 'Work Order')}</div>
          <div class="entry-meta">${escHtml(entry.org_name||'')}${entry.client_name?' / '+escHtml(entry.client_name):''}</div>
          ${entry.address ? `<div class="entry-addr">${svg('location')} ${escHtml(entry.address)}</div>` : ''}
        </div>
        <div class="entry-card-right">
          <span class="status-chip ${statusClass}">${statusClass.toUpperCase()}</span>
        </div>
      </div>
      <div class="entry-card-bottom">
        <div class="entry-times">${svg('clock')} ${fmtTime(entry.clock_in)}${entry.clock_out?' → '+fmtTime(entry.clock_out):' (active)'}</div>
        ${entry.clock_out ? `<div class="entry-duration">${fmtDecimalHours(netSec)}</div>` : ''}
        <div class="entry-pay">${fmtMoney(total)}</div>
        <div class="entry-card-actions">
          <button class="btn btn-ghost btn-sm entry-edit-btn" data-id="${entry.id}">${svg('edit')}</button>
          <button class="btn btn-ghost btn-sm entry-delete-btn" data-id="${entry.id}" style="color:var(--red);">${svg('trash')}</button>
        </div>
      </div>
    </div>`;
}

function openEntryDetail(entry) {
  const netSec = getNetSeconds(entry);
  const labor  = calcLabor(entry, netSec);
  const total  = calcTotalExpected(entry);
  const sym    = state.settings.currency_symbol || '$';
  const mats   = parseMaterials(entry.materials);

  openModal(`
    <div class="modal-header">
      <h3>${escHtml(entry.wo_title||'Work Order')}</h3>
      <button class="btn btn-ghost btn-sm" id="det-close-btn">✕</button>
    </div>
    <div class="modal-body">
      <div class="review-row"><span>Date:</span><span>${fmtDateFull(entry.clock_in)}</span></div>
      <div class="review-row"><span>Company:</span><span>${escHtml(entry.org_name||'—')}</span></div>
      <div class="review-row"><span>Customer:</span><span>${escHtml(entry.client_name||'—')}</span></div>
      <div class="review-row"><span>Assignment ID:</span><span>${escHtml(entry.assignment_id||'—')}</span></div>
      <div class="review-row"><span>Site ID:</span><span>${escHtml(entry.site_id||'—')}</span></div>
      <div class="review-row"><span>Address:</span><span>${escHtml(entry.address||'—')}</span></div>
      <div class="review-row"><span>Clock In:</span><span>${fmtTime(entry.clock_in)}</span></div>
      <div class="review-row"><span>Clock Out:</span><span>${fmtTime(entry.clock_out)}</span></div>
      <div class="review-row"><span>Net Time:</span><span>${fmtDecimalHours(netSec)}</span></div>
      <div class="review-row"><span>Pay Type:</span><span>${entry.rate_type === 'flat' ? 'Flat' : 'Hourly'}</span></div>
      ${entry.rate_type !== 'flat' ? `<div class="review-row"><span>Rate:</span><span>${sym}${entry.hourly_rate||'—'}/hr</span></div>` : ''}
      <div class="review-row"><span>Labor:</span><span>${fmtMoney(labor)}</span></div>
      ${entry.travel_reimb ? `<div class="review-row"><span>Travel Reimb:</span><span>${fmtMoney(entry.travel_reimb)}</span></div>` : ''}
      ${entry.parking_tolls ? `<div class="review-row"><span>Parking/Tolls:</span><span>${fmtMoney(entry.parking_tolls)}</span></div>` : ''}
      <div class="review-row total-row"><span>Total Expected:</span><span>${fmtMoney(total)}</span></div>
      <div class="review-row">
        <span>Received Pay:</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" class="form-control form-control-sm" id="det-received-pay" value="${parseFloat(entry.received_pay||total).toFixed(2)}" min="0" step="0.01">
          <button class="btn btn-ghost btn-sm" id="det-save-recv-btn">${svg('check')}</button>
        </div>
      </div>
      <div class="review-row"><span>Status:</span><span class="status-chip ${entry.status||'pending'}">${(entry.status||'pending').toUpperCase()}</span></div>
      ${entry.mod_name ? `<div class="review-row"><span>MOD:</span><span>${escHtml(entry.mod_name)}</span></div>` : ''}
      ${entry.noc_name ? `<div class="review-row"><span>NOC:</span><span>${escHtml(entry.noc_name)}</span></div>` : ''}
      ${entry.pm_pc_name ? `<div class="review-row"><span>PM/PC:</span><span>${escHtml(entry.pm_pc_name)}</span></div>` : ''}
      ${entry.ticket_num ? `<div class="review-row"><span>Ticket #:</span><span>${escHtml(entry.ticket_num)}</span></div>` : ''}
      ${entry.release_code ? `<div class="review-row"><span>Release Code:</span><span>${escHtml(entry.release_code)}</span></div>` : ''}
      ${mats.length ? '<div class="review-row"><span>Materials:</span><span>' + mats.map(m=>escHtml(m.name+(m.price?' ($'+m.price+')':''))).join(', ') + '</span></div>' : ''}
      ${entry.work_summary ? `<div class="review-row" style="align-items:flex-start;"><span>Summary:</span><span style="white-space:pre-wrap;">${escHtml(entry.work_summary)}</span></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" id="det-copy-btn">${svg('copy')} Copy Report</button>
      <button class="btn btn-primary btn-sm" id="det-edit-btn">${svg('edit')} Edit</button>
    </div>`);

  document.getElementById('det-close-btn').addEventListener('click', closeModal);
  document.getElementById('det-copy-btn').addEventListener('click', () => {
    const text = buildTextReport(entry);
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success'));
  });
  document.getElementById('det-edit-btn').addEventListener('click', () => openEntryEdit(entry));
  document.getElementById('det-save-recv-btn').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('det-received-pay').value) || 0;
    try {
      await api.updateEntry(entry.id, { received_pay: val });
      showToast('Received pay updated', 'success');
      closeModal();
      renderJournalPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function openEntryEdit(entry) {
  const sym = state.settings.currency_symbol || '$';
  openModal(`
    <div class="modal-header">
      <h3>${svg('edit')} Edit Work Order</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">WO Title</label>
        <input type="text" class="form-control" id="ee-wo-title" value="${escHtml(entry.wo_title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Company</label>
        <select class="form-control" id="ee-company">
          <option value="">— None —</option>
          ${state.organizations.map(o=>`<option value="${o.id}" ${entry.organization_id==o.id?'selected':''}>${escHtml(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Customer</label>
        <select class="form-control" id="ee-customer">
          <option value="">— None —</option>
          ${state.clients.map(c=>`<option value="${c.id}" ${entry.client_id==c.id?'selected':''}>${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">Clock In</label>
          <input type="datetime-local" class="form-control" id="ee-clock-in" value="${localISOString(new Date(entry.clock_in))}">
        </div>
        <div class="form-group">
          <label class="form-label">Clock Out</label>
          <input type="datetime-local" class="form-control" id="ee-clock-out" value="${entry.clock_out?localISOString(new Date(entry.clock_out)):''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <input type="text" class="form-control" id="ee-address" value="${escHtml(entry.address||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Assignment ID</label>
        <input type="text" class="form-control" id="ee-assignment" value="${escHtml(entry.assignment_id||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Work Summary</label>
        <textarea class="form-control" id="ee-work-summary" rows="3">${escHtml(entry.work_summary||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Received Pay (${sym})</label>
        <input type="number" class="form-control" id="ee-received-pay" value="${parseFloat(entry.received_pay||calcTotalExpected(entry)).toFixed(2)}" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-control" id="ee-status">
          <option value="pending"   ${entry.status==='pending'  ?'selected':''}>Pending</option>
          <option value="completed" ${entry.status==='completed'?'selected':''}>Completed</option>
          <option value="fail"      ${entry.status==='fail'     ?'selected':''}>Fail</option>
          <option value="cancel"    ${entry.status==='cancel'   ?'selected':''}>Cancel</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="ee-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="ee-save-btn">Save Changes</button>
    </div>`);

  document.getElementById('ee-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('ee-save-btn').addEventListener('click', async () => {
    try {
      await api.updateEntry(entry.id, {
        wo_title:        document.getElementById('ee-wo-title').value.trim()||null,
        organization_id: document.getElementById('ee-company').value   ? Number(document.getElementById('ee-company').value)   : null,
        client_id:       document.getElementById('ee-customer').value  ? Number(document.getElementById('ee-customer').value)  : null,
        clock_in:        toISOFull(document.getElementById('ee-clock-in').value),
        clock_out:       document.getElementById('ee-clock-out').value ? toISOFull(document.getElementById('ee-clock-out').value) : null,
        address:         document.getElementById('ee-address').value.trim()||null,
        assignment_id:   document.getElementById('ee-assignment').value.trim()||null,
        work_summary:    document.getElementById('ee-work-summary').value.trim()||null,
        received_pay:    parseFloat(document.getElementById('ee-received-pay').value)||null,
        status:          document.getElementById('ee-status').value,
      });
      showToast('Saved', 'success');
      closeModal();
      renderJournalPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

/* ================================================================
   OVERVIEW PAGE
   ================================================================ */
async function renderOverviewPage() {
  const page = document.getElementById('page');
  try {
    const all = await api.getEntries();
    const sym = state.settings.currency_symbol || '$';
    const now = new Date();
    const ws  = state.settings.week_start === '7' ? 0 : 1;

    const { start: wkStart, end: wkEnd } = getWeekBounds(now, ws);
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const period = state.overviewPeriod;
    const filtered = all.filter(e => {
      const d = new Date(e.clock_in);
      if (period === 'week')  return d >= wkStart && d <= wkEnd;
      if (period === 'month') return d >= mStart  && d <= now;
      return true;
    }).filter(e => e.clock_out);

    const totalExpected = filtered.reduce((s,e) => s + calcTotalExpected(e), 0);
    const totalReceived = filtered.reduce((s,e) => s + (parseFloat(e.received_pay) || calcTotalExpected(e)), 0);
    const totalHrs = filtered.reduce((s,e) => s + getNetSeconds(e)/3600, 0);
    const jobCount = filtered.length;
    const hourlyJobs = filtered.filter(e => e.rate_type !== 'flat' && e.hourly_rate);
    const avgRate = hourlyJobs.length
      ? hourlyJobs.reduce((s,e) => s + e.hourly_rate, 0) / hourlyJobs.length
      : null;

    // By company
    const byCompany = {};
    for (const e of filtered) {
      const k = e.org_name || 'Unknown';
      if (!byCompany[k]) byCompany[k] = { jobs: 0, hrs: 0, earned: 0 };
      byCompany[k].jobs++;
      byCompany[k].hrs += getNetSeconds(e)/3600;
      byCompany[k].earned += calcTotalExpected(e);
    }

    // By status (all, not just closed)
    const allFiltered = all.filter(e => {
      const d = new Date(e.clock_in);
      if (period === 'week')  return d >= wkStart && d <= wkEnd;
      if (period === 'month') return d >= mStart  && d <= now;
      return true;
    });
    const byStatus = { pending:0, completed:0, fail:0, cancel:0 };
    for (const e of allFiltered) byStatus[e.status || 'pending']++;

    // Last 8 weeks earnings for chart
    const weekBars = [];
    for (let w = 7; w >= 0; w--) {
      const refDate = new Date(now); refDate.setDate(refDate.getDate() - w * 7);
      const { start: ws2, end: we2 } = getWeekBounds(refDate, ws);
      const wEntries = all.filter(e => { const d = new Date(e.clock_in); return d >= ws2 && d <= we2 && e.clock_out; });
      weekBars.push({ label: fmtDateShort(ws2.toISOString()), earned: wEntries.reduce((s,e) => s+calcTotalExpected(e),0) });
    }
    const maxBar = Math.max(...weekBars.map(w => w.earned), 1);

    const variance = totalReceived - totalExpected;

    page.innerHTML = `
      <div class="p-16">
        <div class="period-toggle" id="period-toggle">
          <button class="toggle-btn ${period==='week'?'active':''}"  data-p="week">This Week</button>
          <button class="toggle-btn ${period==='month'?'active':''}" data-p="month">This Month</button>
          <button class="toggle-btn ${period==='all'?'active':''}"   data-p="all">All Time</button>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Expected</div>
            <div class="stat-value">${sym}${totalExpected.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Received</div>
            <div class="stat-value">${sym}${totalReceived.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Hours Worked</div>
            <div class="stat-value">${totalHrs.toFixed(1)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Jobs Done</div>
            <div class="stat-value">${jobCount}</div>
          </div>
          ${avgRate ? `<div class="stat-card"><div class="stat-label">Avg Rate</div><div class="stat-value">${sym}${avgRate.toFixed(0)}/hr</div></div>` : ''}
          <div class="stat-card ${variance >= 0 ? 'positive' : 'negative'}">
            <div class="stat-label">Variance</div>
            <div class="stat-value">${variance >= 0 ? '+' : ''}${sym}${Math.abs(variance).toFixed(2)}</div>
          </div>
        </div>

        <div class="section-label">Earnings — Last 8 Weeks</div>
        <div class="card">
          <div class="bar-chart">
            ${weekBars.map(w => `
              <div class="bar-item">
                <div class="bar-fill" style="height:${Math.round((w.earned/maxBar)*100)}%;" title="${sym}${w.earned.toFixed(2)}"></div>
                <div class="bar-label">${w.label}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="section-label">By Company</div>
        <div class="card">
          ${Object.keys(byCompany).length === 0 ? '<div class="empty-state-sm">No data</div>' :
            Object.entries(byCompany).sort((a,b)=>b[1].earned-a[1].earned).map(([name, d]) => `
              <div class="company-row">
                <div class="company-name">${svg('org')} ${escHtml(name)}</div>
                <div class="company-stats">${d.jobs} jobs · ${d.hrs.toFixed(1)}h · ${sym}${d.earned.toFixed(2)}</div>
              </div>`).join('')}
        </div>

        <div class="section-label">Job Status</div>
        <div class="card">
          <div class="status-breakdown">
            ${Object.entries(byStatus).filter(([,v])=>v>0).map(([k,v]) => `
              <div class="status-row">
                <span class="status-chip ${k}">${k.toUpperCase()}</span>
                <span>${v}</span>
                <div class="status-bar-bg"><div class="status-bar-fill ${k}" style="width:${Math.round(v/Math.max(allFiltered.length,1)*100)}%"></div></div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('period-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      state.overviewPeriod = btn.dataset.p;
      renderOverviewPage();
    });

  } catch (err) {
    page.innerHTML = `<div class="empty-state">Error loading overview</div>`;
  }
}

/* ================================================================
   SETTINGS PAGE
   ================================================================ */
async function renderSettingsPage() {
  const page = document.getElementById('page');
  const s = state.settings;
  const breaksEnabled = s.breaks_enabled === '1';
  const paidBreaks    = s.paid_breaks === '1';
  const breakReminder = parseInt(s.break_frequency_minutes||'0',10) > 0;

  page.innerHTML = `
    <div class="p-16">

      <!-- Tech Info -->
      <div class="section-label">Technician Info</div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">Tech Name</label>
          <input type="text" class="form-control" id="s-tech-name" value="${escHtml(s.tech_name||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Week Begins On</label>
          <div class="toggle-group" id="s-week-toggle">
            <button class="toggle-btn ${s.week_start!=='7'?'active':''}" data-w="1">Monday</button>
            <button class="toggle-btn ${s.week_start==='7'?'active':''}" data-w="7">Sunday</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" class="form-control" id="s-currency" value="${escHtml(s.currency_symbol||'$')}" maxlength="3" style="max-width:80px;">
        </div>
        <button class="btn btn-primary btn-sm" id="s-save-tech-btn">${svg('check')} Save</button>
      </div>

      <!-- Break Settings -->
      <div class="section-label">Break Settings</div>
      <div class="card">
        <div class="form-group">
          <div class="toggle-row">
            <label class="form-label" style="margin:0;">Enable Breaks</label>
            <label class="switch"><input type="checkbox" id="s-breaks-enabled" ${breaksEnabled?'checked':''}><span class="slider"></span></label>
          </div>
        </div>
        <div id="s-break-options" class="${breaksEnabled?'':'hidden'}">
          <div class="form-group">
            <div class="toggle-row">
              <label class="form-label" style="margin:0;">Paid Breaks</label>
              <label class="switch"><input type="checkbox" id="s-paid-breaks" ${paidBreaks?'checked':''}><span class="slider"></span></label>
            </div>
            <div class="field-hint">Timer continues running during paid breaks</div>
          </div>
          <div class="form-group">
            <div class="toggle-row">
              <label class="form-label" style="margin:0;">Break Reminder</label>
              <label class="switch"><input type="checkbox" id="s-break-reminder" ${breakReminder?'checked':''}><span class="slider"></span></label>
            </div>
          </div>
          <div id="s-reminder-options" class="${breakReminder?'':'hidden'}">
            <div class="form-group">
              <label class="form-label">Remind every</label>
              <div class="toggle-group" id="s-freq-toggle">
                ${[['30','30 min'],['60','1 hr'],['120','2 hrs'],['180','3 hrs']].map(([v,l])=>
                  `<button class="toggle-btn ${s.break_frequency_minutes===v?'active':''}" data-v="${v}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Break Length</label>
              <div class="toggle-group" id="s-len-toggle">
                ${[['5','5 min'],['10','10 min'],['15','15 min'],['30','30 min']].map(([v,l])=>
                  `<button class="toggle-btn ${s.break_length_minutes===v?'active':''}" data-v="${v}">${l}</button>`).join('')}
              </div>
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="s-save-breaks-btn" style="margin-top:8px;">${svg('check')} Save</button>
      </div>

      <!-- Pay Rates -->
      <div class="section-label">Pay Rates</div>
      <div class="card" id="pay-rates-card">
        ${renderRatesList()}
        <button class="btn btn-ghost btn-sm" id="add-rate-btn" style="margin-top:8px;">${svg('plus')} Add Rate</button>
      </div>

      <!-- Companies -->
      <div class="section-label">Companies</div>
      <div class="card" id="companies-card">
        ${renderOrgsList()}
        <button class="btn btn-ghost btn-sm" id="add-org-btn" style="margin-top:8px;">${svg('plus')} Add Company</button>
      </div>

      <!-- Customers -->
      <div class="section-label">Customers</div>
      <div class="card" id="customers-card">
        ${renderClientsList()}
        <button class="btn btn-ghost btn-sm" id="add-client-btn" style="margin-top:8px;">${svg('plus')} Add Customer</button>
      </div>

      <div style="height:16px;"></div>
    </div>`;

  // Tech info save
  let weekStart = s.week_start || '1';
  document.getElementById('s-week-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    weekStart = btn.dataset.w;
    document.querySelectorAll('#s-week-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b===btn));
  });
  document.getElementById('s-save-tech-btn').addEventListener('click', async () => {
    try {
      state.settings = await api.saveSettings({
        tech_name:       document.getElementById('s-tech-name').value.trim(),
        week_start:      weekStart,
        currency_symbol: document.getElementById('s-currency').value.trim() || '$',
      });
      showToast('Saved', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });

  // Break options visibility
  document.getElementById('s-breaks-enabled').addEventListener('change', e => {
    document.getElementById('s-break-options').classList.toggle('hidden', !e.target.checked);
  });
  document.getElementById('s-break-reminder').addEventListener('change', e => {
    document.getElementById('s-reminder-options').classList.toggle('hidden', !e.target.checked);
  });

  // Frequency/length toggles
  ['s-freq-toggle', 's-len-toggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      document.querySelectorAll(`#${id} .toggle-btn`).forEach(b => b.classList.toggle('active', b===btn));
    });
  });

  document.getElementById('s-save-breaks-btn').addEventListener('click', async () => {
    const enabled  = document.getElementById('s-breaks-enabled').checked;
    const paid     = document.getElementById('s-paid-breaks').checked;
    const reminder = document.getElementById('s-break-reminder').checked;
    const freq     = document.querySelector('#s-freq-toggle .toggle-btn.active')?.dataset.v || '120';
    const len      = document.querySelector('#s-len-toggle .toggle-btn.active')?.dataset.v  || '15';
    try {
      state.settings = await api.saveSettings({
        breaks_enabled:         enabled ? '1' : '0',
        paid_breaks:            paid    ? '1' : '0',
        break_frequency_minutes: reminder ? freq : '0',
        break_length_minutes:   len,
        break_reminder_minutes: reminder ? freq : '0',
      });
      showToast('Saved', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });

  // Pay rates CRUD
  document.getElementById('add-rate-btn').addEventListener('click', () => showRateForm(null));
  document.querySelectorAll('.rate-edit-btn').forEach(btn => {
    const r = state.payRates.find(x => x.id === parseInt(btn.dataset.id));
    btn.addEventListener('click', () => showRateForm(r));
  });
  document.querySelectorAll('.rate-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this rate?')) return;
      try { await api.deletePayRate(parseInt(btn.dataset.id)); await reloadData(); renderSettingsPage(); } catch(e){ showToast(e.message,'error'); }
    });
  });

  // Companies CRUD
  document.getElementById('add-org-btn').addEventListener('click', () => showOrgForm(null));
  document.querySelectorAll('.org-edit-btn').forEach(btn => {
    const o = state.organizations.find(x => x.id === parseInt(btn.dataset.id));
    btn.addEventListener('click', () => showOrgForm(o));
  });
  document.querySelectorAll('.org-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this company?')) return;
      try { await api.deleteOrganization(parseInt(btn.dataset.id)); await reloadData(); renderSettingsPage(); } catch(e){ showToast(e.message,'error'); }
    });
  });

  // Customers CRUD
  document.getElementById('add-client-btn').addEventListener('click', () => showClientForm(null));
  document.querySelectorAll('.client-edit-btn').forEach(btn => {
    const c = state.clients.find(x => x.id === parseInt(btn.dataset.id));
    btn.addEventListener('click', () => showClientForm(c));
  });
  document.querySelectorAll('.client-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this customer?')) return;
      try { await api.deleteClient(parseInt(btn.dataset.id)); await reloadData(); renderSettingsPage(); } catch(e){ showToast(e.message,'error'); }
    });
  });
}

function renderRatesList() {
  const sym = state.settings.currency_symbol || '$';
  if (!state.payRates.length) return '<div class="empty-state-sm">No rates yet</div>';
  return state.payRates.map(r => `
    <div class="list-item">
      <div class="list-item-info">
        <div class="list-item-name">${escHtml(r.name)}</div>
        <div class="list-item-sub">${sym}${r.rate}/hr</div>
      </div>
      <div class="list-item-actions">
        <button class="btn btn-ghost btn-sm rate-edit-btn" data-id="${r.id}">${svg('edit')}</button>
        <button class="btn btn-ghost btn-sm rate-del-btn"  data-id="${r.id}" style="color:var(--red);">${svg('trash')}</button>
      </div>
    </div>`).join('');
}

function renderOrgsList() {
  if (!state.organizations.length) return '<div class="empty-state-sm">No companies yet</div>';
  return state.organizations.map(o => `
    <div class="list-item">
      <div class="list-item-info"><div class="list-item-name">${escHtml(o.name)}</div></div>
      <div class="list-item-actions">
        <button class="btn btn-ghost btn-sm org-edit-btn" data-id="${o.id}">${svg('edit')}</button>
        <button class="btn btn-ghost btn-sm org-del-btn"  data-id="${o.id}" style="color:var(--red);">${svg('trash')}</button>
      </div>
    </div>`).join('');
}

function renderClientsList() {
  if (!state.clients.length) return '<div class="empty-state-sm">No customers yet</div>';
  return state.clients.map(c => `
    <div class="list-item">
      <div class="list-item-info"><div class="list-item-name">${escHtml(c.name)}</div></div>
      <div class="list-item-actions">
        <button class="btn btn-ghost btn-sm client-edit-btn" data-id="${c.id}">${svg('edit')}</button>
        <button class="btn btn-ghost btn-sm client-del-btn"  data-id="${c.id}" style="color:var(--red);">${svg('trash')}</button>
      </div>
    </div>`).join('');
}

function showRateForm(rate) {
  const sym = state.settings.currency_symbol || '$';
  openModal(`
    <div class="modal-header"><h3>${rate ? 'Edit' : 'Add'} Pay Rate</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-control" id="rf-name" value="${escHtml(rate?.name||'')}" placeholder="e.g. Standard, Overtime...">
      </div>
      <div class="form-group">
        <label class="form-label">Rate (${sym}/hr)</label>
        <input type="number" class="form-control" id="rf-rate" value="${rate?.rate||''}" min="0" step="0.01">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="rf-cancel">Cancel</button>
      <button class="btn btn-primary" id="rf-save">${rate?'Save':'Add'}</button>
    </div>`);
  document.getElementById('rf-cancel').addEventListener('click', closeModal);
  document.getElementById('rf-save').addEventListener('click', async () => {
    const name = document.getElementById('rf-name').value.trim();
    const r    = parseFloat(document.getElementById('rf-rate').value);
    if (!name || !r) { showToast('Name and rate required', 'error'); return; }
    try {
      if (rate) await api.updatePayRate(rate.id, { name, rate: r });
      else      await api.createPayRate({ name, rate: r });
      await reloadData(); closeModal(); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function showOrgForm(org) {
  openModal(`
    <div class="modal-header"><h3>${org ? 'Edit' : 'Add'} Company</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Company Name</label>
        <input type="text" class="form-control" id="of-name" value="${escHtml(org?.name||'')}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="of-cancel">Cancel</button>
      <button class="btn btn-primary" id="of-save">${org?'Save':'Add'}</button>
    </div>`);
  document.getElementById('of-cancel').addEventListener('click', closeModal);
  document.getElementById('of-save').addEventListener('click', async () => {
    const name = document.getElementById('of-name').value.trim();
    if (!name) { showToast('Name required', 'error'); return; }
    try {
      if (org) await api.updateOrganization(org.id, { name });
      else     await api.createOrganization({ name });
      await reloadData(); closeModal(); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function showClientForm(client) {
  openModal(`
    <div class="modal-header"><h3>${client ? 'Edit' : 'Add'} Customer</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Customer Name</label>
        <input type="text" class="form-control" id="cf-name" value="${escHtml(client?.name||'')}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="cf-cancel">Cancel</button>
      <button class="btn btn-primary" id="cf-save">${client?'Save':'Add'}</button>
    </div>`);
  document.getElementById('cf-cancel').addEventListener('click', closeModal);
  document.getElementById('cf-save').addEventListener('click', async () => {
    const name = document.getElementById('cf-name').value.trim();
    if (!name) { showToast('Name required', 'error'); return; }
    try {
      if (client) await api.updateClient(client.id, { name });
      else        await api.createClient({ name });
      await reloadData(); closeModal(); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

/* ================================================================
   INIT
   ================================================================ */
async function reloadData() {
  const [orgs, clients, rates, settings] = await Promise.all([
    api.getOrganizations(),
    api.getClients(),
    api.getPayRates(),
    api.getSettings(),
  ]);
  state.organizations = orgs;
  state.clients       = clients;
  state.payRates      = rates;
  state.settings      = settings;
}

async function init() {
  startLiveClock();
  try {
    await reloadData();
  } catch (e) {
    console.error('Init failed:', e);
  }
  renderPage();
}

init();
