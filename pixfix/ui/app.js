// pixfix — application logic
// Uses window.__TAURI__ (withGlobalTauri: true in tauri.conf.json)

const { invoke } = window.__TAURI__.core;
const { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  activeTab: 'preview',
  imageLoaded: false,
  imagePath: null,
  imageInfo: null,
  settingsFocusIndex: 0,
  processing: false,
  editingKey: null,  // which setting key is being inline-edited
  palettes: [],
  paletteIndex: 0,

  // Current config values (mirrors ProcessConfig)
  config: {
    gridSize: null,        // null = auto
    downscaleMode: 'snap',
    aaThreshold: null,     // null = off
    paletteName: null,     // null = off
    autoColors: null,      // null = off
    removeBg: false,
    bgTolerance: 0.05,
    floodFill: true,
  },
};

// Default config for reset
const DEFAULT_CONFIG = JSON.parse(JSON.stringify(state.config));

// ---------------------------------------------------------------------------
// Settings definitions
// ---------------------------------------------------------------------------

const DOWNSCALE_MODES = ['snap', 'center-weighted', 'majority-vote', 'center-pixel'];

function getSettings() {
  const c = state.config;
  return [
    { section: 'Grid' },
    {
      key: 'gridSize', label: 'Grid Size',
      value: c.gridSize === null ? 'auto' : String(c.gridSize),
      help: 'Detected logical pixel size. Override or leave as auto.',
      changed: c.gridSize !== null,
    },
    {
      key: 'downscaleMode', label: 'Mode',
      value: c.downscaleMode,
      help: 'snap = clean in-place, others reduce to logical resolution.',
      changed: c.downscaleMode !== 'snap',
    },
    { section: 'Colors' },
    {
      key: 'aaThreshold', label: 'AA Removal',
      value: c.aaThreshold === null ? 'off' : c.aaThreshold.toFixed(2),
      help: 'Anti-aliasing removal threshold (0.0-1.0). Lower = more aggressive.',
      changed: c.aaThreshold !== null,
    },
    {
      key: 'paletteName', label: 'Palette',
      value: c.paletteName === null ? 'none' : c.paletteName,
      help: 'Snap colors to a predefined palette.',
      changed: c.paletteName !== null,
    },
    {
      key: 'autoColors', label: 'Auto Colors',
      value: c.autoColors === null ? 'off' : String(c.autoColors),
      help: 'Auto-extract N colors via k-means quantization.',
      changed: c.autoColors !== null,
    },
    { section: 'Background' },
    {
      key: 'removeBg', label: 'Remove BG',
      value: c.removeBg ? 'on' : 'off',
      help: 'Detect and remove background color.',
      changed: c.removeBg,
    },
    {
      key: 'bgTolerance', label: 'BG Tolerance',
      value: c.bgTolerance.toFixed(2),
      help: 'Color distance threshold for background matching.',
      changed: c.bgTolerance !== 0.05,
    },
    {
      key: 'floodFill', label: 'Flood Fill',
      value: c.floodFill ? 'on' : 'off',
      help: 'Use flood-fill from corners (on) or global replace (off).',
      changed: !c.floodFill,
    },
  ];
}

function getSettingRows() {
  return getSettings().filter(s => !s.section);
}

// ---------------------------------------------------------------------------
// Setting adjustment
// ---------------------------------------------------------------------------

function adjustSetting(key, direction) {
  const c = state.config;
  switch (key) {
    case 'gridSize':
      if (c.gridSize === null) {
        c.gridSize = state.imageInfo?.gridSize || 4;
      } else {
        c.gridSize = Math.max(1, c.gridSize + direction);
        if (c.gridSize === 1 && direction < 0) c.gridSize = null; // back to auto
      }
      break;
    case 'downscaleMode': {
      let idx = DOWNSCALE_MODES.indexOf(c.downscaleMode);
      idx = (idx + direction + DOWNSCALE_MODES.length) % DOWNSCALE_MODES.length;
      c.downscaleMode = DOWNSCALE_MODES[idx];
      break;
    }
    case 'aaThreshold':
      if (c.aaThreshold === null) {
        c.aaThreshold = 0.50;
      } else {
        c.aaThreshold = Math.round((c.aaThreshold + direction * 0.05) * 100) / 100;
        if (c.aaThreshold <= 0) c.aaThreshold = null; // back to off
        else if (c.aaThreshold > 1.0) c.aaThreshold = 1.0;
      }
      break;
    case 'paletteName': {
      const names = [null, ...state.palettes.map(p => p.slug)];
      let idx = names.indexOf(c.paletteName);
      idx = (idx + direction + names.length) % names.length;
      c.paletteName = names[idx];
      // If palette is set, disable autoColors
      if (c.paletteName !== null) c.autoColors = null;
      break;
    }
    case 'autoColors':
      if (c.autoColors === null) {
        c.autoColors = 16;
      } else {
        c.autoColors = Math.max(2, c.autoColors + direction * 2);
        if (c.autoColors <= 2 && direction < 0) c.autoColors = null; // back to off
        else if (c.autoColors > 256) c.autoColors = 256;
      }
      // If autoColors is set, disable palette
      if (c.autoColors !== null) c.paletteName = null;
      break;
    case 'removeBg':
      c.removeBg = !c.removeBg;
      break;
    case 'bgTolerance':
      c.bgTolerance = Math.round((c.bgTolerance + direction * 0.01) * 100) / 100;
      c.bgTolerance = Math.max(0.01, Math.min(0.50, c.bgTolerance));
      break;
    case 'floodFill':
      c.floodFill = !c.floodFill;
      break;
  }
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function setStatus(msg, type = '') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function showSpinners() {
  document.getElementById('preview-spinner')?.classList.add('active');
  document.getElementById('settings-spinner')?.classList.add('active');
}

function hideSpinners() {
  document.getElementById('preview-spinner')?.classList.remove('active');
  document.getElementById('settings-spinner')?.classList.remove('active');
}

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
}

function renderSettings() {
  const list = document.getElementById('settings-list');
  const settings = getSettings();
  let rowIndex = 0;
  let html = '';
  for (const s of settings) {
    if (s.section) {
      html += `<div class="setting-section">${s.section}</div>`;
    } else {
      const focused = rowIndex === state.settingsFocusIndex ? ' focused' : '';
      const changed = s.changed ? ' changed' : '';
      const editing = state.editingKey === s.key;
      html += `<div class="setting-row${focused}" data-index="${rowIndex}" data-key="${s.key}">`;
      html += `<span class="setting-indicator">&#9654;</span>`;
      html += `<span class="setting-label">${s.label}</span>`;
      html += `<span class="setting-value${changed}">`;
      if (editing) {
        html += renderEditWidget(s.key);
      } else {
        html += s.value;
      }
      html += `</span>`;
      html += `</div>`;
      html += `<div class="setting-help">${s.help}</div>`;
      rowIndex++;
    }
  }
  list.innerHTML = html;

  // Focus the input/select if editing
  if (state.editingKey) {
    const el = list.querySelector('.setting-edit');
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT') el.select();
    }
  }
}

function renderEditWidget(key) {
  const c = state.config;
  switch (key) {
    case 'gridSize': {
      const val = c.gridSize === null ? '' : c.gridSize;
      return `<input class="setting-edit" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'aaThreshold': {
      const val = c.aaThreshold === null ? '' : c.aaThreshold.toFixed(2);
      return `<input class="setting-edit" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case 'autoColors': {
      const val = c.autoColors === null ? '' : c.autoColors;
      return `<input class="setting-edit" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case 'bgTolerance': {
      const val = c.bgTolerance.toFixed(2);
      return `<input class="setting-edit" type="text" value="${val}" data-key="${key}">`;
    }
    case 'downscaleMode': {
      let opts = DOWNSCALE_MODES.map(m =>
        `<option value="${m}"${m === c.downscaleMode ? ' selected' : ''}>${m}</option>`
      ).join('');
      return `<select class="setting-edit" data-key="${key}">${opts}</select>`;
    }
    case 'paletteName': {
      let opts = `<option value=""${c.paletteName === null ? ' selected' : ''}>none</option>`;
      opts += state.palettes.map(p =>
        `<option value="${p.slug}"${p.slug === c.paletteName ? ' selected' : ''}>${p.slug}</option>`
      ).join('');
      return `<select class="setting-edit" data-key="${key}">${opts}</select>`;
    }
    default:
      return '';
  }
}

function startEditing(key) {
  const booleans = ['removeBg', 'floodFill'];
  if (booleans.includes(key)) {
    // Booleans just toggle
    adjustSetting(key, 1);
    renderSettings();
    autoProcess();
    return;
  }
  state.editingKey = key;
  renderSettings();
}

function commitEdit(key, rawValue) {
  const c = state.config;
  const val = rawValue.trim();
  switch (key) {
    case 'gridSize':
      if (val === '' || val === 'auto') {
        c.gridSize = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1) c.gridSize = n;
      }
      break;
    case 'aaThreshold':
      if (val === '' || val === 'off') {
        c.aaThreshold = null;
      } else {
        const n = parseFloat(val);
        if (!isNaN(n)) c.aaThreshold = Math.max(0.01, Math.min(1.0, n));
      }
      break;
    case 'autoColors':
      if (val === '' || val === 'off') {
        c.autoColors = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 2) {
          c.autoColors = Math.min(256, n);
          c.paletteName = null; // mutually exclusive
        }
      }
      break;
    case 'bgTolerance': {
      const n = parseFloat(val);
      if (!isNaN(n)) c.bgTolerance = Math.max(0.01, Math.min(0.50, n));
      break;
    }
    case 'downscaleMode':
      if (DOWNSCALE_MODES.includes(val)) c.downscaleMode = val;
      break;
    case 'paletteName':
      c.paletteName = val === '' ? null : val;
      if (c.paletteName !== null) c.autoColors = null; // mutually exclusive
      break;
  }
  state.editingKey = null;
  renderSettings();
  autoProcess();
}

function cancelEdit() {
  state.editingKey = null;
  renderSettings();
}

function renderDiagnostics() {
  const info = state.imageInfo;
  if (!info) {
    document.getElementById('diag-grid-info').innerHTML =
      '<div class="diag-item"><span class="label">No image loaded</span></div>';
    document.getElementById('diag-grid-bars').innerHTML = '';
    document.getElementById('diag-info').innerHTML = '';
    document.getElementById('diag-histogram').innerHTML = '';
    return;
  }

  // Grid info
  let gridHtml = '';
  gridHtml += `<div class="diag-item"><span class="label">Detected size</span><span class="value">${info.gridSize ?? 'none'}</span></div>`;
  gridHtml += `<div class="diag-item"><span class="label">Confidence</span><span class="value">${info.gridConfidence != null ? (info.gridConfidence * 100).toFixed(1) + '%' : 'n/a'}</span></div>`;
  document.getElementById('diag-grid-info').innerHTML = gridHtml;

  // Grid score bars
  let barsHtml = '';
  if (info.gridScores && info.gridScores.length > 0) {
    const maxScore = Math.max(...info.gridScores.map(s => s[1]));
    const bestSize = info.gridSize;
    for (const [size, score] of info.gridScores) {
      const pct = maxScore > 0 ? (score / maxScore * 100) : 0;
      const best = size === bestSize ? ' best' : '';
      barsHtml += `<div class="grid-bar-row">`;
      barsHtml += `<span class="grid-bar-label">${size}</span>`;
      barsHtml += `<div class="grid-bar-track"><div class="grid-bar-fill${best}" style="width:${pct}%"></div></div>`;
      barsHtml += `<span class="grid-bar-value">${score.toFixed(3)}</span>`;
      barsHtml += `</div>`;
    }
  }
  document.getElementById('diag-grid-bars').innerHTML = barsHtml;

  // Color info
  let infoHtml = '';
  infoHtml += `<div class="diag-item"><span class="label">Dimensions</span><span class="value">${info.width} x ${info.height}</span></div>`;
  infoHtml += `<div class="diag-item"><span class="label">Unique colors</span><span class="value">${info.uniqueColors}</span></div>`;
  document.getElementById('diag-info').innerHTML = infoHtml;

  // Histogram
  let histHtml = '';
  if (info.histogram) {
    for (const entry of info.histogram) {
      histHtml += `<div class="color-row">`;
      histHtml += `<div class="color-swatch" style="background:${entry.hex}"></div>`;
      histHtml += `<span class="color-hex">${entry.hex}</span>`;
      histHtml += `<div class="color-bar-track"><div class="color-bar-fill" style="width:${Math.min(entry.percent, 100)}%;background:${entry.hex}"></div></div>`;
      histHtml += `<span class="color-percent">${entry.percent.toFixed(1)}%</span>`;
      histHtml += `</div>`;
    }
  }
  document.getElementById('diag-histogram').innerHTML = histHtml;
}

// ---------------------------------------------------------------------------
// Image loading and processing
// ---------------------------------------------------------------------------

async function loadImageBlob(which) {
  const bytes = await invoke('get_image', { which });
  const arr = new Uint8Array(bytes);
  const blob = new Blob([arr], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

async function openImage(path) {
  setStatus('Loading...', 'processing');
  showSpinners();
  try {
    const info = await invoke('open_image', { path });
    state.imageLoaded = true;
    state.imagePath = path;
    state.imageInfo = info;
    // Reset config to defaults
    state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    // If grid was detected, note it
    if (info.gridSize) {
      state.config.gridSize = null; // auto will use detected
    }

    // Show filename
    const fname = path.split('/').pop().split('\\').pop();
    document.getElementById('filename').textContent = fname;

    // Show images
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('original-pane').style.display = 'flex';
    document.getElementById('processed-pane').style.display = 'flex';

    const [origUrl, procUrl] = await Promise.all([
      loadImageBlob('original'),
      loadImageBlob('processed'),
    ]);
    document.getElementById('original-img').src = origUrl;
    document.getElementById('processed-img').src = procUrl;
    document.getElementById('original-dims').textContent = `${info.width}x${info.height}`;
    document.getElementById('processed-dims').textContent = `${info.width}x${info.height}`;

    // Settings preview
    document.getElementById('settings-preview-img').src = procUrl;
    document.getElementById('settings-preview-img').style.display = 'block';
    document.getElementById('settings-no-image').style.display = 'none';

    renderSettings();
    renderDiagnostics();
    hideSpinners();
    setStatus(`Loaded — ${info.width}x${info.height}, grid=${info.gridSize ?? 'none'}, ${info.uniqueColors} colors`, 'success');
  } catch (e) {
    hideSpinners();
    setStatus('Error: ' + e, 'error');
  }
}

async function processImage() {
  if (!state.imageLoaded || state.processing) return;
  state.processing = true;
  setStatus('Processing...', 'processing');
  showSpinners();
  try {
    const result = await invoke('process', { pc: state.config });
    state.imageInfo = { ...state.imageInfo, ...result };

    const procUrl = await loadImageBlob('processed');
    document.getElementById('processed-img').src = procUrl;
    document.getElementById('processed-dims').textContent = `${result.width}x${result.height}`;
    document.getElementById('settings-preview-img').src = procUrl;

    renderDiagnostics();
    setStatus(`Processed — ${result.width}x${result.height}, ${result.uniqueColors} colors`, 'success');
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  } finally {
    state.processing = false;
    hideSpinners();
  }
}

// ---------------------------------------------------------------------------
// File dialogs
// ---------------------------------------------------------------------------

async function doOpen() {
  try {
    const result = await openDialog({
      multiple: false,
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
      }],
    });
    if (result) {
      await openImage(result);
    }
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  }
}

async function doSave() {
  if (!state.imageLoaded) return;
  try {
    const result = await saveDialog({
      defaultPath: state.imagePath ? state.imagePath.replace(/\.[^.]+$/, '_fixed.png') : 'output.png',
      filters: [{
        name: 'PNG Image',
        extensions: ['png'],
      }],
    });
    if (result) {
      await invoke('save_image', { path: result });
      setStatus('Saved: ' + result.split('/').pop().split('\\').pop(), 'success');
    }
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  }
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  // When editing an inline input, only handle Enter/Escape
  if (e.target.classList?.contains('setting-edit')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(e.target.dataset.key, e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
    return;
  }

  // Ignore other typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.key;

  // Tab switching
  if (key === '1') { switchTab('preview'); return; }
  if (key === '2') { switchTab('settings'); return; }
  if (key === '3') { switchTab('diagnostics'); return; }
  if (key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }

  // Global shortcuts
  if (key === 'o') { doOpen(); return; }
  if (key === 's') { doSave(); return; }
  if (key === ' ') { e.preventDefault(); processImage(); return; }
  if (key === 'r') { resetConfig(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'q') { window.close(); return; }

  // Settings navigation (only on settings tab, blocked during processing)
  if (state.activeTab === 'settings' && !state.processing) {
    const rows = getSettingRows();
    if (key === 'j' || key === 'ArrowDown') {
      e.preventDefault();
      state.settingsFocusIndex = Math.min(state.settingsFocusIndex + 1, rows.length - 1);
      renderSettings();
      return;
    }
    if (key === 'k' || key === 'ArrowUp') {
      e.preventDefault();
      state.settingsFocusIndex = Math.max(state.settingsFocusIndex - 1, 0);
      renderSettings();
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      const row = rows[state.settingsFocusIndex];
      if (row) startEditing(row.key);
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (key === 'l' || key === 'ArrowRight') {
      e.preventDefault();
      const row = rows[state.settingsFocusIndex];
      if (row) {
        adjustSetting(row.key, 1);
        renderSettings();
        autoProcess();
      }
      return;
    }
    if (key === 'h' || key === 'ArrowLeft') {
      e.preventDefault();
      const row = rows[state.settingsFocusIndex];
      if (row) {
        adjustSetting(row.key, -1);
        renderSettings();
        autoProcess();
      }
      return;
    }
  }
});

const TABS = ['preview', 'settings', 'diagnostics'];

function cycleTab(dir) {
  let idx = TABS.indexOf(state.activeTab);
  idx = (idx + dir + TABS.length) % TABS.length;
  switchTab(TABS[idx]);
}

function resetConfig() {
  state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  renderSettings();
  if (state.imageLoaded) {
    autoProcess();
  }
  setStatus('Config reset to defaults');
}

// Auto-process with debounce
let processTimer = null;
function autoProcess() {
  if (!state.imageLoaded) return;
  clearTimeout(processTimer);
  processTimer = setTimeout(() => processImage(), 150);
}

// ---------------------------------------------------------------------------
// Tab click handling
// ---------------------------------------------------------------------------

document.querySelector('.tab-bar').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) switchTab(tab.dataset.tab);
});

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

const dropOverlay = document.getElementById('drop-overlay');
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('active');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    // Tauri drag-and-drop gives us the file path
    if (file.path) {
      await openImage(file.path);
    }
  }
});

// Also handle Tauri's native file drop event
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen('tauri://drag-drop', async (event) => {
    dropOverlay.classList.remove('active');
    dragCounter = 0;
    const paths = event.payload?.paths;
    if (paths && paths.length > 0) {
      await openImage(paths[0]);
    }
  });

  window.__TAURI__.event.listen('tauri://drag-enter', () => {
    dropOverlay.classList.add('active');
  });

  window.__TAURI__.event.listen('tauri://drag-leave', () => {
    dropOverlay.classList.remove('active');
    dragCounter = 0;
  });
}

// ---------------------------------------------------------------------------
// Settings click handling
// ---------------------------------------------------------------------------

document.getElementById('settings-list').addEventListener('click', (e) => {
  // Click on value to start editing
  const valueEl = e.target.closest('.setting-value');
  if (valueEl && !state.editingKey && !state.processing) {
    const row = valueEl.closest('.setting-row');
    if (row) {
      state.settingsFocusIndex = parseInt(row.dataset.index);
      startEditing(row.dataset.key);
      return;
    }
  }
  const row = e.target.closest('.setting-row');
  if (row) {
    state.settingsFocusIndex = parseInt(row.dataset.index);
    renderSettings();
  }
});

// Delegate blur/change events for inline edit widgets
document.getElementById('settings-list').addEventListener('focusout', (e) => {
  if (e.target.classList?.contains('setting-edit') && state.editingKey) {
    // Small delay to allow Enter handler to fire first
    setTimeout(() => {
      if (state.editingKey) {
        commitEdit(e.target.dataset.key, e.target.value);
      }
    }, 50);
  }
});

document.getElementById('settings-list').addEventListener('change', (e) => {
  if (e.target.tagName === 'SELECT' && e.target.classList?.contains('setting-edit')) {
    commitEdit(e.target.dataset.key, e.target.value);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    state.palettes = await invoke('list_palettes');
  } catch (e) {
    console.error('Failed to load palettes:', e);
  }
  renderSettings();
  renderDiagnostics();
}

init();
