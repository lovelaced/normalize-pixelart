// pixfix — application logic (TypeScript)
// Uses window.__TAURI__ (withGlobalTauri: true in tauri.conf.json)

// ---------------------------------------------------------------------------
// Tauri API bindings
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __TAURI__: {
      core: {
        invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      dialog: {
        open: (options?: DialogOptions) => Promise<string | null>;
        save: (options?: DialogOptions) => Promise<string | null>;
      };
      event: {
        listen: (event: string, handler: (event: TauriEvent) => void) => Promise<void>;
      };
    };
  }
}

interface DialogOptions {
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

interface TauriEvent {
  payload?: { paths?: string[] };
}

const { invoke } = window.__TAURI__.core;
const { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;

// ---------------------------------------------------------------------------
// Backend types (mirror Rust serde structs)
// ---------------------------------------------------------------------------

interface ImageInfo {
  width: number;
  height: number;
  gridSize: number | null;
  gridConfidence: number | null;
  uniqueColors: number;
  gridScores: [number, number][];
  histogram: ColorEntry[];
}

interface ProcessResult {
  width: number;
  height: number;
  gridSize: number | null;
  gridConfidence: number | null;
  uniqueColors: number;
  gridScores: [number, number][];
  histogram: ColorEntry[];
}

interface ColorEntry {
  hex: string;
  r: number;
  g: number;
  b: number;
  percent: number;
}

interface PaletteInfo {
  name: string;
  slug: string;
  numColors: number;
}

interface LospecResult {
  name: string;
  slug: string;
  numColors: number;
  colors: string[];
}

interface ProcessConfig {
  gridSize: number | null;
  gridPhaseX: number | null;
  gridPhaseY: number | null;
  maxGridCandidate: number | null;
  noGridDetect: boolean;
  downscaleMode: string;
  aaThreshold: number | null;
  paletteName: string | null;
  autoColors: number | null;
  customPalette: string[] | null;
  removeBg: boolean;
  noQuantize: boolean;
  bgColor: string | null;
  borderThreshold: number | null;
  bgTolerance: number;
  floodFill: boolean;
  outputScale: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AppConfig {
  gridSize: number | null;
  gridPhaseX: number | null;
  gridPhaseY: number | null;
  maxGridCandidate: number;
  noGridDetect: boolean;
  downscaleMode: string;
  aaThreshold: number | null;
  paletteName: string | null;
  autoColors: number | null;
  lospecSlug: string | null;
  customPalette: string[] | null;
  noQuantize: boolean;
  removeBg: boolean;
  bgColor: string | null;
  borderThreshold: number | null;
  bgTolerance: number;
  floodFill: boolean;
  outputScale: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
}

interface AppState {
  activeTab: string;
  imageLoaded: boolean;
  imagePath: string | null;
  imageInfo: ImageInfo | null;
  settingsFocusIndex: number;
  processing: boolean;
  palettes: PaletteInfo[];
  paletteIndex: number;
  config: AppConfig;
  // Lospec state
  lospecResult: LospecResult | null;
  lospecError: string | null;
  lospecLoading: boolean;
  // Palette swatches for current selection
  paletteColors: string[] | null;
  // Help visibility
  showAllHelp: boolean;
  // Timing
  lastProcessTime: number | null;
  // Batch state
  batchFiles: string[];
  batchOutputDir: string | null;
  batchRunning: boolean;
  batchProgress: { current: number; total: number; filename: string } | null;
  batchResult: { succeeded: number; failed: { path: string; error: string }[] } | null;
  // Sheet state
  sheetMode: 'fixed' | 'auto';
  sheetConfig: {
    tileWidth: number | null;
    tileHeight: number | null;
    spacing: number;
    margin: number;
    separatorThreshold: number;
    minSpriteSize: number;
    pad: number;
    noNormalize: boolean;
  };
  sheetPreview: { tileCount: number; tileWidth: number; tileHeight: number; cols: number; rows: number } | null;
  sheetProcessing: boolean;
  // GIF animation state
  gifMode: 'row' | 'all';
  gifRow: number;
  gifFps: number;
  gifPreviewUrl: string | null;
  gifGenerating: boolean;
}

const state: AppState = {
  activeTab: 'preview',
  imageLoaded: false,
  imagePath: null,
  imageInfo: null,
  settingsFocusIndex: 0,
  processing: false,
  palettes: [],
  paletteIndex: 0,
  config: {
    gridSize: null,
    gridPhaseX: null,
    gridPhaseY: null,
    maxGridCandidate: 32,
    noGridDetect: false,
    downscaleMode: 'snap',
    aaThreshold: null,
    paletteName: null,
    autoColors: null,
    lospecSlug: null,
    customPalette: null,
    noQuantize: false,
    removeBg: false,
    bgColor: null,
    borderThreshold: null,
    bgTolerance: 0.05,
    floodFill: true,
    outputScale: null,
    outputWidth: null,
    outputHeight: null,
  },
  lospecResult: null,
  lospecError: null,
  lospecLoading: false,
  paletteColors: null,
  showAllHelp: false,
  lastProcessTime: null,
  // Batch
  batchFiles: [],
  batchOutputDir: null,
  batchRunning: false,
  batchProgress: null,
  batchResult: null,
  // Sheet
  sheetMode: 'auto',
  sheetConfig: {
    tileWidth: null,
    tileHeight: null,
    spacing: 0,
    margin: 0,
    separatorThreshold: 0.90,
    minSpriteSize: 8,
    pad: 0,
    noNormalize: false,
  },
  sheetPreview: null,
  sheetProcessing: false,
  // GIF
  gifMode: 'row',
  gifRow: 0,
  gifFps: 10,
  gifPreviewUrl: null,
  gifGenerating: false,
};

const DEFAULT_CONFIG: AppConfig = JSON.parse(JSON.stringify(state.config));

// ---------------------------------------------------------------------------
// Settings definitions
// ---------------------------------------------------------------------------

const DOWNSCALE_MODES = ['snap', 'center-weighted', 'majority-vote', 'center-pixel'];

interface SettingSection {
  section: string;
  key?: undefined;
}

interface SettingRow {
  section?: undefined;
  key: string;
  label: string;
  value: string;
  help: string;
  changed: boolean;
}

type SettingEntry = SettingSection | SettingRow;

function getSettings(): SettingEntry[] {
  const c = state.config;
  return [
    { section: 'Grid Detection' },
    {
      key: 'gridSize', label: 'Grid Size',
      value: c.gridSize === null ? 'auto' : String(c.gridSize),
      help: 'How many screen pixels make up one "logical" pixel in your art. Auto-detection works well for most images. Override if the grid looks wrong.',
      changed: c.gridSize !== null,
    },
    {
      key: 'gridPhaseX', label: 'Phase X',
      value: c.gridPhaseX === null ? 'auto' : String(c.gridPhaseX),
      help: 'Override the X offset of the grid alignment. Usually auto-detected.',
      changed: c.gridPhaseX !== null,
    },
    {
      key: 'gridPhaseY', label: 'Phase Y',
      value: c.gridPhaseY === null ? 'auto' : String(c.gridPhaseY),
      help: 'Override the Y offset of the grid alignment. Usually auto-detected.',
      changed: c.gridPhaseY !== null,
    },
    {
      key: 'noGridDetect', label: 'Skip Grid',
      value: c.noGridDetect ? 'on' : 'off',
      help: 'Skip grid detection entirely. Useful if your image is already at logical resolution.',
      changed: c.noGridDetect,
    },
    {
      key: 'maxGridCandidate', label: 'Max Grid',
      value: String(c.maxGridCandidate),
      help: 'Maximum grid size to test during auto-detection (default: 32).',
      changed: c.maxGridCandidate !== 32,
    },
    {
      key: 'downscaleMode', label: 'Mode',
      value: c.downscaleMode,
      help: 'How to combine pixels in each grid cell. "snap" cleans in-place at original resolution. Others reduce to logical pixel resolution.',
      changed: c.downscaleMode !== 'snap',
    },
    { section: 'Anti-Aliasing' },
    {
      key: 'aaThreshold', label: 'AA Removal',
      value: c.aaThreshold === null ? 'off' : c.aaThreshold.toFixed(2),
      help: 'Removes soft blending between colors added by AI generators. Lower values are more aggressive. Try 0.30\u20130.50 for most images.',
      changed: c.aaThreshold !== null,
    },
    { section: 'Color Palette' },
    {
      key: 'paletteName', label: 'Palette',
      value: c.paletteName === null ? 'none' : c.paletteName,
      help: 'Snap all colors to a classic pixel art palette. Mutually exclusive with Lospec and Auto Colors.',
      changed: c.paletteName !== null,
    },
    {
      key: 'lospecSlug', label: 'Lospec',
      value: c.lospecSlug === null ? 'none' : c.lospecSlug,
      help: 'Load any palette from lospec.com by slug (e.g. "pico-8", "endesga-32"). Press Enter to type a slug and fetch it.',
      changed: c.lospecSlug !== null,
    },
    {
      key: 'autoColors', label: 'Auto Colors',
      value: c.autoColors === null ? 'off' : String(c.autoColors),
      help: 'Auto-extract the best N colors from your image using k-means clustering in OKLAB color space.',
      changed: c.autoColors !== null,
    },
    {
      key: 'paletteFile', label: 'Load .hex',
      value: c.customPalette && !c.lospecSlug ? `${c.customPalette.length} colors` : 'none',
      help: 'Load a palette from a .hex file (one hex color per line). Overrides palette and auto colors.',
      changed: c.customPalette !== null && c.lospecSlug === null,
    },
    {
      key: 'noQuantize', label: 'Skip Quantize',
      value: c.noQuantize ? 'on' : 'off',
      help: 'Skip color quantization entirely. Useful if you only want grid snapping and AA removal without palette changes.',
      changed: c.noQuantize,
    },
    { section: 'Background' },
    {
      key: 'removeBg', label: 'Remove BG',
      value: c.removeBg ? 'on' : 'off',
      help: 'Detect and make the background transparent. The dominant border color is treated as background.',
      changed: c.removeBg,
    },
    {
      key: 'bgColor', label: 'BG Color',
      value: c.bgColor === null ? 'auto' : c.bgColor,
      help: 'Explicit background color as hex (e.g. "#FF00FF"). If auto, detects from border pixels.',
      changed: c.bgColor !== null,
    },
    {
      key: 'borderThreshold', label: 'Border Thresh',
      value: c.borderThreshold === null ? '0.40' : c.borderThreshold.toFixed(2),
      help: 'Fraction of border pixels that must match for auto-detection (0.0\u20131.0, default: 0.40).',
      changed: c.borderThreshold !== null,
    },
    {
      key: 'bgTolerance', label: 'BG Tolerance',
      value: c.bgTolerance.toFixed(2),
      help: 'How different a pixel can be from the background color and still count as background. Higher = more aggressive.',
      changed: c.bgTolerance !== 0.05,
    },
    {
      key: 'floodFill', label: 'Flood Fill',
      value: c.floodFill ? 'on' : 'off',
      help: 'On: only remove connected background from edges. Off: remove matching color everywhere.',
      changed: !c.floodFill,
    },
    { section: 'Output' },
    {
      key: 'outputScale', label: 'Scale',
      value: c.outputScale === null ? 'off' : c.outputScale + 'x',
      help: 'Scale the output by an integer multiplier (2x, 3x, etc). Great for upscaling sprites for game engines.',
      changed: c.outputScale !== null,
    },
    {
      key: 'outputWidth', label: 'Width',
      value: c.outputWidth === null ? 'auto' : String(c.outputWidth),
      help: 'Explicit output width in pixels. Overrides scale.',
      changed: c.outputWidth !== null,
    },
    {
      key: 'outputHeight', label: 'Height',
      value: c.outputHeight === null ? 'auto' : String(c.outputHeight),
      help: 'Explicit output height in pixels. Overrides scale.',
      changed: c.outputHeight !== null,
    },
  ];
}

function getSettingRows(): SettingRow[] {
  return getSettings().filter((s): s is SettingRow => !s.section);
}

// ---------------------------------------------------------------------------
// Setting adjustment (arrow keys)
// ---------------------------------------------------------------------------

function adjustSetting(key: string, direction: number): void {
  const c = state.config;
  switch (key) {
    case 'gridSize':
      if (c.gridSize === null) {
        c.gridSize = state.imageInfo?.gridSize || 4;
      } else {
        c.gridSize = Math.max(1, c.gridSize + direction);
        if (c.gridSize === 1 && direction < 0) c.gridSize = null;
      }
      break;
    case 'gridPhaseX':
      if (c.gridPhaseX === null) {
        c.gridPhaseX = 0;
      } else {
        c.gridPhaseX = Math.max(0, c.gridPhaseX + direction);
      }
      break;
    case 'gridPhaseY':
      if (c.gridPhaseY === null) {
        c.gridPhaseY = 0;
      } else {
        c.gridPhaseY = Math.max(0, c.gridPhaseY + direction);
      }
      break;
    case 'maxGridCandidate':
      c.maxGridCandidate = Math.max(2, Math.min(64, c.maxGridCandidate + direction * 4));
      break;
    case 'noGridDetect':
      c.noGridDetect = !c.noGridDetect;
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
        if (c.aaThreshold <= 0) c.aaThreshold = null;
        else if (c.aaThreshold > 1.0) c.aaThreshold = 1.0;
      }
      break;
    case 'paletteName': {
      const names: (string | null)[] = [null, ...state.palettes.map(p => p.slug)];
      let idx = names.indexOf(c.paletteName);
      idx = (idx + direction + names.length) % names.length;
      c.paletteName = names[idx];
      if (c.paletteName !== null) {
        c.autoColors = null;
        c.lospecSlug = null;
        c.customPalette = null;
        state.lospecResult = null;
        fetchPaletteColors(c.paletteName);
      } else {
        state.paletteColors = null;
      }
      break;
    }
    case 'autoColors':
      if (c.autoColors === null) {
        c.autoColors = 16;
      } else {
        c.autoColors = Math.max(2, c.autoColors + direction * 2);
        if (c.autoColors <= 2 && direction < 0) c.autoColors = null;
        else if (c.autoColors > 256) c.autoColors = 256;
      }
      if (c.autoColors !== null) {
        c.paletteName = null;
        c.lospecSlug = null;
        c.customPalette = null;
        state.paletteColors = null;
        state.lospecResult = null;
      }
      break;
    case 'removeBg':
      c.removeBg = !c.removeBg;
      break;
    case 'borderThreshold':
      if (c.borderThreshold === null) {
        c.borderThreshold = 0.40;
      } else {
        c.borderThreshold = Math.round((c.borderThreshold + direction * 0.05) * 100) / 100;
        if (c.borderThreshold <= 0) c.borderThreshold = null;
        else if (c.borderThreshold > 1.0) c.borderThreshold = 1.0;
      }
      break;
    case 'bgTolerance':
      c.bgTolerance = Math.round((c.bgTolerance + direction * 0.01) * 100) / 100;
      c.bgTolerance = Math.max(0.01, Math.min(0.50, c.bgTolerance));
      break;
    case 'floodFill':
      c.floodFill = !c.floodFill;
      break;
    case 'outputScale':
      if (c.outputScale === null) {
        c.outputScale = 2;
      } else {
        c.outputScale = c.outputScale + direction;
        if (c.outputScale < 2) c.outputScale = null;
        else if (c.outputScale > 16) c.outputScale = 16;
      }
      break;
    case 'outputWidth':
      if (c.outputWidth === null) {
        c.outputWidth = state.imageInfo?.width || 64;
      } else {
        c.outputWidth = Math.max(1, c.outputWidth + direction * 8);
      }
      break;
    case 'outputHeight':
      if (c.outputHeight === null) {
        c.outputHeight = state.imageInfo?.height || 64;
      } else {
        c.outputHeight = Math.max(1, c.outputHeight + direction * 8);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Palette colors fetching
// ---------------------------------------------------------------------------

async function fetchPaletteColors(slug: string): Promise<void> {
  try {
    const colors = await invoke<string[]>('get_palette_colors', { slug });
    state.paletteColors = colors;
    renderSettings();
  } catch {
    state.paletteColors = null;
  }
}

async function fetchLospec(slug: string): Promise<void> {
  state.lospecLoading = true;
  state.lospecError = null;
  renderSettings();
  try {
    const result = await invoke<LospecResult>('fetch_lospec', { slug });
    state.lospecResult = result;
    state.config.lospecSlug = slug;
    state.config.customPalette = result.colors;
    state.config.paletteName = null;
    state.config.autoColors = null;
    state.paletteColors = result.colors;
    state.lospecLoading = false;
    renderSettings();
    autoProcess();
  } catch (e) {
    state.lospecError = String(e);
    state.lospecLoading = false;
    renderSettings();
  }
}

async function loadPaletteFileDialog(): Promise<void> {
  try {
    const result = await openDialog({
      multiple: false,
      filters: [{
        name: 'Palette Files',
        extensions: ['hex', 'txt'],
      }],
    });
    if (result) {
      const colors = await invoke<string[]>('load_palette_file', { path: result });
      state.config.customPalette = colors;
      state.config.paletteName = null;
      state.config.autoColors = null;
      state.config.lospecSlug = null;
      state.lospecResult = null;
      state.paletteColors = colors;
      renderSettings();
      autoProcess();
    }
  } catch (e) {
    setStatus('Error loading palette: ' + e, 'error');
  }
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function setStatus(msg: string, type: string = ''): void {
  const el = document.getElementById('status-msg')!;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function showSpinners(): void {
  document.getElementById('preview-spinner')?.classList.add('active');
  document.getElementById('settings-spinner')?.classList.add('active');
}

function hideSpinners(): void {
  document.getElementById('preview-spinner')?.classList.remove('active');
  document.getElementById('settings-spinner')?.classList.remove('active');
}

function switchTab(name: string): void {
  state.activeTab = name;
  document.querySelectorAll('.tab').forEach(t => {
    (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    (p as HTMLElement).classList.toggle('active', p.id === 'panel-' + name);
  });
  // Re-render dynamic tabs to reflect latest state
  if (name === 'batch') renderBatch();
  if (name === 'sheet') renderSheet();
}

// Settings that always render as <select> dropdowns
const SELECT_SETTINGS = ['downscaleMode', 'paletteName'];
// Settings that are boolean toggles
const BOOLEAN_SETTINGS = ['removeBg', 'floodFill', 'noGridDetect', 'noQuantize'];
// Settings that require Enter-to-edit (text/numeric input)
const INPUT_SETTINGS = ['gridSize', 'gridPhaseX', 'gridPhaseY', 'maxGridCandidate', 'aaThreshold', 'autoColors', 'bgColor', 'borderThreshold', 'bgTolerance', 'lospecSlug', 'outputScale', 'outputWidth', 'outputHeight'];
// Settings that open a file dialog instead of editing
const FILE_SETTINGS = ['paletteFile'];
// Nullable settings — can be turned off (null) with a clear button
const NULLABLE_SETTINGS: Record<string, { offLabel: string; defaultValue: () => unknown }> = {
  gridSize:         { offLabel: 'auto',  defaultValue: () => state.imageInfo?.gridSize || 4 },
  gridPhaseX:       { offLabel: 'auto',  defaultValue: () => 0 },
  gridPhaseY:       { offLabel: 'auto',  defaultValue: () => 0 },
  aaThreshold:      { offLabel: 'off',   defaultValue: () => 0.50 },
  autoColors:       { offLabel: 'off',   defaultValue: () => 16 },
  lospecSlug:       { offLabel: 'none',  defaultValue: () => null }, // lospec always opens input
  bgColor:          { offLabel: 'auto',  defaultValue: () => null }, // bgColor opens input
  borderThreshold:  { offLabel: '0.40',  defaultValue: () => 0.40 },
  outputScale:      { offLabel: 'off',   defaultValue: () => 2 },
  outputWidth:      { offLabel: 'auto',  defaultValue: () => state.imageInfo?.width || 64 },
  outputHeight:     { offLabel: 'auto',  defaultValue: () => state.imageInfo?.height || 64 },
};

function renderSettings(): void {
  const list = document.getElementById('settings-list')!;

  // Don't clobber the DOM while the user is focused on an inline input
  const focused = document.activeElement;
  if (focused && focused.classList?.contains('setting-inline-input') && list.contains(focused)) {
    // Update non-input parts only: focus indicator, changed classes
    updateSettingsFocusOnly(list);
    return;
  }

  const settings = getSettings();
  let rowIndex = 0;
  let html = '';

  for (const s of settings) {
    if (s.section) {
      html += `<div class="setting-section">${s.section}</div>`;
    } else {
      const isFocused = rowIndex === state.settingsFocusIndex ? ' focused' : '';
      const changed = s.changed ? ' changed' : '';

      html += `<div class="setting-row${isFocused}" data-index="${rowIndex}" data-key="${s.key}">`;
      html += `<span class="setting-indicator">&#9654;</span>`;
      html += `<span class="setting-label">${s.label}</span>`;
      html += `<span class="setting-value${changed}">`;

      if (SELECT_SETTINGS.includes(s.key)) {
        // Always render as dropdown
        html += renderInlineSelect(s.key);
      } else if (BOOLEAN_SETTINGS.includes(s.key)) {
        // Render as clickable toggle
        html += `<span class="setting-toggle" data-key="${s.key}">${escapeHtml(s.value)}</span>`;
      } else if (FILE_SETTINGS.includes(s.key)) {
        // File settings: clickable to open dialog, with clear button when active
        if (s.changed) {
          html += escapeHtml(s.value);
          html += `<span class="setting-clear" data-key="${s.key}" title="Clear">\u00d7</span>`;
        } else {
          html += `<span class="setting-toggle" data-key="${s.key}">${escapeHtml(s.value)}</span>`;
        }
      } else if (INPUT_SETTINGS.includes(s.key)) {
        // Always-visible inline input
        html += renderInlineInput(s.key);
        if (s.key in NULLABLE_SETTINGS && s.changed) {
          const nullable = NULLABLE_SETTINGS[s.key];
          html += `<span class="setting-clear" data-key="${s.key}" title="Reset to ${nullable.offLabel}">\u00d7</span>`;
        }
      } else {
        html += escapeHtml(s.value);
      }

      html += `</span>`;
      html += `</div>`;
      // Help text always visible
      html += `<div class="setting-help">${s.help}</div>`;

      // Palette swatches (after palette, lospec, or paletteFile row)
      if ((s.key === 'paletteName' || s.key === 'lospecSlug' || s.key === 'paletteFile') && state.paletteColors && state.paletteColors.length > 0) {
        if ((s.key === 'paletteName' && state.config.paletteName !== null) ||
            (s.key === 'lospecSlug' && state.config.lospecSlug !== null) ||
            (s.key === 'paletteFile' && state.config.customPalette !== null && state.config.lospecSlug === null)) {
          html += renderPaletteSwatches(state.paletteColors);
        }
      }

      // Lospec info/error after lospec row
      if (s.key === 'lospecSlug') {
        if (state.lospecLoading) {
          html += `<div class="lospec-info lospec-loading">Fetching palette...</div>`;
        } else if (state.lospecError) {
          html += `<div class="lospec-error">${escapeHtml(state.lospecError)}</div>`;
        } else if (state.lospecResult && state.config.lospecSlug) {
          html += `<div class="lospec-info">${escapeHtml(state.lospecResult.name)} \u2014 ${state.lospecResult.numColors} colors</div>`;
        }
      }

      rowIndex++;
    }
  }
  list.innerHTML = html;
}

// Lightweight re-render: just update focus/changed classes without destroying inputs
function updateSettingsFocusOnly(list: HTMLElement): void {
  const rows = list.querySelectorAll('.setting-row');
  rows.forEach((row, i) => {
    (row as HTMLElement).classList.toggle('focused', i === state.settingsFocusIndex);
  });
}

function renderPaletteSwatches(colors: string[]): string {
  let html = '<div class="palette-swatches">';
  for (const color of colors) {
    html += `<div class="palette-swatch" style="background:${color}" title="${color}"></div>`;
  }
  html += '</div>';
  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInlineSelect(key: string): string {
  const c = state.config;
  switch (key) {
    case 'downscaleMode': {
      const opts = DOWNSCALE_MODES.map(m =>
        `<option value="${m}"${m === c.downscaleMode ? ' selected' : ''}>${m}</option>`
      ).join('');
      return `<select class="setting-inline-select" data-key="${key}">${opts}</select>`;
    }
    case 'paletteName': {
      let opts = `<option value=""${c.paletteName === null ? ' selected' : ''}>none</option>`;
      opts += state.palettes.map(p =>
        `<option value="${p.slug}"${p.slug === c.paletteName ? ' selected' : ''}>${p.slug} (${p.numColors})</option>`
      ).join('');
      return `<select class="setting-inline-select" data-key="${key}">${opts}</select>`;
    }
    default:
      return '';
  }
}

function renderInlineInput(key: string): string {
  const c = state.config;
  switch (key) {
    case 'gridSize': {
      const val = c.gridSize === null ? '' : c.gridSize;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'gridPhaseX': {
      const val = c.gridPhaseX === null ? '' : c.gridPhaseX;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'gridPhaseY': {
      const val = c.gridPhaseY === null ? '' : c.gridPhaseY;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'maxGridCandidate': {
      return `<input class="setting-inline-input" type="text" value="${c.maxGridCandidate}" data-key="${key}">`;
    }
    case 'aaThreshold': {
      const val = c.aaThreshold === null ? '' : c.aaThreshold.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case 'autoColors': {
      const val = c.autoColors === null ? '' : c.autoColors;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case 'bgColor': {
      const val = c.bgColor ?? '';
      return `<input class="setting-inline-input" type="text" value="${escapeHtml(val)}" placeholder="auto (#RRGGBB)" data-key="${key}">`;
    }
    case 'borderThreshold': {
      const val = c.borderThreshold === null ? '' : c.borderThreshold.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="0.40" data-key="${key}">`;
    }
    case 'bgTolerance': {
      const val = c.bgTolerance.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" data-key="${key}">`;
    }
    case 'outputScale': {
      const val = c.outputScale === null ? '' : c.outputScale;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case 'outputWidth': {
      const val = c.outputWidth === null ? '' : c.outputWidth;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'outputHeight': {
      const val = c.outputHeight === null ? '' : c.outputHeight;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case 'lospecSlug': {
      const val = c.lospecSlug ?? '';
      return `<input class="setting-inline-input setting-inline-input-wide" type="text" value="${escapeHtml(val)}" placeholder="e.g. pico-8" data-key="${key}">`;
    }
    default:
      return '';
  }
}

function startEditing(key: string): void {
  // Booleans toggle immediately
  if (BOOLEAN_SETTINGS.includes(key)) {
    adjustSetting(key, 1);
    renderSettings();
    autoProcess();
    return;
  }
  // Selects are always visible
  if (SELECT_SETTINGS.includes(key)) {
    return;
  }
  // File settings open a file dialog
  if (FILE_SETTINGS.includes(key)) {
    if (key === 'paletteFile') {
      loadPaletteFileDialog();
    }
    return;
  }
  // For inline inputs, just focus the input element
  if (INPUT_SETTINGS.includes(key)) {
    const input = document.querySelector(`.setting-inline-input[data-key="${key}"]`) as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }
}

function clearSetting(key: string): void {
  const c = state.config;
  switch (key) {
    case 'gridSize': c.gridSize = null; break;
    case 'gridPhaseX': c.gridPhaseX = null; break;
    case 'gridPhaseY': c.gridPhaseY = null; break;
    case 'aaThreshold': c.aaThreshold = null; break;
    case 'autoColors': c.autoColors = null; break;
    case 'lospecSlug':
      c.lospecSlug = null;
      c.customPalette = null;
      state.lospecResult = null;
      state.paletteColors = null;
      break;
    case 'paletteFile':
      if (!c.lospecSlug) {
        c.customPalette = null;
        state.paletteColors = null;
      }
      break;
    case 'bgColor': c.bgColor = null; break;
    case 'borderThreshold': c.borderThreshold = null; break;
    case 'outputScale': c.outputScale = null; break;
    case 'outputWidth': c.outputWidth = null; break;
    case 'outputHeight': c.outputHeight = null; break;
  }
  renderSettings();
  autoProcess();
}

function commitEdit(key: string, rawValue: string): void {
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
    case 'gridPhaseX':
      if (val === '' || val === 'auto') {
        c.gridPhaseX = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 0) c.gridPhaseX = n;
      }
      break;
    case 'gridPhaseY':
      if (val === '' || val === 'auto') {
        c.gridPhaseY = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 0) c.gridPhaseY = n;
      }
      break;
    case 'maxGridCandidate': {
      const n = parseInt(val);
      if (!isNaN(n) && n >= 2) c.maxGridCandidate = Math.min(64, n);
      break;
    }
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
          c.paletteName = null;
          c.lospecSlug = null;
          c.customPalette = null;
          state.paletteColors = null;
          state.lospecResult = null;
        }
      }
      break;
    case 'bgColor':
      if (val === '' || val === 'auto') {
        c.bgColor = null;
      } else {
        // Accept with or without #
        const hex = val.startsWith('#') ? val : '#' + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
          c.bgColor = hex.toUpperCase();
        }
      }
      break;
    case 'borderThreshold':
      if (val === '' || val === 'auto') {
        c.borderThreshold = null;
      } else {
        const n = parseFloat(val);
        if (!isNaN(n)) c.borderThreshold = Math.max(0.01, Math.min(1.0, n));
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
      if (c.paletteName !== null) {
        c.autoColors = null;
        c.lospecSlug = null;
        c.customPalette = null;
        state.lospecResult = null;
        fetchPaletteColors(c.paletteName);
      } else {
        state.paletteColors = null;
      }
      break;
    case 'lospecSlug':
      // Lospec: commit triggers a fetch
      if (val === '' || val === 'none') {
        c.lospecSlug = null;
        c.customPalette = null;
        state.lospecResult = null;
        state.paletteColors = null;
        renderSettings();
        autoProcess();
        return;
      }
      fetchLospec(val);
      return;
    case 'outputScale':
      if (val === '' || val === 'off' || val === '1') {
        c.outputScale = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 2 && n <= 16) c.outputScale = n;
      }
      break;
    case 'outputWidth':
      if (val === '' || val === 'auto') {
        c.outputWidth = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1) c.outputWidth = n;
      }
      break;
    case 'outputHeight':
      if (val === '' || val === 'auto') {
        c.outputHeight = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1) c.outputHeight = n;
      }
      break;
  }

  renderSettings();
  autoProcess();
}

// ---------------------------------------------------------------------------
// Diagnostics rendering
// ---------------------------------------------------------------------------

function renderDiagnostics(): void {
  const info = state.imageInfo;
  if (!info) {
    document.getElementById('diag-grid-info')!.innerHTML =
      '<div class="diag-item"><span class="label">No image loaded</span></div>';
    document.getElementById('diag-grid-bars')!.innerHTML = '';
    document.getElementById('diag-info')!.innerHTML = '';
    document.getElementById('diag-histogram')!.innerHTML = '';
    return;
  }

  let gridHtml = '';
  gridHtml += `<div class="diag-item"><span class="label">Detected size</span><span class="value">${info.gridSize ?? 'none'}</span></div>`;
  gridHtml += `<div class="diag-item"><span class="label">Confidence</span><span class="value">${info.gridConfidence != null ? (info.gridConfidence * 100).toFixed(1) + '%' : 'n/a'}</span></div>`;
  document.getElementById('diag-grid-info')!.innerHTML = gridHtml;

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
  document.getElementById('diag-grid-bars')!.innerHTML = barsHtml;

  let infoHtml = '';
  infoHtml += `<div class="diag-item"><span class="label">Dimensions</span><span class="value">${info.width} x ${info.height}</span></div>`;
  infoHtml += `<div class="diag-item"><span class="label">Unique colors</span><span class="value">${info.uniqueColors}</span></div>`;
  document.getElementById('diag-info')!.innerHTML = infoHtml;

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
  document.getElementById('diag-histogram')!.innerHTML = histHtml;
}

// ---------------------------------------------------------------------------
// Image loading and processing
// ---------------------------------------------------------------------------

async function loadImageBlob(which: string): Promise<string> {
  const bytes = await invoke<number[]>('get_image', { which });
  const arr = new Uint8Array(bytes);
  const blob = new Blob([arr], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

async function openImage(path: string): Promise<void> {
  setStatus('Loading...', 'processing');
  showSpinners();
  try {
    const info = await invoke<ImageInfo>('open_image', { path });
    state.imageLoaded = true;
    state.imagePath = path;
    state.imageInfo = info;
    state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    state.lospecResult = null;
    state.lospecError = null;
    state.paletteColors = null;

    const fname = path.split('/').pop()!.split('\\').pop()!;
    document.getElementById('filename')!.textContent = fname;

    document.getElementById('welcome')!.style.display = 'none';
    document.getElementById('original-pane')!.style.display = 'flex';
    document.getElementById('processed-pane')!.style.display = 'flex';

    const [origUrl, procUrl] = await Promise.all([
      loadImageBlob('original'),
      loadImageBlob('processed'),
    ]);
    (document.getElementById('original-img') as HTMLImageElement).src = origUrl;
    (document.getElementById('processed-img') as HTMLImageElement).src = procUrl;
    document.getElementById('original-dims')!.textContent = `${info.width}\u00d7${info.height}`;
    document.getElementById('processed-dims')!.textContent = `${info.width}\u00d7${info.height}`;

    (document.getElementById('settings-preview-img') as HTMLImageElement).src = procUrl;
    document.getElementById('settings-preview-img')!.style.display = 'block';
    document.getElementById('settings-no-image')!.style.display = 'none';

    renderSettings();
    renderDiagnostics();
    hideSpinners();
    setStatus(`Loaded \u2014 ${info.width}\u00d7${info.height}, grid=${info.gridSize ?? 'none'}, ${info.uniqueColors} colors`, 'success');
  } catch (e) {
    hideSpinners();
    setStatus('Error: ' + e, 'error');
  }
}

function buildProcessConfig(): ProcessConfig {
  const c = state.config;
  return {
    gridSize: c.gridSize,
    gridPhaseX: c.gridPhaseX,
    gridPhaseY: c.gridPhaseY,
    maxGridCandidate: c.maxGridCandidate === 32 ? null : c.maxGridCandidate,
    noGridDetect: c.noGridDetect,
    downscaleMode: c.downscaleMode,
    aaThreshold: c.aaThreshold,
    paletteName: c.paletteName,
    autoColors: c.autoColors,
    customPalette: c.customPalette,
    noQuantize: c.noQuantize,
    removeBg: c.removeBg,
    bgColor: c.bgColor,
    borderThreshold: c.borderThreshold,
    bgTolerance: c.bgTolerance,
    floodFill: c.floodFill,
    outputScale: c.outputScale,
    outputWidth: c.outputWidth,
    outputHeight: c.outputHeight,
  };
}

async function processImage(): Promise<void> {
  if (!state.imageLoaded || state.processing) return;
  state.processing = true;
  setStatus('Processing...', 'processing');
  showSpinners();
  const t0 = performance.now();
  try {
    const result = await invoke<ProcessResult>('process', { pc: buildProcessConfig() });
    state.imageInfo = { ...state.imageInfo!, ...result };

    const procUrl = await loadImageBlob('processed');
    (document.getElementById('processed-img') as HTMLImageElement).src = procUrl;
    document.getElementById('processed-dims')!.textContent = `${result.width}\u00d7${result.height}`;
    (document.getElementById('settings-preview-img') as HTMLImageElement).src = procUrl;

    renderDiagnostics();
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    state.lastProcessTime = performance.now() - t0;
    setStatus(`Processed \u2014 ${result.width}\u00d7${result.height}, ${result.uniqueColors} colors (${elapsed}s)`, 'success');
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

async function doOpen(): Promise<void> {
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

async function doSave(): Promise<void> {
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
      setStatus('Saved: ' + result.split('/').pop()!.split('\\').pop()!, 'success');
    }
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  }
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // When focused on an always-visible inline input, handle Enter/Escape/Tab
  if ((e.target as HTMLElement).classList?.contains('setting-inline-input')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = e.target as HTMLInputElement;
      commitEdit(target.dataset.key!, target.value);
      target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      renderSettings();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      cycleTab(e.shiftKey ? -1 : 1);
    }
    return;
  }

  // When focused on an inline select, let it handle its own keys except Tab
  if ((e.target as HTMLElement).classList?.contains('setting-inline-select')) {
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
    }
    return;
  }

  // Ignore other typing in inputs (sheet inputs, etc.)
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    // Still allow Tab to switch tabs from any input
    if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
    return;
  }

  const key = e.key;

  // Tab switching
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
      switchTab('preview');
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

const TABS = ['preview', 'settings', 'diagnostics', 'batch', 'sheet'];

function cycleTab(dir: number): void {
  let idx = TABS.indexOf(state.activeTab);
  idx = (idx + dir + TABS.length) % TABS.length;
  switchTab(TABS[idx]);
}

function resetConfig(): void {
  state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  state.lospecResult = null;
  state.lospecError = null;
  state.paletteColors = null;
  renderSettings();
  if (state.imageLoaded) {
    autoProcess();
  }
  setStatus('Config reset to defaults');
}

// Auto-process with debounce
let processTimer: ReturnType<typeof setTimeout> | null = null;
function autoProcess(): void {
  if (!state.imageLoaded) return;
  if (processTimer) clearTimeout(processTimer);
  processTimer = setTimeout(() => processImage(), 150);
}

// ---------------------------------------------------------------------------
// Batch tab
// ---------------------------------------------------------------------------

function renderBatch(): void {
  const el = document.getElementById('batch-content')!;
  let html = '';

  html += '<div class="batch-section">';
  html += '<div class="batch-title">Batch Processing</div>';
  html += '<div class="batch-desc">Process multiple images with the current pipeline settings.</div>';
  html += '</div>';

  // File list
  html += '<div class="batch-section">';
  html += `<div class="batch-row"><span class="batch-label">Files</span><span class="batch-value">${state.batchFiles.length} selected</span>`;
  html += `<button class="batch-btn" id="batch-add-files"${state.batchRunning ? ' disabled' : ''}>Add Files</button>`;
  if (state.batchFiles.length > 0) {
    html += `<button class="batch-btn batch-btn-dim" id="batch-clear-files"${state.batchRunning ? ' disabled' : ''}>Clear</button>`;
  }
  html += '</div>';

  if (state.batchFiles.length > 0) {
    html += '<div class="batch-file-list">';
    for (const f of state.batchFiles) {
      const name = f.split('/').pop()!.split('\\').pop()!;
      html += `<div class="batch-file">${escapeHtml(name)}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Output directory
  html += '<div class="batch-section">';
  html += `<div class="batch-row"><span class="batch-label">Output</span><span class="batch-value">${state.batchOutputDir ? escapeHtml(state.batchOutputDir.split('/').pop()!.split('\\').pop()!) : 'not set'}</span>`;
  html += `<button class="batch-btn" id="batch-choose-dir"${state.batchRunning ? ' disabled' : ''}>Choose Folder</button>`;
  html += '</div>';
  html += '</div>';

  // Run button
  const canRun = state.batchFiles.length > 0 && state.batchOutputDir && !state.batchRunning;
  html += '<div class="batch-section">';
  html += `<button class="batch-btn batch-btn-primary" id="batch-run"${canRun ? '' : ' disabled'}>Process All</button>`;
  html += '</div>';

  // Progress
  if (state.batchProgress) {
    const pct = Math.round((state.batchProgress.current / state.batchProgress.total) * 100);
    html += '<div class="batch-section">';
    html += `<div class="batch-progress-info">${state.batchProgress.current}/${state.batchProgress.total} &mdash; ${escapeHtml(state.batchProgress.filename)}</div>`;
    html += `<div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%"></div></div>`;
    html += '</div>';
  }

  // Results
  if (state.batchResult) {
    const r = state.batchResult;
    html += '<div class="batch-section">';
    html += `<div class="batch-result-summary">${r.succeeded} succeeded`;
    if (r.failed.length > 0) {
      html += `, <span class="batch-result-failed">${r.failed.length} failed</span>`;
    }
    html += '</div>';
    if (r.failed.length > 0) {
      html += '<div class="batch-errors">';
      for (const f of r.failed) {
        const name = f.path.split('/').pop()!.split('\\').pop()!;
        html += `<div class="batch-error">${escapeHtml(name)}: ${escapeHtml(f.error)}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

async function batchAddFiles(): Promise<void> {
  try {
    const result = await openDialog({
      multiple: true,
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
      }],
    });
    if (result) {
      // result may be a string or array depending on selection
      const paths = Array.isArray(result) ? result : [result];
      // Add to existing list, dedup
      const existing = new Set(state.batchFiles);
      for (const p of paths) {
        if (p && !existing.has(p)) {
          state.batchFiles.push(p);
          existing.add(p);
        }
      }
      renderBatch();
    }
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  }
}

async function batchChooseDir(): Promise<void> {
  try {
    const result = await openDialog({
      directory: true,
    });
    if (result) {
      state.batchOutputDir = Array.isArray(result) ? result[0] : result;
      renderBatch();
    }
  } catch (e) {
    setStatus('Error: ' + e, 'error');
  }
}

async function batchRun(): Promise<void> {
  if (state.batchRunning || state.batchFiles.length === 0 || !state.batchOutputDir) return;
  state.batchRunning = true;
  state.batchResult = null;
  state.batchProgress = { current: 0, total: state.batchFiles.length, filename: '' };
  renderBatch();
  setStatus('Batch processing...', 'processing');

  // Listen for progress events
  const unlisten = await window.__TAURI__.event.listen('batch-progress', (event: { payload: { current: number; total: number; filename: string } }) => {
    state.batchProgress = event.payload;
    renderBatch();
  });

  try {
    const result = await invoke<{ succeeded: number; failed: { path: string; error: string }[] }>('batch_process', {
      inputPaths: state.batchFiles,
      outputDir: state.batchOutputDir,
      pc: buildProcessConfig(),
      overwrite: false,
    });
    state.batchResult = result;
    setStatus(`Batch done: ${result.succeeded} succeeded, ${result.failed.length} failed`, result.failed.length > 0 ? 'error' : 'success');
  } catch (e) {
    setStatus('Batch error: ' + e, 'error');
  } finally {
    state.batchRunning = false;
    state.batchProgress = null;
    if (typeof unlisten === 'function') unlisten();
    renderBatch();
  }
}

// ---------------------------------------------------------------------------
// Sheet tab
// ---------------------------------------------------------------------------

function renderSheet(): void {
  const el = document.getElementById('sheet-content')!;
  const sc = state.sheetConfig;
  const dis = state.sheetProcessing ? ' disabled' : '';
  let html = '';

  html += '<div class="sheet-section">';
  html += '<div class="sheet-title">Sprite Sheet Processing</div>';
  html += '<div class="sheet-desc">Split a sprite sheet into individual tiles, run the normalize pipeline on each one, then reassemble into a clean sheet. You can also export each tile as a separate file.</div>';
  if (!state.imageLoaded) {
    html += '<div class="sheet-desc" style="color:var(--yellow);margin-top:6px">Load an image first in the Preview tab.</div>';
  }
  html += '</div>';

  // Mode toggle
  html += '<div class="sheet-section">';
  html += '<div class="sheet-setting-label" style="margin-bottom:4px">Split Mode</div>';
  html += '<div class="sheet-mode-toggle">';
  html += `<button class="sheet-mode-btn${state.sheetMode === 'fixed' ? ' active' : ''}" data-mode="fixed">Fixed Grid</button>`;
  html += `<button class="sheet-mode-btn${state.sheetMode === 'auto' ? ' active' : ''}" data-mode="auto">Auto-Split</button>`;
  html += '</div>';
  if (state.sheetMode === 'fixed') {
    html += '<div class="sheet-help">Use when your sheet has a uniform grid &mdash; all tiles are the same size with consistent spacing.</div>';
  } else {
    html += '<div class="sheet-help">Use when tiles are different sizes or irregularly placed. Detects sprites automatically by finding separator rows/columns in the image.</div>';
  }
  html += '</div>';

  // Mode-specific settings
  html += '<div class="sheet-section">';
  if (state.sheetMode === 'fixed') {
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Tile Width</span>';
    html += `<input class="sheet-input" type="number" id="sheet-tw" value="${sc.tileWidth ?? ''}" placeholder="px"${dis}></div>`;
    html += '<div class="sheet-help">Width of each tile in pixels. Required.</div>';

    html += '<div class="sheet-setting"><span class="sheet-setting-label">Tile Height</span>';
    html += `<input class="sheet-input" type="number" id="sheet-th" value="${sc.tileHeight ?? ''}" placeholder="px"${dis}></div>`;
    html += '<div class="sheet-help">Height of each tile in pixels. Required.</div>';

    html += '<div class="sheet-setting"><span class="sheet-setting-label">Spacing</span>';
    html += `<input class="sheet-input" type="number" id="sheet-sp" value="${sc.spacing}" placeholder="0"${dis}></div>`;
    html += '<div class="sheet-help">Gap between tiles in pixels. Set to 0 if tiles are packed edge-to-edge.</div>';

    html += '<div class="sheet-setting"><span class="sheet-setting-label">Margin</span>';
    html += `<input class="sheet-input" type="number" id="sheet-mg" value="${sc.margin}" placeholder="0"${dis}></div>`;
    html += '<div class="sheet-help">Border around the entire sheet in pixels. Usually 0.</div>';
  } else {
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Sep. Threshold</span>';
    html += `<input class="sheet-input" type="number" id="sheet-sep" value="${sc.separatorThreshold}" step="0.05" min="0" max="1"${dis}></div>`;
    html += '<div class="sheet-help">How uniform a row/column must be to count as a separator (0&ndash;1). Higher = stricter. 0.90 works for most sheets.</div>';

    html += '<div class="sheet-setting"><span class="sheet-setting-label">Min Sprite Size</span>';
    html += `<input class="sheet-input" type="number" id="sheet-min" value="${sc.minSpriteSize}" min="1"${dis}></div>`;
    html += '<div class="sheet-help">Ignore detected regions smaller than this many pixels. Filters out noise and tiny fragments.</div>';

    html += '<div class="sheet-setting"><span class="sheet-setting-label">Padding</span>';
    html += `<input class="sheet-input" type="number" id="sheet-pad" value="${sc.pad}" min="0"${dis}></div>`;
    html += '<div class="sheet-help">Extra pixels to include around each detected sprite. Useful if auto-detection crops too tightly.</div>';
  }
  html += '</div>';

  // Skip normalize toggle
  html += '<div class="sheet-section">';
  html += '<div class="sheet-setting"><span class="sheet-setting-label">Skip Normalize</span>';
  html += `<button class="batch-btn batch-btn-dim" id="sheet-no-normalize" style="min-width:40px"${dis}>${sc.noNormalize ? 'on' : 'off'}</button></div>`;
  html += '<div class="sheet-help">When on, tiles are split and reassembled without running the pipeline. Useful for just extracting or rearranging tiles.</div>';
  html += '</div>';

  // Action buttons
  const canAct = state.imageLoaded && !state.sheetProcessing;
  html += '<div class="sheet-section">';
  html += '<div class="sheet-actions">';
  html += `<button class="batch-btn" id="sheet-preview-btn"${canAct ? '' : ' disabled'}>Preview Split</button>`;
  html += `<button class="batch-btn batch-btn-primary" id="sheet-process-btn"${canAct ? '' : ' disabled'}>Process Sheet</button>`;
  html += `<button class="batch-btn" id="sheet-save-tiles-btn"${state.sheetPreview && !state.sheetProcessing ? '' : ' disabled'}>Save Tiles</button>`;
  html += '</div>';
  html += '<div class="sheet-help"><strong>Preview Split</strong> shows how many tiles will be extracted. <strong>Process Sheet</strong> runs the normalize pipeline on each tile and reassembles. <strong>Save Tiles</strong> exports each tile as a separate PNG.</div>';
  html += '</div>';

  // Preview info
  if (state.sheetPreview) {
    const p = state.sheetPreview;
    html += '<div class="sheet-section">';
    html += `<div class="sheet-info">${p.tileCount} tiles &mdash; ${p.cols}\u00d7${p.rows} grid &mdash; ${p.tileWidth}\u00d7${p.tileHeight}px each</div>`;
    html += '</div>';

    // GIF animation section
    const gifDis = state.gifGenerating ? ' disabled' : '';
    html += '<div class="sheet-section">';
    html += '<div class="sheet-title" style="margin-top:4px">GIF Animation</div>';
    html += '<div class="sheet-help">Generate an animated GIF from the processed tiles. Preview it here or export to a file.</div>';

    // Mode toggle
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Animate</span>';
    html += '<div class="sheet-mode-toggle">';
    html += `<button class="sheet-mode-btn gif-mode-btn${state.gifMode === 'row' ? ' active' : ''}" data-gif-mode="row"${gifDis}>By Row</button>`;
    html += `<button class="sheet-mode-btn gif-mode-btn${state.gifMode === 'all' ? ' active' : ''}" data-gif-mode="all"${gifDis}>Entire Sheet</button>`;
    html += '</div></div>';

    // Row selector (row mode only)
    if (state.gifMode === 'row') {
      html += '<div class="sheet-setting"><span class="sheet-setting-label">Row</span>';
      html += `<input class="sheet-input" type="number" id="gif-row" value="${state.gifRow}" min="0" max="${p.rows - 1}"${gifDis}></div>`;
      html += `<div class="sheet-help">Which row to animate (0\u2013${p.rows - 1}). Each row becomes one animation sequence.</div>`;
    }

    // FPS input
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Frame Rate</span>';
    html += `<input class="sheet-input" type="number" id="gif-fps" value="${state.gifFps}" min="1" max="100"${gifDis}></div>`;
    html += '<div class="sheet-help">Frames per second (1\u2013100). 10 fps is a good default for pixel art animations.</div>';

    // Action buttons
    html += '<div class="sheet-actions" style="margin-top:4px">';
    html += `<button class="batch-btn batch-btn-primary" id="gif-preview-btn"${gifDis}>Preview GIF</button>`;
    html += `<button class="batch-btn" id="gif-export-btn"${state.gifPreviewUrl && !state.gifGenerating ? '' : ' disabled'}>Export GIF</button>`;
    html += '</div>';

    // Generating indicator
    if (state.gifGenerating) {
      html += '<div class="sheet-info" style="color:var(--mauve);margin-top:6px">Generating GIF...</div>';
    }

    // Preview area
    if (state.gifPreviewUrl) {
      html += '<div class="gif-preview-container">';
      html += `<img class="gif-preview-img" src="${state.gifPreviewUrl}" alt="GIF Preview">`;
      html += '</div>';
    }

    html += '</div>';
  }

  if (state.sheetProcessing) {
    html += '<div class="sheet-section"><div class="sheet-info" style="color:var(--mauve)">Processing...</div></div>';
  }

  el.innerHTML = html;
}

function readSheetConfig(): void {
  const sc = state.sheetConfig;
  if (state.sheetMode === 'fixed') {
    const tw = document.getElementById('sheet-tw') as HTMLInputElement | null;
    const th = document.getElementById('sheet-th') as HTMLInputElement | null;
    const sp = document.getElementById('sheet-sp') as HTMLInputElement | null;
    const mg = document.getElementById('sheet-mg') as HTMLInputElement | null;
    if (tw) { const v = parseInt(tw.value); sc.tileWidth = isNaN(v) || v < 1 ? null : v; }
    if (th) { const v = parseInt(th.value); sc.tileHeight = isNaN(v) || v < 1 ? null : v; }
    if (sp) { const v = parseInt(sp.value); sc.spacing = isNaN(v) ? 0 : Math.max(0, v); }
    if (mg) { const v = parseInt(mg.value); sc.margin = isNaN(v) ? 0 : Math.max(0, v); }
  } else {
    const sep = document.getElementById('sheet-sep') as HTMLInputElement | null;
    const min = document.getElementById('sheet-min') as HTMLInputElement | null;
    const pad = document.getElementById('sheet-pad') as HTMLInputElement | null;
    if (sep) { const v = parseFloat(sep.value); sc.separatorThreshold = isNaN(v) ? 0.90 : Math.max(0, Math.min(1, v)); }
    if (min) { const v = parseInt(min.value); sc.minSpriteSize = isNaN(v) ? 8 : Math.max(1, v); }
    if (pad) { const v = parseInt(pad.value); sc.pad = isNaN(v) ? 0 : Math.max(0, v); }
  }
}

function buildSheetArgs(): Record<string, unknown> {
  const sc = state.sheetConfig;
  return {
    mode: state.sheetMode,
    tileWidth: sc.tileWidth,
    tileHeight: sc.tileHeight,
    spacing: sc.spacing,
    margin: sc.margin,
    separatorThreshold: sc.separatorThreshold,
    minSpriteSize: sc.minSpriteSize,
    pad: sc.pad,
    noNormalize: sc.noNormalize || null,
  };
}

async function sheetPreviewAction(): Promise<void> {
  if (!state.imageLoaded || state.sheetProcessing) return;
  readSheetConfig();
  state.sheetProcessing = true;
  renderSheet();
  try {
    const result = await invoke<{ tileCount: number; tileWidth: number; tileHeight: number; cols: number; rows: number }>('sheet_preview', buildSheetArgs());
    state.sheetPreview = result;
    setStatus(`Sheet: ${result.tileCount} tiles (${result.cols}\u00d7${result.rows})`, 'success');
  } catch (e) {
    setStatus('Sheet error: ' + e, 'error');
    state.sheetPreview = null;
  } finally {
    state.sheetProcessing = false;
    renderSheet();
  }
}

async function sheetProcessAction(): Promise<void> {
  if (!state.imageLoaded || state.sheetProcessing) return;
  readSheetConfig();
  state.sheetProcessing = true;
  state.gifPreviewUrl = null;
  renderSheet();
  setStatus('Processing sheet...', 'processing');
  const t0 = performance.now();
  try {
    const args = { ...buildSheetArgs(), pc: buildProcessConfig() };
    const result = await invoke<{ tileCount: number; tileWidth: number; tileHeight: number; cols: number; rows: number; outputWidth: number; outputHeight: number }>('sheet_process', args);
    state.sheetPreview = result;

    // Update preview with the processed sheet
    const procUrl = await loadImageBlob('processed');
    (document.getElementById('processed-img') as HTMLImageElement).src = procUrl;
    document.getElementById('processed-dims')!.textContent = `${result.outputWidth}\u00d7${result.outputHeight}`;
    (document.getElementById('settings-preview-img') as HTMLImageElement).src = procUrl;

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    setStatus(`Sheet processed: ${result.tileCount} tiles, ${result.outputWidth}\u00d7${result.outputHeight} (${elapsed}s)`, 'success');
  } catch (e) {
    setStatus('Sheet error: ' + e, 'error');
  } finally {
    state.sheetProcessing = false;
    renderSheet();
  }
}

async function sheetSaveTilesAction(): Promise<void> {
  try {
    const result = await openDialog({ directory: true });
    if (result) {
      const dir = Array.isArray(result) ? result[0] : result;
      const count = await invoke<number>('sheet_save_tiles', { outputDir: dir });
      setStatus(`Saved ${count} tiles to ${dir.split('/').pop()!.split('\\').pop()!}`, 'success');
    }
  } catch (e) {
    setStatus('Error saving tiles: ' + e, 'error');
  }
}

function readGifConfig(): void {
  const rowEl = document.getElementById('gif-row') as HTMLInputElement | null;
  const fpsEl = document.getElementById('gif-fps') as HTMLInputElement | null;
  if (rowEl) {
    const v = parseInt(rowEl.value);
    state.gifRow = isNaN(v) ? 0 : Math.max(0, v);
  }
  if (fpsEl) {
    const v = parseInt(fpsEl.value);
    state.gifFps = isNaN(v) ? 10 : Math.max(1, Math.min(100, v));
  }
}

async function gifPreviewAction(): Promise<void> {
  if (state.gifGenerating) return;
  readGifConfig();
  state.gifGenerating = true;
  state.gifPreviewUrl = null;
  renderSheet();
  setStatus('Generating GIF preview...', 'processing');
  try {
    const dataUrl = await invoke<string>('sheet_generate_gif', {
      mode: state.gifMode,
      row: state.gifMode === 'row' ? state.gifRow : null,
      fps: state.gifFps,
    });
    state.gifPreviewUrl = dataUrl;
    setStatus('GIF preview generated', 'success');
  } catch (e) {
    setStatus('GIF error: ' + e, 'error');
  } finally {
    state.gifGenerating = false;
    renderSheet();
  }
}

async function gifExportAction(): Promise<void> {
  if (!state.gifPreviewUrl) return;
  readGifConfig();
  try {
    const defaultName = state.gifMode === 'row' ? `row_${state.gifRow}.gif` : 'animation.gif';
    const path = await saveDialog({
      filters: [{ name: 'GIF', extensions: ['gif'] }],
      defaultPath: defaultName,
    });
    if (path) {
      setStatus('Exporting GIF...', 'processing');
      await invoke('sheet_export_gif', {
        path,
        mode: state.gifMode,
        row: state.gifMode === 'row' ? state.gifRow : null,
        fps: state.gifFps,
      });
      const fname = (path as string).split('/').pop()!.split('\\').pop()!;
      setStatus(`GIF saved to ${fname}`, 'success');
    }
  } catch (e) {
    setStatus('GIF export error: ' + e, 'error');
  }
}

// ---------------------------------------------------------------------------
// Tab click handling
// ---------------------------------------------------------------------------

document.querySelector('.tab-bar')!.addEventListener('click', (e: Event) => {
  const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (tab) switchTab(tab.dataset.tab!);
});

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

const dropOverlay = document.getElementById('drop-overlay')!;
let dragCounter = 0;

document.addEventListener('dragenter', (e: DragEvent) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', (e: DragEvent) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('active');
  }
});

document.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0] as File & { path?: string };
    if (file.path) {
      await openImage(file.path);
    }
  }
});

// Tauri native file drop events
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen('tauri://drag-drop', async (event: TauriEvent) => {
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

document.getElementById('settings-list')!.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;

  // Clear button click (× to reset nullable setting)
  if (target.classList?.contains('setting-clear') && !state.processing) {
    skipNextBlurCommit = true;
    const key = target.dataset.key!;
    clearSetting(key);
    return;
  }

  // Boolean or nullable-off toggle click
  if (target.classList?.contains('setting-toggle') && !state.processing) {
    const key = target.dataset.key!;
    const row = target.closest('.setting-row') as HTMLElement | null;
    if (row) state.settingsFocusIndex = parseInt(row.dataset.index!);
    if (BOOLEAN_SETTINGS.includes(key)) {
      adjustSetting(key, 1);
      renderSettings();
      autoProcess();
    } else {
      // Nullable setting in "off" state — enable it
      startEditing(key);
    }
    return;
  }

  // Click on row to focus it
  const row = target.closest('.setting-row') as HTMLElement | null;
  if (row) {
    state.settingsFocusIndex = parseInt(row.dataset.index!);
    renderSettings();
  }
});

// Commit inline input on blur
let skipNextBlurCommit = false;
document.getElementById('settings-list')!.addEventListener('focusout', (e: FocusEvent) => {
  const target = e.target as HTMLElement;
  if (target.classList?.contains('setting-inline-input')) {
    setTimeout(() => {
      if (skipNextBlurCommit) { skipNextBlurCommit = false; return; }
      commitEdit((target as HTMLInputElement).dataset.key!, (target as HTMLInputElement).value);
    }, 50);
  }
});

// Commit select changes
document.getElementById('settings-list')!.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLSelectElement;
  if (target.tagName === 'SELECT' && target.classList?.contains('setting-inline-select')) {
    commitEdit(target.dataset.key!, target.value);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  try {
    state.palettes = await invoke<PaletteInfo[]>('list_palettes');
  } catch (e) {
    console.error('Failed to load palettes:', e);
  }
  renderSettings();
  renderDiagnostics();
  renderBatch();
  renderSheet();
}

// Batch panel click delegation
document.getElementById('batch-content')!.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.id === 'batch-add-files') { batchAddFiles(); return; }
  if (target.id === 'batch-clear-files') { state.batchFiles = []; state.batchResult = null; renderBatch(); return; }
  if (target.id === 'batch-choose-dir') { batchChooseDir(); return; }
  if (target.id === 'batch-run') { batchRun(); return; }
});

// Sheet panel click delegation
document.getElementById('sheet-content')!.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.classList?.contains('sheet-mode-btn') && !target.classList.contains('gif-mode-btn')) {
    const mode = target.dataset.mode as 'fixed' | 'auto';
    if (mode) { state.sheetMode = mode; state.sheetPreview = null; renderSheet(); }
    return;
  }
  if (target.classList?.contains('gif-mode-btn')) {
    const gifMode = target.dataset.gifMode as 'row' | 'all';
    if (gifMode) { state.gifMode = gifMode; state.gifPreviewUrl = null; renderSheet(); }
    return;
  }
  if (target.id === 'sheet-no-normalize') { state.sheetConfig.noNormalize = !state.sheetConfig.noNormalize; renderSheet(); return; }
  if (target.id === 'sheet-preview-btn') { sheetPreviewAction(); return; }
  if (target.id === 'sheet-process-btn') { sheetProcessAction(); return; }
  if (target.id === 'sheet-save-tiles-btn') { sheetSaveTilesAction(); return; }
  if (target.id === 'gif-preview-btn') { gifPreviewAction(); return; }
  if (target.id === 'gif-export-btn') { gifExportAction(); return; }
});

init();
