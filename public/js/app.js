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
  tripTimerInterval: null,
  reminderTimeout: null,
  breakReturnTimeout: null,
  showReminderBanner: false,
  showBreakReturnBanner: false,
  journalDate: new Date(),
  overviewPeriod: 'month',
  overviewOffset: 0,
  currentTrip: null,
  tripCategories: [],
  journalSubTab: 'work',
  pendingTripAssignment: null,
  pendingTripClockIn: null,
  pendingTripId: null,
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
  if (state.settings?.paid_breaks === '1') return gross;
  return Math.max(0, gross - (entry.total_break_seconds || 0));
}
function calcLabor(entry, netSec) {
  const s = netSec !== undefined ? netSec : getNetSeconds(entry);
  if (entry.rate_type === 'none') return 0;   // non-billable visit
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
function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function fmtMMMWk(weekStartStr) {
  const d = new Date(weekStartStr + 'T12:00:00');
  return `${d.toLocaleDateString('en-US', { month: 'short' })}/W${getISOWeekNum(d)}`;
}
function dateToISODate(date) {
  const pad = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
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
  car:      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="9" y1="11" x2="2.5" y2="7.5"/><line x1="15" y1="11" x2="21.5" y2="7.5"/>',
  pause:    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  file:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
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

/* ── Photo helpers ──────────────────────────────────────────────── */
function compressImage(file, maxPx = 1920, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
        else { width = Math.round(width * maxPx / height); height = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadPhoto(entryId, file, photoType, nameHint = null) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const blob = isPdf ? file : await compressImage(file);
  const mime = isPdf ? 'application/pdf' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const b64 = e.target.result.split(',')[1];
        const result = await api.uploadPhoto(entryId, {
          data: b64, filename: file.name, photo_type: photoType, mime, name_hint: nameHint
        });
        resolve(result);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

function isPdfFile(photo) {
  return /\.pdf$/i.test(photo.filename || photo.url || '');
}

function buildPhotoThumb(photo, label) {
  const inner = isPdfFile(photo)
    ? `<a class="photo-thumb-img photo-thumb-pdf" href="${escHtml(photo.url)}" target="_blank" title="${escHtml(photo.original_name || 'PDF')}">${svg('file')}<span>PDF</span></a>`
    : `<img class="photo-thumb-img" src="${escHtml(photo.url)}" alt="${escHtml(label)}" loading="lazy">`;
  return `<div class="photo-thumb-item" data-photo-id="${photo.id}">
    ${inner}
    <button class="photo-delete-btn" data-photo-id="${photo.id}" type="button" aria-label="Remove">&#x2715;</button>
  </div>`;
}

function buildPhotoSection(photoType, label, photos, opts = {}) {
  const allowPdf = !!opts.pdf;
  const thumbs = (photos || []).map(p => buildPhotoThumb(p, label)).join('');
  return `<div class="photo-section" data-type="${photoType}">
    <div class="photo-section-label">${escHtml(label)}</div>
    <div class="photo-thumbs-row" data-thumbs="${photoType}">${thumbs}</div>
    <label class="photo-add-btn" for="photo-inp-${photoType}">
      ${svg('camera')}<span>${allowPdf ? 'Add Photo / PDF' : 'Add Photo'}</span>
    </label>
    <input type="file" accept="${allowPdf ? 'image/*,application/pdf' : 'image/*'}" multiple class="photo-input visually-hidden"
           id="photo-inp-${photoType}" data-type="${photoType}">
  </div>`;
}

function buildPhotoGallery(photos) {
  if (!photos || !photos.length) return '';
  const LABELS = { before: 'Before', serial_before: 'Serial Numbers', issues: 'Issues', add_info: 'Add. Info', after: 'After', work_order: 'Work Order', sign_off: 'Sign Off', equipment_left: 'Equipment Left', new_serial: 'New Serials', material: 'Materials', return_track: 'Return Track', signature: 'Signatures' };
  const grouped = {};
  photos.forEach(p => { if (!grouped[p.photo_type]) grouped[p.photo_type] = []; grouped[p.photo_type].push(p); });
  const typeLabel = t => LABELS[t] || (t.startsWith('cf_') ? cfLabel(t) : t);
  return `<div class="det-photo-section">
    <div class="subsection-label" style="margin:12px 0 8px;">Photos</div>
    ${Object.entries(grouped).map(([type, list]) => `
      <div style="margin-bottom:10px;">
        <div class="photo-section-label">${escHtml(typeLabel(type))}</div>
        <div class="photo-gallery-row">
          ${list.map(p => isPdfFile(p)
            ? `<a href="${escHtml(p.url)}" target="_blank" class="photo-gallery-item photo-gallery-pdf" title="${escHtml(p.original_name || 'PDF')}">${svg('file')}<span>PDF</span></a>`
            : `<a href="${escHtml(p.url)}" target="_blank" class="photo-gallery-item">
            <img src="${escHtml(p.url)}" alt="${type}" loading="lazy">
          </a>`).join('')}
        </div>
      </div>`).join('')}
  </div>`;
}

function setupPictureSectionEvents(picSection, entryId) {
  picSection.addEventListener('click', async (e) => {
    const btn = e.target.closest('.photo-delete-btn');
    if (!btn || btn.disabled) return;
    const photoId = btn.dataset.photoId;
    const item = btn.closest('.photo-thumb-item');
    if (!item) return;
    btn.disabled = true;
    try {
      await api.deletePhoto(entryId, photoId);
      item.remove();
      showToast('Photo removed', 'success');
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || 'Delete failed', 'error');
    }
  });

  picSection.addEventListener('change', async (e) => {
    const inp = e.target.closest('.photo-input');
    if (!inp) return;
    const files = [...(inp.files || [])];
    if (!files.length) return;
    const photoType = inp.dataset.type;
    const label = inp.closest('.photo-section')?.querySelector('.photo-section-label')?.textContent || photoType;
    const thumbsDiv = picSection.querySelector(`[data-thumbs="${photoType}"]`);
    const nameHint = photoType.startsWith('cf_') ? photoType.slice(3) : null;
    inp.disabled = true;
    for (const file of files) {
      try {
        const photo = await uploadPhoto(entryId, file, photoType, nameHint);
        thumbsDiv?.insertAdjacentHTML('beforeend', buildPhotoThumb(photo, label));
        showToast('Photo uploaded', 'success');
      } catch (err) {
        showToast(err.message || 'Upload failed', 'error');
      }
    }
    inp.value = '';
    inp.disabled = false;
  });
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
async function navigateTo(page) {
  if (state.page === 'clock' && page !== 'clock' && state.currentEntry) {
    await autoSaveActiveForm();
  }
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
  clearInterval(state.tripTimerInterval);
  clearTimeout(state.reminderTimeout);
  clearTimeout(state.breakReturnTimeout);
  state.elapsedInterval = null;
  state.breakElapsedInterval = null;
  state.tripTimerInterval = null;
}

/* ── Clipboard helpers ───────────────────────────────────────────── */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard!', 'success');
      return;
    }
  } catch (_) { /* fall through */ }
  showTextModal(text);
}

function showTextModal(text) {
  openModal(`
    <div class="modal-header">
      <h3>${svg('copy')} Text Report</h3>
      <button class="btn btn-ghost btn-sm" id="tr-x">✕</button>
    </div>
    <div class="modal-body">
      <p class="field-hint" style="margin-bottom:10px;">Tap inside the box, then select all (Ctrl+A / Cmd+A) and copy</p>
      <textarea class="form-control report-textarea" id="tr-text" readonly rows="14">${escHtml(text)}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="tr-close">Close</button>
    </div>`);
  setTimeout(() => { const ta = document.getElementById('tr-text'); ta?.focus(); ta?.select(); }, 60);
  document.getElementById('tr-x')?.addEventListener('click', closeModal);
  document.getElementById('tr-close')?.addEventListener('click', closeModal);
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
    const netSec = paidBreaks
      ? grossSec
      : Math.max(0, grossSec - (entry.total_break_seconds || 0) - (onBreak ? breakSecs : 0));

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
  state.reminderTimeout = setTimeout(async () => {
    state.showReminderBanner = true;
    await autoSaveActiveForm();
    renderActiveClockPage();
  }, minutes * 60000);
}

function scheduleBreakReturnReminder(breakStart) {
  clearTimeout(state.breakReturnTimeout);
  const minutes = parseInt(state.settings.break_length_minutes || '15', 10);
  if (!minutes) return;
  const elapsed = (Date.now() - new Date(breakStart)) / 60000;
  const remaining = Math.max(0, minutes - elapsed);
  state.breakReturnTimeout = setTimeout(async () => {
    state.showBreakReturnBanner = true;
    await autoSaveActiveForm();
    renderActiveClockPage();
  }, remaining * 60000);
}

/* ── Time Selector Widget ────────────────────────────────────────── */
function renderTimeSelector(containerId, label, onConfirm, extraTimeOptions = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  function phase1() {
    const extraBtnsHtml = extraTimeOptions.map((opt, i) =>
      `<button class="btn btn-primary btn-full" id="ts-extra-${i}" style="margin-bottom:6px;">${escHtml(opt.label)}</button>`
    ).join('');
    container.innerHTML = `
      <div class="time-selector">
        <div class="time-sel-label">${label}</div>
        ${extraBtnsHtml}
        <div class="time-sel-row">
          <button class="btn btn-primary flex-1" id="ts-now">Now</button>
          <button class="btn btn-ghost flex-1" id="ts-later">Other time →</button>
        </div>
      </div>`;
    extraTimeOptions.forEach((opt, i) => {
      document.getElementById(`ts-extra-${i}`)?.addEventListener('click', () => onConfirm(opt.isoTime));
    });
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
  try { state.currentTrip = await api.getCurrentTrip(); } catch { state.currentTrip = null; }
  if (state.currentEntry) renderActiveClockPage();
  else if (state.currentTrip) renderActiveTripPage();
  else if (state.lastCompletedEntry && !state.pendingRevisit) renderSummaryPage(state.lastCompletedEntry);
  else renderIdleClockPage();
}

/* ── Idle (pre-clock-in) ─────────────────────────────────────────── */
async function renderIdleClockPage() {
  const orgs  = state.organizations;
  const clis  = state.clients;
  const rates = state.payRates;
  const sym   = state.settings.currency_symbol || '$';

  try { state.projects = await api.getProjects(); } catch { state.projects = state.projects || []; }
  try { state.plannedJobs = await api.getPlannedJobs(); } catch { state.plannedJobs = state.plannedJobs || []; }
  const projects = state.projects || [];
  const plannedJobs = state.plannedJobs || [];

  const orgOpts  = orgs.map(o  => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  const cliOpts  = clis.map(c  => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  const rateOpts = rates.map(r => `<option value="${r.id}">${escHtml(r.name)} — ${sym}${r.rate}/hr</option>`).join('');
  const projOpts = projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const pendingBanner = (state.pendingTripAssignment || state.pendingTripClockIn || state.pendingTripId) ? `
    <div class="card" style="background:var(--green-bg);border:1px solid var(--green);padding:10px 14px;margin-bottom:4px;border-radius:8px;">
      ${state.pendingTripAssignment ? `<div style="font-size:13px;">Trip WO: <b>${escHtml(state.pendingTripAssignment)}</b> will be pre-filled</div>` : ''}
      ${!state.pendingTripAssignment && state.pendingTripId ? `<div style="font-size:13px;">Trip will link to WO when you save Assignment ID</div>` : ''}
      ${state.pendingTripClockIn ? `<div style="font-size:13px;margin-top:2px;">Trip arrival time: <b>${fmtTime(state.pendingTripClockIn)}</b> available as clock-in</div>` : ''}
    </div>` : '';

  document.getElementById('page').innerHTML = `
    <div class="p-16">
      <div class="row-2" style="margin-bottom:16px;">
        <button class="btn btn-secondary btn-full" id="in-route-btn">
          ${svg('car')} In Route
        </button>
        <button class="btn btn-primary btn-full" id="clock-in-start-btn">
          ${svg('clock')} Clock In
        </button>
      </div>
      ${pendingBanner}
      ${plannedJobs.length ? (() => {
        const dated = plannedJobs.filter(p => p.planned_date).sort((a,b) => a.planned_date.localeCompare(b.planned_date));
        const next = dated[0] || plannedJobs[0];
        const nextLbl = `${next.planned_date ? plannedDayLabel(next.planned_date) + ' — ' : ''}${next.wo_title || next.assignment_id || 'job'}`;
        return `
      <div class="card" id="planned-strip" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${svg('bell')} Planned Jobs — ${plannedJobs.length}</div>
          <div class="field-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Next: ${escHtml(nextLbl)}</div>
        </div>
        ${svg('chevR')}
      </div>`;
      })() : ''}
      <div style="margin-bottom:12px;">
        <button class="btn btn-ghost btn-sm" id="plan-job-btn">${svg('plus')} Plan a Job</button>
      </div>
      <div class="section-label">New Work Order</div>
      <div class="card" id="clock-in-form-card">
        <div class="form-group">
          <label class="form-label">WO Title</label>
          <input type="text" class="form-control" id="wo-title-input" placeholder="Brief description of work...">
        </div>
        <div class="form-group">
          <label class="form-label">Project <span class="opt-label">optional</span></label>
          <div class="input-row">
            <select class="form-control" id="project-select" style="flex:1;">
              <option value="">— No Project —</option>
              ${projOpts}
            </select>
            <button class="btn btn-ghost btn-icon" id="manage-projects-btn" title="Manage projects">${svg('edit')}</button>
          </div>
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
          <label class="form-label">Flat Rate</label>
          <div class="money-wrap">
            <span class="money-sym">${sym}</span>
            <input type="number" class="form-control" id="flat-amount-input" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="field-hint">Flat 0.00 = Non-Billable visit</div>
        </div>
        <div class="form-group">
          <label class="form-label">Travel Reimbursement</label>
          <div class="money-wrap">
            <span class="money-sym">${sym}</span>
            <input type="number" class="form-control" id="travel-reimb-input" min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
        <div id="clockin-time-selector"></div>
      </div>
    </div>`;

  document.getElementById('in-route-btn').addEventListener('click', () => openTripStartModal());

  document.getElementById('clock-in-start-btn').addEventListener('click', () => {
    const formCard = document.getElementById('clock-in-form-card');
    if (formCard) {
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formCard.querySelector('input,select')?.focus();
    }
  });

  let rateType = 'hourly';
  const setRateType = (t) => {
    rateType = t;
    document.querySelectorAll('#pay-type-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.type === t));
    document.getElementById('hourly-rate-group').classList.toggle('hidden', t !== 'hourly');
    document.getElementById('flat-rate-group').classList.toggle('hidden', t !== 'flat');
  };
  document.getElementById('pay-type-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    setRateType(btn.dataset.type);
  });

  // Extra fields carried into clock-in from a planned job / project defaults
  const prefillExtras = { assignment_id: null, site_id: null, plannedJobId: null };

  const applyProjectDefaults = (p) => {
    let d = {};
    try { d = JSON.parse(p.defaults || '{}') || {}; } catch { d = {}; }
    if (d.wo_title)          document.getElementById('wo-title-input').value = d.wo_title;
    if (d.organization_id)   document.getElementById('company-select').value = String(d.organization_id);
    if (d.client_id)         document.getElementById('customer-select').value = String(d.client_id);
    if (d.address)           document.getElementById('addr-input').value = d.address;
    if (d.rate_type)         setRateType(d.rate_type);
    if (d.pay_rate_id)       document.getElementById('rate-select').value = String(d.pay_rate_id);
    if (d.flat_amount != null && d.flat_amount !== '') document.getElementById('flat-amount-input').value = d.flat_amount;
    if (d.travel_reimb != null && d.travel_reimb !== '') document.getElementById('travel-reimb-input').value = d.travel_reimb;
    if (d.site_id)           prefillExtras.site_id = d.site_id;
    if (d.assignment_id)     prefillExtras.assignment_id = d.assignment_id;
  };

  document.getElementById('project-select').addEventListener('change', e => {
    const p = (state.projects || []).find(x => x.id === Number(e.target.value));
    if (p) applyProjectDefaults(p);
  });

  document.getElementById('manage-projects-btn').addEventListener('click', () => openProjectsModal());
  document.getElementById('plan-job-btn').addEventListener('click', () => openPlanJobModal());

  const applyPlannedJob = (pj) => {
    if (pj.wo_title)        document.getElementById('wo-title-input').value = pj.wo_title;
    if (pj.project_id)      document.getElementById('project-select').value = String(pj.project_id);
    if (pj.organization_id) document.getElementById('company-select').value = String(pj.organization_id);
    if (pj.client_id)       document.getElementById('customer-select').value = String(pj.client_id);
    if (pj.address)         document.getElementById('addr-input').value = pj.address;
    if (pj.rate_type)       setRateType(pj.rate_type === 'none' ? 'flat' : pj.rate_type);
    if (pj.pay_rate_id)     document.getElementById('rate-select').value = String(pj.pay_rate_id);
    if (pj.flat_amount != null) document.getElementById('flat-amount-input').value = pj.flat_amount;
    if (pj.travel_reimb != null) document.getElementById('travel-reimb-input').value = pj.travel_reimb;
    prefillExtras.assignment_id = pj.assignment_id || prefillExtras.assignment_id;
    prefillExtras.site_id = pj.site_id || prefillExtras.site_id;
    prefillExtras.revisit_of = pj.revisit_of || prefillExtras.revisit_of;
    prefillExtras.plannedJobId = pj.id;
    document.getElementById('clock-in-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Job pre-filled — pick a clock-in time to start', 'success');
  };

  document.getElementById('planned-strip')?.addEventListener('click', () => {
    openPlannedScheduleModal(applyPlannedJob);
  });

  // Revisit prefill (set by openRevisitModal)
  if (state.pendingRevisit) {
    const rv = state.pendingRevisit;
    state.pendingRevisit = null;
    if (rv.wo_title)        document.getElementById('wo-title-input').value = rv.wo_title;
    if (rv.project_id)      document.getElementById('project-select').value = String(rv.project_id);
    if (rv.organization_id) document.getElementById('company-select').value = String(rv.organization_id);
    if (rv.client_id)       document.getElementById('customer-select').value = String(rv.client_id);
    if (rv.address)         document.getElementById('addr-input').value = rv.address;
    if (rv.rate_type)       setRateType(rv.rate_type);
    if (rv.pay_rate_id)     document.getElementById('rate-select').value = String(rv.pay_rate_id);
    if (rv.flat_amount != null && rv.flat_amount !== '') document.getElementById('flat-amount-input').value = rv.flat_amount;
    if (rv.travel_reimb != null && rv.travel_reimb !== '') document.getElementById('travel-reimb-input').value = rv.travel_reimb;
    ['assignment_id','site_id','ticket_num','inc_num','mod_name','noc_name','pm_pc_name','revisit_of'].forEach(k => {
      if (rv[k]) prefillExtras[k] = rv[k];
    });
    setTimeout(() => {
      document.getElementById('clock-in-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    showToast('Revisit pre-filled — pick a clock-in time to start', 'success');
  }

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

  const tripTimeOpts = state.pendingTripClockIn
    ? [{ label: `Trip arrival time — ${fmtTime(state.pendingTripClockIn)}`, isoTime: state.pendingTripClockIn }]
    : [];

  async function doClockIn(clockInISO) {
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

      const projectSel = document.getElementById('project-select').value;
      // Flat rate with no amount = Non-Billable visit
      const effRateType = (rateType === 'flat' && !flatAmt) ? 'none' : rateType;
      state.currentEntry = await api.clockIn({
        clock_in:        clockInISO,
        organization_id: org    ? Number(org)   : null,
        client_id:       client ? Number(client): null,
        pay_rate_id:     (effRateType === 'hourly' && rate) ? Number(rate) : null,
        rate_type:       effRateType,
        flat_amount:     effRateType === 'flat' ? flatAmt : null,
        address:         addr    || null,
        latitude:        geoCoords?.lat || null,
        longitude:       geoCoords?.lng || null,
        wo_title:        woTitle || null,
        travel_reimb:    travel,
        assignment_id:   state.pendingTripAssignment || prefillExtras.assignment_id || null,
        site_id:         prefillExtras.site_id || null,
        ticket_num:      prefillExtras.ticket_num || null,
        inc_num:         prefillExtras.inc_num || null,
        mod_name:        prefillExtras.mod_name || null,
        noc_name:        prefillExtras.noc_name || null,
        pm_pc_name:      prefillExtras.pm_pc_name || null,
        project_id:      projectSel ? Number(projectSel) : null,
        revisit_of:      prefillExtras.revisit_of || null,
        status:          'pending',
      });
      if (prefillExtras.plannedJobId) {
        try { await api.deletePlannedJob(prefillExtras.plannedJobId); } catch { /* non-critical */ }
      }
      state.pendingTripAssignment = null;
      state.pendingTripClockIn = null;
      // pendingTripId is intentionally NOT cleared here — it must survive
      // until the user saves Assignment ID on the active clock page, which
      // then calls reassignTrip() to update the trip's files and clears it.
      state.showReminderBanner = false;
      state.showBreakReturnBanner = false;
      scheduleBreakReminder();
      renderActiveClockPage();
    } catch (err) {
      showToast(err.message || 'Error', 'error');
      renderTimeSelector('clockin-time-selector', 'Clock-in time', doClockIn, tripTimeOpts);
    }
  }

  renderTimeSelector('clockin-time-selector', 'Clock-in time', doClockIn, tripTimeOpts);
}

/* ── Planned jobs mini-schedule ──────────────────────────────────── */
function plannedDayLabel(iso) {
  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function openPlannedScheduleModal(applyPlannedJob) {
  const jobs = state.plannedJobs || [];
  const byDay = {};
  jobs.forEach(pj => {
    const k = pj.planned_date || '';
    (byDay[k] = byDay[k] || []).push(pj);
  });
  const dayKeys = Object.keys(byDay).sort((a, b) => {
    if (!a) return 1; if (!b) return -1;   // undated last
    return a.localeCompare(b);
  });

  openModal(`
    <div class="modal-header">
      <h3>${svg('bell')} Planned Jobs</h3>
      <button class="btn btn-ghost btn-sm" id="ps-x">✕</button>
    </div>
    <div class="modal-body">
      ${dayKeys.map(k => `
        <div class="day-group" style="margin-left:0;">
          <div class="day-group-header">${k ? plannedDayLabel(k) : 'Unscheduled'}</div>
          ${byDay[k].map(pj => `
            <div class="card" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${pj.revisit_of ? '<span style="color:var(--blue);font-size:11px;font-weight:700;">REV</span> ' : ''}${escHtml(pj.wo_title || pj.assignment_id || 'Planned job')}
                </div>
                <div class="field-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${[pj.org_name, pj.client_name, pj.project_name].filter(Boolean).map(escHtml).join(' · ') || '&nbsp;'}</div>
              </div>
              <button class="btn btn-primary btn-sm ps-start" data-id="${pj.id}">${svg('play')}</button>
              <button class="btn btn-ghost btn-sm ps-del" data-id="${pj.id}" style="color:var(--red);">✕</button>
            </div>`).join('')}
        </div>`).join('') || '<div class="empty-state">No planned jobs</div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="ps-close">Close</button>
      <button class="btn btn-primary" id="ps-add">${svg('plus')} Plan a Job</button>
    </div>`);

  document.getElementById('ps-x').addEventListener('click', closeModal);
  document.getElementById('ps-close').addEventListener('click', closeModal);
  document.getElementById('ps-add').addEventListener('click', () => { closeModal(); openPlanJobModal(); });

  document.querySelectorAll('.ps-start').forEach(btn => {
    btn.addEventListener('click', () => {
      const pj = (state.plannedJobs || []).find(p => p.id === Number(btn.dataset.id));
      if (!pj) return;
      closeModal();
      if (applyPlannedJob) applyPlannedJob(pj);
    });
  });
  document.querySelectorAll('.ps-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this planned job?')) return;
      try {
        await api.deletePlannedJob(Number(btn.dataset.id));
        closeModal();
        renderIdleClockPage();
      } catch (err) { showToast(err.message || 'Delete failed', 'error'); }
    });
  });
}

/* ── Plan a Job modal ────────────────────────────────────────────── */
function buildJobFieldsHtml(prefix, sym) {
  const orgOpts  = state.organizations.map(o => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  const cliOpts  = state.clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  const rateOpts = state.payRates.map(r => `<option value="${r.id}">${escHtml(r.name)} — ${sym}${r.rate}/hr</option>`).join('');
  return `
    <div class="form-group">
      <label class="form-label">WO Title</label>
      <input type="text" class="form-control" id="${prefix}-title" placeholder="Brief description...">
    </div>
    <div class="row-2">
      <div class="form-group">
        <label class="form-label">Company</label>
        <select class="form-control" id="${prefix}-org"><option value="">—</option>${orgOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Customer</label>
        <select class="form-control" id="${prefix}-client"><option value="">—</option>${cliOpts}</select>
      </div>
    </div>
    <div class="row-2">
      <div class="form-group">
        <label class="form-label">Assignment ID</label>
        <input type="text" class="form-control" id="${prefix}-assign">
      </div>
      <div class="form-group">
        <label class="form-label">Site ID</label>
        <input type="text" class="form-control" id="${prefix}-site">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Address</label>
      <input type="text" class="form-control" id="${prefix}-addr">
    </div>
    <div class="form-group">
      <label class="form-label">Pay Type</label>
      <div class="toggle-group" id="${prefix}-paytype">
        <button type="button" class="toggle-btn active" data-type="hourly">Hourly</button>
        <button type="button" class="toggle-btn" data-type="flat">Flat</button>
      </div>
    </div>
    <div class="form-group" id="${prefix}-hourly-group">
      <label class="form-label">Hourly Rate</label>
      <select class="form-control" id="${prefix}-rate"><option value="">—</option>${rateOpts}</select>
    </div>
    <div class="form-group hidden" id="${prefix}-flat-group">
      <label class="form-label">Flat Rate</label>
      <div class="money-wrap"><span class="money-sym">${sym}</span>
        <input type="number" class="form-control" id="${prefix}-flat" min="0" step="0.01"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Travel Reimbursement</label>
      <div class="money-wrap"><span class="money-sym">${sym}</span>
        <input type="number" class="form-control" id="${prefix}-travel" min="0" step="0.01"></div>
    </div>`;
}

function wireJobFieldsPayType(prefix) {
  let t = 'hourly';
  document.getElementById(`${prefix}-paytype`).addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    t = btn.dataset.type;
    document.querySelectorAll(`#${prefix}-paytype .toggle-btn`).forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById(`${prefix}-hourly-group`).classList.toggle('hidden', t !== 'hourly');
    document.getElementById(`${prefix}-flat-group`).classList.toggle('hidden', t !== 'flat');
  });
  return () => t;
}

function readJobFields(prefix, getRateType) {
  const g = id => document.getElementById(`${prefix}-${id}`);
  const rt = getRateType();
  return {
    wo_title:        g('title').value.trim() || null,
    organization_id: g('org').value ? Number(g('org').value) : null,
    client_id:       g('client').value ? Number(g('client').value) : null,
    assignment_id:   g('assign').value.trim() || null,
    site_id:         g('site').value.trim() || null,
    address:         g('addr').value.trim() || null,
    rate_type:       rt,
    pay_rate_id:     (rt === 'hourly' && g('rate').value) ? Number(g('rate').value) : null,
    flat_amount:     rt === 'flat' ? (parseFloat(g('flat').value) || null) : null,
    travel_reimb:    parseFloat(g('travel').value) || null,
  };
}

function openPlanJobModal() {
  const sym = state.settings.currency_symbol || '$';
  const projOpts = (state.projects || []).map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  openModal(`
    <div class="modal-header">
      <h3>${svg('plus')} Plan a Job</h3>
      <button class="btn btn-ghost btn-sm" id="pj-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Planned Date <span class="opt-label">optional</span></label>
        <input type="date" class="form-control" id="pj-date">
      </div>
      <div class="form-group">
        <label class="form-label">Project <span class="opt-label">optional</span></label>
        <select class="form-control" id="pj-project"><option value="">— No Project —</option>${projOpts}</select>
      </div>
      ${buildJobFieldsHtml('pj', sym)}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="pj-cancel">Cancel</button>
      <button class="btn btn-primary" id="pj-save">${svg('check')} Save Planned Job</button>
    </div>`);

  document.getElementById('pj-x').addEventListener('click', closeModal);
  document.getElementById('pj-cancel').addEventListener('click', closeModal);
  const getRateType = wireJobFieldsPayType('pj');

  document.getElementById('pj-save').addEventListener('click', async () => {
    const data = readJobFields('pj', getRateType);
    if (!data.wo_title && !data.assignment_id) { showToast('Add at least a WO Title or Assignment ID', 'error'); return; }
    data.project_id = document.getElementById('pj-project').value ? Number(document.getElementById('pj-project').value) : null;
    data.planned_date = document.getElementById('pj-date').value || null;
    try {
      await api.createPlannedJob(data);
      closeModal();
      showToast('Job planned', 'success');
      renderIdleClockPage();
    } catch (err) { showToast(err.message || 'Save failed', 'error'); }
  });
}

/* ── Projects modal ──────────────────────────────────────────────── */
function openProjectsModal() {
  const sym = state.settings.currency_symbol || '$';
  const projects = state.projects || [];
  const projList = projects.length ? projects.map(p => {
    let d = {};
    try { d = JSON.parse(p.defaults || '{}') || {}; } catch {}
    const setKeys = Object.keys(d).filter(k => d[k] != null && d[k] !== '');
    return `
    <div class="card" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:6px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${escHtml(p.name)}</div>
        <div class="field-hint">${setKeys.length ? `Auto-fills: ${setKeys.join(', ')}` : 'No defaults set'}</div>
      </div>
      <button class="btn btn-ghost btn-sm proj-del" data-id="${p.id}" style="color:var(--red);">${svg('trash')}</button>
    </div>`;
  }).join('') : '<div class="empty-state" style="padding:12px;">No projects yet</div>';

  openModal(`
    <div class="modal-header">
      <h3>${svg('org')} Projects</h3>
      <button class="btn btn-ghost btn-sm" id="prj-x">✕</button>
    </div>
    <div class="modal-body">
      ${projList}
      <div class="divider" style="margin:12px 0;"></div>
      <div class="subsection-label">New Project</div>
      <div class="form-group" style="margin-top:8px;">
        <label class="form-label">Project Name <span class="req-star">*</span></label>
        <input type="text" class="form-control" id="prj-name" placeholder="e.g. Store rollout Q3">
      </div>
      <div class="field-hint" style="margin-bottom:8px;">Fill any fields below — they will auto-fill each new WO in this project.</div>
      ${buildJobFieldsHtml('prj', sym)}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="prj-cancel">Close</button>
      <button class="btn btn-primary" id="prj-save">${svg('check')} Create Project</button>
    </div>`);

  document.getElementById('prj-x').addEventListener('click', closeModal);
  document.getElementById('prj-cancel').addEventListener('click', closeModal);
  const getRateType = wireJobFieldsPayType('prj');

  document.querySelectorAll('.proj-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this project? Entries keep their data, only the grouping is removed.')) return;
      try {
        await api.deleteProject(Number(btn.dataset.id));
        state.projects = await api.getProjects();
        closeModal();
        openProjectsModal();
      } catch (err) { showToast(err.message || 'Delete failed', 'error'); }
    });
  });

  document.getElementById('prj-save').addEventListener('click', async () => {
    const name = document.getElementById('prj-name').value.trim();
    if (!name) { showToast('Project name is required', 'error'); return; }
    const defaults = readJobFields('prj', getRateType);
    // Keep only fields that were actually filled in
    Object.keys(defaults).forEach(k => {
      if (defaults[k] == null || defaults[k] === '' || (k === 'rate_type' && defaults[k] === 'hourly' && !defaults.pay_rate_id)) delete defaults[k];
    });
    try {
      await api.createProject({ name, defaults });
      closeModal();
      showToast('Project created', 'success');
      renderIdleClockPage();
    } catch (err) { showToast(err.message || 'Save failed', 'error'); }
  });
}

/* ── Revisit modal ───────────────────────────────────────────────── */
function openRevisitModal(entry) {
  // Address / Company / Customer / Project / Site ID / WO Title (REV | ...)
  // are carried automatically; extra fields are behind "Import more".
  const EXTRA = [
    { key: 'pay',          label: 'Pay Type & Rate', has: true },
    { key: 'travel_reimb', label: 'Travel Reimb',    has: entry.travel_reimb != null && entry.travel_reimb !== '' },
    { key: 'ticket_num',   label: 'Ticket #',        has: !!entry.ticket_num },
    { key: 'inc_num',      label: 'INC #',           has: !!entry.inc_num },
    { key: 'mod_name',     label: 'MOD Name',        has: !!entry.mod_name },
    { key: 'noc_name',     label: 'NOC Name',        has: !!entry.noc_name },
    { key: 'pm_pc_name',   label: 'PM/PC Name',      has: !!entry.pm_pc_name },
  ].filter(f => f.has);

  const hasAssign = !!entry.assignment_id;
  const revTitle = entry.wo_title ? `REV | ${entry.wo_title.replace(/^REV \| /, '')}` : '';

  openModal(`
    <div class="modal-header">
      <h3>${svg('return')} Revisit</h3>
      <button class="btn btn-ghost btn-sm" id="rv-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="field-hint" style="margin-bottom:10px;">
        Carrying over automatically: <b>Address, Company, Customer, Project, Site ID${revTitle ? `, WO Title ("${escHtml(revTitle)}")` : ''}</b>
      </div>
      ${EXTRA.length ? `
      <button class="btn btn-ghost btn-sm" id="rv-more-toggle" style="margin-bottom:8px;">${svg('plus')} Import more...</button>
      <div id="rv-more" class="hidden" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:12px;">
        ${EXTRA.map(f => `
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
            <input type="checkbox" class="rv-field" data-key="${f.key}"> ${escHtml(f.label)}
          </label>`).join('')}
      </div>` : ''}
      <div class="divider"></div>
      <div class="form-group" style="margin-top:10px;">
        <label class="form-label">Assignment ID</label>
        ${hasAssign ? `
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;cursor:pointer;">
          <input type="radio" name="rv-assign-mode" value="same" checked>
          Same as original → <b>${escHtml(entry.assignment_id)}-R</b>
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;cursor:pointer;">
          <input type="radio" name="rv-assign-mode" value="new"> New Assignment ID:
        </label>` : ''}
        <input type="text" class="form-control ${hasAssign ? 'hidden' : ''}" id="rv-assign-input" placeholder="e.g. 171624976">
      </div>
      <div class="form-group hidden" id="rv-date-group">
        <label class="form-label">Planned date</label>
        <input type="date" class="form-control" id="rv-date">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="rv-cancel">Cancel</button>
      <button class="btn btn-secondary" id="rv-plan">${svg('plus')} Plan for Later</button>
      <button class="btn btn-primary" id="rv-go">${svg('clock')} Clock In Now</button>
    </div>`);

  document.getElementById('rv-x').addEventListener('click', closeModal);
  document.getElementById('rv-cancel').addEventListener('click', closeModal);
  document.getElementById('rv-more-toggle')?.addEventListener('click', () => {
    document.getElementById('rv-more').classList.toggle('hidden');
  });

  document.querySelectorAll('input[name="rv-assign-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const isNew = document.querySelector('input[name="rv-assign-mode"]:checked')?.value === 'new';
      document.getElementById('rv-assign-input').classList.toggle('hidden', !isNew);
      if (isNew) document.getElementById('rv-assign-input').focus();
    });
  });

  const buildRevisit = () => {
    const rv = {
      address:         entry.address || null,
      organization_id: entry.organization_id || null,
      client_id:       entry.client_id || null,
      project_id:      entry.project_id || null,
      site_id:         entry.site_id || null,
      wo_title:        revTitle || null,
      revisit_of:      entry.id,
    };
    const picked = new Set([...document.querySelectorAll('.rv-field:checked')].map(c => c.dataset.key));
    if (picked.has('travel_reimb')) rv.travel_reimb = entry.travel_reimb;
    if (picked.has('ticket_num'))   rv.ticket_num = entry.ticket_num;
    if (picked.has('inc_num'))      rv.inc_num = entry.inc_num;
    if (picked.has('mod_name'))     rv.mod_name = entry.mod_name;
    if (picked.has('noc_name'))     rv.noc_name = entry.noc_name;
    if (picked.has('pm_pc_name'))   rv.pm_pc_name = entry.pm_pc_name;
    if (picked.has('pay')) {
      rv.rate_type = entry.rate_type || 'hourly';
      rv.pay_rate_id = entry.pay_rate_id;
      rv.flat_amount = entry.flat_amount;
    }
    const mode = document.querySelector('input[name="rv-assign-mode"]:checked')?.value;
    if (hasAssign && mode === 'same') {
      rv.assignment_id = `${entry.assignment_id}-R`;
    } else {
      rv.assignment_id = document.getElementById('rv-assign-input').value.trim() || null;
    }
    return rv;
  };

  document.getElementById('rv-go').addEventListener('click', () => {
    if (state.currentEntry) { showToast('Clock out of the current job first', 'error'); return; }
    state.pendingRevisit = buildRevisit();
    closeModal();
    navigateTo('clock');
  });

  // Plan for Later → creates a planned job (asks for a date on first tap)
  document.getElementById('rv-plan').addEventListener('click', async () => {
    const dateGroup = document.getElementById('rv-date-group');
    if (dateGroup.classList.contains('hidden')) {
      dateGroup.classList.remove('hidden');
      document.getElementById('rv-date').focus();
      return;
    }
    const rv = buildRevisit();
    rv.planned_date = document.getElementById('rv-date').value || null;
    try {
      await api.createPlannedJob(rv);
      closeModal();
      showToast('Revisit planned', 'success');
    } catch (err) { showToast(err.message || 'Save failed', 'error'); }
  });
}

/* ── Active trip page ────────────────────────────────────────────── */
function renderActiveTripPage() {
  const trip = state.currentTrip;
  if (!trip) { renderIdleClockPage(); return; }

  clearTimers();

  const paused = !!trip.active_pause;
  const startEl = new Date(trip.start_time);
  const pausedSince = paused ? new Date(trip.active_pause.pause_start) : null;

  document.getElementById('page').innerHTML = `
    <div class="clock-hero" style="border-bottom:2px solid ${paused ? 'var(--orange)' : 'var(--blue)'};">
      <div class="status-badge ${paused ? 'on-break' : 'working'}" style="${paused
        ? 'background:var(--orange-bg);color:var(--orange);border-color:var(--orange);'
        : 'background:var(--blue-bg);color:var(--blue);border-color:var(--blue);'}">
        <span class="dot" style="background:${paused ? 'var(--orange)' : 'var(--blue)'};"></span>
        ${paused ? 'TRIP PAUSED' : 'TRIP ACTIVE'}
      </div>
      <div class="elapsed-time" id="trip-elapsed-display">00:00:00</div>
      <div class="clock-meta">
        ${svg('car')} ${escHtml(trip.category)}
        ${trip.assignment_id ? ` &nbsp;·&nbsp; ${escHtml(trip.assignment_id)}` : ''}
      </div>
      <div class="clock-meta" style="margin-top:4px;">
        Started ${fmtTime(trip.start_time)}
        ${trip.mileage_start != null ? ` &nbsp;·&nbsp; Start: ${trip.mileage_start} mi` : ''}
      </div>
    </div>
    <div class="clock-actions" style="flex-direction:column;gap:10px;padding:20px 16px;">
      ${!paused ? `<button class="btn btn-primary btn-lg" id="atp-main-action">
        ${trip.category === 'In Route to WO' ? `${svg('clock')} Clock In` : `${svg('stop')} Finish Trip`}
      </button>` : ''}
      <button class="btn ${paused ? 'btn-primary' : 'btn-orange'} btn-lg" id="atp-pause">
        ${paused ? `${svg('return')} Resume Trip` : `${svg('pause')} Pause Trip`}
      </button>
      <button class="btn btn-secondary btn-lg" id="atp-reassign">${svg('car')} Reassign Trip</button>
      <button class="btn btn-danger btn-lg" id="atp-cancel">${svg('trash')} Cancel Trip</button>
      ${state.currentEntry ? `<button class="btn btn-ghost btn-lg" id="atp-back-to-work">${svg('return')} Back to Work</button>` : ''}
    </div>`;

  const update = () => {
    const el = document.getElementById('trip-elapsed-display');
    if (!el) return;
    let elapsed = Math.floor((Date.now() - startEl) / 1000);
    elapsed -= (trip.total_pause_seconds || 0);
    if (paused && pausedSince) elapsed -= Math.floor((Date.now() - pausedSince) / 1000);
    el.textContent = fmtDuration(Math.max(0, elapsed));
  };
  update();
  state.tripTimerInterval = setInterval(update, 1000);

  document.getElementById('atp-pause').addEventListener('click', async () => {
    const btn = document.getElementById('atp-pause');
    btn.disabled = true;
    try {
      if (paused) {
        await api.endTripPause(trip.id, { pause_end: new Date().toISOString() });
      } else {
        await api.startTripPause(trip.id, { pause_start: new Date().toISOString() });
      }
      state.currentTrip = await api.getCurrentTrip().catch(() => null);
      clearInterval(state.tripTimerInterval);
      state.tripTimerInterval = null;
      renderActiveTripPage();
    } catch (err) {
      showToast(err.message || 'Failed to update pause', 'error');
      btn.disabled = false;
    }
  });

  document.getElementById('atp-cancel').addEventListener('click', async () => {
    if (!confirm('Cancel this trip? All trip data and photos will be deleted.')) return;
    try {
      await api.deleteTrip(trip.id);
      state.currentTrip = null;
      clearInterval(state.tripTimerInterval);
      state.tripTimerInterval = null;
      if (state.currentEntry) renderActiveClockPage();
      else renderIdleClockPage();
    } catch (err) {
      showToast(err.message || 'Failed to cancel trip', 'error');
    }
  });

  document.getElementById('atp-reassign').addEventListener('click', () => {
    openReassignTripModal(trip);
  });

  document.getElementById('atp-main-action')?.addEventListener('click', () => {
    if (trip.category === 'In Route to WO') {
      openTripClockInModal(trip);
    } else {
      openTripStopModal(trip);
    }
  });

  document.getElementById('atp-back-to-work')?.addEventListener('click', () => {
    renderActiveClockPage();
  });
}

function openReassignTripModal(trip) {
  const clocked = !!state.currentEntry;
  const allCats = state.tripCategories;
  const cats = allCats.filter(c => {
    if (clocked) return c.name === 'OnClock Tools/Supplies' || c.name === 'Other';
    return c.name !== 'OnClock Tools/Supplies';
  });

  let selectedCat = trip.category;
  if (!cats.find(c => c.name === selectedCat)) selectedCat = cats[0]?.name || trip.category;
  const isInRoute = () => selectedCat === 'In Route to WO';
  const hasAssignId = !!(trip.assignment_id);

  const catBtnsHtml = cats.map(c =>
    `<button class="trip-cat-btn${c.name === selectedCat ? ' active' : ''}" data-cat="${escHtml(c.name)}">${escHtml(c.name)}</button>`
  ).join('');

  openModal(`
    <div class="modal-header">
      <h3>${svg('car')} Reassign Trip</h3>
      <button class="btn btn-ghost btn-sm" id="ra-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Category</label>
        <div class="trip-cat-grid" id="ra-cat-grid">${catBtnsHtml}</div>
      </div>
      <div class="form-group" id="ra-assignment-group" style="${isInRoute() ? '' : 'display:none;'}">
        <label class="form-label">Assignment ID <span class="req-star">*</span></label>
        <div class="input-row">
          <input type="text" class="form-control" id="ra-assignment" value="${escHtml(trip.assignment_id || '')}"
            placeholder="e.g. ABC-12345" ${!hasAssignId ? 'disabled' : ''}>
          <label style="display:flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap;cursor:pointer;">
            <input type="checkbox" id="ra-add-later" ${!hasAssignId ? 'checked' : ''}> Add Later
          </label>
        </div>
        <div id="ra-assignment-hint" class="field-hint hidden" style="color:var(--orange);">Enter Assignment ID or check "Add Later"</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="ra-cancel">Cancel</button>
      <button class="btn btn-primary" id="ra-save">Save</button>
    </div>`);

  document.getElementById('ra-x').addEventListener('click', closeModal);
  document.getElementById('ra-cancel').addEventListener('click', closeModal);

  document.getElementById('ra-cat-grid').addEventListener('click', e => {
    const btn = e.target.closest('.trip-cat-btn');
    if (!btn) return;
    selectedCat = btn.dataset.cat;
    document.querySelectorAll('#ra-cat-grid .trip-cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('ra-assignment-group').style.display = isInRoute() ? '' : 'none';
    document.getElementById('ra-assignment-hint').classList.add('hidden');
  });

  document.getElementById('ra-add-later')?.addEventListener('change', e => {
    const inp = document.getElementById('ra-assignment');
    if (!inp) return;
    inp.disabled = e.target.checked;
    if (e.target.checked) { inp.value = ''; document.getElementById('ra-assignment-hint').classList.add('hidden'); }
  });

  document.getElementById('ra-save').addEventListener('click', async () => {
    const addLater = document.getElementById('ra-add-later')?.checked ?? false;
    const rawAssign = document.getElementById('ra-assignment')?.value.trim() || '';
    if (isInRoute() && !addLater && !rawAssign) {
      document.getElementById('ra-assignment-hint').classList.remove('hidden');
      document.getElementById('ra-assignment').focus();
      return;
    }
    const assignId = isInRoute() && !addLater ? rawAssign || null : null;
    const saveBtn = document.getElementById('ra-save');
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const updated = await api.reassignTrip(trip.id, { category: selectedCat, assignment_id: assignId });
      state.currentTrip = updated;
      closeModal();
      renderActiveTripPage();
    } catch (err) {
      showToast(err.message || 'Failed to reassign', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

function openTripClockInModal(trip) {
  const rate = parseFloat(state.settings.mileage_rate || '0.67');
  const sym = state.settings.currency_symbol || '$';
  let afterPhotoData = null;

  const calcHtml = (val) => {
    if (trip.mileage_start == null || !val) return '';
    const dist = parseFloat(val) - trip.mileage_start;
    if (dist < 0) return `<div style="color:var(--red);font-size:13px;margin-top:4px;">⚠ End must be ≥ start (${trip.mileage_start})</div>`;
    return `<div class="review-row" style="margin-top:6px;font-size:13px;"><span>Miles driven:</span><b>${dist.toFixed(2)} mi</b></div>
            <div class="review-row" style="font-size:13px;"><span>Tax deduction:</span><b>${sym}${(dist * rate).toFixed(2)}</b></div>`;
  };

  openModal(`
    <div class="modal-header">
      <h3>${svg('clock')} Clock In from Trip</h3>
      <button class="btn btn-ghost btn-sm" id="tci-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="review-row" style="margin-bottom:6px;"><span>Category:</span><span>${escHtml(trip.category)}</span></div>
      ${trip.assignment_id ? `<div class="review-row" style="margin-bottom:6px;"><span>Assignment:</span><span>${escHtml(trip.assignment_id)}</span></div>` : ''}
      <div class="review-row" style="margin-bottom:10px;"><span>Mileage start:</span><span>${trip.mileage_start != null ? trip.mileage_start + ' mi' : '—'}</span></div>
      <div class="form-group">
        <label class="form-label">Mileage End <span class="req-star">*</span></label>
        <input type="number" class="form-control" id="tci-mileage-end" placeholder="e.g. 45278.5" min="0" step="0.1">
        <div id="tci-calc"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Mileage Photo (After) <span class="opt-label">optional</span></label>
        <label class="photo-add-btn" for="tci-photo-inp">
          ${svg('camera')} <span id="tci-photo-txt">Add Photo</span>
        </label>
        <input type="file" accept="image/*" class="visually-hidden" id="tci-photo-inp">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="tci-cancel">Cancel</button>
      <button class="btn btn-primary" id="tci-confirm">${svg('clock')} Stop Trip &amp; Clock In</button>
    </div>`);

  document.getElementById('tci-x').addEventListener('click', closeModal);
  document.getElementById('tci-cancel').addEventListener('click', closeModal);

  document.getElementById('tci-mileage-end').addEventListener('input', e => {
    document.getElementById('tci-calc').innerHTML = calcHtml(e.target.value);
  });

  document.getElementById('tci-photo-inp').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      afterPhotoData = await compressFileToBase64(file);
      document.getElementById('tci-photo-txt').textContent = '✓ ' + file.name;
    } catch (err) { showToast('Photo error: ' + err.message, 'error'); }
  });

  document.getElementById('tci-confirm').addEventListener('click', async () => {
    const milEndVal = document.getElementById('tci-mileage-end').value.trim();
    if (!milEndVal) { showToast('Mileage end is required', 'error'); return; }
    const confirmBtn = document.getElementById('tci-confirm');
    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Stopping trip...';
      const nowIso = new Date().toISOString();
      const stopped = await api.stopTrip(trip.id, {
        end_time: nowIso,
        mileage_end: parseFloat(milEndVal),
      });
      if (afterPhotoData) await uploadTripPhotoData(stopped.id, 'after', afterPhotoData);
      state.pendingTripAssignment = trip.assignment_id || null;
      state.pendingTripClockIn = nowIso;
      state.pendingTripId = trip.assignment_id ? null : trip.id;
      state.currentTrip = null;
      clearInterval(state.tripTimerInterval);
      state.tripTimerInterval = null;
      closeModal();
      renderIdleClockPage();
    } catch (err) {
      showToast(err.message || 'Failed to stop trip', 'error');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `${svg('clock')} Stop Trip &amp; Clock In`;
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
      ${entry.rate_type === 'none'
        ? `<div class="earning-rate" style="margin-top:4px;">Non-Billable Visit</div>`
        : isFlat && entry.flat_amount
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
    <div style="display:flex;justify-content:flex-end;padding:0 16px 4px;">
      <button class="btn btn-secondary btn-sm" id="onclock-trip-btn">${svg('car')} Trip</button>
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
      <div class="form-group">
        <label class="form-label">Ticket # <span class="opt-label">optional</span></label>
        ${buildMultiInputs('jd-tickets', entry.ticket_num || '')}
      </div>
      <div class="form-group">
        <label class="form-label">INC # <span class="opt-label">optional</span></label>
        <input type="text" class="form-control" id="jd-inc" value="${escHtml(entry.inc_num||'')}">
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
        ${buildMultiInputs('jd-mods', entry.mod_name || '', 'Required')}
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
      <div class="subsection-label">Before</div>
      <div id="photos-before" class="photo-sections-group">
        <div class="photo-section-loading">${svg('camera')} Loading…</div>
      </div>
      <div class="divider"></div>
      <div class="form-group" style="margin-bottom:8px;">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Add Issues?</label>
          <label class="switch"><input type="checkbox" id="jd-issues-toggle"><span class="slider"></span></label>
        </div>
      </div>
      <div id="photos-issues-wrap" class="hidden">
        <div id="photos-issues" class="photo-sections-group">
          <div class="photo-section-loading">${svg('camera')} Loading…</div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:8px;">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Add Add. Info?</label>
          <label class="switch"><input type="checkbox" id="jd-addinfo-toggle"><span class="slider"></span></label>
        </div>
      </div>
      <div id="photos-addinfo-wrap" class="hidden">
        <div id="photos-add-info" class="photo-sections-group">
          <div class="photo-section-loading">${svg('camera')} Loading…</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="subsection-label">After</div>
      <div id="photos-after" class="photo-sections-group">
        <div class="photo-section-loading">${svg('camera')} Loading…</div>
      </div>
      <div class="divider"></div>
      <div class="subsection-label">Work Order</div>
      <div id="photos-work-order" class="photo-sections-group">
        <div class="photo-section-loading">${svg('camera')} Loading…</div>
      </div>
      <div class="divider"></div>
      <div class="subsection-label">Sign Off</div>
      <div id="photos-sign-off" class="photo-sections-group">
        <div class="photo-section-loading">${svg('camera')} Loading…</div>
      </div>
      <div id="custom-photo-sections"></div>
      <button class="btn btn-ghost btn-sm" id="add-custom-photo-field" style="margin-top:6px;">${svg('plus')} Add Picture Field</button>
      <div class="divider"></div>
      <div class="form-group" style="margin-bottom:8px;">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Equipment left on site?</label>
          <label class="switch"><input type="checkbox" id="jd-equipment-toggle"><span class="slider"></span></label>
        </div>
      </div>
      <div id="photos-equipment-wrap" class="hidden">
        <div id="photos-equipment" class="photo-sections-group">
          <div class="photo-section-loading">${svg('camera')} Loading…</div>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px;">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Removal / Replacement?</label>
          <label class="switch"><input type="checkbox" id="jd-replacement" ${entry.is_replacement?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="replacement-fields" class="${entry.is_replacement?'':'hidden'}">
        <div id="photos-new-serial" class="photo-sections-group">
          <div class="photo-section-loading">${svg('camera')} Loading…</div>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label class="form-label">Return Track #</label>
          <div class="input-row">
            <input type="text" class="form-control" id="jd-return-track" value="${escHtml(entry.return_track||'')}" ${entry.no_return_track?'disabled':''}>
            <label class="btn btn-ghost btn-sm" title="Add Return Track photo" style="flex-shrink:0;">
              ${svg('camera')}
              <input type="file" accept="image/*" class="visually-hidden" id="jd-return-photo-inp">
            </label>
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
        <label class="form-label">Amount</label>
        <div class="money-wrap">
          <span class="money-sym">${sym}</span>
          <input type="number" class="form-control" id="parking-amount" min="0" step="0.01" value="${escHtml(String(entry.parking_tolls||''))}">
        </div>
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
        await autoSaveActiveForm();
        await api.endBreak(entry.id, { break_end: new Date().toISOString() });
        state.currentEntry = await api.getCurrentEntry();
        state.showBreakReturnBanner = false;
        clearTimeout(state.breakReturnTimeout);
        clearTimers();
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
        await autoSaveActiveForm();
        const b = await api.startBreak(entry.id, { break_start: new Date().toISOString() });
        state.currentEntry = { ...entry, active_break: b };
        state.showReminderBanner = false;
        clearTimeout(state.reminderTimeout);
        clearTimers();
        renderActiveClockPage();
      } catch (e) { showToast(e.message, 'error'); }
    });
  }
  document.getElementById('take-break-reminder')?.addEventListener('click', () => document.getElementById('start-break-btn')?.click());

  document.getElementById('clockout-btn').addEventListener('click', async () => {
    await autoSaveActiveForm();
    initiateClockOut(entry);
  });

  document.getElementById('onclock-trip-btn').addEventListener('click', async () => {
    if (state.currentTrip) {
      renderActiveTripPage();
    } else {
      openTripStartModal();
    }
  });

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
  document.getElementById('save-assignment-btn').addEventListener('click', async () => {
    const newAssignId = document.getElementById('jd-assignment').value.trim() || null;
    await saveSection(entry, {
      wo_title:        document.getElementById('jd-wo-title').value.trim() || null,
      organization_id: document.getElementById('jd-company').value ? Number(document.getElementById('jd-company').value) : null,
      client_id:       document.getElementById('jd-customer').value ? Number(document.getElementById('jd-customer').value) : null,
      site_id:         document.getElementById('jd-site-id').value.trim() || null,
      assignment_id:   newAssignId,
      ticket_num:      readMultiInputs('jd-tickets'),
      inc_num:         document.getElementById('jd-inc').value.trim() || null,
    });
    if (newAssignId && state.pendingTripId) {
      try {
        await api.reassignTrip(state.pendingTripId, { category: 'In Route to WO', assignment_id: newAssignId });
        state.pendingTripId = null;
        showToast('Trip linked to WO', 'success');
      } catch { /* non-critical */ }
    }
  });

  // POCs save
  document.getElementById('save-pocs-btn').addEventListener('click', () => saveSection(entry, {
    mod_name:  readMultiInputs('jd-mods'),
    noc_name:  document.getElementById('jd-noc').value.trim() || null,
    pm_pc_name:document.getElementById('jd-pmpc').value.trim() || null,
  }));

  wireMultiInputs('jd-tickets');
  wireMultiInputs('jd-mods');

  // Optional picture-section toggles
  const wireSectionToggle = (toggleId, wrapId) => {
    document.getElementById(toggleId)?.addEventListener('change', e => {
      document.getElementById(wrapId)?.classList.toggle('hidden', !e.target.checked);
    });
  };
  wireSectionToggle('jd-issues-toggle', 'photos-issues-wrap');
  wireSectionToggle('jd-addinfo-toggle', 'photos-addinfo-wrap');
  wireSectionToggle('jd-equipment-toggle', 'photos-equipment-wrap');

  // Return Track photo
  document.getElementById('jd-return-photo-inp')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadPhoto(entry.id, file, 'return_track', 'Return-Track');
      showToast('Return track photo saved', 'success');
    } catch (err) { showToast(err.message || 'Upload failed', 'error'); }
    e.target.value = '';
  });

  // Custom picture fields
  document.getElementById('add-custom-photo-field')?.addEventListener('click', async () => {
    const name = (prompt('Picture field name:') || '').trim();
    if (!name) return;
    const fields = getCustomPhotoFields();
    if (fields.some(f => f.toLowerCase() === name.toLowerCase())) { showToast('Field already exists', 'error'); return; }
    fields.push(name);
    try {
      await api.saveSettings({ custom_photo_fields: JSON.stringify(fields) });
      state.settings.custom_photo_fields = JSON.stringify(fields);
      await autoSaveActiveForm();
      renderActiveClockPage();
    } catch (err) { showToast(err.message || 'Failed to add field', 'error'); }
  });

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

  // Pictures: event delegation + load photos
  const picSection = document.getElementById('sec-pictures');
  setupPictureSectionEvents(picSection, entry.id);
  (async () => {
    try {
      const photos = await api.getPhotos(entry.id);
      const grouped = { before: [], serial_before: [], issues: [], add_info: [], after: [], work_order: [], sign_off: [], equipment_left: [], new_serial: [] };
      photos.forEach(p => { (grouped[p.photo_type] = grouped[p.photo_type] || []).push(p); });
      document.getElementById('photos-before').innerHTML =
        buildPhotoSection('before', 'Before Photo', grouped.before) +
        buildPhotoSection('serial_before', 'Serial Numbers', grouped.serial_before);
      document.getElementById('photos-issues').innerHTML =
        buildPhotoSection('issues', 'Issues', grouped.issues);
      document.getElementById('photos-add-info').innerHTML =
        buildPhotoSection('add_info', 'Add. Info', grouped.add_info);
      document.getElementById('photos-after').innerHTML =
        buildPhotoSection('after', 'After Photo', grouped.after);
      document.getElementById('photos-work-order').innerHTML =
        buildPhotoSection('work_order', 'Work Order', grouped.work_order, { pdf: true });
      document.getElementById('photos-sign-off').innerHTML =
        buildPhotoSection('sign_off', 'Sign Off', grouped.sign_off, { pdf: true });
      document.getElementById('photos-equipment').innerHTML =
        buildPhotoSection('equipment_left', 'Equipment Left', grouped.equipment_left);
      document.getElementById('photos-new-serial').innerHTML =
        buildPhotoSection('new_serial', 'New Serial Numbers', grouped.new_serial);
      // User-defined custom picture fields (stored in settings)
      const customFields = getCustomPhotoFields();
      const customBox = document.getElementById('custom-photo-sections');
      if (customBox) {
        customBox.innerHTML = customFields.map(name => `
          <div class="divider"></div>
          <div class="subsection-label">${escHtml(name)}</div>
          <div class="photo-sections-group">${buildPhotoSection(cfSlug(name), name, grouped[cfSlug(name)] || [])}</div>`
        ).join('');
      }
      // Auto-expand collapsed sections that already have content
      const autoExpand = (list, toggleId, wrapId) => {
        if (!list.length) return;
        const t = document.getElementById(toggleId);
        if (t) t.checked = true;
        document.getElementById(wrapId)?.classList.remove('hidden');
      };
      autoExpand(grouped.issues, 'jd-issues-toggle', 'photos-issues-wrap');
      autoExpand(grouped.add_info, 'jd-addinfo-toggle', 'photos-addinfo-wrap');
      autoExpand(grouped.equipment_left, 'jd-equipment-toggle', 'photos-equipment-wrap');
    } catch(e) {
      picSection.querySelectorAll('.photo-section-loading').forEach(el => { el.textContent = '—'; });
    }
  })();

  // Pictures save (replacement toggle + return track)
  document.getElementById('save-pictures-btn').addEventListener('click', () => {
    const isReplacement = document.getElementById('jd-replacement').checked;
    saveSection(entry, {
      is_replacement:  isReplacement,
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
  setupMaterialsUI(mats, entry.id);

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
function buildMaterialRow(index, name='', price='', withPhoto=false) {
  const sym = state.settings.currency_symbol || '$';
  return `<div class="material-row" data-index="${index}">
    <input type="text" class="form-control mat-name" placeholder="Material name" value="${escHtml(name)}" style="flex:2;min-width:0;">
    <div class="money-wrap" style="flex:1;min-width:0;">
      <span class="money-sym">${sym}</span>
      <input type="number" class="form-control mat-price" placeholder="0.00" value="${escHtml(String(price))}" min="0" step="0.01">
    </div>
    ${withPhoto ? `
    <label class="btn btn-ghost btn-sm mat-photo-btn" style="flex-shrink:0;" title="Add photo of this material">
      ${svg('camera')}
      <input type="file" accept="image/*" class="visually-hidden mat-photo-inp">
    </label>` : ''}
    <button class="btn btn-ghost btn-sm remove-mat" style="color:var(--red);flex-shrink:0;" title="Remove">${svg('trash')}</button>
  </div>`;
}

function setupMaterialsUI(existing, photoEntryId = null) {
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
    list.innerHTML = rows.map((m, i) => buildMaterialRow(i, m.name, m.price, !!photoEntryId)).join('');
    list.querySelectorAll('.remove-mat').forEach((btn, i) => {
      btn.addEventListener('click', () => { syncFromDOM(); rows.splice(i, 1); rerender(); });
    });
    if (photoEntryId) {
      list.querySelectorAll('.mat-photo-inp').forEach((inp, i) => {
        inp.addEventListener('change', async e => {
          const file = e.target.files?.[0];
          if (!file) return;
          syncFromDOM();
          const matName = rows[i]?.name || `Item-${i + 1}`;
          try {
            await uploadPhoto(photoEntryId, file, 'material', `Material-${matName}`);
            showToast(`Photo saved for "${matName}"`, 'success');
          } catch (err) { showToast(err.message || 'Upload failed', 'error'); }
          e.target.value = '';
        });
      });
    }
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

function getCustomPhotoFields() {
  try {
    const arr = JSON.parse(state.settings.custom_photo_fields || '[]');
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'string' && n.trim()) : [];
  } catch { return []; }
}
// photo_type must be id/filename-safe — spaces in field names broke the
// file input label binding and produced URLs the server 404'd on
function cfSlug(name) {
  return 'cf_' + String(name).trim().replace(/[^\w-]+/g, '_');
}
function cfLabel(type) {
  const match = getCustomPhotoFields().find(f => cfSlug(f) === type);
  return match || type.slice(3).replace(/_/g, ' ');
}

/* ── Multi-value inputs (tickets, MODs) — stored comma-joined ────── */
function splitMulti(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}
function buildMultiInputs(containerId, storedValue, placeholder = '') {
  const vals = splitMulti(storedValue);
  if (!vals.length) vals.push('');
  return `<div class="multi-input-list" id="${containerId}">
    ${vals.map((v, i) => `
      <div class="input-row multi-input-row" style="margin-bottom:4px;">
        <input type="text" class="form-control" value="${escHtml(v)}" placeholder="${escHtml(placeholder)}">
        ${i === 0
          ? `<button type="button" class="btn btn-ghost btn-sm multi-add" title="Add another">${svg('plus')}</button>`
          : `<button type="button" class="btn btn-ghost btn-sm multi-remove" title="Remove">✕</button>`}
      </div>`).join('')}
  </div>`;
}
function wireMultiInputs(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.addEventListener('click', e => {
    const add = e.target.closest('.multi-add');
    const rem = e.target.closest('.multi-remove');
    if (add) {
      const row = document.createElement('div');
      row.className = 'input-row multi-input-row';
      row.style.marginBottom = '4px';
      row.innerHTML = `<input type="text" class="form-control">
        <button type="button" class="btn btn-ghost btn-sm multi-remove" title="Remove">✕</button>`;
      box.appendChild(row);
      row.querySelector('input').focus();
    } else if (rem) {
      rem.closest('.multi-input-row')?.remove();
    }
  });
}
function readMultiInputs(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return null;
  const vals = [...box.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
  return vals.length ? vals.join(', ') : null;
}

function readMaterialsFromDOM() {
  return [...document.querySelectorAll('.material-row')].map(row => ({
    name:  row.querySelector('.mat-name')?.value.trim()  || '',
    price: row.querySelector('.mat-price')?.value.trim() || '',
  })).filter(m => m.name || m.price);
}

async function autoSaveActiveForm() {
  const entry = state.currentEntry;
  if (!entry) return;
  const g = id => document.getElementById(id);
  const data = {};
  if (g('jd-wo-title'))    data.wo_title        = g('jd-wo-title').value.trim()    || null;
  if (g('jd-company'))     data.organization_id  = g('jd-company').value            ? Number(g('jd-company').value)   : null;
  if (g('jd-customer'))    data.client_id        = g('jd-customer').value           ? Number(g('jd-customer').value)  : null;
  if (g('jd-site-id'))     data.site_id          = g('jd-site-id').value.trim()     || null;
  if (g('jd-assignment'))  data.assignment_id    = g('jd-assignment').value.trim()  || null;
  if (g('jd-tickets'))     data.ticket_num       = readMultiInputs('jd-tickets');
  if (g('jd-inc'))         data.inc_num          = g('jd-inc').value.trim()         || null;
  if (g('jd-mods'))        data.mod_name         = readMultiInputs('jd-mods');
  if (g('jd-noc'))         data.noc_name         = g('jd-noc').value.trim()         || null;
  if (g('jd-pmpc'))        data.pm_pc_name       = g('jd-pmpc').value.trim()        || null;
  if (g('jd-replacement')) data.is_replacement   = g('jd-replacement').checked ? 1 : 0;
  if (g('jd-return-track')) {
    const noRet = g('jd-return-track').disabled;
    data.no_return_track = noRet ? 1 : 0;
    data.return_track    = noRet ? null : (g('jd-return-track').value.trim() || null);
  }
  if (g('jd-work-summary')) data.work_summary    = g('jd-work-summary').value.trim() || null;
  if (g('parking-toggle')) {
    const parkOn = g('parking-toggle').checked;
    data.parking_tolls = parkOn ? (parseFloat(g('parking-amount')?.value) || null) : null;
  }
  if (g('materials-toggle')?.checked) data.materials = readMaterialsFromDOM();
  if (!Object.keys(data).length) return;
  try { state.currentEntry = await api.updateEntry(entry.id, data); } catch { /* silent */ }
}

/* ── Clock Out flow ─────────────────────────────────────────────── */
async function initiateClockOut(entry) {
  const workSummary = document.getElementById('jd-work-summary')?.value.trim() || entry.work_summary || '';
  const assignId    = document.getElementById('jd-assignment')?.value.trim()   || entry.assignment_id || '';
  const modName     = (document.getElementById('jd-mods') ? readMultiInputs('jd-mods') : null) || entry.mod_name || '';

  const missing = [];
  if (!assignId)    missing.push('Assignment ID');
  if (!modName)     missing.push('MOD Name');
  if (!workSummary) missing.push('Work Performed / Comments');

  if (missing.length) {
    const otherMissing = missing.filter(f => f !== 'MOD Name');
    openModal(`
      <div class="modal-header">
        <h3>${svg('alert')} Missing Required Fields</h3>
      </div>
      <div class="modal-body">
        ${!modName ? `
        <div class="form-group">
          <label class="form-label">MOD Name</label>
          <input type="text" class="form-control" id="mf-mod" placeholder="Manager on duty (comma-separate several)">
        </div>` : ''}
        ${otherMissing.length ? `
        <p style="color:var(--text2);margin-bottom:8px;">Also empty:</p>
        ${otherMissing.map(f => `<div class="missing-field-item">${svg('alert')} ${f}</div>`).join('')}
        <p style="color:var(--text3);font-size:13px;margin-top:10px;">Go back to fill them, or Override to mark as "OVERRIDE!"</p>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="co-cancel-btn">← Back</button>
        <button class="btn ${otherMissing.length ? 'btn-danger' : 'btn-primary'}" id="co-continue-btn">
          ${otherMissing.length ? 'Override & Continue' : `${svg('check')} Continue`}
        </button>
      </div>`);

    document.getElementById('co-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('co-continue-btn').addEventListener('click', async () => {
      const modName2 = modName || document.getElementById('mf-mod')?.value.trim() || '';
      if (!modName && !modName2 && !otherMissing.length) {
        showToast('Enter the MOD name or go back', 'error');
        return;
      }
      // Persist a newly entered MOD name
      if (!modName && modName2) {
        try { state.currentEntry = await api.updateEntry(entry.id, { mod_name: modName2 }); } catch { /* keep local */ }
      }
      const stillMissing = [...otherMissing];
      if (!modName2) stillMissing.push('MOD Name');
      closeModal();
      showClockOutTimePicker(state.currentEntry || entry, workSummary, assignId, modName2, stillMissing);
    });
    return;
  }
  showClockOutTimePicker(entry, workSummary, assignId, modName, []);
}

function showClockOutTimePicker(entry, workSummary, assignId, modName, overrides) {
  const t = off => fmtHHMM(adjustedTime(off));
  openModal(`
    <div class="modal-header">
      <h3>${svg('stop')} Clock Out</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">When did you finish?</label>
        <div class="time-sel-row">
          <button class="btn btn-danger flex-1" id="co-ts-now">Clock Out Now</button>
          <button class="btn btn-ghost flex-1" id="co-ts-adjust">Early / Later →</button>
        </div>
      </div>
      <div id="co-adjust-panel" class="hidden">
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">Adjust time</label>
          <div class="time-sel-grid">
            <button class="btn btn-ghost time-adj-btn" data-offset="-10">−10 min<span>${t(-10)}</span></button>
            <button class="btn btn-ghost time-adj-btn" data-offset="-5">−5 min<span>${t(-5)}</span></button>
            <button class="btn btn-ghost time-adj-btn" data-offset="5">+5 min<span>${t(5)}</span></button>
            <button class="btn btn-ghost time-adj-btn" data-offset="10">+10 min<span>${t(10)}</span></button>
          </div>
        </div>
        <button class="btn btn-ghost btn-full" id="co-ts-manual-toggle">Enter time manually...</button>
        <div id="co-ts-manual-group" class="hidden" style="margin-top:8px;">
          <input type="datetime-local" class="form-control" id="co-ts-manual-input" value="${localISOString()}">
          <button class="btn btn-danger btn-full" id="co-ts-manual-confirm" style="margin-top:8px;">Confirm Time</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="co-ts-cancel">Cancel</button>
    </div>`);

  document.getElementById('co-ts-cancel').addEventListener('click', closeModal);

  document.getElementById('co-ts-now').addEventListener('click', () =>
    showClockOutModal(entry, workSummary, assignId, modName, overrides, new Date().toISOString())
  );

  document.getElementById('co-ts-adjust').addEventListener('click', () =>
    document.getElementById('co-adjust-panel').classList.remove('hidden')
  );

  document.querySelectorAll('.time-adj-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      showClockOutModal(entry, workSummary, assignId, modName, overrides,
        adjustedTime(parseInt(btn.dataset.offset)).toISOString())
    );
  });

  document.getElementById('co-ts-manual-toggle').addEventListener('click', () =>
    document.getElementById('co-ts-manual-group').classList.toggle('hidden')
  );

  document.getElementById('co-ts-manual-confirm').addEventListener('click', () => {
    const val = document.getElementById('co-ts-manual-input').value;
    if (!val) return showToast('Please select a time', 'error');
    showClockOutModal(entry, workSummary, assignId, modName, overrides, toISOFull(val));
  });
}

function showClockOutModal(entry, workSummary, assignId, modName, overrides, clockOutISO) {
  const override = field => overrides.includes(field) ? 'OVERRIDE!' : null;
  const clockOutTime = new Date(clockOutISO);

  openModal(`
    <div class="modal-header">
      <h3>${svg('stop')} Clock Out</h3>
      <span style="font-size:12px;color:var(--text3);">Out: ${fmtHHMM(clockOutTime)}</span>
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
      <div id="revisit-auto" class="hidden field-hint" style="color:var(--red);margin-bottom:4px;">
        ⚠ FAIL — Revisit Required is set automatically.
      </div>
      <div class="form-group">
        <label class="form-label">Release Code</label>
        <div class="input-row">
          <input type="text" class="form-control" id="co-release-code" value="${escHtml(entry.release_code||'')}" placeholder="Enter release code...">
          <button class="btn btn-ghost btn-sm" id="no-code-btn" style="white-space:nowrap;">No Code</button>
        </div>
        <div id="no-code-label" class="hidden field-hint" style="color:var(--orange);">⊘ Marked as N/a</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="co-back-btn">← Back</button>
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
      document.getElementById('revisit-auto').classList.toggle('hidden', selectedStatus !== 'fail');
    });
  });

  document.getElementById('no-code-btn').addEventListener('click', () => {
    noCode = !noCode;
    document.getElementById('co-release-code').disabled = noCode;
    document.getElementById('co-release-code').value = noCode ? '' : (entry.release_code || '');
    document.getElementById('no-code-label').classList.toggle('hidden', !noCode);
    document.getElementById('no-code-btn').textContent = noCode ? 'Undo N/a' : 'No Code';
  });

  document.getElementById('co-back-btn').addEventListener('click', () =>
    showClockOutTimePicker(entry, workSummary, assignId, modName, overrides)
  );

  document.getElementById('co-review-btn').addEventListener('click', () => {
    if (!selectedStatus) { showToast('Please select a WO status', 'error'); return; }
    const releaseCode = noCode ? null : (document.getElementById('co-release-code').value.trim() || null);
    if (!noCode && !releaseCode) {
      showToast('Release code is empty — use "No Code" if there is none', 'error');
      return;
    }
    const isFail = selectedStatus === 'fail';
    const revisit = isFail || (selectedStatus === 'completed' && document.getElementById('revisit-toggle').checked);
    const baseSummary = workSummary || override('Work Performed / Comments') || '';
    showFinalReview(entry, {
      workSummary: revisit ? baseSummary + '\n\nREVISIT REQUIRED!' : baseSummary,
      assignId:    assignId  || override('Assignment ID') || '',
      modName:     modName   || override('MOD Name')      || '',
      status:      selectedStatus,
      revisit,
      releaseCode,
      noCode,
      clockOutISO,
    });
  });
}

function showFinalReview(entry, coData) {
  const techName = state.settings.tech_name || '—';
  const clockOutTime = new Date(coData.clockOutISO);
  const grossSec = Math.max(0, Math.floor((clockOutTime - new Date(entry.clock_in)) / 1000));
  const netSec   = state.settings.paid_breaks === '1'
    ? grossSec
    : Math.max(0, grossSec - (entry.total_break_seconds || 0));
  const labor    = calcLabor(entry, netSec);
  const travel   = parseFloat(entry.travel_reimb) || 0;
  const parking  = parseFloat(entry.parking_tolls) || 0;
  const total    = labor + travel + parking;

  openModal(`
    <div class="modal-header">
      <h3>${svg('check')} Final Review</h3>
    </div>
    <div class="modal-body">
      <div class="review-row"><span>Tech:</span><span>${escHtml(techName)}</span></div>
      <div class="review-row"><span>WO Title:</span><span>${escHtml(entry.wo_title||'—')}</span></div>
      <div class="review-row"><span>Company:</span><span>${escHtml(entry.org_name||'—')}</span></div>
      <div class="review-row"><span>Customer:</span><span>${escHtml(entry.client_name||'—')}</span></div>
      <div class="review-row"><span>Assignment ID:</span><span>${escHtml(coData.assignId)}</span></div>
      <div class="review-row"><span>MOD Name:</span><span>${escHtml(coData.modName)}</span></div>
      <div class="review-row"><span>Address:</span><span>${escHtml(entry.address||'—')}</span></div>
      <div class="review-row"><span>Clock In:</span><span>${fmtTime(entry.clock_in)}</span></div>
      <div class="review-row"><span>Clock Out:</span><span>${fmtHHMM(clockOutTime)}</span></div>
      <div class="review-row"><span>Net Time:</span><span>${fmtDecimalHours(netSec)}</span></div>
      <div class="review-row"><span>Labor:</span><span>${fmtMoney(labor)}</span></div>
      ${travel  ? `<div class="review-row"><span>Travel Reimb:</span><span>${fmtMoney(travel)}</span></div>`  : ''}
      ${parking ? `<div class="review-row"><span>Parking/Tolls:</span><span>${fmtMoney(parking)}</span></div>` : ''}
      <div class="review-row total-row"><span>Total Expected:</span><span>${fmtMoney(total)}</span></div>
      <div class="review-row"><span>Status:</span><span class="status-chip ${coData.status}">${coData.status.toUpperCase()}${coData.revisit ? ' · REVISIT' : ''}</span></div>
      <div class="review-row"><span>Release Code:</span><span>${coData.noCode ? 'N/a' : escHtml(coData.releaseCode || '—')}</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="fr-back-btn">← Back</button>
      <button class="btn btn-danger" id="fr-confirm-btn">Confirm Clock Out</button>
    </div>`);

  document.getElementById('fr-back-btn').addEventListener('click', () =>
    showClockOutModal(entry, coData.workSummary, coData.assignId, coData.modName, [], coData.clockOutISO)
  );

  document.getElementById('fr-confirm-btn').addEventListener('click', () => {
    closeModal();
    showSignatureModal(entry, coData);
  });
}

/* ── Manager sign-off (separate window — no money on screen) ─────── */
function showSignatureModal(entry, coData) {
  openModal(`
    <div class="modal-header">
      <h3>${svg('edit')} Manager Sign-Off</h3>
    </div>
    <div class="modal-body">
      <div id="fr-sig-area">
        <div class="form-group" style="margin-top:2px;">
          <div class="input-row">
            <select class="form-control" id="fr-sig-mod" style="flex:1;">
              ${splitMulti(coData.modName).map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}
              <option value="__other__">+ Other person...</option>
            </select>
          </div>
          <input type="text" class="form-control hidden" id="fr-sig-name" placeholder="Signer name" style="margin-top:6px;">
        </div>
        <canvas id="fr-sig-pad" width="560" height="180" style="width:100%;height:140px;border:1.5px dashed var(--border);border-radius:8px;background:#fff;touch-action:none;"></canvas>
      </div>
      <div class="input-row" style="margin-top:4px;">
        <span class="field-hint" id="fr-sig-hint" style="flex:1;">Sign above with finger or mouse</span>
        <button class="btn btn-ghost btn-sm" id="fr-sig-clear">Clear</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="fr-sig-back">← Back</button>
      <button class="btn btn-ghost" id="fr-sig-none">No Signature</button>
      <button class="btn btn-danger" id="fr-sig-done">${svg('check')} Clock Out</button>
    </div>`);

  // Signature pad
  let sigDrawn = false;
  const sigCanvas = document.getElementById('fr-sig-pad');
  const sigCtx = sigCanvas.getContext('2d');
  sigCtx.lineWidth = 2.5; sigCtx.lineCap = 'round'; sigCtx.strokeStyle = '#1a2433';
  const sigPos = e => {
    const r = sigCanvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (sigCanvas.width / r.width), y: (p.clientY - r.top) * (sigCanvas.height / r.height) };
  };
  let sigActive = false;
  const sigStart = e => { e.preventDefault(); sigActive = true; const { x, y } = sigPos(e); sigCtx.beginPath(); sigCtx.moveTo(x, y); };
  const sigMove = e => { if (!sigActive) return; e.preventDefault(); const { x, y } = sigPos(e); sigCtx.lineTo(x, y); sigCtx.stroke(); sigDrawn = true; };
  const sigEnd = () => { sigActive = false; };
  sigCanvas.addEventListener('mousedown', sigStart); sigCanvas.addEventListener('mousemove', sigMove);
  window.addEventListener('mouseup', sigEnd);
  sigCanvas.addEventListener('touchstart', sigStart, { passive: false });
  sigCanvas.addEventListener('touchmove', sigMove, { passive: false });
  sigCanvas.addEventListener('touchend', sigEnd);
  document.getElementById('fr-sig-clear').addEventListener('click', () => {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigDrawn = false;
  });
  document.getElementById('fr-sig-mod').addEventListener('change', e => {
    document.getElementById('fr-sig-name').classList.toggle('hidden', e.target.value !== '__other__');
  });
  document.getElementById('fr-sig-back').addEventListener('click', () => {
    closeModal();
    showFinalReview(entry, coData);
  });

  const finishClockOut = async (withSignature) => {
    try {
      let modNameFinal = coData.modName || entry.mod_name;
      if (withSignature && sigDrawn) {
        const modSel = document.getElementById('fr-sig-mod').value;
        const signer = modSel === '__other__'
          ? (document.getElementById('fr-sig-name').value.trim() || 'Manager')
          : (modSel || 'Manager');
        if (modSel === '__other__' && signer !== 'Manager' && !splitMulti(modNameFinal).includes(signer)) {
          modNameFinal = splitMulti(modNameFinal).concat(signer).join(', ');
        }
        try {
          const dataUrl = sigCanvas.toDataURL('image/png');
          await api.uploadPhoto(entry.id, {
            data: dataUrl.split(',')[1],
            filename: `MOD-${signer}-Signature.png`,
            photo_type: 'signature',
            mime: 'image/png',
            name_hint: `MOD-${signer}-Signature`,
          });
        } catch (err) { showToast('Signature upload failed: ' + err.message, 'error'); }
      }
      const completed = await api.clockOut(entry.id, {
        clock_out:        coData.clockOutISO,
        status:           coData.status,
        work_summary:     coData.workSummary,
        assignment_id:    coData.assignId,
        mod_name:         modNameFinal,
        release_code:     coData.releaseCode,
        no_release_code:  coData.noCode,
        revisit_required: coData.revisit ? 1 : 0,
      });
      state.currentEntry = null;
      state.lastCompletedEntry = completed;
      closeModal();
      renderSummaryPage(completed);
    } catch (e) { showToast(e.message || 'Clock out failed', 'error'); }
  };

  document.getElementById('fr-sig-none').addEventListener('click', () => finishClockOut(false));
  document.getElementById('fr-sig-done').addEventListener('click', () => finishClockOut(true));
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
    copyToClipboard(buildTextReport(entry));
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
   TRIP MODALS
   ================================================================ */

async function uploadTripPhotoData(tripId, type, photoData) {
  // photoData is a base64 data URL (data:image/jpeg;base64,...)
  const b64 = photoData.split(',')[1];
  if (!b64) return null;
  try {
    return await api.uploadTripPhoto(tripId, {
      data: b64,
      filename: `photo_${type}.jpg`,
      photo_type: type,
      mime: 'image/jpeg',
    });
  } catch (err) {
    showToast('Photo upload failed: ' + err.message, 'error');
    return null;
  }
}

async function compressFileToBase64(file) {
  const blob = await compressImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

async function openTripStartModal() {
  const cats = state.tripCategories;
  const clocked = !!state.currentEntry;
  try { state.plannedJobs = await api.getPlannedJobs(); } catch { state.plannedJobs = state.plannedJobs || []; }
  const plannedWithAssign = (state.plannedJobs || []).filter(p => p.assignment_id);

  // When clocked in, only OnClock/Other. When off-clock, everything except OnClock.
  const filteredCats = cats.filter(c => {
    if (clocked) return c.name === 'OnClock Tools/Supplies' || c.name === 'Other';
    return c.name !== 'OnClock Tools/Supplies';
  });

  let selectedCat = clocked ? 'OnClock Tools/Supplies' : 'In Route to WO';
  // Make sure defaultCat is actually in filteredCats
  if (!filteredCats.find(c => c.name === selectedCat)) selectedCat = filteredCats[0]?.name || 'Other';
  let photoData = null;

  const isOther = () => selectedCat === 'Other';
  const isInRoute = () => selectedCat === 'In Route to WO';

  const catBtnsHtml = filteredCats.map(c =>
    `<button class="trip-cat-btn${c.name === selectedCat ? ' active' : ''}" data-cat="${escHtml(c.name)}">${escHtml(c.name)}</button>`
  ).join('');

  openModal(`
    <div class="modal-header">
      <h3>${svg('car')} Start Trip</h3>
      <button class="btn btn-ghost btn-sm" id="ts-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Category</label>
        <div class="trip-cat-grid" id="ts-cat-grid">${catBtnsHtml}</div>
      </div>
      <div class="form-group" id="ts-assignment-group" style="${isInRoute() ? '' : 'display:none;'}">
        ${plannedWithAssign.length ? `
        <label class="form-label">From Planned Job <span class="opt-label">optional</span></label>
        <select class="form-control" id="ts-planned-select" style="margin-bottom:8px;">
          <option value="">— Pick a planned job —</option>
          ${plannedWithAssign.map(p => `<option value="${escHtml(p.assignment_id)}">${escHtml(p.planned_date ? plannedDayLabel(p.planned_date) + ' — ' : '')}${escHtml(p.wo_title || p.assignment_id)}</option>`).join('')}
        </select>` : ''}
        <label class="form-label">Assignment ID <span class="req-star">*</span></label>
        <div class="input-row">
          <input type="text" class="form-control" id="ts-assignment" placeholder="e.g. ABC-12345">
          <label style="display:flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap;cursor:pointer;">
            <input type="checkbox" id="ts-add-later"> Add Later
          </label>
        </div>
        <div id="ts-assignment-hint" class="field-hint hidden" style="color:var(--orange);">
          Enter Assignment ID or check "Add Later"
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Mileage Start <span class="req-star">*</span></label>
        <input type="number" class="form-control" id="ts-mileage" placeholder="e.g. 45231.5" min="0" step="0.1">
      </div>
      <div class="form-group" id="ts-note-field">
        <label class="form-label">Note${isOther() ? ' <span class="req-star">*</span>' : ' <span class="opt-label">optional</span>'}</label>
        <textarea class="form-control" id="ts-notes" rows="2" placeholder="${isOther() ? 'Required for Other trips...' : 'Optional note...'}"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Mileage Photo (Before) <span class="opt-label">optional</span></label>
        <label class="photo-add-btn" for="ts-photo-inp">
          ${svg('camera')} <span id="ts-photo-txt">Add Photo</span>
        </label>
        <input type="file" accept="image/*" class="visually-hidden" id="ts-photo-inp">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="ts-cancel">Cancel</button>
      <button class="btn btn-primary" id="ts-start">Start Trip</button>
    </div>`);

  document.getElementById('ts-x').addEventListener('click', closeModal);
  document.getElementById('ts-cancel').addEventListener('click', closeModal);

  document.getElementById('ts-planned-select')?.addEventListener('change', e => {
    if (!e.target.value) return;
    const inp = document.getElementById('ts-assignment');
    inp.value = e.target.value;
    const later = document.getElementById('ts-add-later');
    if (later) { later.checked = false; inp.disabled = false; }
    document.getElementById('ts-assignment-hint')?.classList.add('hidden');
  });

  const updateNoteLabel = () => {
    const noteField = document.getElementById('ts-note-field');
    if (!noteField) return;
    noteField.querySelector('label').innerHTML = isOther()
      ? 'Note <span class="req-star">*</span>'
      : 'Note <span class="opt-label">optional</span>';
    document.getElementById('ts-notes').placeholder = isOther() ? 'Required for Other trips...' : 'Optional note...';
  };

  document.getElementById('ts-cat-grid').addEventListener('click', e => {
    const btn = e.target.closest('.trip-cat-btn');
    if (!btn) return;
    selectedCat = btn.dataset.cat;
    document.querySelectorAll('#ts-cat-grid .trip-cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('ts-assignment-group').style.display = isInRoute() ? '' : 'none';
    document.getElementById('ts-assignment-hint').classList.add('hidden');
    updateNoteLabel();
  });

  document.getElementById('ts-add-later').addEventListener('change', e => {
    const inp = document.getElementById('ts-assignment');
    inp.disabled = e.target.checked;
    if (e.target.checked) { inp.value = ''; document.getElementById('ts-assignment-hint').classList.add('hidden'); }
  });

  document.getElementById('ts-photo-inp').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      photoData = await compressFileToBase64(file);
      document.getElementById('ts-photo-txt').textContent = '✓ ' + file.name;
    } catch (err) {
      showToast('Photo error: ' + err.message, 'error');
    }
  });

  document.getElementById('ts-start').addEventListener('click', async () => {
    const milVal = document.getElementById('ts-mileage').value.trim();
    if (!milVal) { showToast('Mileage start is required', 'error'); return; }

    const addLater = document.getElementById('ts-add-later')?.checked ?? false;
    const rawAssign = document.getElementById('ts-assignment')?.value.trim() || '';
    if (isInRoute() && !addLater && !rawAssign) {
      document.getElementById('ts-assignment-hint').classList.remove('hidden');
      document.getElementById('ts-assignment').focus();
      return;
    }

    const notes = document.getElementById('ts-notes').value.trim() || null;
    if (isOther() && !notes) { showToast('Notes are required for Other trips', 'error'); return; }

    const assignId = (isInRoute() && !addLater) ? rawAssign || null : null;

    try {
      document.getElementById('ts-start').disabled = true;
      document.getElementById('ts-start').textContent = 'Starting...';
      const trip = await api.startTrip({
        category: selectedCat,
        assignment_id: assignId,
        start_time: new Date().toISOString(),
        mileage_start: parseFloat(milVal),
        notes,
      });
      state.currentTrip = trip;
      if (photoData) await uploadTripPhotoData(trip.id, 'before', photoData);
      closeModal();
      renderActiveTripPage();
    } catch (err) {
      showToast(err.message || 'Failed to start trip', 'error');
      document.getElementById('ts-start').disabled = false;
      document.getElementById('ts-start').textContent = 'Start Trip';
    }
  });
}

function openTripStopModal(trip) {
  const rate = parseFloat(state.settings.mileage_rate || '0.67');
  const sym = state.settings.currency_symbol || '$';
  let afterPhotoData = null;

  const calcHtml = (val) => {
    if (trip.mileage_start == null || !val) return '';
    const dist = parseFloat(val) - trip.mileage_start;
    if (dist < 0) return `<div style="color:var(--red);font-size:13px;margin-top:4px;">⚠ End must be ≥ start (${trip.mileage_start})</div>`;
    return `<div class="review-row" style="margin-top:6px;font-size:13px;"><span>Miles driven:</span><b>${dist.toFixed(2)} mi</b></div>
            <div class="review-row" style="font-size:13px;"><span>Tax deduction:</span><b>${sym}${(dist * rate).toFixed(2)}</b></div>`;
  };

  openModal(`
    <div class="modal-header">
      <h3>${svg('car')} Finish Trip</h3>
      <button class="btn btn-ghost btn-sm" id="tst-x">✕</button>
    </div>
    <div class="modal-body">
      <div class="review-row" style="margin-bottom:6px;"><span>Category:</span><span>${escHtml(trip.category)}</span></div>
      ${trip.assignment_id ? `<div class="review-row" style="margin-bottom:6px;"><span>Assignment:</span><span>${escHtml(trip.assignment_id)}</span></div>` : ''}
      ${trip.mileage_start != null ? `<div class="review-row" style="margin-bottom:10px;"><span>Mileage start:</span><span>${trip.mileage_start} mi</span></div>` : ''}
      <div class="form-group">
        <label class="form-label">Mileage End <span class="req-star">*</span></label>
        <input type="number" class="form-control" id="tst-mileage-end" placeholder="e.g. 45278.5" min="0" step="0.1">
        <div id="tst-calc"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes ${trip.category === 'Other' ? '<span class="req-star">*</span>' : '<span class="opt-label">optional</span>'}</label>
        <textarea class="form-control" id="tst-notes" rows="2" placeholder="${trip.category === 'Other' ? 'Required for Other trips...' : 'Optional note...'}">${escHtml(trip.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Mileage Photo (After) <span class="opt-label">optional</span></label>
        <label class="photo-add-btn" for="tst-photo-inp">
          ${svg('camera')} <span id="tst-photo-txt">Add Photo</span>
        </label>
        <input type="file" accept="image/*" class="visually-hidden" id="tst-photo-inp">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="tst-cancel">Cancel</button>
      <button class="btn btn-primary" id="tst-finish">Finish Trip</button>
    </div>`);

  document.getElementById('tst-x').addEventListener('click', closeModal);
  document.getElementById('tst-cancel').addEventListener('click', closeModal);

  document.getElementById('tst-mileage-end').addEventListener('input', e => {
    document.getElementById('tst-calc').innerHTML = calcHtml(e.target.value);
  });

  document.getElementById('tst-photo-inp').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      afterPhotoData = await compressFileToBase64(file);
      document.getElementById('tst-photo-txt').textContent = '✓ ' + file.name;
    } catch (err) {
      showToast('Photo error: ' + err.message, 'error');
    }
  });

  document.getElementById('tst-finish').addEventListener('click', async () => {
    const milEndVal = document.getElementById('tst-mileage-end').value.trim();
    const notes = document.getElementById('tst-notes').value.trim() || null;
    if (!milEndVal) { showToast('Mileage end is required', 'error'); return; }
    if (trip.mileage_start != null && parseFloat(milEndVal) < trip.mileage_start) {
      showToast('Mileage end must be ≥ mileage start', 'error'); return;
    }
    if (trip.category === 'Other' && !notes) { showToast('Notes are required for Other trips', 'error'); return; }
    const finishBtn = document.getElementById('tst-finish');
    try {
      finishBtn.disabled = true;
      finishBtn.textContent = 'Finishing...';
      const stopped = await api.stopTrip(trip.id, {
        end_time: new Date().toISOString(),
        mileage_end: parseFloat(milEndVal),
        notes,
      });
      if (afterPhotoData) await uploadTripPhotoData(stopped.id, 'after', afterPhotoData);
      state.currentTrip = null;
      clearInterval(state.tripTimerInterval);
      state.tripTimerInterval = null;
      closeModal();
      openTripSummaryModal(stopped);
    } catch (err) {
      showToast(err.message || 'Failed to stop trip', 'error');
      finishBtn.disabled = false;
      finishBtn.textContent = 'Finish Trip';
    }
  });
}

function openTripSummaryModal(trip) {
  const sym = state.settings.currency_symbol || '$';
  let drivingSec = 0;
  if (trip.start_time && trip.end_time) {
    drivingSec = Math.max(0, Math.floor((new Date(trip.end_time) - new Date(trip.start_time)) / 1000));
  }

  openModal(`
    <div class="modal-header">
      <h3>${svg('car')} Trip Summary</h3>
    </div>
    <div class="modal-body">
      <div class="review-row"><span>Category:</span><span>${escHtml(trip.category)}</span></div>
      ${trip.assignment_id ? `<div class="review-row"><span>Assignment:</span><span>${escHtml(trip.assignment_id)}</span></div>` : ''}
      ${trip.trip_id ? `<div class="review-row"><span>Trip ID:</span><span>${escHtml(trip.trip_id)}</span></div>` : ''}
      <div class="review-row"><span>Distance:</span><span>${trip.distance != null ? trip.distance.toFixed(2) + ' mi' : '—'}</span></div>
      <div class="review-row"><span>Driving Time:</span><span>${fmtDecimalHours(drivingSec)}</span></div>
      <div class="review-row total-row"><span>Tax Deduction:</span><span>${trip.tax_deduction != null ? sym + trip.tax_deduction.toFixed(2) : '—'}</span></div>
    </div>
    <div class="modal-footer">
      ${(trip.category === 'In Route to WO' && trip.assignment_id) ?
        `<button class="btn btn-primary" id="ts-clockin-now">Clock In Now</button>` : ''}
      <button class="btn btn-ghost" id="ts-done">Done</button>
    </div>`);

  document.getElementById('ts-done').addEventListener('click', () => {
    closeModal();
    if (state.currentEntry) renderActiveClockPage();
    else renderIdleClockPage();
  });

  document.getElementById('ts-clockin-now')?.addEventListener('click', () => {
    state.pendingTripAssignment = trip.assignment_id || null;
    state.pendingTripClockIn = trip.end_time || null;
    closeModal();
    navigateTo('clock');
  });
}

function openTripDetail(trip) {
  const sym = state.settings.currency_symbol || '$';
  let drivingSec = 0;
  if (trip.start_time && trip.end_time) {
    drivingSec = Math.max(0, Math.floor((new Date(trip.end_time) - new Date(trip.start_time)) / 1000));
  }

  openModal(`
    <div class="modal-header">
      <h3>${svg('car')} Trip Detail</h3>
      <button class="btn btn-ghost btn-sm" id="td-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="review-row"><span>Category:</span><span>${escHtml(trip.category)}</span></div>
      ${trip.assignment_id ? `<div class="review-row"><span>Assignment ID:</span><span>${escHtml(trip.assignment_id)}</span></div>` : ''}
      ${trip.trip_id ? `<div class="review-row"><span>Trip ID:</span><span>${escHtml(trip.trip_id)}</span></div>` : ''}
      <div class="review-row"><span>Start:</span><span>${fmtDateFull(trip.start_time)}</span></div>
      <div class="review-row"><span>End:</span><span>${trip.end_time ? fmtDateFull(trip.end_time) : 'Active'}</span></div>
      <div class="review-row"><span>Mileage Start:</span><span>${trip.mileage_start != null ? trip.mileage_start + ' mi' : '—'}</span></div>
      <div class="review-row"><span>Mileage End:</span><span>${trip.mileage_end != null ? trip.mileage_end + ' mi' : '—'}</span></div>
      <div class="review-row"><span>Distance:</span><span>${trip.distance != null ? trip.distance.toFixed(2) + ' mi' : '—'}</span></div>
      <div class="review-row"><span>Driving Time:</span><span>${fmtDecimalHours(drivingSec)}</span></div>
      <div class="review-row total-row"><span>Tax Deduction:</span><span>${trip.tax_deduction != null ? sym + trip.tax_deduction.toFixed(2) : '—'}</span></div>
      ${trip.notes ? `<div class="review-row" style="align-items:flex-start;"><span>Notes:</span><span style="white-space:pre-wrap;">${escHtml(trip.notes)}</span></div>` : ''}
      <div id="td-photos"><div class="field-hint" style="margin-top:12px;">Loading photos...</div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger btn-sm" id="td-delete">Delete</button>
      <button class="btn btn-ghost" id="td-close2">Close</button>
    </div>`);

  document.getElementById('td-close').addEventListener('click', closeModal);
  document.getElementById('td-close2').addEventListener('click', closeModal);
  document.getElementById('td-delete').addEventListener('click', async () => {
    if (!confirm('Delete this trip?')) return;
    try {
      await api.deleteTrip(trip.id);
      closeModal();
      renderJournalPage();
    } catch (err) { showToast(err.message, 'error'); }
  });

  // Load photos
  (async () => {
    const photosDiv = document.getElementById('td-photos');
    if (!photosDiv) return;
    try {
      const photos = await api.getTripPhotos(trip.id);
      if (!photos.length) { photosDiv.innerHTML = ''; return; }
      photosDiv.innerHTML = buildPhotoGallery(photos);
    } catch { photosDiv.innerHTML = ''; }
  })();
}

function renderTripsJournal(trips, sym) {
  if (!trips || !trips.length) return '<div class="empty-state">No trips this month</div>';

  const ws = state.settings.week_start === '7' ? 0 : 1;
  const weekGroups = {};
  for (const t of trips) {
    const dt = new Date(t.start_time);
    const { start, end } = getWeekBounds(dt, ws);
    const key = start.toISOString();
    if (!weekGroups[key]) weekGroups[key] = { start, end, trips: [] };
    weekGroups[key].trips.push(t);
  }

  const sortedWeeks = Object.values(weekGroups).sort((a,b) => a.start - b.start);

  return sortedWeeks.map(wg => {
    const completedTrips = wg.trips.filter(t => t.status === 'completed');
    const weekMiles = completedTrips.reduce((s,t) => s + (t.distance || 0), 0);
    const weekTax   = completedTrips.reduce((s,t) => s + (t.tax_deduction || 0), 0);
    const dateRange = `${fmtDateShort(wg.start.toISOString())} – ${fmtDateShort(wg.end.toISOString())}`;

    const tripCardsHtml = [...wg.trips]
      .sort((a,b) => new Date(a.start_time) - new Date(b.start_time))
      .map(t => `
        <div class="entry-card trip-card" data-trip-id="${t.id}" style="cursor:pointer;">
          <div class="entry-card-top">
            <div class="entry-title">${escHtml(t.category)}</div>
            <span class="status-chip ${t.status === 'completed' ? 'completed' : 'pending'}">${t.distance != null ? t.distance.toFixed(1)+' mi' : '—'}</span>
          </div>
          <div class="entry-meta">
            ${t.assignment_id ? escHtml(t.assignment_id)+' · ' : ''}
            ${fmtDateFull(t.start_time)} · ${t.tax_deduction != null ? sym+t.tax_deduction.toFixed(2)+' deduction' : ''}
          </div>
        </div>`).join('');

    return `
      <div class="week-group">
        <div class="week-header">
          <div class="week-header-left">
            <div class="week-label">${getISOWeekLabel(wg.start)} <span class="week-dates">${dateRange}</span></div>
            <div class="week-totals">${weekMiles.toFixed(1)} mi · ${sym}${weekTax.toFixed(2)} deduction</div>
          </div>
        </div>
        ${tripCardsHtml}
      </div>`;
  }).join('');
}


/* ================================================================
   JOURNAL PAGE
   ================================================================ */
async function renderJournalPage() {
  const page = document.getElementById('page');
  try {
    const d = state.journalDate;
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd   = new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59);
    const sym = state.settings.currency_symbol || '$';
    const ws = state.settings.week_start === '7' ? 0 : 1;

    // Render header and sub-tabs
    page.innerHTML = `
      <div class="journal-header">
        <button class="btn btn-ghost btn-icon" id="j-prev">${svg('chevL')}</button>
        <div class="journal-month-title">${fmtMonthYear(d)}</div>
        <button class="btn btn-ghost btn-icon" id="j-next">${svg('chevR')}</button>
      </div>
      <div class="journal-tabs">
        <button class="journal-tab ${state.journalSubTab==='work'?'active':''}" data-tab="work">Work</button>
        <button class="journal-tab ${state.journalSubTab==='trips'?'active':''}" data-tab="trips">Trips</button>
      </div>
      <div id="journal-body"><div class="loading-page"><div class="spinner"></div></div></div>`;

    document.getElementById('j-prev').addEventListener('click', () => {
      state.journalDate = new Date(d.getFullYear(), d.getMonth()-1, 1);
      renderJournalPage();
    });
    document.getElementById('j-next').addEventListener('click', () => {
      state.journalDate = new Date(d.getFullYear(), d.getMonth()+1, 1);
      renderJournalPage();
    });

    document.querySelectorAll('.journal-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.journalSubTab = btn.dataset.tab;
        renderJournalPage();
      });
    });

    const journalBody = document.getElementById('journal-body');

    if (state.journalSubTab === 'trips') {
      // Load trips for this month
      const allTrips = await api.getTrips();
      const monthTrips = allTrips.filter(t => {
        const dt = new Date(t.start_time);
        return dt >= monthStart && dt <= monthEnd;
      });
      const totalMiles = monthTrips.filter(t=>t.status==='completed').reduce((s,t) => s+(t.distance||0), 0);
      const totalTax   = monthTrips.filter(t=>t.status==='completed').reduce((s,t) => s+(t.tax_deduction||0), 0);
      journalBody.innerHTML = `
        <div class="journal-month-totals" style="border-top:1px solid var(--border);">
          <span>${totalMiles.toFixed(1)} mi</span>
          <span>${sym}${totalTax.toFixed(2)} deductions</span>
          <a class="btn btn-ghost btn-sm" href="${api.getMileageExportUrl(monthStart.toISOString(), monthEnd.toISOString())}">${svg('download')} Mileage CSV</a>
        </div>
        ${renderTripsJournal(monthTrips, sym)}`;

      // Wire up trip card clicks
      journalBody.querySelectorAll('.trip-card').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          const tid = parseInt(card.dataset.tripId);
          const trip = monthTrips.find(t => t.id === tid);
          if (trip) openTripDetail(trip);
        });
      });
    } else {
      // Work tab — existing behavior
      const [entries, payPeriods] = await Promise.all([api.getEntries(), api.getPayPeriods()]);
      const payMap = {};
      payPeriods.forEach(p => { payMap[p.week_start] = p; });

      // An entry belongs to the month in which its WEEK STARTS, so a week
      // straddling two months stays whole in the month where it began
      const monthEntries = entries.filter(e => {
        const wStart = getWeekBounds(new Date(e.clock_in), ws).start;
        return wStart.getFullYear() === monthStart.getFullYear() && wStart.getMonth() === monthStart.getMonth();
      });

      const weekGroups = {};
      for (const e of monthEntries) {
        const ci = new Date(e.clock_in);
        const { start, end } = getWeekBounds(ci, ws);
        const key = start.toISOString();
        if (!weekGroups[key]) weekGroups[key] = { start, end, entries: [] };
        weekGroups[key].entries.push(e);
      }

      const sortedWeeks = Object.values(weekGroups).sort((a,b) => a.start - b.start);
      const weekGroupsByDate = {};
      for (const wg of sortedWeeks) weekGroupsByDate[dateToISODate(wg.start)] = wg;

      const mTotalExpected = monthEntries.filter(e=>e.clock_out).reduce((s,e) => s + calcTotalExpected(e), 0);
      const mTotalHrs = monthEntries.filter(e=>e.clock_out).reduce((s,e) => s + getNetSeconds(e)/3600, 0);

      journalBody.innerHTML = `
        <div class="journal-month-totals" style="border-top:1px solid var(--border);">
          <span>${mTotalHrs.toFixed(2)} hrs</span>
          <span>${sym}${mTotalExpected.toFixed(2)} expected</span>
          <a class="btn btn-ghost btn-sm" href="${api.getExportUrl(monthStart.toISOString(), monthEnd.toISOString())}">${svg('download')} Export CSV</a>
        </div>
        ${sortedWeeks.length === 0 ? '<div class="empty-state">No work orders this month</div>' :
          sortedWeeks.map(wg => renderWeekGroup(wg, ws, sym, payMap)).join('')}`;

      // Entry card click handlers
      journalBody.querySelectorAll('.entry-card').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          const eid = parseInt(card.dataset.id);
          const entry = entries.find(en => en.id === eid);
          if (entry) openEntryDetail(entry);
        });
      });

      // REVISIT badge → jump to the first visit
      journalBody.querySelectorAll('.rev-badge').forEach(badge => {
        badge.addEventListener('click', e => {
          e.stopPropagation();
          const original = entries.find(en => en.id === parseInt(badge.dataset.revOf));
          if (original) openEntryDetail(original);
          else showToast('Original visit not found', 'error');
        });
      });

      journalBody.querySelectorAll('.entry-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const eid = parseInt(btn.dataset.id);
          const entry = entries.find(en => en.id === eid);
          if (entry) openEntryEdit(entry);
        });
      });

      journalBody.querySelectorAll('.entry-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm('Delete this work order?')) return;
          try {
            await api.deleteEntry(parseInt(btn.dataset.id));
            renderJournalPage();
          } catch (err) { showToast(err.message, 'error'); }
        });
      });

      journalBody.querySelectorAll('.pay-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const weekStart = btn.dataset.weekStart;
          const weekEnd   = btn.dataset.weekEnd;
          const wg = weekGroupsByDate[weekStart];
          if (!wg) return;
          const completed = wg.entries.filter(e => e.clock_out);
          const wExp = completed.reduce((s,e) => s + calcTotalExpected(e), 0);
          openPayModal(weekStart, weekEnd, wExp, payMap[weekStart] || null, sym, renderJournalPage, completed);
        });
      });
    }

  } catch (err) {
    page.innerHTML = `<div class="empty-state">Error loading journal</div>`;
  }
}

function renderWeekGroup(wg, ws, sym, payMap) {
  const weekKey   = dateToISODate(wg.start);
  const weekEnd   = dateToISODate(wg.end);
  const payPeriod = (payMap || {})[weekKey];
  const payStatus = payPeriod?.status || 'pending';
  const PAY_LABELS = { pending: 'PAY PENDING', received: 'PAY RECEIVED', delayed: 'PAY DELAYED', problem: 'PAY PROBLEM' };

  const weekLabel = getISOWeekLabel(wg.start);
  const dateRange = `${fmtDateShort(wg.start.toISOString())} – ${fmtDateShort(wg.end.toISOString())}`;
  const completed = wg.entries.filter(e => e.clock_out);
  const wHrs = completed.reduce((s,e) => s + getNetSeconds(e)/3600, 0);
  const wExp = completed.reduce((s,e) => s + calcTotalExpected(e), 0);

  const payRec     = payPeriod?.received_amount ?? null;
  const payVariance = payRec !== null ? payRec - wExp : null;

  return `
    <div class="week-group">
      <div class="week-header">
        <div class="week-header-left">
          <div class="week-label">${weekLabel} <span class="week-dates">${dateRange}</span></div>
          <div class="week-totals">${wHrs.toFixed(2)}h · ${sym}${wExp.toFixed(2)}</div>
        </div>
        <div class="week-header-right">
          <span class="pay-status-chip ${payStatus}">${PAY_LABELS[payStatus] || payStatus.toUpperCase()}</span>
          <a class="btn btn-ghost btn-sm" href="${api.getExportUrl(wg.start.toISOString(), wg.end.toISOString())}" title="Export week CSV" download>${svg('download')}</a>
          <button class="btn btn-ghost btn-sm pay-btn" data-week-start="${weekKey}" data-week-end="${weekEnd}">${svg('dollar')} Pay</button>
        </div>
      </div>
      ${(() => {
        // Group entries by calendar day, render a day header per group.
        // Revisits whose original is in the same week get a visual link.
        const revLinked = new Set();
        wg.entries.forEach(e => {
          if (e.revisit_of && wg.entries.some(o => o.id === e.revisit_of)) {
            revLinked.add(e.id); revLinked.add(e.revisit_of);
          }
        });
        const sorted = [...wg.entries].sort((a,b) => new Date(a.clock_in) - new Date(b.clock_in));
        const days = {};
        for (const e of sorted) {
          const k = new Date(e.clock_in).toLocaleDateString('en-CA');
          (days[k] = days[k] || []).push(e);
        }
        return Object.keys(days).sort().map(k => {
          const d = new Date(k + 'T12:00:00');
          const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          return `
          <div class="day-group">
            <div class="day-group-header">${label}</div>
            ${days[k].map(e => renderEntryCard(e, revLinked.has(e.id))).join('')}
          </div>`;
        }).join('');
      })()}
      <div class="week-summary">
        <span>Expected: <b>${sym}${wExp.toFixed(2)}</b></span>
        ${payRec !== null
          ? `<span>Paycheck: <b>${sym}${payRec.toFixed(2)}</b></span>
             <span class="${payVariance >= 0 ? 'pos' : 'neg'}">Δ ${payVariance >= 0 ? '+' : '−'}${sym}${Math.abs(payVariance).toFixed(2)}</span>`
          : ''}
      </div>
    </div>`;
}

function openPayModal(weekStart, weekEnd, expectedTotal, payPeriod, sym, onSave, entries = []) {
  const wsDate    = new Date(weekStart + 'T12:00:00');
  const weDate    = new Date(weekEnd   + 'T12:00:00');
  const dateRange = `${fmtDateShort(wsDate.toISOString())} – ${fmtDateShort(weDate.toISOString())}`;
  const curStatus = payPeriod?.status || 'pending';
  const curNotes  = payPeriod?.notes || '';

  // Per-entry pay override state (received amount replaces base for that job)
  const ovMap = {};
  entries.forEach(e => {
    ovMap[e.id] = {
      amount: e.received_pay != null ? parseFloat(e.received_pay) : null,
      note: e.pay_adjustment_note || '',
      date: (e.received_date || '').slice(0, 10),
    };
  });
  const baseFor = e => calcTotalExpected(e);
  const totalExpected = () => entries.length
    ? entries.reduce((s, e) => s + baseFor(e), 0)
    : expectedTotal;
  const receivedSum = () => entries.reduce((s, e) => {
    const ov = ovMap[e.id].amount;
    return s + (ov != null ? ov : baseFor(e));
  }, 0);
  const curAmount = payPeriod?.received_amount ?? (entries.length ? receivedSum() : expectedTotal);

  // Local calendar date of stored paid_at. New-format values are stored as
  // fixed UTC noon (YYYY-MM-DDT12:00:00Z) and round-trip via the date part;
  // legacy instants fall back to the local date of that moment.
  const paidAtDate = (() => {
    const pa = payPeriod?.paid_at || '';
    if (!pa) return '';
    if (pa.slice(11, 19) === '12:00:00') return pa.slice(0, 10);
    try { return new Date(pa).toLocaleDateString('en-CA'); } catch { return pa.slice(0, 10); }
  })();

  // When the stored weekly amount deliberately differs from the per-job sum
  // (or the user edits the field), stop auto-syncing it from the job list.
  let amountTouched = payPeriod?.received_amount != null &&
    entries.length > 0 && Math.abs(payPeriod.received_amount - receivedSum()) > 0.005;

  const metaFor = (o) => {
    const parts = [];
    if (o.note) parts.push(`✎ ${escHtml(o.note)}`);
    if (o.date) parts.push(`Received: ${escHtml(o.date)}`);
    return parts.join(' · ');
  };

  const entryRows = entries.map(e => {
    const o = ovMap[e.id];
    const shown = o.amount != null ? o.amount : baseFor(e);
    const meta = metaFor(o);
    return `
    <div class="pay-entry-row" data-id="${e.id}">
      <div class="pay-entry-head">
        <div class="pay-entry-info">
          <div class="pay-entry-title">${escHtml(fmtDateShort(e.clock_in))} · ${escHtml(e.wo_title || e.assignment_id || 'Work Order')}</div>
          <div class="pay-entry-base">Expected: ${sym}${baseFor(e).toFixed(2)}</div>
          <div class="pay-entry-meta ${meta ? '' : 'hidden'}" data-meta="${e.id}">${meta}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <div class="pay-entry-total" data-total="${e.id}">${sym}${shown.toFixed(2)}</div>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${e.id}" title="Edit pay for this job">${svg('edit')}</button>
        </div>
      </div>
      <div class="pay-entry-editor hidden" data-editor="${e.id}">
        <div class="input-row" style="margin-bottom:6px;">
          <div class="money-wrap" style="flex:1;">
            <span class="money-sym">${sym}</span>
            <input type="number" class="form-control" min="0" step="0.01" data-ov="${e.id}"
              placeholder="${baseFor(e).toFixed(2)}" value="${o.amount != null ? o.amount.toFixed(2) : ''}">
          </div>
          <button class="btn btn-ghost btn-sm" data-act="clear" data-id="${e.id}">Clear</button>
        </div>
        <input type="text" class="form-control" data-ovnote="${e.id}"
          placeholder="Reason / note for this day..." value="${escHtml(o.note)}">
        <div class="input-row" style="margin-top:6px;align-items:center;">
          <label style="font-size:12px;color:var(--text3);white-space:nowrap;">Received date</label>
          <input type="date" class="form-control" data-ovdate="${e.id}" value="${escHtml(o.date)}">
        </div>
      </div>
    </div>`;
  }).join('');

  openModal(`
    <div class="modal-header">
      <h3>${svg('dollar')} Weekly Pay</h3>
      <button class="btn btn-ghost btn-sm" id="pm-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="field-hint" style="margin-bottom:16px;">${dateRange}</div>
      <div class="form-group">
        <label class="form-label">Expected Total</label>
        <div style="font-size:20px;font-weight:700;color:var(--text);" id="pm-expected">${sym}${totalExpected().toFixed(2)}</div>
      </div>
      ${entries.length ? `
      <div class="form-group">
        <label class="form-label">Jobs this week</label>
        <div class="pay-entries-list">${entryRows}</div>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Amount Received</label>
        <div class="money-wrap">
          <span class="money-sym">${sym}</span>
          <input type="number" class="form-control" id="pm-amount" min="0" step="0.01" value="${curAmount.toFixed(2)}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Received Date <span style="color:var(--text3);font-weight:400;">(applies to all jobs unless set per job)</span></label>
        <input type="date" class="form-control" id="pm-week-date" value="${escHtml(paidAtDate)}">
      </div>
      <div class="form-group">
        <label class="form-label">Notes <span style="color:var(--text3);font-weight:400;">(optional)</span></label>
        <textarea class="form-control" id="pm-notes" rows="2" placeholder="e.g. short by $50, check 1234...">${escHtml(curNotes)}</textarea>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <span class="pay-status-chip ${curStatus === 'received' ? 'received' : 'pending'}" id="pm-status-chip">
          ${curStatus === 'received' ? 'PAY RECEIVED' : 'PAY PENDING'}
        </span>
        ${curStatus === 'received' ? `<button class="btn btn-ghost btn-sm" id="pm-unconfirm">Undo confirmation</button>` : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="pm-cancel">Cancel</button>
      <button class="btn ${curStatus === 'received' ? 'btn-primary' : 'btn-ghost'}" id="pm-save">Save</button>
      ${curStatus !== 'received' ? `<button class="btn btn-primary" id="pm-confirm">${svg('check')} Confirm PAY</button>` : ''}
    </div>`);

  document.getElementById('pm-close').addEventListener('click', closeModal);
  document.getElementById('pm-cancel').addEventListener('click', closeModal);

  // Per-entry override wiring
  const modalBody = document.getElementById('modal-body');
  const refreshTotals = () => {
    entries.forEach(e => {
      const el = modalBody.querySelector(`[data-total="${e.id}"]`);
      if (!el) return;
      const o = ovMap[e.id];
      const base = baseFor(e);
      const shown = o.amount != null ? o.amount : base;
      el.textContent = `${sym}${shown.toFixed(2)}`;
      el.style.color = o.amount == null ? '' : o.amount < base ? 'var(--red)' : o.amount > base ? 'var(--green)' : '';
      const metaEl = modalBody.querySelector(`[data-meta="${e.id}"]`);
      if (metaEl) {
        const meta = metaFor(o);
        metaEl.innerHTML = meta;
        metaEl.classList.toggle('hidden', !meta);
      }
    });
    // Live-sync weekly Amount Received with per-entry values (unless the
    // user set the weekly amount manually — then their value wins)
    const amountInp = document.getElementById('pm-amount');
    if (amountInp && entries.length && !amountTouched) amountInp.value = receivedSum().toFixed(2);
  };

  document.getElementById('pm-amount').addEventListener('input', () => { amountTouched = true; });

  modalBody.querySelectorAll('[data-act="edit"], [data-act="clear"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const editor = modalBody.querySelector(`[data-editor="${id}"]`);
      if (btn.dataset.act === 'clear') {
        ovMap[id].amount = null; ovMap[id].note = ''; ovMap[id].date = '';
        const ovInp = modalBody.querySelector(`[data-ov="${id}"]`);
        if (ovInp) ovInp.value = '';
        const noteInp = modalBody.querySelector(`[data-ovnote="${id}"]`);
        if (noteInp) noteInp.value = '';
        const dateInp = modalBody.querySelector(`[data-ovdate="${id}"]`);
        if (dateInp) dateInp.value = '';
        editor?.classList.add('hidden');
        refreshTotals();
        return;
      }
      const opening = editor?.classList.contains('hidden');
      editor?.classList.toggle('hidden');
      if (opening) {
        const ovInp = modalBody.querySelector(`[data-ov="${id}"]`);
        ovInp?.focus();
        ovInp?.select();
      }
    });
  });

  modalBody.querySelectorAll('[data-ov]').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      ovMap[inp.dataset.ov].amount = v === '' ? null : (parseFloat(v) || 0);
      refreshTotals();
    });
  });
  modalBody.querySelectorAll('[data-ovnote]').forEach(inp => {
    inp.addEventListener('input', () => {
      ovMap[inp.dataset.ovnote].note = inp.value.trim();
      refreshTotals();
    });
  });
  modalBody.querySelectorAll('[data-ovdate]').forEach(inp => {
    inp.addEventListener('input', () => {
      ovMap[inp.dataset.ovdate].date = inp.value;
      refreshTotals();
    });
  });

  const doSave = async (status, btn) => {
    const amount = parseFloat(document.getElementById('pm-amount').value) || null;
    const notes  = document.getElementById('pm-notes').value.trim() || null;
    const weekDate = document.getElementById('pm-week-date').value || '';
    const confirmDate = status === 'received' ? new Date().toLocaleDateString('en-CA') : null;
    // paid_at is stored as fixed UTC noon of the picked date so the date part
    // round-trips exactly (modal prefill and CSV both read the first 10 chars)
    let paid_at;
    if (status !== 'received' && payPeriod?.status === 'received') paid_at = null; // undo confirmation
    else if (weekDate)         paid_at = weekDate + 'T12:00:00Z';
    else if (paidAtDate)       paid_at = null;                  // user cleared a previously set date
    else if (confirmDate)      paid_at = confirmDate + 'T12:00:00Z';
    else                       paid_at = payPeriod?.paid_at || null;
    try {
      if (btn) btn.disabled = true;
      // Per-job default: week date if set, else day you confirm the pay
      const defaultDate = weekDate || confirmDate;
      // Persist changed per-entry overrides
      for (const e of entries) {
        const o = ovMap[e.id];
        const origAmount = e.received_pay != null ? parseFloat(e.received_pay) : null;
        const origNote = e.pay_adjustment_note || '';
        const origDate = (e.received_date || '').slice(0, 10);
        let newDate = o.date || '';
        if (!newDate && defaultDate) newDate = defaultDate;
        if (o.amount !== origAmount || o.note !== origNote || newDate !== origDate) {
          await api.updateEntry(e.id, {
            received_pay: o.amount,
            pay_adjustment_note: o.note || null,
            received_date: newDate || null,
          });
        }
      }
      await api.upsertPayPeriod({ week_start: weekStart, week_end: weekEnd, status, received_amount: amount, expected_total: totalExpected(), notes, paid_at });
      showToast(status === 'received' ? 'Pay confirmed' : 'Saved', 'success');
      closeModal();
      onSave();
    } catch (e) {
      showToast(e.message || 'Save failed', 'error');
      if (btn) btn.disabled = false;
    }
  };

  document.getElementById('pm-save').addEventListener('click', e => doSave(curStatus === 'received' ? 'received' : 'pending', e.currentTarget));
  document.getElementById('pm-confirm')?.addEventListener('click', e => doSave('received', e.currentTarget));
  document.getElementById('pm-unconfirm')?.addEventListener('click', e => doSave('pending', e.currentTarget));
}

function renderEntryCard(entry, linked = false) {
  const netSec = getNetSeconds(entry);
  const labor  = calcLabor(entry, netSec);
  const total  = calcTotalExpected(entry);
  const statusClass = entry.status || 'pending';

  return `
    <div class="entry-card${linked ? ' linked-visit' : ''}" data-id="${entry.id}">
      <div class="entry-card-top">
        <div class="entry-card-left">
          <div class="entry-title">${escHtml(entry.wo_title || entry.assignment_id || 'Work Order')}</div>
          <div class="entry-meta">${escHtml(entry.org_name||'')}${entry.client_name?' / '+escHtml(entry.client_name):''}${entry.project_name?` · <span style="color:var(--blue);">${escHtml(entry.project_name)}</span>`:''}</div>
          ${entry.address ? `<div class="entry-addr">${svg('location')} ${escHtml(entry.address)}</div>` : ''}
        </div>
        <div class="entry-card-right">
          ${entry.revisit_of ? `<button class="rev-badge" data-rev-of="${entry.revisit_of}" title="Open first visit">${svg('return')} REVISIT</button>` : ''}
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
      ${entry.project_name ? `<div class="review-row"><span>Project:</span><span>${escHtml(entry.project_name)}</span></div>` : ''}
      <div class="review-row"><span>Company:</span><span>${escHtml(entry.org_name||'—')}</span></div>
      <div class="review-row"><span>Customer:</span><span>${escHtml(entry.client_name||'—')}</span></div>
      <div class="review-row"><span>Assignment ID:</span><span>${escHtml(entry.assignment_id||'—')}</span></div>
      <div class="review-row"><span>Site ID:</span><span>${escHtml(entry.site_id||'—')}</span></div>
      <div class="review-row"><span>Address:</span><span>${escHtml(entry.address||'—')}</span></div>
      <div class="review-row"><span>Clock In:</span><span>${fmtTime(entry.clock_in)}</span></div>
      <div class="review-row"><span>Clock Out:</span><span>${fmtTime(entry.clock_out)}</span></div>
      <div class="review-row"><span>Net Time:</span><span>${fmtDecimalHours(netSec)}</span></div>
      <div class="review-row"><span>Pay Type:</span><span>${entry.rate_type === 'flat' ? 'Flat' : entry.rate_type === 'none' ? 'Non-Billable' : 'Hourly'}</span></div>
      ${entry.rate_type === 'hourly' || !entry.rate_type ? `<div class="review-row"><span>Rate:</span><span>${sym}${entry.hourly_rate||'—'}/hr</span></div>` : ''}
      <div class="review-row"><span>Labor:</span><span>${fmtMoney(labor)}</span></div>
      ${entry.travel_reimb ? `<div class="review-row"><span>Travel Reimb:</span><span>${fmtMoney(entry.travel_reimb)}</span></div>` : ''}
      ${entry.parking_tolls ? `<div class="review-row"><span>Parking/Tolls:</span><span>${fmtMoney(entry.parking_tolls)}</span></div>` : ''}
      ${entry.pay_adjustment_note ? `<div class="review-row"><span>Pay Note:</span><span>${escHtml(entry.pay_adjustment_note)}</span></div>` : ''}
      <div class="review-row total-row"><span>Total Expected:</span><span>${fmtMoney(total)}</span></div>
      <div class="review-row"><span>Status:</span><span class="status-chip ${entry.status||'pending'}">${(entry.status||'pending').toUpperCase()}</span></div>
      ${entry.mod_name ? `<div class="review-row"><span>MOD:</span><span>${escHtml(entry.mod_name)}</span></div>` : ''}
      ${entry.noc_name ? `<div class="review-row"><span>NOC:</span><span>${escHtml(entry.noc_name)}</span></div>` : ''}
      ${entry.pm_pc_name ? `<div class="review-row"><span>PM/PC:</span><span>${escHtml(entry.pm_pc_name)}</span></div>` : ''}
      ${entry.ticket_num ? `<div class="review-row"><span>Ticket #:</span><span>${escHtml(entry.ticket_num)}</span></div>` : ''}
      ${entry.release_code ? `<div class="review-row"><span>Release Code:</span><span>${escHtml(entry.release_code)}</span></div>` : ''}
      ${mats.length ? '<div class="review-row"><span>Materials:</span><span>' + mats.map(m=>escHtml(m.name+(m.price?' ($'+m.price+')':''))).join(', ') + '</span></div>' : ''}
      ${entry.work_summary ? `<div class="review-row" style="align-items:flex-start;"><span>Summary:</span><span style="white-space:pre-wrap;">${escHtml(entry.work_summary)}</span></div>` : ''}
      <div id="det-photos"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" id="det-copy-btn">${svg('copy')} Copy Report</button>
      <a class="btn btn-ghost btn-sm" href="${api.getEntryZipUrl(entry.id)}" download>${svg('download')} Export ZIP</a>
      ${entry.clock_out ? `<button class="btn btn-secondary btn-sm" id="det-revisit-btn">${svg('return')} Revisit</button>` : ''}
      <button class="btn btn-primary btn-sm" id="det-edit-btn">${svg('edit')} Edit</button>
    </div>`);

  document.getElementById('det-close-btn').addEventListener('click', closeModal);
  document.getElementById('det-copy-btn').addEventListener('click', () => {
    copyToClipboard(buildTextReport(entry));
  });
  document.getElementById('det-edit-btn').addEventListener('click', () => openEntryEdit(entry));
  document.getElementById('det-revisit-btn')?.addEventListener('click', () => openRevisitModal(entry));

  (async () => {
    const photosDiv = document.getElementById('det-photos');
    if (!photosDiv) return;
    try {
      const photos = await api.getPhotos(entry.id);
      if (!photos.length) return;
      photosDiv.innerHTML = buildPhotoGallery(photos);
    } catch (e) { /* silently skip if photos unavailable */ }
  })();
}

async function openEntryEdit(entry) {
  const sym    = state.settings.currency_symbol || '$';
  const isFlat = entry.rate_type === 'flat';
  const mats   = parseMaterials(entry.materials);

  try { state.projects = await api.getProjects(); } catch { state.projects = state.projects || []; }
  const projOpts = (state.projects || []).map(p =>
    `<option value="${p.id}" ${entry.project_id == p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');

  // Candidates for "Revisit of" — recent completed WOs, excluding this one
  let revOpts = '';
  try {
    const all = await api.getEntries();
    revOpts = all
      .filter(e => e.id !== entry.id && e.clock_out)
      .slice(0, 100)
      .map(e => `<option value="${e.id}" ${entry.revisit_of == e.id ? 'selected' : ''}>${escHtml(fmtDateShort(e.clock_in))} — ${escHtml(e.wo_title || e.assignment_id || 'WO #' + e.id)}</option>`)
      .join('');
  } catch { /* select stays minimal */ }

  const rateOpts = state.payRates.map(r =>
    `<option value="${r.id}" ${Number(entry.pay_rate_id) === r.id ? 'selected' : ''}>${escHtml(r.name)} — ${sym}${r.rate}/hr</option>`
  ).join('');

  openModal(`
    <div class="modal-header">
      <h3>${svg('edit')} Edit Work Order</h3>
      <button class="btn btn-ghost btn-sm" id="ee-close-btn">✕</button>
    </div>
    <div class="modal-body">

      <div class="form-group">
        <label class="form-label">WO Title</label>
        <input type="text" class="form-control" id="ee-wo-title" value="${escHtml(entry.wo_title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Project</label>
        <select class="form-control" id="ee-project">
          <option value="">— No Project —</option>
          ${projOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Revisit of <span class="opt-label">optional</span></label>
        <select class="form-control" id="ee-revisit-of">
          <option value="">— Not a revisit —</option>
          ${revOpts}
        </select>
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
          <label class="form-label">Site ID</label>
          <input type="text" class="form-control" id="ee-site-id" value="${escHtml(entry.site_id||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Assignment ID</label>
          <input type="text" class="form-control" id="ee-assignment" value="${escHtml(entry.assignment_id||'')}">
        </div>
      </div>

      <div class="divider"></div>
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

      <div class="divider"></div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">Ticket #</label>
          <input type="text" class="form-control" id="ee-ticket" value="${escHtml(entry.ticket_num||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">INC #</label>
          <input type="text" class="form-control" id="ee-inc" value="${escHtml(entry.inc_num||'')}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">MOD Name</label>
        <input type="text" class="form-control" id="ee-mod" value="${escHtml(entry.mod_name||'')}">
      </div>
      <div class="row-2">
        <div class="form-group">
          <label class="form-label">NOC Name</label>
          <input type="text" class="form-control" id="ee-noc" value="${escHtml(entry.noc_name||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">PM/PC Name</label>
          <input type="text" class="form-control" id="ee-pmpc" value="${escHtml(entry.pm_pc_name||'')}">
        </div>
      </div>

      <div class="divider"></div>
      <div class="form-group">
        <label class="form-label">Pay Type</label>
        <div class="toggle-group" id="ee-pay-type-toggle">
          <button class="toggle-btn ${!isFlat?'active':''}" data-type="hourly">Hourly</button>
          <button class="toggle-btn ${isFlat?'active':''}" data-type="flat">Flat</button>
        </div>
      </div>
      <div class="form-group ${isFlat?'hidden':''}" id="ee-hourly-rate-group">
        <label class="form-label">Hourly Rate</label>
        <select class="form-control" id="ee-rate-select">
          <option value="">— Select Rate —</option>
          ${rateOpts}
        </select>
      </div>
      <div class="form-group ${!isFlat?'hidden':''}" id="ee-flat-rate-group">
        <label class="form-label">Flat Rate (${sym})</label>
        <div class="money-wrap">
          <span class="money-sym">${sym}</span>
          <input type="number" class="form-control" id="ee-flat-amount" min="0" step="0.01" value="${entry.flat_amount||''}">
        </div>
      </div>

      <div class="divider"></div>
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Removal / Replacement?</label>
          <label class="switch"><input type="checkbox" id="ee-replacement" ${entry.is_replacement?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="ee-replacement-fields" class="${entry.is_replacement?'':'hidden'}">
        <div class="form-group">
          <label class="form-label">Return Track #</label>
          <div class="input-row">
            <input type="text" class="form-control" id="ee-return-track" value="${escHtml(entry.return_track||'')}" ${entry.no_return_track?'disabled':''}>
            <button class="btn btn-ghost btn-sm" id="ee-no-return-btn" style="white-space:nowrap;">${entry.no_return_track?'Undo N/a':'No Return'}</button>
          </div>
          <div id="ee-no-return-label" class="${entry.no_return_track?'':'hidden'} field-hint" style="color:var(--orange);">⚠ Marked as N/a</div>
        </div>
      </div>

      <div class="divider"></div>
      <div class="form-group">
        <label class="form-label">Travel Reimb (${sym})</label>
        <div class="money-wrap">
          <span class="money-sym">${sym}</span>
          <input type="number" class="form-control" id="ee-travel-reimb" min="0" step="0.01" value="${entry.travel_reimb||''}">
        </div>
      </div>
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Parking / Tolls?</label>
          <label class="switch"><input type="checkbox" id="ee-parking-toggle" ${entry.parking_tolls?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="ee-parking-group" class="${entry.parking_tolls?'':'hidden'} form-group">
        <label class="form-label">Parking Amount</label>
        <div class="money-wrap">
          <span class="money-sym">${sym}</span>
          <input type="number" class="form-control" id="ee-parking-amount" min="0" step="0.01" value="${entry.parking_tolls||''}">
        </div>
      </div>
      <div class="form-group">
        <div class="toggle-row">
          <label class="form-label" style="margin:0;">Materials?</label>
          <label class="switch"><input type="checkbox" id="ee-materials-toggle" ${mats.length?'checked':''}><span class="slider"></span></label>
        </div>
      </div>
      <div id="ee-materials-group" class="${mats.length?'':'hidden'}">
        <div id="materials-list"></div>
        <button class="btn btn-ghost btn-sm" id="add-material-btn" style="margin-top:8px;">${svg('plus')} Add Material</button>
      </div>

      <div class="divider"></div>
      <div class="form-group">
        <label class="form-label">Release Code</label>
        <div class="input-row">
          <input type="text" class="form-control" id="ee-release-code" value="${escHtml(entry.release_code||'')}" ${entry.no_release_code?'disabled':''}>
          <button class="btn btn-ghost btn-sm" id="ee-no-code-btn" style="white-space:nowrap;">${entry.no_release_code?'Undo N/a':'No Code'}</button>
        </div>
        <div id="ee-no-code-label" class="${entry.no_release_code?'':'hidden'} field-hint" style="color:var(--orange);">⚠ Marked as N/a</div>
      </div>
      <div class="form-group">
        <label class="form-label">Work Summary</label>
        <textarea class="form-control" id="ee-work-summary" rows="4">${escHtml(entry.work_summary||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">WO Status</label>
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

  // Pay type toggle
  let eeRateType = isFlat ? 'flat' : 'hourly';
  document.getElementById('ee-pay-type-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    eeRateType = btn.dataset.type;
    document.querySelectorAll('#ee-pay-type-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('ee-hourly-rate-group').classList.toggle('hidden', eeRateType === 'flat');
    document.getElementById('ee-flat-rate-group').classList.toggle('hidden', eeRateType === 'hourly');
  });

  // Replacement toggle
  let eeNoReturn = !!entry.no_return_track;
  document.getElementById('ee-replacement').addEventListener('change', e => {
    document.getElementById('ee-replacement-fields').classList.toggle('hidden', !e.target.checked);
  });
  document.getElementById('ee-no-return-btn').addEventListener('click', () => {
    eeNoReturn = !eeNoReturn;
    document.getElementById('ee-return-track').disabled = eeNoReturn;
    document.getElementById('ee-return-track').value = eeNoReturn ? '' : (entry.return_track || '');
    document.getElementById('ee-no-return-label').classList.toggle('hidden', !eeNoReturn);
    document.getElementById('ee-no-return-btn').textContent = eeNoReturn ? 'Undo N/a' : 'No Return';
  });

  // Parking toggle
  document.getElementById('ee-parking-toggle').addEventListener('change', e => {
    document.getElementById('ee-parking-group').classList.toggle('hidden', !e.target.checked);
  });

  // Materials toggle + editor
  document.getElementById('ee-materials-toggle').addEventListener('change', e => {
    document.getElementById('ee-materials-group').classList.toggle('hidden', !e.target.checked);
  });
  setupMaterialsUI(mats);

  // Release code toggle
  let eeNoCode = !!entry.no_release_code;
  document.getElementById('ee-no-code-btn').addEventListener('click', () => {
    eeNoCode = !eeNoCode;
    document.getElementById('ee-release-code').disabled = eeNoCode;
    document.getElementById('ee-release-code').value = eeNoCode ? '' : (entry.release_code || '');
    document.getElementById('ee-no-code-label').classList.toggle('hidden', !eeNoCode);
    document.getElementById('ee-no-code-btn').textContent = eeNoCode ? 'Undo N/a' : 'No Code';
  });

  document.getElementById('ee-close-btn').addEventListener('click', closeModal);
  document.getElementById('ee-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('ee-save-btn').addEventListener('click', async () => {
    const parkingOn = document.getElementById('ee-parking-toggle').checked;
    const matsOn    = document.getElementById('ee-materials-toggle').checked;
    const isRepl    = document.getElementById('ee-replacement').checked;
    try {
      await api.updateEntry(entry.id, {
        wo_title:        document.getElementById('ee-wo-title').value.trim() || null,
        project_id:      document.getElementById('ee-project').value ? Number(document.getElementById('ee-project').value) : null,
        revisit_of:      document.getElementById('ee-revisit-of').value ? Number(document.getElementById('ee-revisit-of').value) : null,
        organization_id: document.getElementById('ee-company').value    ? Number(document.getElementById('ee-company').value)    : null,
        client_id:       document.getElementById('ee-customer').value   ? Number(document.getElementById('ee-customer').value)   : null,
        site_id:         document.getElementById('ee-site-id').value.trim() || null,
        assignment_id:   document.getElementById('ee-assignment').value.trim() || null,
        clock_in:        toISOFull(document.getElementById('ee-clock-in').value),
        clock_out:       document.getElementById('ee-clock-out').value ? toISOFull(document.getElementById('ee-clock-out').value) : null,
        address:         document.getElementById('ee-address').value.trim() || null,
        ticket_num:      document.getElementById('ee-ticket').value.trim() || null,
        inc_num:         document.getElementById('ee-inc').value.trim() || null,
        mod_name:        document.getElementById('ee-mod').value.trim() || null,
        noc_name:        document.getElementById('ee-noc').value.trim() || null,
        pm_pc_name:      document.getElementById('ee-pmpc').value.trim() || null,
        rate_type:       eeRateType,
        pay_rate_id:     (eeRateType === 'hourly' && document.getElementById('ee-rate-select').value)
                           ? Number(document.getElementById('ee-rate-select').value) : null,
        flat_amount:     eeRateType === 'flat' ? (parseFloat(document.getElementById('ee-flat-amount').value) || null) : null,
        is_replacement:  isRepl ? 1 : 0,
        no_return_track: (isRepl && eeNoReturn) ? 1 : 0,
        return_track:    (isRepl && !eeNoReturn) ? document.getElementById('ee-return-track').value.trim() || null : null,
        travel_reimb:    parseFloat(document.getElementById('ee-travel-reimb').value) || null,
        parking_tolls:   parkingOn ? (parseFloat(document.getElementById('ee-parking-amount').value) || null) : null,
        materials:       matsOn ? readMaterialsFromDOM() : null,
        release_code:    eeNoCode ? null : (document.getElementById('ee-release-code').value.trim() || null),
        no_release_code: eeNoCode ? 1 : 0,
        work_summary:    document.getElementById('ee-work-summary').value.trim() || null,
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
    const [all, allPayPeriods, allTrips] = await Promise.all([api.getEntries(), api.getPayPeriods(), api.getTrips().catch(() => [])]);
    const sym = state.settings.currency_symbol || '$';
    const now = new Date();
    const ws  = state.settings.week_start === '7' ? 0 : 1;

    const period = state.overviewPeriod;
    const offset = state.overviewOffset || 0;

    // Compute date range
    let fromDate = null, toDate = null;
    if (period === 'week') {
      const ref = new Date(now); ref.setDate(now.getDate() - offset * 7);
      const { start, end } = getWeekBounds(ref, ws);
      fromDate = start; toDate = end;
    } else if (period === 'month') {
      const m = now.getMonth() - offset;
      const yr = now.getFullYear() + Math.floor(m / 12);
      const mo = ((m % 12) + 12) % 12;
      fromDate = new Date(yr, mo, 1);
      toDate   = new Date(yr, mo + 1, 0, 23, 59, 59);
    }

    const filtered = all.filter(e => {
      if (!e.clock_out) return false;
      const d = new Date(e.clock_in);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });

    const totalExpected = filtered.reduce((s,e) => s + calcTotalExpected(e), 0);
    const totalHrs = filtered.reduce((s,e) => s + getNetSeconds(e)/3600, 0);
    const jobCount = filtered.length;
    // Time-weighted: total labor / total paid hours (a 30-min flat job must
    // not skew the average the way per-job rate averaging did)
    let paidLabor = 0, paidHrs = 0;
    for (const e of filtered) {
      const hrs = getNetSeconds(e) / 3600;
      const labor = calcLabor(e, getNetSeconds(e));
      if (hrs > 0 && labor > 0) { paidLabor += labor; paidHrs += hrs; }
    }
    const avgRate = paidHrs > 0 ? paidLabor / paidHrs : null;

    // By company
    const byCompany = {};
    for (const e of filtered) {
      const k = e.org_name || 'Unknown';
      if (!byCompany[k]) byCompany[k] = { jobs: 0, hrs: 0, earned: 0 };
      byCompany[k].jobs++;
      byCompany[k].hrs   += getNetSeconds(e)/3600;
      byCompany[k].earned += calcTotalExpected(e);
    }

    // By status
    const allFiltered = all.filter(e => {
      const d = new Date(e.clock_in);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });
    const byStatus = { pending:0, completed:0, fail:0, cancel:0 };
    for (const e of allFiltered) byStatus[e.status || 'pending']++;

    // Last 8 weeks bar chart
    const weekBars = [];
    let prevBarMonth = null;
    for (let w = 7; w >= 0; w--) {
      const refDate = new Date(now); refDate.setDate(refDate.getDate() - w * 7);
      const { start: ws2, end: we2 } = getWeekBounds(refDate, ws);
      const wEntries = all.filter(e => { const d = new Date(e.clock_in); return d >= ws2 && d <= we2 && e.clock_out; });
      const monStr  = ws2.toLocaleDateString('en-US', { month: 'short' });
      const wkNum   = getISOWeekNum(ws2);
      const newMon  = monStr !== prevBarMonth;
      prevBarMonth  = monStr;
      weekBars.push({
        monLabel: newMon ? monStr : '',
        wkLabel:  `W${wkNum}`,
        earned:   wEntries.reduce((s,e) => s + calcTotalExpected(e), 0),
        newMon,
      });
    }
    const maxBar = Math.max(...weekBars.map(w => w.earned), 1);

    // Pay period summary (all-time)
    const payStat = {
      pending:  { list:[], expected:0 },
      delayed:  { list:[], expected:0 },
      problem:  { list:[], expected:0, received:0 },
      received: { list:[], expected:0, received:0 },
    };
    for (const pp of allPayPeriods) {
      const st = pp.status || 'pending';
      if (!payStat[st]) continue;
      const wsD = new Date(pp.week_start + 'T00:00:00');
      const weD = new Date(pp.week_end   + 'T23:59:59');
      const exp = all.filter(e => e.clock_out && new Date(e.clock_in) >= wsD && new Date(e.clock_in) <= weD)
                     .reduce((s,e) => s + calcTotalExpected(e), 0);
      payStat[st].list.push(pp.week_start);
      payStat[st].expected += exp;
      if (pp.received_amount != null) payStat[st].received += pp.received_amount;
    }
    const outstanding = payStat.pending.expected + payStat.delayed.expected + Math.max(0, payStat.problem.expected - payStat.problem.received);
    const hasPayData  = allPayPeriods.length > 0;

    // Mileage stats
    const filteredTrips = allTrips.filter(t => {
      if (t.status !== 'completed') return false;
      const d = new Date(t.start_time);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });
    const totalMiles = filteredTrips.reduce((s,t) => s + (t.distance || 0), 0);
    const totalTaxDed = filteredTrips.reduce((s,t) => s + (t.tax_deduction || 0), 0);
    const totalDrivingSec = filteredTrips.reduce((s,t) => {
      if (!t.start_time || !t.end_time) return s;
      return s + Math.max(0, Math.floor((new Date(t.end_time) - new Date(t.start_time))/1000));
    }, 0);

    // Sub-select options
    const weekOpts  = ['This Week','Last Week','2 Wks Ago','3 Wks Ago','4 Wks Ago'];
    const monthOpts = ['This Month','Last Month','2 Mo Ago','3 Mo Ago','4 Mo Ago'];

    page.innerHTML = `
      <div class="p-16">
        <div class="period-toggle" id="period-toggle">
          <button class="toggle-btn ${period==='week' ?'active':''}" data-p="week">Week</button>
          <button class="toggle-btn ${period==='month'?'active':''}" data-p="month">Month</button>
          <button class="toggle-btn ${period==='all'  ?'active':''}" data-p="all">All Time</button>
        </div>
        ${period !== 'all' ? `
        <select class="period-sub-select" id="period-offset-select">
          ${(period === 'week' ? weekOpts : monthOpts).map((lbl,i) =>
            `<option value="${i}"${offset===i?' selected':''}>${lbl}</option>`
          ).join('')}
        </select>` : ''}

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Expected</div>
            <div class="stat-value">${sym}${totalExpected.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Hours Worked</div>
            <div class="stat-value">${totalHrs.toFixed(1)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Jobs Done</div>
            <div class="stat-value">${jobCount}</div>
          </div>
          ${avgRate ? `<div class="stat-card"><div class="stat-label">Avg Rate</div><div class="stat-value">${sym}${avgRate.toFixed(1)}/hr</div></div>` : ''}
        </div>

        <div class="section-label">Earnings — Last 8 Weeks</div>
        <div class="card">
          <div class="bar-chart">
            ${weekBars.map(w => `
              <div class="bar-item${w.newMon ? ' bar-new-month' : ''}">
                <div class="bar-fill" style="height:${Math.round((w.earned/maxBar)*100)}%;" title="${sym}${w.earned.toFixed(2)}"></div>
                <div class="bar-label">
                  <span class="bar-mon-lbl">${w.monLabel || '&nbsp;'}</span>
                  <span>${w.wkLabel}</span>
                </div>
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

        <div class="section-label">Mileage</div>
        <div class="card">
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-label">Total Miles</div><div class="stat-value">${totalMiles.toFixed(1)}</div></div>
            <div class="stat-card"><div class="stat-label">Drive Time</div><div class="stat-value">${fmtDecimalHours(totalDrivingSec)}</div></div>
            <div class="stat-card"><div class="stat-label">Tax Deductions</div><div class="stat-value">${sym}${totalTaxDed.toFixed(2)}</div></div>
            ${filteredTrips.length > 0 ? `<div class="stat-card"><div class="stat-label">Trips</div><div class="stat-value">${filteredTrips.length}</div></div>` : ''}
          </div>
          ${filteredTrips.length === 0 ? '<div class="empty-state-sm">No trips in this period</div>' : ''}
        </div>

        <div class="section-label">Pay Status</div>
        <div class="card" style="padding:4px 16px;">
          ${!hasPayData ? '<div class="empty-state-sm" style="padding:12px 0;">No pay periods tracked yet — mark pay in the Journal tab</div>' : `
          ${payStat.pending.list.length  ? `<div class="pay-summary-row"><div><span class="pay-status-chip pending">PAY PENDING</span><div class="pay-week-tags">${payStat.pending.list.map(fmtMMMWk).join(' · ')}</div></div><b>${sym}${payStat.pending.expected.toFixed(2)}</b></div>` : ''}
          ${payStat.delayed.list.length  ? `<div class="pay-summary-row"><div><span class="pay-status-chip delayed">PAY DELAYED</span><div class="pay-week-tags">${payStat.delayed.list.map(fmtMMMWk).join(' · ')}</div></div><b>${sym}${payStat.delayed.expected.toFixed(2)}</b></div>` : ''}
          ${payStat.problem.list.length  ? `<div class="pay-summary-row"><div><span class="pay-status-chip problem">PAY PROBLEM</span><div class="pay-week-tags">${payStat.problem.list.map(fmtMMMWk).join(' · ')}</div></div><div style="text-align:right;"><b>${sym}${payStat.problem.expected.toFixed(2)}</b><div style="font-size:11px;color:var(--red);">rcvd ${sym}${payStat.problem.received.toFixed(2)} · Δ −${sym}${(payStat.problem.expected-payStat.problem.received).toFixed(2)}</div></div></div>` : ''}
          ${payStat.received.list.length ? `<div class="pay-summary-row"><div><span class="pay-status-chip received">PAY RECEIVED</span><div class="pay-week-tags">${payStat.received.list.map(fmtMMMWk).join(' · ')}</div></div><b style="color:var(--green)">${sym}${payStat.received.received.toFixed(2)}</b></div>` : ''}
          ${outstanding > 0 ? `<div class="pay-summary-outstanding"><span>Outstanding</span><span style="color:var(--red);">−${sym}${outstanding.toFixed(2)}</span></div>` : ''}`}
        </div>
      </div>`;

    document.getElementById('period-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      if (btn.dataset.p !== state.overviewPeriod) state.overviewOffset = 0;
      state.overviewPeriod = btn.dataset.p;
      renderOverviewPage();
    });
    document.getElementById('period-offset-select')?.addEventListener('change', e => {
      state.overviewOffset = parseInt(e.target.value);
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

      <!-- Trip Settings -->
      <div class="section-label">Trip Settings</div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">IRS Mileage Rate ($/mi)</label>
          <div class="money-wrap">
            <span class="money-sym">$</span>
            <input type="number" class="form-control" id="s-mileage-rate" value="${escHtml(s.mileage_rate||'0.67')}" min="0" step="0.01" style="max-width:120px;">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="s-save-mileage-btn">${svg('check')} Save Rate</button>
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

  // Trip Settings — Mileage rate save
  document.getElementById('s-save-mileage-btn').addEventListener('click', async () => {
    const rate = document.getElementById('s-mileage-rate').value.trim();
    if (!rate) { showToast('Rate required', 'error'); return; }
    try {
      state.settings = await api.saveSettings({ mileage_rate: rate });
      showToast('Mileage rate saved', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });

}

function refreshTripCatList() {
  const card = document.getElementById('trip-cat-card');
  if (!card) return;
  // Re-render list items before the form group
  const formGroup = card.querySelector('.form-group');
  // Remove existing list items
  card.querySelectorAll('.list-item').forEach(el => el.remove());
  card.querySelectorAll('.empty-state-sm').forEach(el => el.remove());
  // Insert new list
  const tmp = document.createElement('div');
  tmp.innerHTML = renderTripCategoriesList();
  while (tmp.firstChild) {
    card.insertBefore(tmp.firstChild, formGroup || null);
  }
  rewireTripCatDeleteBtns();
}

function rewireTripCatDeleteBtns() {
  document.querySelectorAll('.trip-cat-del-btn').forEach(btn => {
    // Remove existing listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async () => {
      const id = parseInt(newBtn.dataset.id);
      const cat = state.tripCategories.find(c => c.id === id);
      if (!confirm(`Delete category "${cat?.name || id}"?`)) return;
      try {
        await api.deleteTripCategory(id);
        state.tripCategories = state.tripCategories.filter(c => c.id !== id);
        refreshTripCatList();
      } catch (e) { showToast(e.message, 'error'); }
    });
  });
}

function renderTripCategoriesList() {
  if (!state.tripCategories.length) return '<div class="empty-state-sm">No trip categories yet</div>';
  return state.tripCategories.map(c => `
    <div class="list-item">
      <div class="list-item-info"><div class="list-item-name">${escHtml(c.name)}</div></div>
      <div class="list-item-actions">
        <button class="btn btn-ghost btn-sm trip-cat-del-btn" data-id="${c.id}" style="color:var(--red);">${svg('trash')}</button>
      </div>
    </div>`).join('');
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
    state.tripCategories = await api.getTripCategories().catch(() => []);
    try { state.currentTrip = await api.getCurrentTrip(); } catch { state.currentTrip = null; }
  } catch (e) {
    console.error('Init failed:', e);
  }
  renderPage();
}

init();
