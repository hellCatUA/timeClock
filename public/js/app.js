/* ===== State ===== */
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
  reportWeekDate: new Date(),
  reportData: null,
};

/* ===== Time helpers ===== */
function roundTo5(date) {
  const ms = Math.round(date.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
  return new Date(ms);
}
function adjustedTime(offsetMinutes) {
  return roundTo5(new Date(Date.now() + offsetMinutes * 60000));
}
function fmtHHMM(date) {
  return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtDurationShort(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}г ${m}хв` : `${m}хв`;
}
function fmtMoney(amount) {
  const sym = state.settings.currency_symbol || '$';
  if (amount == null) return '—';
  return sym + amount.toFixed(2);
}
function fmtTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateShort(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}
function localISOString(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toISOFull(localStr) {
  return new Date(localStr).toISOString();
}
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function parseMaterials(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

/* ===== Icons ===== */
function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const ICONS = {
  clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play:     '<polygon points="5 3 19 12 5 21 5 3"/>',
  stop:     '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
  coffee:   '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  comment:  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit:     '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  alert:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  chevL:    '<polyline points="15 18 9 12 15 6"/>',
  chevR:    '<polyline points="9 18 15 12 9 6"/>',
  org:      '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  dollar:   '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  check:    '<polyline points="20 6 9 17 4 12"/>',
  print:    '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  hash:     '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  return:   '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  copy:     '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  tool:     '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>',
  wrench:   '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
};
const svg = name => icon(ICONS[name] || '');

/* ===== Toast ===== */
let toastTimer;
function showToast(msg, type = '', duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' '+type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ===== Modal ===== */
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

/* ===== Navigation ===== */
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
    case 'history':  renderHistoryPage(); break;
    case 'reports':  renderReportsPage(); break;
    case 'settings': renderSettingsPage(); break;
  }
}

/* ===== Live clock in header ===== */
function startLiveClock() {
  const el = document.getElementById('live-clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick();
  setInterval(tick, 1000);
}

/* ===== Timer cleanup ===== */
function clearTimers() {
  clearInterval(state.elapsedInterval);
  clearInterval(state.breakElapsedInterval);
  clearTimeout(state.reminderTimeout);
  clearTimeout(state.breakReturnTimeout);
  state.elapsedInterval = null;
  state.breakElapsedInterval = null;
}

/* ===================================================================
   TIME SELECTOR — reusable two-step widget
   =================================================================== */
function renderTimeSelector(containerId, label, onConfirm) {
  const container = document.getElementById(containerId);
  if (!container) return;

  function phase1() {
    container.innerHTML = `
      <div class="time-selector">
        <div class="time-sel-label">${label}</div>
        <div class="time-sel-row">
          <button class="btn btn-primary flex-1" id="ts-now">Зараз</button>
          <button class="btn btn-ghost flex-1" id="ts-later">Інший час →</button>
        </div>
      </div>`;
    document.getElementById('ts-now').addEventListener('click', () => {
      onConfirm(new Date().toISOString());
    });
    document.getElementById('ts-later').addEventListener('click', phase2);
  }

  function phase2() {
    const t = (off) => fmtHHMM(adjustedTime(off));
    container.innerHTML = `
      <div class="time-selector">
        <div class="time-sel-label">${label}</div>
        <div class="time-sel-grid">
          <button class="btn btn-ghost time-adj-btn" data-offset="-10">−10 хв<span>${t(-10)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="-5">−5 хв<span>${t(-5)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="5">+5 хв<span>${t(5)}</span></button>
          <button class="btn btn-ghost time-adj-btn" data-offset="10">+10 хв<span>${t(10)}</span></button>
        </div>
        <button class="btn btn-ghost btn-full" id="ts-custom">Вибрати вручну...</button>
        <div id="ts-custom-group" class="hidden" style="margin-top:8px;">
          <input type="datetime-local" class="form-control" id="ts-custom-input" value="${localISOString()}">
          <button class="btn btn-primary btn-full" id="ts-custom-confirm" style="margin-top:8px;">Підтвердити</button>
        </div>
      </div>`;

    container.querySelectorAll('.time-adj-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const off = parseInt(btn.dataset.offset);
        onConfirm(adjustedTime(off).toISOString());
      });
    });
    document.getElementById('ts-custom').addEventListener('click', () => {
      document.getElementById('ts-custom-group').classList.toggle('hidden');
    });
    document.getElementById('ts-custom-confirm').addEventListener('click', () => {
      const val = document.getElementById('ts-custom-input').value;
      if (!val) return showToast('Виберіть час', 'error');
      onConfirm(toISOFull(val));
    });
  }

  phase1();
}

/* ===== Clock Page ===== */
async function renderClockPage() {
  try {
    state.currentEntry = await api.getCurrentEntry();
  } catch (e) {
    state.currentEntry = null;
  }
  if (state.currentEntry) renderActiveClockPage();
  else if (state.lastCompletedEntry) renderSummaryPage();
  else renderIdleClockPage();
}

/* ===== Idle Clock Page ===== */
function renderIdleClockPage() {
  const orgs    = state.organizations;
  const clients = state.clients;
  const rates   = state.payRates;

  const orgOpts    = orgs.map(o    => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  const clientOpts = clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  const rateOpts   = rates.map(r   => `<option value="${r.id}">${escHtml(r.name)} — ${state.settings.currency_symbol || '$'}${r.rate}/год</option>`).join('');

  document.getElementById('page').innerHTML = `
    <div class="clock-idle">
      <div class="section-label">Нова зміна</div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">Організація</label>
          <select class="form-control" id="org-select">
            <option value="">— Без організації —</option>
            ${orgOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Клієнт</label>
          <select class="form-control" id="client-select">
            <option value="">— Без клієнта —</option>
            ${clientOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Site ID</label>
          <input type="text" class="form-control" id="site-id-input" placeholder="Ідентифікатор об'єкта...">
        </div>
        <div class="form-group">
          <label class="form-label">Тип оплати</label>
          <div class="toggle-group" id="rate-type-toggle">
            <button class="toggle-btn active" data-type="hourly">Погодинна</button>
            <button class="toggle-btn" data-type="flat">Фіксована</button>
          </div>
        </div>
        <div class="form-group" id="hourly-rate-group">
          <label class="form-label">Ставка оплати</label>
          <select class="form-control" id="rate-select">
            <option value="">— Без ставки —</option>
            ${rateOpts}
          </select>
        </div>
        <div class="form-group hidden" id="flat-rate-group">
          <label class="form-label">Фіксована сума (${state.settings.currency_symbol || '$'})</label>
          <input type="number" class="form-control" id="flat-amount-input" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Адреса</label>
          <div class="location-row">
            <input type="text" class="form-control" id="addr-input" placeholder="Введіть адресу...">
            <button class="btn btn-ghost location-btn" id="geo-btn" title="Визначити місце">${svg('location')}</button>
          </div>
          <div id="geo-status" style="font-size:12px;color:var(--text3);margin-top:4px;"></div>
        </div>

        <div id="clockin-time-selector"></div>
      </div>
    </div>`;

  // Rate type toggle
  let rateType = 'hourly';
  document.getElementById('rate-type-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    rateType = btn.dataset.type;
    document.querySelectorAll('#rate-type-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('hourly-rate-group').classList.toggle('hidden', rateType === 'flat');
    document.getElementById('flat-rate-group').classList.toggle('hidden', rateType === 'hourly');
  });

  // Geolocation
  let geoCoords = null;
  document.getElementById('geo-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('geo-status');
    statusEl.textContent = 'Визначаємо місце...';
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      geoCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      statusEl.textContent = 'Отримуємо адресу...';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${geoCoords.lat}&lon=${geoCoords.lng}&format=json`, {
          headers: { 'Accept-Language': 'uk,en' }
        });
        const data = await r.json();
        document.getElementById('addr-input').value = data.display_name || '';
        statusEl.textContent = '';
      } catch {
        document.getElementById('addr-input').value = `${geoCoords.lat.toFixed(5)}, ${geoCoords.lng.toFixed(5)}`;
        statusEl.textContent = 'Адресу не знайдено, збережено координати';
      }
    } catch {
      statusEl.textContent = 'Геолокація недоступна або відхилена';
    }
  });

  // Time selector → clock in
  renderTimeSelector('clockin-time-selector', 'Час початку', async (clockInISO) => {
    const container = document.getElementById('clockin-time-selector');
    container.innerHTML = '<div style="text-align:center;color:var(--text2);padding:12px;">Зберігаємо...</div>';
    try {
      const org       = document.getElementById('org-select').value;
      const client    = document.getElementById('client-select').value;
      const rate      = document.getElementById('rate-select').value;
      const flatAmt   = parseFloat(document.getElementById('flat-amount-input').value) || null;
      const addr      = document.getElementById('addr-input').value.trim();
      const siteId    = document.getElementById('site-id-input').value.trim();

      state.currentEntry = await api.clockIn({
        clock_in: clockInISO,
        organization_id: org    ? Number(org)    : null,
        client_id:       client ? Number(client) : null,
        pay_rate_id:     (rateType === 'hourly' && rate) ? Number(rate) : null,
        rate_type:       rateType,
        flat_amount:     rateType === 'flat' ? flatAmt : null,
        address:  addr   || null,
        site_id:  siteId || null,
        status:   'pending',
        latitude:  geoCoords?.lat || null,
        longitude: geoCoords?.lng || null,
      });

      state.showReminderBanner = false;
      state.showBreakReturnBanner = false;
      scheduleBreakReminder();
      renderActiveClockPage();
    } catch (err) {
      showToast(err.message || 'Помилка', 'error');
      renderTimeSelector('clockin-time-selector', 'Час початку', arguments.callee);
    }
  });
}

/* ===== Active Clock Page ===== */
function renderActiveClockPage() {
  const entry = state.currentEntry;
  if (!entry) { renderIdleClockPage(); return; }

  const onBreak  = !!entry.active_break;
  const org      = entry.org_name || '';
  const client   = entry.client_name || '';
  const isFlat   = entry.rate_type === 'flat';
  const materials = parseMaterials(entry.materials);

  document.getElementById('page').innerHTML = `
    ${state.showReminderBanner ? `
    <div class="reminder-banner">
      ${svg('bell')}
      <p>Час зробити перерву!</p>
      <button class="btn btn-orange btn-sm" id="take-break-reminder">Перерва</button>
    </div>` : ''}

    ${state.showBreakReturnBanner ? `
    <div class="reminder-banner" style="border-color:var(--green);background:var(--green-bg);">
      ${svg('return')}
      <p style="color:var(--green);">Перерва — час повертатись!</p>
      <button class="btn btn-primary btn-sm" id="end-break-banner-btn">Повернутись</button>
    </div>` : ''}

    <div class="clock-active-hero">
      <div class="status-badge ${onBreak ? 'on-break' : 'working'}">
        <span class="dot"></span>
        ${onBreak ? 'На перерві' : 'Працюю'}
      </div>
      <div class="elapsed-time" id="elapsed-display">00:00:00</div>
      ${isFlat && entry.flat_amount ? `
        <div class="earnings-display">${fmtMoney(entry.flat_amount)}</div>
        <div class="earning-rate">Фіксована ставка</div>
      ` : (entry.hourly_rate ? `
        <div class="earnings-display" id="earnings-display">${fmtMoney(0)}</div>
        <div class="earning-rate">${state.settings.currency_symbol || '$'}${entry.hourly_rate}/год</div>
      ` : '')}
      ${onBreak ? `<div class="break-timer">Перерва: <span id="break-elapsed">00:00:00</span></div>` : ''}
      <div class="clock-meta">
        <div class="clock-meta-item">${svg('clock')} ${fmtTime(entry.clock_in)}</div>
        ${org    ? `<div class="clock-meta-item">${svg('org')}  ${escHtml(org)}</div>`    : ''}
        ${client ? `<div class="clock-meta-item">${svg('user')} ${escHtml(client)}</div>` : ''}
        ${entry.site_id ? `<div class="clock-meta-item">${svg('hash')} ${escHtml(entry.site_id)}</div>` : ''}
        ${entry.address ? `<div class="clock-meta-item">${svg('location')} ${escHtml(entry.address)}</div>` : ''}
      </div>
    </div>

    <div class="clock-actions">
      ${onBreak
        ? `<button class="btn btn-primary btn-lg" id="end-break-btn">${svg('play')} Повернутись</button>`
        : `<button class="btn btn-orange btn-lg" id="start-break-btn">${svg('coffee')} Перерва</button>`
      }
      <button class="btn btn-danger btn-lg" id="clockout-btn">${svg('stop')} Стоп</button>
    </div>

    <div class="section-label">Деталі завдання</div>
    <div class="card" id="job-details-card">
      <div class="form-group">
        <label class="form-label">Assignment ID <span style="color:var(--red)">*</span></label>
        <input type="text" class="form-control" id="jd-assignment" value="${escHtml(entry.assignment_id || '')}" placeholder="Обов'язково">
      </div>
      <div class="row">
        <div class="form-group">
          <label class="form-label">Ticket #</label>
          <input type="text" class="form-control" id="jd-ticket" value="${escHtml(entry.ticket_num || '')}" placeholder="Необов'язково">
        </div>
        <div class="form-group">
          <label class="form-label">INC #</label>
          <input type="text" class="form-control" id="jd-inc" value="${escHtml(entry.inc_num || '')}" placeholder="Необов'язково">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">MOD Name <span style="color:var(--red)">*</span></label>
        <input type="text" class="form-control" id="jd-mod" value="${escHtml(entry.mod_name || '')}" placeholder="Обов'язково">
      </div>
      <div class="form-group">
        <label class="form-label">NOC Name</label>
        <input type="text" class="form-control" id="jd-noc" value="${escHtml(entry.noc_name || '')}" placeholder="Необов'язково">
      </div>
      <div class="form-group">
        <label class="form-label">PM/PC Name</label>
        <input type="text" class="form-control" id="jd-pmpc" value="${escHtml(entry.pm_pc_name || '')}" placeholder="Необов'язково">
      </div>
      <div class="form-group">
        <label class="form-label">Parking/Tolls</label>
        <input type="text" class="form-control" id="jd-parking" value="${escHtml(entry.parking_tolls || '')}" placeholder="Напр. $15 parking">
      </div>

      <div class="divider" style="margin:8px 0 16px;"></div>

      <div class="form-group">
        <label class="form-label replacement-toggle-label">
          <input type="checkbox" id="jd-replacement" ${entry.is_replacement ? 'checked' : ''} style="margin-right:8px;accent-color:var(--green);">
          Replacement? (Заміна обладнання)
        </label>
      </div>
      <div id="replacement-fields" class="${entry.is_replacement ? '' : 'hidden'}">
        <div class="form-group">
          <label class="form-label">Old Serial Numbers</label>
          <textarea class="form-control" id="jd-old-serial" rows="2" placeholder="Старі серійні номери">${escHtml(entry.old_serial || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Return Track #</label>
          <div class="input-group">
            <input type="text" class="form-control" id="jd-return-track" value="${escHtml(entry.return_track || '')}" placeholder="Номер відстеження">
            <button class="btn btn-ghost btn-sm" id="no-return-track-btn" style="white-space:nowrap;flex-shrink:0;">Немає</button>
          </div>
          <div id="no-return-track-label" class="${entry.no_return_track ? '' : 'hidden'}" style="font-size:12px;color:var(--orange);margin-top:4px;">⚠ No Return Track # Provided</div>
        </div>
      </div>

      <div class="divider" style="margin:8px 0 16px;"></div>

      <div class="form-group">
        <label class="form-label">Опис роботи (Work Summary)
          <span id="ws-counter" style="float:right;font-weight:400;">${(entry.work_summary || '').length}/500</span>
        </label>
        <textarea class="form-control" id="jd-work-summary" rows="3" maxlength="500" placeholder="Опис виконаних робіт...">${escHtml(entry.work_summary || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Additional Info / Issues</label>
        <textarea class="form-control" id="jd-additional" rows="2" placeholder="Додаткова інформація...">${escHtml(entry.additional_info || '')}</textarea>
      </div>

      <div class="divider" style="margin:8px 0 16px;"></div>

      <div class="form-group">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label class="form-label" style="margin:0;">Матеріали</label>
          <button class="btn btn-ghost btn-sm" id="add-material-btn">${svg('plus')} Додати</button>
        </div>
        <div id="materials-list">
          ${materials.map((m, i) => buildMaterialRow(i, m.name, m.price)).join('')}
        </div>
      </div>

      ${entry.breaks.length > 0 ? `
        <div class="divider" style="margin:8px 0 16px;"></div>
        <div style="font-size:13px;color:var(--text2);">
          <div style="font-weight:600;margin-bottom:4px;">Перерви:</div>
          ${entry.breaks.map(b => `<div>${fmtTime(b.break_start)} — ${b.break_end ? fmtTime(b.break_end) : 'зараз'}</div>`).join('')}
        </div>
      ` : ''}

      <button class="btn btn-primary btn-full" id="save-details-btn" style="margin-top:12px;">${svg('check')} Зберегти деталі</button>
    </div>`;

  // Break buttons
  if (onBreak) {
    const endBreakAction = async () => {
      try {
        await api.endBreak(entry.id, { break_end: new Date().toISOString() });
        state.currentEntry = await api.getCurrentEntry();
        state.showBreakReturnBanner = false;
        clearTimeout(state.breakReturnTimeout);
        state.breakReturnTimeout = null;
        scheduleBreakReminder();
        renderActiveClockPage();
      } catch (e) { showToast(e.message, 'error'); }
    };
    document.getElementById('end-break-btn')?.addEventListener('click', endBreakAction);
    document.getElementById('end-break-banner-btn')?.addEventListener('click', endBreakAction);
    startBreakElapsedTimer(entry.active_break.break_start);
    scheduleBreakReturnReminder(entry.active_break.break_start);
  } else {
    document.getElementById('start-break-btn')?.addEventListener('click', async () => {
      try {
        const b = await api.startBreak(entry.id, { break_start: new Date().toISOString() });
        state.currentEntry = { ...entry, active_break: b, breaks: [...entry.breaks] };
        state.showReminderBanner = false;
        state.showBreakReturnBanner = false;
        clearTimeout(state.reminderTimeout);
        renderActiveClockPage();
      } catch (e) { showToast(e.message, 'error'); }
    });
  }

  document.getElementById('take-break-reminder')?.addEventListener('click', () => {
    document.getElementById('start-break-btn')?.click();
  });

  document.getElementById('clockout-btn').addEventListener('click', () => showClockOutModal(entry));

  // Replacement toggle
  document.getElementById('jd-replacement').addEventListener('change', e => {
    document.getElementById('replacement-fields').classList.toggle('hidden', !e.target.checked);
  });

  // No return track button
  let noReturnTrack = !!entry.no_return_track;
  document.getElementById('no-return-track-btn')?.addEventListener('click', () => {
    noReturnTrack = !noReturnTrack;
    document.getElementById('jd-return-track').value = noReturnTrack ? '' : (entry.return_track || '');
    document.getElementById('jd-return-track').disabled = noReturnTrack;
    document.getElementById('no-return-track-label').classList.toggle('hidden', !noReturnTrack);
    document.getElementById('no-return-track-btn').textContent = noReturnTrack ? 'Скасувати' : 'Немає';
  });
  if (noReturnTrack) {
    document.getElementById('jd-return-track').disabled = true;
    document.getElementById('no-return-track-btn').textContent = 'Скасувати';
  }

  // Work summary counter
  document.getElementById('jd-work-summary').addEventListener('input', e => {
    document.getElementById('ws-counter').textContent = `${e.target.value.length}/500`;
  });

  // Materials
  setupMaterialsUI(materials);

  // Save details
  document.getElementById('save-details-btn').addEventListener('click', () => saveJobDetails(entry));

  startElapsedTimer(entry);
}

function buildMaterialRow(index, name = '', price = '') {
  return `
    <div class="material-row" data-index="${index}">
      <input type="text" class="form-control mat-name" placeholder="Назва матеріалу" value="${escHtml(name)}" style="flex:2;">
      <input type="number" class="form-control mat-price" placeholder="Ціна" value="${escHtml(String(price))}" min="0" step="0.01" style="flex:1;">
      <button class="btn btn-ghost btn-sm remove-material-btn" style="flex-shrink:0;color:var(--red);">${svg('trash')}</button>
    </div>`;
}

function setupMaterialsUI(initialMaterials) {
  let materials = [...initialMaterials];

  function refreshList() {
    const list = document.getElementById('materials-list');
    if (!list) return;
    list.innerHTML = materials.map((m, i) => buildMaterialRow(i, m.name, m.price)).join('');
    list.querySelectorAll('.remove-material-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        materials.splice(i, 1);
        refreshList();
      });
    });
  }

  refreshList();

  document.getElementById('add-material-btn')?.addEventListener('click', () => {
    materials.push({ name: '', price: '' });
    refreshList();
    const list = document.getElementById('materials-list');
    list?.querySelector('.material-row:last-child .mat-name')?.focus();
  });
}

function collectMaterials() {
  const rows = document.querySelectorAll('#materials-list .material-row');
  const materials = [];
  rows.forEach(row => {
    const name = row.querySelector('.mat-name')?.value.trim();
    const price = row.querySelector('.mat-price')?.value.trim();
    if (name) materials.push({ name, price: price ? parseFloat(price) : null });
  });
  return materials;
}

async function saveJobDetails(entry) {
  const isReplacement = document.getElementById('jd-replacement').checked;
  const noReturnTrack = !!(document.getElementById('jd-return-track')?.disabled);

  try {
    await api.updateEntry(entry.id, {
      assignment_id:  document.getElementById('jd-assignment').value.trim() || null,
      ticket_num:     document.getElementById('jd-ticket').value.trim() || null,
      inc_num:        document.getElementById('jd-inc').value.trim() || null,
      mod_name:       document.getElementById('jd-mod').value.trim() || null,
      noc_name:       document.getElementById('jd-noc').value.trim() || null,
      pm_pc_name:     document.getElementById('jd-pmpc').value.trim() || null,
      parking_tolls:  document.getElementById('jd-parking').value.trim() || null,
      is_replacement: isReplacement,
      old_serial:     document.getElementById('jd-old-serial')?.value.trim() || null,
      return_track:   noReturnTrack ? null : (document.getElementById('jd-return-track')?.value.trim() || null),
      no_return_track: noReturnTrack,
      work_summary:   document.getElementById('jd-work-summary').value.trim() || null,
      additional_info:document.getElementById('jd-additional').value.trim() || null,
      materials:      collectMaterials(),
    });
    state.currentEntry = await api.getCurrentEntry();
    showToast('Деталі збережено', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ===== Elapsed & earnings timers ===== */
function startElapsedTimer(entry) {
  clearInterval(state.elapsedInterval);
  const isFlat = entry.rate_type === 'flat';
  function tick() {
    const now = Date.now();
    const startMs = new Date(entry.clock_in).getTime();
    let breakMs = (entry.total_break_seconds || 0) * 1000;
    if (entry.active_break) breakMs += (now - new Date(entry.active_break.break_start).getTime());
    const elapsedSec = Math.max(0, Math.floor((now - startMs - breakMs) / 1000));
    const el = document.getElementById('elapsed-display');
    if (el) el.textContent = fmtDuration(elapsedSec);
    if (!isFlat && entry.hourly_rate) {
      const earnings = (elapsedSec / 3600) * entry.hourly_rate;
      const earn = document.getElementById('earnings-display');
      if (earn) earn.textContent = fmtMoney(earnings);
      document.title = `${fmtMoney(earnings)} — TimeClock`;
    }
  }
  tick();
  state.elapsedInterval = setInterval(tick, 1000);
}

function startBreakElapsedTimer(breakStart) {
  clearInterval(state.breakElapsedInterval);
  const tick = () => {
    const el = document.getElementById('break-elapsed');
    if (el) el.textContent = fmtDuration(Math.floor((Date.now() - new Date(breakStart).getTime()) / 1000));
  };
  tick();
  state.breakElapsedInterval = setInterval(tick, 1000);
}

/* ===== Reminders ===== */
function scheduleBreakReminder() {
  clearTimeout(state.reminderTimeout);
  const minutes = parseInt(state.settings.break_reminder_minutes) || 0;
  if (!minutes || !state.currentEntry) return;
  state.reminderTimeout = setTimeout(() => {
    if (!state.currentEntry || state.currentEntry.clock_out || state.currentEntry.active_break) return;
    state.showReminderBanner = true;
    if (Notification.permission === 'granted') {
      new Notification('TimeClock — Час для перерви!', {
        body: `Ви працюєте вже ${minutes} хвилин. Зробіть перерву!`,
      });
    }
    if (state.page === 'clock') renderActiveClockPage();
  }, minutes * 60 * 1000);
}

function scheduleBreakReturnReminder(breakStartISO) {
  clearTimeout(state.breakReturnTimeout);
  const minutes = parseInt(state.settings.break_return_minutes) || 10;
  const elapsed = (Date.now() - new Date(breakStartISO).getTime()) / 1000 / 60;
  const remaining = Math.max(0, minutes - elapsed);
  if (remaining <= 0) {
    state.showBreakReturnBanner = true;
    return;
  }
  state.breakReturnTimeout = setTimeout(() => {
    if (!state.currentEntry?.active_break) return;
    state.showBreakReturnBanner = true;
    if (Notification.permission === 'granted') {
      new Notification('TimeClock — Час повертатись!', {
        body: `Перерва ${minutes} хвилин. Час повертатись до роботи!`,
      });
    }
    if (state.page === 'clock') renderActiveClockPage();
  }, remaining * 60 * 1000);
}

/* ===== Clock Out Modal ===== */
function showClockOutModal(entry) {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Завершення зміни</div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Статус завдання</label>
        <div class="status-selector" id="job-status-sel">
          <button class="status-opt ${(entry.status || 'pending') === 'pending'    ? 'active' : ''}" data-status="pending">Pending</button>
          <button class="status-opt ${entry.status === 'completed' ? 'active' : ''}" data-status="completed">Completed</button>
          <button class="status-opt ${entry.status === 'fail'      ? 'active' : ''}" data-status="fail">Fail</button>
          <button class="status-opt ${entry.status === 'canceled'  ? 'active' : ''}" data-status="canceled">Canceled</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Release Code</label>
        <div class="input-group">
          <input type="text" class="form-control" id="co-release-code" value="${escHtml(entry.release_code || '')}" placeholder="Код підтвердження">
          <button class="btn btn-ghost btn-sm" id="no-release-code-btn" style="white-space:nowrap;flex-shrink:0;">Немає</button>
        </div>
        <div id="no-release-label" class="${entry.no_release_code ? '' : 'hidden'}" style="font-size:12px;color:var(--orange);margin-top:4px;">⚠ No Release Code Provided</div>
      </div>
      <div id="clockout-time-selector"></div>
    </div>`);

  let selectedStatus = entry.status || 'pending';
  document.getElementById('job-status-sel').addEventListener('click', e => {
    const btn = e.target.closest('.status-opt');
    if (!btn) return;
    selectedStatus = btn.dataset.status;
    document.querySelectorAll('.status-opt').forEach(b => b.classList.toggle('active', b === btn));
  });

  let noReleaseCode = !!entry.no_release_code;
  document.getElementById('no-release-code-btn').addEventListener('click', () => {
    noReleaseCode = !noReleaseCode;
    document.getElementById('co-release-code').disabled = noReleaseCode;
    document.getElementById('co-release-code').value = noReleaseCode ? '' : (entry.release_code || '');
    document.getElementById('no-release-label').classList.toggle('hidden', !noReleaseCode);
    document.getElementById('no-release-code-btn').textContent = noReleaseCode ? 'Скасувати' : 'Немає';
  });
  if (noReleaseCode) {
    document.getElementById('co-release-code').disabled = true;
    document.getElementById('no-release-code-btn').textContent = 'Скасувати';
  }

  renderTimeSelector('clockout-time-selector', 'Час завершення', async (clockOutISO) => {
    try {
      const releaseCode = noReleaseCode ? null : (document.getElementById('co-release-code').value.trim() || null);
      const completedEntry = await api.clockOut(entry.id, {
        clock_out: clockOutISO,
        status: selectedStatus,
        release_code: releaseCode,
        no_release_code: noReleaseCode,
      });
      state.currentEntry = null;
      state.lastCompletedEntry = completedEntry;
      clearTimers();
      document.title = 'TimeClock';
      closeModal();
      showToast('Зміну завершено', 'success');
      renderSummaryPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

/* ===== Summary Page (post clock-out) ===== */
function renderSummaryPage() {
  const entry = state.lastCompletedEntry;
  if (!entry) { renderIdleClockPage(); return; }

  const techName    = state.settings.tech_name || '';
  const netSec      = Math.max(0, (entry.gross_seconds || 0) - (entry.total_break_seconds || 0));

  // Calculate net time if gross_seconds not provided
  let displayNetSec = netSec;
  if (!entry.gross_seconds && entry.clock_in && entry.clock_out) {
    const g = Math.round((new Date(entry.clock_out) - new Date(entry.clock_in)) / 1000);
    displayNetSec = Math.max(0, g - (entry.total_break_seconds || 0));
  }

  const materials = parseMaterials(entry.materials);
  const materialsStr = materials.length > 0
    ? materials.map(m => m.price != null ? `${m.name} ($${parseFloat(m.price).toFixed(2)})` : m.name).join(', ')
    : '';

  const returnTrack = entry.no_return_track ? 'No Return Track #' : (entry.return_track || '');
  const releaseCode = entry.no_release_code ? 'No Release Code Provided' : (entry.release_code || '');
  const siteAndId   = [entry.org_name, entry.site_id].filter(Boolean).join(' / ');

  const summaryText =
`Tech name: ${techName}
Assignment ID: ${entry.assignment_id || ''}
Site name & ID: ${siteAndId}
Address: ${entry.address || ''}
Buyer/Representing company: ${entry.org_name || ''}
Onsite (Check in): ${fmtTime(entry.clock_in)}
Offsite (Check out): ${fmtTime(entry.clock_out)}
Total time: ${fmtDurationShort(displayNetSec)}
Parking/Tolls: ${entry.parking_tolls || ''}
PM/PC name: ${entry.pm_pc_name || ''}
MOD name: ${entry.mod_name || ''}
NOC name: ${entry.noc_name || ''}
Ticket #: ${entry.ticket_num || ''}
INC #: ${entry.inc_num || ''}
Release code: ${releaseCode}
Return track #: ${returnTrack}
Materials used: ${materialsStr}
Work summary (< 500 char.): ${entry.work_summary || ''}`;

  const statusColors = { pending: 'orange', completed: 'green', fail: 'red', canceled: 'red' };
  const statusColor  = statusColors[entry.status] || 'text2';

  document.getElementById('page').innerHTML = `
    <div style="padding:12px 0 20px;">
      <div class="section-label">Зміну завершено</div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <div style="font-weight:600;font-size:15px;">${escHtml(entry.org_name || 'Без організації')}</div>
            <div style="font-size:13px;color:var(--text2);margin-top:2px;">${fmtTime(entry.clock_in)} — ${fmtTime(entry.clock_out)}</div>
          </div>
          <span class="badge badge-${statusColor === 'green' ? 'green' : statusColor === 'orange' ? 'orange' : 'red'}">${entry.status || 'pending'}</span>
        </div>
        <div class="summary-output" id="summary-text-block">${escHtml(summaryText)}</div>
        <button class="btn btn-ghost btn-full" id="copy-summary-btn" style="margin-top:12px;">${svg('copy')} Копіювати в буфер</button>
      </div>
      <div style="padding:0 12px;">
        <button class="btn btn-primary btn-full" id="new-shift-btn">${svg('plus')} Нова зміна</button>
      </div>
    </div>`;

  document.getElementById('copy-summary-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      showToast('Скопійовано!', 'success');
    } catch {
      showToast('Не вдалося скопіювати', 'error');
    }
  });

  document.getElementById('new-shift-btn').addEventListener('click', () => {
    state.lastCompletedEntry = null;
    renderIdleClockPage();
  });
}

/* ===== History Page ===== */
async function renderHistoryPage() {
  try {
    const entries = await api.getEntries();
    buildHistoryPage(entries);
  } catch (e) {
    document.getElementById('page').innerHTML = `<div class="empty-state">${svg('alert')}<p>Помилка завантаження</p></div>`;
  }
}

function buildHistoryPage(entries) {
  if (!entries.length) {
    document.getElementById('page').innerHTML = `
      <div class="history-header"><h2>Журнал</h2></div>
      <div class="empty-state">${svg('clock')}<p>Записів немає</p></div>`;
    return;
  }
  const groups = {};
  entries.forEach(e => {
    const day = new Date(e.clock_in).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    (groups[day] = groups[day] || []).push(e);
  });

  let html = `<div class="history-header"><h2>Журнал</h2></div>`;
  for (const [day, dayEntries] of Object.entries(groups)) {
    html += `<div class="day-group"><div class="day-label">${day}</div>`;
    dayEntries.forEach(e => { html += buildEntryCard(e); });
    html += `</div>`;
  }
  document.getElementById('page').innerHTML = html;

  document.querySelectorAll('.entry-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.btn')) return;
      card.querySelector('.entry-expanded')?.classList.toggle('hidden');
    });
  });
  document.querySelectorAll('.delete-entry-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Видалити цей запис?')) return;
      try { await api.deleteEntry(btn.dataset.id); showToast('Запис видалено'); renderHistoryPage(); }
      catch (err) { showToast(err.message, 'error'); }
    });
  });
  document.querySelectorAll('.edit-entry-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const entry = entries.find(en => String(en.id) === btn.dataset.id);
      if (entry) showEditEntryModal(entry);
    });
  });
}

function buildEntryCard(e) {
  const isActive  = !e.clock_out;
  const clockIn   = new Date(e.clock_in);
  const clockOut  = e.clock_out ? new Date(e.clock_out) : null;
  const grossSec  = clockOut ? Math.round((clockOut - clockIn) / 1000) : null;
  const netSec    = grossSec !== null ? grossSec - (e.total_break_seconds || 0) : null;
  const isFlat    = e.rate_type === 'flat';
  const earnings  = isFlat
    ? (e.flat_amount ?? null)
    : (netSec !== null && e.hourly_rate ? (netSec / 3600) * e.hourly_rate : null);

  const statusColors = { pending: 'orange', completed: 'green', fail: 'red', canceled: 'red' };
  const sc = statusColors[e.status] || '';

  return `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-header">
        <div class="entry-org">${escHtml(e.org_name || 'Без організації')}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${e.status && !isActive ? `<span class="badge badge-${sc === 'green' ? 'green' : sc === 'orange' ? 'orange' : 'red'}" style="font-size:10px;">${e.status}</span>` : ''}
          ${isActive ? '<span class="entry-active-badge">Активна</span>' : ''}
          ${earnings !== null ? `<div class="entry-earnings">${fmtMoney(earnings)}</div>` : ''}
        </div>
      </div>
      <div class="entry-meta">
        <div class="entry-meta-item">${svg('clock')} ${fmtTime(e.clock_in)} — ${e.clock_out ? fmtTime(e.clock_out) : 'зараз'}</div>
        ${netSec !== null ? `<div class="entry-meta-item">${svg('play')} ${fmtDurationShort(netSec)}</div>` : ''}
        ${e.client_name    ? `<div class="entry-meta-item">${svg('user')}     ${escHtml(e.client_name)}</div>`    : ''}
        ${e.site_id        ? `<div class="entry-meta-item">${svg('hash')}     ${escHtml(e.site_id)}</div>`        : ''}
        ${e.assignment_id  ? `<div class="entry-meta-item">${svg('tag')}      ${escHtml(e.assignment_id)}</div>`  : ''}
        ${e.rate_name && !isFlat ? `<div class="entry-meta-item">${svg('dollar')} ${escHtml(e.rate_name)}</div>` : ''}
        ${isFlat ? `<div class="entry-meta-item">${svg('dollar')} Фіксована</div>` : ''}
        ${e.address        ? `<div class="entry-meta-item">${svg('location')} ${escHtml(e.address)}</div>`        : ''}
      </div>
      ${e.work_summary ? `<div class="entry-comment">${svg('comment')} ${escHtml(e.work_summary)}</div>` : ''}
      <div class="entry-expanded hidden">
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-ghost btn-sm edit-entry-btn" data-id="${e.id}">${svg('edit')} Редагувати</button>
          <button class="btn btn-secondary btn-sm delete-entry-btn" data-id="${e.id}" style="color:var(--red);">${svg('trash')} Видалити</button>
        </div>
      </div>
    </div>`;
}

function showEditEntryModal(entry) {
  const orgOpts    = state.organizations.map(o => `<option value="${o.id}" ${entry.organization_id == o.id ? 'selected' : ''}>${escHtml(o.name)}</option>`).join('');
  const clientOpts = state.clients.map(c       => `<option value="${c.id}" ${entry.client_id       == c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
  const rateOpts   = state.payRates.map(r      => `<option value="${r.id}" ${entry.pay_rate_id     == r.id ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Редагування запису</div>
    <div class="modal-body">
      <div class="row">
        <div class="form-group">
          <label class="form-label">Початок</label>
          <input type="datetime-local" class="form-control" id="edit-in" value="${localISOString(new Date(entry.clock_in))}">
        </div>
        <div class="form-group">
          <label class="form-label">Кінець</label>
          <input type="datetime-local" class="form-control" id="edit-out" value="${entry.clock_out ? localISOString(new Date(entry.clock_out)) : ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Організація</label>
        <select class="form-control" id="edit-org"><option value="">— Без організації —</option>${orgOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Клієнт</label>
        <select class="form-control" id="edit-client"><option value="">— Без клієнта —</option>${clientOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Site ID</label>
        <input type="text" class="form-control" id="edit-site-id" value="${escHtml(entry.site_id || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Ставка</label>
        <select class="form-control" id="edit-rate"><option value="">— Без ставки —</option>${rateOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Адреса</label>
        <input type="text" class="form-control" id="edit-addr" value="${escHtml(entry.address || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Опис роботи</label>
        <textarea class="form-control" id="edit-work-summary" rows="2">${escHtml(entry.work_summary || '')}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="edit-cancel">Скасувати</button>
      <button class="btn btn-primary" id="edit-save">${svg('check')} Зберегти</button>
    </div>`);

  document.getElementById('edit-cancel').addEventListener('click', closeModal);
  document.getElementById('edit-save').addEventListener('click', async () => {
    try {
      const clockIn    = toISOFull(document.getElementById('edit-in').value);
      const coVal      = document.getElementById('edit-out').value;
      const clockOut   = coVal ? toISOFull(coVal) : null;
      const orgVal     = document.getElementById('edit-org').value;
      const clientVal  = document.getElementById('edit-client').value;
      const rateVal    = document.getElementById('edit-rate').value;
      await api.updateEntry(entry.id, {
        clock_in:        clockIn,
        clock_out:       clockOut,
        organization_id: orgVal    ? Number(orgVal)    : null,
        client_id:       clientVal ? Number(clientVal) : null,
        pay_rate_id:     rateVal   ? Number(rateVal)   : null,
        site_id:         document.getElementById('edit-site-id').value.trim()     || null,
        address:         document.getElementById('edit-addr').value.trim()         || null,
        work_summary:    document.getElementById('edit-work-summary').value.trim() || null,
      });
      closeModal();
      showToast('Збережено', 'success');
      renderHistoryPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

/* ===== Reports Page ===== */
async function renderReportsPage() {
  try {
    const data = await api.getWeekReport(state.reportWeekDate.toISOString().slice(0, 10));
    state.reportData = data;
    buildReportsPage(data);
  } catch (e) {
    document.getElementById('page').innerHTML = `<div class="empty-state">${svg('alert')}<p>Помилка завантаження звіту</p></div>`;
  }
}

function buildReportsPage(data) {
  const weekStart = new Date(data.week_start);
  const weekEnd   = new Date(data.week_end);
  const weekLabel = `${fmtDateShort(weekStart.toISOString())} — ${fmtDateShort(weekEnd.toISOString())}`;
  const totalH    = Math.floor(data.total_net_seconds / 3600);
  const totalM    = Math.floor((data.total_net_seconds % 3600) / 60);

  let tableRows = data.entries.map(e => {
    const clockIn = new Date(e.clock_in);
    const netSec  = e.net_seconds || 0;
    const h = Math.floor(netSec / 3600), m = Math.floor((netSec % 3600) / 60);
    const isFlat = e.rate_type === 'flat';
    const earn = isFlat ? (e.flat_amount != null ? fmtMoney(e.flat_amount) : '—') : (e.earnings !== null ? fmtMoney(e.earnings) : '—');
    return `<tr>
      <td>${clockIn.toLocaleDateString('uk-UA', { weekday:'short', day:'numeric', month:'short' })}</td>
      <td>${escHtml(e.org_name || '—')}${e.client_name ? `<br><small style="color:var(--text2)">${escHtml(e.client_name)}</small>` : ''}</td>
      <td>${fmtTime(e.clock_in)} — ${e.clock_out ? fmtTime(e.clock_out) : '…'}</td>
      <td>${h}г ${m}хв</td>
      <td>${earn}</td>
    </tr>`;
  }).join('');

  if (!tableRows) tableRows = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px;">Записів немає</td></tr>`;

  document.getElementById('page').innerHTML = `
    <div class="reports-header">
      <div class="week-nav">
        <button class="week-arrow" id="prev-week">${svg('chevL')}</button>
        <div class="week-label">${weekLabel}</div>
        <button class="week-arrow" id="next-week">${svg('chevR')}</button>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Всього годин</div><div class="stat-value">${totalH}г ${totalM}хв</div></div>
      <div class="stat-card"><div class="stat-label">Заробіток</div><div class="stat-value green">${fmtMoney(data.total_earnings)}</div></div>
      <div class="stat-card"><div class="stat-label">Змін</div><div class="stat-value">${data.entries.length}</div></div>
      <div class="stat-card"><div class="stat-label">Серед. зміна</div><div class="stat-value">${data.entries.length > 0 ? fmtDurationShort(Math.round(data.total_net_seconds / data.entries.length)) : '—'}</div></div>
    </div>
    <div class="section-label">Деталі</div>
    <div class="report-table">
      <table>
        <thead><tr><th>Дата</th><th>Організація</th><th>Час</th><th>Год</th><th>Дохід</th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr class="total-row"><td colspan="3"><strong>Разом</strong></td><td>${totalH}г ${totalM}хв</td><td>${fmtMoney(data.total_earnings)}</td></tr></tfoot>
      </table>
    </div>
    <div class="section-label">Експорт</div>
    <div class="export-bar">
      <button class="btn btn-ghost" id="export-week-btn">${svg('download')} CSV цього тижня</button>
      <button class="btn btn-ghost" id="export-all-btn">${svg('download')} Весь CSV</button>
      <button class="btn btn-ghost" id="print-btn">${svg('print')} Друк</button>
    </div>`;

  document.getElementById('prev-week').addEventListener('click', () => {
    state.reportWeekDate = new Date(weekStart.getTime() - 7 * 86400000);
    renderReportsPage();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    state.reportWeekDate = new Date(weekStart.getTime() + 7 * 86400000);
    renderReportsPage();
  });
  document.getElementById('export-week-btn').addEventListener('click', () => {
    window.location.href = api.getExportUrl(data.week_start, data.week_end);
  });
  document.getElementById('export-all-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/csv';
  });
  document.getElementById('print-btn').addEventListener('click', () => window.print());
}

/* ===== Settings Page ===== */
async function renderSettingsPage() {
  try {
    const [orgs, clients, rates, settings] = await Promise.all([
      api.getOrganizations(), api.getClients(), api.getPayRates(), api.getSettings()
    ]);
    state.organizations = orgs;
    state.clients = clients;
    state.payRates = rates;
    state.settings = settings;
    buildSettingsPage(orgs, clients, rates, settings);
  } catch (e) {
    document.getElementById('page').innerHTML = `<div class="empty-state">${svg('alert')}<p>Помилка завантаження</p></div>`;
  }
}

function buildSettingsPage(orgs, clients, rates, settings) {
  const notifSupported = 'Notification' in window;
  const notifGranted   = notifSupported && Notification.permission === 'granted';

  const makeList = (items, editClass, delClass, subtextFn = null) =>
    items.map(it => `
      <div class="settings-item">
        <div class="settings-item-info">
          <div class="settings-item-label">${escHtml(it.name)}</div>
          ${subtextFn ? `<div class="settings-item-sub">${subtextFn(it)}</div>` : ''}
        </div>
        <div class="settings-item-actions">
          <button class="btn btn-ghost btn-sm ${editClass}" data-id="${it.id}">${svg('edit')}</button>
          <button class="btn btn-ghost btn-sm ${delClass}"  data-id="${it.id}" style="color:var(--red);">${svg('trash')}</button>
        </div>
      </div>`).join('');

  document.getElementById('page').innerHTML = `
    ${notifSupported && !notifGranted ? `
    <div class="notif-prompt">${svg('bell')}
      <span>Дозвольте сповіщення для нагадувань про перерви</span>
      <button class="btn btn-ghost btn-sm" id="req-notif">Дозволити</button>
    </div>` : ''}

    <div class="section-label">Загальні</div>
    <div class="settings-list">
      <div class="settings-item">
        <div class="settings-item-info"><div class="settings-item-label">Ім'я техніка</div></div>
        <input type="text" class="form-control" id="tech-name" value="${escHtml(settings.tech_name || '')}" placeholder="Your name" style="width:160px;">
      </div>
      <div class="settings-item">
        <div class="settings-item-info">
          <div class="settings-item-label">Нагадування про перерву</div>
          <div class="settings-item-sub">Через скільки хвилин нагадати</div>
        </div>
        <select class="form-control" id="break-reminder-sel" style="width:auto;padding:8px 10px;font-size:14px;">
          <option value="0"   ${settings.break_reminder_minutes==='0'  ?'selected':''}>Вимкнено</option>
          <option value="30"  ${settings.break_reminder_minutes==='30' ?'selected':''}>30 хв</option>
          <option value="60"  ${settings.break_reminder_minutes==='60' ?'selected':''}>1 год</option>
          <option value="90"  ${settings.break_reminder_minutes==='90' ?'selected':''}>1.5 год</option>
          <option value="120" ${settings.break_reminder_minutes==='120'?'selected':''}>2 год</option>
          <option value="180" ${settings.break_reminder_minutes==='180'?'selected':''}>3 год</option>
        </select>
      </div>
      <div class="settings-item">
        <div class="settings-item-info">
          <div class="settings-item-label">Тривалість перерви</div>
          <div class="settings-item-sub">Нагадування про повернення</div>
        </div>
        <select class="form-control" id="break-return-sel" style="width:auto;padding:8px 10px;font-size:14px;">
          <option value="5"  ${settings.break_return_minutes==='5' ?'selected':''}>5 хв</option>
          <option value="10" ${settings.break_return_minutes==='10'?'selected':''}>10 хв</option>
          <option value="15" ${settings.break_return_minutes==='15'?'selected':''}>15 хв</option>
          <option value="20" ${settings.break_return_minutes==='20'?'selected':''}>20 хв</option>
          <option value="30" ${settings.break_return_minutes==='30'?'selected':''}>30 хв</option>
        </select>
      </div>
      <div class="settings-item">
        <div class="settings-item-info"><div class="settings-item-label">Символ валюти</div></div>
        <input type="text" class="form-control" id="currency-sym" value="${escHtml(settings.currency_symbol || '$')}" style="width:60px;text-align:center;">
      </div>
      <div class="settings-item">
        <div class="settings-item-info"><div class="settings-item-label">Початок тижня</div></div>
        <select class="form-control" id="week-start-sel" style="width:auto;padding:8px 10px;font-size:14px;">
          <option value="1" ${settings.week_start==='1'?'selected':''}>Понеділок</option>
          <option value="0" ${settings.week_start==='0'?'selected':''}>Неділя</option>
        </select>
      </div>
    </div>
    <div style="padding:0 12px 12px;">
      <button class="btn btn-primary btn-full" id="save-general-btn">${svg('check')} Зберегти налаштування</button>
    </div>

    <div class="section-label">Організації</div>
    <div class="settings-list">
      ${makeList(orgs, 'edit-org-btn', 'delete-org-btn', o => o.address || '')}
      <div class="list-add-row"><button class="btn btn-ghost btn-full" id="add-org-btn">${svg('plus')} Додати організацію</button></div>
    </div>

    <div class="section-label">Клієнти</div>
    <div class="settings-list">
      ${makeList(clients, 'edit-client-btn', 'delete-client-btn')}
      <div class="list-add-row"><button class="btn btn-ghost btn-full" id="add-client-btn">${svg('plus')} Додати клієнта</button></div>
    </div>

    <div class="section-label">Ставки оплати</div>
    <div class="settings-list">
      ${makeList(rates, 'edit-rate-btn', 'delete-rate-btn', r => `${settings.currency_symbol || '$'}${r.rate}/год`)}
      <div class="list-add-row"><button class="btn btn-ghost btn-full" id="add-rate-btn">${svg('plus')} Додати ставку</button></div>
    </div>`;

  // Notification
  document.getElementById('req-notif')?.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    showToast(perm === 'granted' ? 'Сповіщення дозволено' : 'Сповіщення відхилено', perm === 'granted' ? 'success' : 'error');
    if (perm === 'granted') renderSettingsPage();
  });

  // Save general
  document.getElementById('save-general-btn').addEventListener('click', async () => {
    try {
      const saved = await api.saveSettings({
        tech_name:              document.getElementById('tech-name').value.trim(),
        break_reminder_minutes: document.getElementById('break-reminder-sel').value,
        break_return_minutes:   document.getElementById('break-return-sel').value,
        currency_symbol:        document.getElementById('currency-sym').value.trim() || '$',
        week_start:             document.getElementById('week-start-sel').value,
      });
      state.settings = saved;
      showToast('Налаштування збережено', 'success');
      if (state.currentEntry) scheduleBreakReminder();
    } catch (e) { showToast(e.message, 'error'); }
  });

  // Orgs
  document.getElementById('add-org-btn').addEventListener('click', () => showOrgModal(null));
  document.querySelectorAll('.edit-org-btn').forEach(btn => {
    btn.addEventListener('click', () => showOrgModal(state.organizations.find(o => o.id == btn.dataset.id)));
  });
  document.querySelectorAll('.delete-org-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Видалити організацію?')) return;
      try { await api.deleteOrganization(btn.dataset.id); state.organizations = state.organizations.filter(o => o.id != btn.dataset.id); showToast('Видалено'); renderSettingsPage(); }
      catch (e) { showToast(e.message, 'error'); }
    });
  });

  // Clients
  document.getElementById('add-client-btn').addEventListener('click', () => showClientModal(null));
  document.querySelectorAll('.edit-client-btn').forEach(btn => {
    btn.addEventListener('click', () => showClientModal(state.clients.find(c => c.id == btn.dataset.id)));
  });
  document.querySelectorAll('.delete-client-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Видалити клієнта?')) return;
      try { await api.deleteClient(btn.dataset.id); state.clients = state.clients.filter(c => c.id != btn.dataset.id); showToast('Видалено'); renderSettingsPage(); }
      catch (e) { showToast(e.message, 'error'); }
    });
  });

  // Rates
  document.getElementById('add-rate-btn').addEventListener('click', () => showRateModal(null));
  document.querySelectorAll('.edit-rate-btn').forEach(btn => {
    btn.addEventListener('click', () => showRateModal(state.payRates.find(r => r.id == btn.dataset.id)));
  });
  document.querySelectorAll('.delete-rate-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Видалити ставку?')) return;
      try { await api.deletePayRate(btn.dataset.id); state.payRates = state.payRates.filter(r => r.id != btn.dataset.id); showToast('Видалено'); renderSettingsPage(); }
      catch (e) { showToast(e.message, 'error'); }
    });
  });
}

/* ===== Settings modals ===== */
function showOrgModal(org) {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${org ? 'Редагувати організацію' : 'Нова організація'}</div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Назва *</label>
        <input type="text" class="form-control" id="org-name" value="${escHtml(org?.name || '')}" placeholder="Назва організації"></div>
      <div class="form-group"><label class="form-label">Адреса</label>
        <input type="text" class="form-control" id="org-addr" value="${escHtml(org?.address || '')}" placeholder="Необов'язково"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="org-cancel">Скасувати</button>
      <button class="btn btn-primary"   id="org-save">${svg('check')} Зберегти</button>
    </div>`);
  document.getElementById('org-cancel').addEventListener('click', closeModal);
  document.getElementById('org-save').addEventListener('click', async () => {
    const name = document.getElementById('org-name').value.trim();
    const address = document.getElementById('org-addr').value.trim();
    if (!name) return showToast('Введіть назву', 'error');
    try {
      if (org) {
        const u = await api.updateOrganization(org.id, { name, address: address || null });
        const i = state.organizations.findIndex(o => o.id === org.id);
        if (i >= 0) state.organizations[i] = u;
      } else {
        state.organizations.push(await api.createOrganization({ name, address: address || null }));
      }
      closeModal(); showToast('Збережено', 'success'); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function showClientModal(client) {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${client ? 'Редагувати клієнта' : 'Новий клієнт'}</div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Назва *</label>
        <input type="text" class="form-control" id="client-name" value="${escHtml(client?.name || '')}" placeholder="Назва клієнта"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="client-cancel">Скасувати</button>
      <button class="btn btn-primary"   id="client-save">${svg('check')} Зберегти</button>
    </div>`);
  document.getElementById('client-cancel').addEventListener('click', closeModal);
  document.getElementById('client-save').addEventListener('click', async () => {
    const name = document.getElementById('client-name').value.trim();
    if (!name) return showToast('Введіть назву', 'error');
    try {
      if (client) {
        const u = await api.updateClient(client.id, { name });
        const i = state.clients.findIndex(c => c.id === client.id);
        if (i >= 0) state.clients[i] = u;
      } else {
        state.clients.push(await api.createClient({ name }));
      }
      closeModal(); showToast('Збережено', 'success'); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

function showRateModal(rate) {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${rate ? 'Редагувати ставку' : 'Нова ставка'}</div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Назва *</label>
        <input type="text" class="form-control" id="rate-name" value="${escHtml(rate?.name || '')}" placeholder="Напр. Основна, Нічна..."></div>
      <div class="row">
        <div class="form-group"><label class="form-label">Ставка/год *</label>
          <input type="number" class="form-control" id="rate-val" value="${rate?.rate || ''}" min="0.01" step="0.01" placeholder="25.00"></div>
        <div class="form-group"><label class="form-label">Валюта</label>
          <input type="text" class="form-control" id="rate-cur" value="${escHtml(rate?.currency || 'USD')}" placeholder="USD"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="rate-cancel">Скасувати</button>
      <button class="btn btn-primary"   id="rate-save">${svg('check')} Зберегти</button>
    </div>`);
  document.getElementById('rate-cancel').addEventListener('click', closeModal);
  document.getElementById('rate-save').addEventListener('click', async () => {
    const name    = document.getElementById('rate-name').value.trim();
    const rateVal = parseFloat(document.getElementById('rate-val').value);
    const currency = document.getElementById('rate-cur').value.trim() || 'USD';
    if (!name)              return showToast('Введіть назву', 'error');
    if (!rateVal || rateVal <= 0) return showToast('Введіть ставку', 'error');
    try {
      if (rate) {
        const u = await api.updatePayRate(rate.id, { name, rate: rateVal, currency });
        const i = state.payRates.findIndex(r => r.id === rate.id);
        if (i >= 0) state.payRates[i] = u;
      } else {
        state.payRates.push(await api.createPayRate({ name, rate: rateVal, currency }));
      }
      closeModal(); showToast('Збережено', 'success'); renderSettingsPage();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

/* ===== Init ===== */
async function init() {
  startLiveClock();
  try {
    const [orgs, clients, rates, settings] = await Promise.all([
      api.getOrganizations(), api.getClients(), api.getPayRates(), api.getSettings()
    ]);
    state.organizations = orgs;
    state.clients = clients;
    state.payRates = rates;
    state.settings = settings;
  } catch (e) { console.error('Init error:', e); }

  try {
    state.currentEntry = await api.getCurrentEntry();
    if (state.currentEntry) {
      scheduleBreakReminder();
      if (state.currentEntry.active_break) {
        scheduleBreakReturnReminder(state.currentEntry.active_break.break_start);
      }
    }
  } catch { state.currentEntry = null; }

  renderPage();
}

init();
