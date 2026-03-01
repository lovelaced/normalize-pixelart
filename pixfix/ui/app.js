// pixfix/ui/src/app.ts
var { invoke } = window.__TAURI__.core;
var { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;
var state = {
  activeTab: "preview",
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
    downscaleMode: "snap",
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
    outputHeight: null
  },
  lospecResult: null,
  lospecError: null,
  lospecLoading: false,
  paletteColors: null,
  showAllHelp: false,
  lastProcessTime: null,
  batchFiles: [],
  batchOutputDir: null,
  batchRunning: false,
  batchProgress: null,
  batchResult: null,
  sheetMode: "auto",
  sheetConfig: {
    tileWidth: null,
    tileHeight: null,
    spacing: 0,
    margin: 0,
    separatorThreshold: 0.9,
    minSpriteSize: 8,
    pad: 0,
    noNormalize: false
  },
  sheetPreview: null,
  sheetProcessing: false,
  gifMode: "row",
  gifRow: 0,
  gifFps: 10,
  gifPreviewUrl: null,
  gifGenerating: false
};
var DEFAULT_CONFIG = JSON.parse(JSON.stringify(state.config));
var DOWNSCALE_MODES = ["snap", "center-weighted", "majority-vote", "center-pixel"];
function getSettings() {
  const c = state.config;
  return [
    { section: "Grid Detection" },
    {
      key: "gridSize",
      label: "Grid Size",
      value: c.gridSize === null ? "auto" : String(c.gridSize),
      help: 'How many screen pixels make up one "logical" pixel in your art. Auto-detection works well for most images. Override if the grid looks wrong.',
      changed: c.gridSize !== null
    },
    {
      key: "gridPhaseX",
      label: "Phase X",
      value: c.gridPhaseX === null ? "auto" : String(c.gridPhaseX),
      help: "Override the X offset of the grid alignment. Usually auto-detected.",
      changed: c.gridPhaseX !== null
    },
    {
      key: "gridPhaseY",
      label: "Phase Y",
      value: c.gridPhaseY === null ? "auto" : String(c.gridPhaseY),
      help: "Override the Y offset of the grid alignment. Usually auto-detected.",
      changed: c.gridPhaseY !== null
    },
    {
      key: "noGridDetect",
      label: "Skip Grid",
      value: c.noGridDetect ? "on" : "off",
      help: "Skip grid detection entirely. Useful if your image is already at logical resolution.",
      changed: c.noGridDetect
    },
    {
      key: "maxGridCandidate",
      label: "Max Grid",
      value: String(c.maxGridCandidate),
      help: "Maximum grid size to test during auto-detection (default: 32).",
      changed: c.maxGridCandidate !== 32
    },
    {
      key: "downscaleMode",
      label: "Mode",
      value: c.downscaleMode,
      help: 'How to combine pixels in each grid cell. "snap" cleans in-place at original resolution. Others reduce to logical pixel resolution.',
      changed: c.downscaleMode !== "snap"
    },
    { section: "Anti-Aliasing" },
    {
      key: "aaThreshold",
      label: "AA Removal",
      value: c.aaThreshold === null ? "off" : c.aaThreshold.toFixed(2),
      help: "Removes soft blending between colors added by AI generators. Lower values are more aggressive. Try 0.30\u20130.50 for most images.",
      changed: c.aaThreshold !== null
    },
    { section: "Color Palette" },
    {
      key: "paletteName",
      label: "Palette",
      value: c.paletteName === null ? "none" : c.paletteName,
      help: "Snap all colors to a classic pixel art palette. Mutually exclusive with Lospec and Auto Colors.",
      changed: c.paletteName !== null
    },
    {
      key: "lospecSlug",
      label: "Lospec",
      value: c.lospecSlug === null ? "none" : c.lospecSlug,
      help: 'Load any palette from lospec.com by slug (e.g. "pico-8", "endesga-32"). Press Enter to type a slug and fetch it.',
      changed: c.lospecSlug !== null
    },
    {
      key: "autoColors",
      label: "Auto Colors",
      value: c.autoColors === null ? "off" : String(c.autoColors),
      help: "Auto-extract the best N colors from your image using k-means clustering in OKLAB color space.",
      changed: c.autoColors !== null
    },
    {
      key: "paletteFile",
      label: "Load .hex",
      value: c.customPalette && !c.lospecSlug ? `${c.customPalette.length} colors` : "none",
      help: "Load a palette from a .hex file (one hex color per line). Overrides palette and auto colors.",
      changed: c.customPalette !== null && c.lospecSlug === null
    },
    {
      key: "noQuantize",
      label: "Skip Quantize",
      value: c.noQuantize ? "on" : "off",
      help: "Skip color quantization entirely. Useful if you only want grid snapping and AA removal without palette changes.",
      changed: c.noQuantize
    },
    { section: "Background" },
    {
      key: "removeBg",
      label: "Remove BG",
      value: c.removeBg ? "on" : "off",
      help: "Detect and make the background transparent. The dominant border color is treated as background.",
      changed: c.removeBg
    },
    {
      key: "bgColor",
      label: "BG Color",
      value: c.bgColor === null ? "auto" : c.bgColor,
      help: 'Explicit background color as hex (e.g. "#FF00FF"). If auto, detects from border pixels.',
      changed: c.bgColor !== null
    },
    {
      key: "borderThreshold",
      label: "Border Thresh",
      value: c.borderThreshold === null ? "0.40" : c.borderThreshold.toFixed(2),
      help: "Fraction of border pixels that must match for auto-detection (0.0\u20131.0, default: 0.40).",
      changed: c.borderThreshold !== null
    },
    {
      key: "bgTolerance",
      label: "BG Tolerance",
      value: c.bgTolerance.toFixed(2),
      help: "How different a pixel can be from the background color and still count as background. Higher = more aggressive.",
      changed: c.bgTolerance !== 0.05
    },
    {
      key: "floodFill",
      label: "Flood Fill",
      value: c.floodFill ? "on" : "off",
      help: "On: only remove connected background from edges. Off: remove matching color everywhere.",
      changed: !c.floodFill
    },
    { section: "Output" },
    {
      key: "outputScale",
      label: "Scale",
      value: c.outputScale === null ? "off" : c.outputScale + "x",
      help: "Scale the output by an integer multiplier (2x, 3x, etc). Great for upscaling sprites for game engines.",
      changed: c.outputScale !== null
    },
    {
      key: "outputWidth",
      label: "Width",
      value: c.outputWidth === null ? "auto" : String(c.outputWidth),
      help: "Explicit output width in pixels. Overrides scale.",
      changed: c.outputWidth !== null
    },
    {
      key: "outputHeight",
      label: "Height",
      value: c.outputHeight === null ? "auto" : String(c.outputHeight),
      help: "Explicit output height in pixels. Overrides scale.",
      changed: c.outputHeight !== null
    }
  ];
}
function getSettingRows() {
  return getSettings().filter((s) => !s.section);
}
function adjustSetting(key, direction) {
  const c = state.config;
  switch (key) {
    case "gridSize":
      if (c.gridSize === null) {
        c.gridSize = state.imageInfo?.gridSize || 4;
      } else {
        c.gridSize = Math.max(1, c.gridSize + direction);
        if (c.gridSize === 1 && direction < 0)
          c.gridSize = null;
      }
      break;
    case "gridPhaseX":
      if (c.gridPhaseX === null) {
        c.gridPhaseX = 0;
      } else {
        c.gridPhaseX = Math.max(0, c.gridPhaseX + direction);
      }
      break;
    case "gridPhaseY":
      if (c.gridPhaseY === null) {
        c.gridPhaseY = 0;
      } else {
        c.gridPhaseY = Math.max(0, c.gridPhaseY + direction);
      }
      break;
    case "maxGridCandidate":
      c.maxGridCandidate = Math.max(2, Math.min(64, c.maxGridCandidate + direction * 4));
      break;
    case "noGridDetect":
      c.noGridDetect = !c.noGridDetect;
      break;
    case "downscaleMode": {
      let idx = DOWNSCALE_MODES.indexOf(c.downscaleMode);
      idx = (idx + direction + DOWNSCALE_MODES.length) % DOWNSCALE_MODES.length;
      c.downscaleMode = DOWNSCALE_MODES[idx];
      break;
    }
    case "aaThreshold":
      if (c.aaThreshold === null) {
        c.aaThreshold = 0.5;
      } else {
        c.aaThreshold = Math.round((c.aaThreshold + direction * 0.05) * 100) / 100;
        if (c.aaThreshold <= 0)
          c.aaThreshold = null;
        else if (c.aaThreshold > 1)
          c.aaThreshold = 1;
      }
      break;
    case "paletteName": {
      const names = [null, ...state.palettes.map((p) => p.slug)];
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
    case "autoColors":
      if (c.autoColors === null) {
        c.autoColors = 16;
      } else {
        c.autoColors = Math.max(2, c.autoColors + direction * 2);
        if (c.autoColors <= 2 && direction < 0)
          c.autoColors = null;
        else if (c.autoColors > 256)
          c.autoColors = 256;
      }
      if (c.autoColors !== null) {
        c.paletteName = null;
        c.lospecSlug = null;
        c.customPalette = null;
        state.paletteColors = null;
        state.lospecResult = null;
      }
      break;
    case "removeBg":
      c.removeBg = !c.removeBg;
      break;
    case "borderThreshold":
      if (c.borderThreshold === null) {
        c.borderThreshold = 0.4;
      } else {
        c.borderThreshold = Math.round((c.borderThreshold + direction * 0.05) * 100) / 100;
        if (c.borderThreshold <= 0)
          c.borderThreshold = null;
        else if (c.borderThreshold > 1)
          c.borderThreshold = 1;
      }
      break;
    case "bgTolerance":
      c.bgTolerance = Math.round((c.bgTolerance + direction * 0.01) * 100) / 100;
      c.bgTolerance = Math.max(0.01, Math.min(0.5, c.bgTolerance));
      break;
    case "floodFill":
      c.floodFill = !c.floodFill;
      break;
    case "outputScale":
      if (c.outputScale === null) {
        c.outputScale = 2;
      } else {
        c.outputScale = c.outputScale + direction;
        if (c.outputScale < 2)
          c.outputScale = null;
        else if (c.outputScale > 16)
          c.outputScale = 16;
      }
      break;
    case "outputWidth":
      if (c.outputWidth === null) {
        c.outputWidth = state.imageInfo?.width || 64;
      } else {
        c.outputWidth = Math.max(1, c.outputWidth + direction * 8);
      }
      break;
    case "outputHeight":
      if (c.outputHeight === null) {
        c.outputHeight = state.imageInfo?.height || 64;
      } else {
        c.outputHeight = Math.max(1, c.outputHeight + direction * 8);
      }
      break;
  }
}
async function fetchPaletteColors(slug) {
  try {
    const colors = await invoke("get_palette_colors", { slug });
    state.paletteColors = colors;
    renderSettings();
  } catch {
    state.paletteColors = null;
  }
}
async function fetchLospec(slug) {
  state.lospecLoading = true;
  state.lospecError = null;
  renderSettings();
  try {
    const result = await invoke("fetch_lospec", { slug });
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
async function loadPaletteFileDialog() {
  try {
    const result = await openDialog({
      multiple: false,
      filters: [{
        name: "Palette Files",
        extensions: ["hex", "txt"]
      }]
    });
    if (result) {
      const colors = await invoke("load_palette_file", { path: result });
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
    setStatus("Error loading palette: " + e, "error");
  }
}
function setStatus(msg, type = "") {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = "status-msg" + (type ? " " + type : "");
}
function showSpinners() {
  document.getElementById("preview-spinner")?.classList.add("active");
  document.getElementById("settings-spinner")?.classList.add("active");
}
function hideSpinners() {
  document.getElementById("preview-spinner")?.classList.remove("active");
  document.getElementById("settings-spinner")?.classList.remove("active");
}
function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === "panel-" + name);
  });
  if (name === "batch")
    renderBatch();
  if (name === "sheet")
    renderSheet();
}
var SELECT_SETTINGS = ["downscaleMode", "paletteName"];
var BOOLEAN_SETTINGS = ["removeBg", "floodFill", "noGridDetect", "noQuantize"];
var INPUT_SETTINGS = ["gridSize", "gridPhaseX", "gridPhaseY", "maxGridCandidate", "aaThreshold", "autoColors", "bgColor", "borderThreshold", "bgTolerance", "lospecSlug", "outputScale", "outputWidth", "outputHeight"];
var FILE_SETTINGS = ["paletteFile"];
var NULLABLE_SETTINGS = {
  gridSize: { offLabel: "auto", defaultValue: () => state.imageInfo?.gridSize || 4 },
  gridPhaseX: { offLabel: "auto", defaultValue: () => 0 },
  gridPhaseY: { offLabel: "auto", defaultValue: () => 0 },
  aaThreshold: { offLabel: "off", defaultValue: () => 0.5 },
  autoColors: { offLabel: "off", defaultValue: () => 16 },
  lospecSlug: { offLabel: "none", defaultValue: () => null },
  bgColor: { offLabel: "auto", defaultValue: () => null },
  borderThreshold: { offLabel: "0.40", defaultValue: () => 0.4 },
  outputScale: { offLabel: "off", defaultValue: () => 2 },
  outputWidth: { offLabel: "auto", defaultValue: () => state.imageInfo?.width || 64 },
  outputHeight: { offLabel: "auto", defaultValue: () => state.imageInfo?.height || 64 }
};
function renderSettings() {
  const list = document.getElementById("settings-list");
  const focused = document.activeElement;
  if (focused && focused.classList?.contains("setting-inline-input") && list.contains(focused)) {
    updateSettingsFocusOnly(list);
    return;
  }
  const settings = getSettings();
  let rowIndex = 0;
  let html = "";
  for (const s of settings) {
    if (s.section) {
      html += `<div class="setting-section">${s.section}</div>`;
    } else {
      const isFocused = rowIndex === state.settingsFocusIndex ? " focused" : "";
      const changed = s.changed ? " changed" : "";
      html += `<div class="setting-row${isFocused}" data-index="${rowIndex}" data-key="${s.key}">`;
      html += `<span class="setting-indicator">&#9654;</span>`;
      html += `<span class="setting-label">${s.label}</span>`;
      html += `<span class="setting-value${changed}">`;
      if (SELECT_SETTINGS.includes(s.key)) {
        html += renderInlineSelect(s.key);
      } else if (BOOLEAN_SETTINGS.includes(s.key)) {
        html += `<span class="setting-toggle" data-key="${s.key}">${escapeHtml(s.value)}</span>`;
      } else if (FILE_SETTINGS.includes(s.key)) {
        if (s.changed) {
          html += escapeHtml(s.value);
          html += `<span class="setting-clear" data-key="${s.key}" title="Clear">\xD7</span>`;
        } else {
          html += `<span class="setting-toggle" data-key="${s.key}">${escapeHtml(s.value)}</span>`;
        }
      } else if (INPUT_SETTINGS.includes(s.key)) {
        html += renderInlineInput(s.key);
        if (s.key in NULLABLE_SETTINGS && s.changed) {
          const nullable = NULLABLE_SETTINGS[s.key];
          html += `<span class="setting-clear" data-key="${s.key}" title="Reset to ${nullable.offLabel}">\xD7</span>`;
        }
      } else {
        html += escapeHtml(s.value);
      }
      html += `</span>`;
      html += `</div>`;
      html += `<div class="setting-help">${s.help}</div>`;
      if ((s.key === "paletteName" || s.key === "lospecSlug" || s.key === "paletteFile") && state.paletteColors && state.paletteColors.length > 0) {
        if (s.key === "paletteName" && state.config.paletteName !== null || s.key === "lospecSlug" && state.config.lospecSlug !== null || s.key === "paletteFile" && state.config.customPalette !== null && state.config.lospecSlug === null) {
          html += renderPaletteSwatches(state.paletteColors);
        }
      }
      if (s.key === "lospecSlug") {
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
function updateSettingsFocusOnly(list) {
  const rows = list.querySelectorAll(".setting-row");
  rows.forEach((row, i) => {
    row.classList.toggle("focused", i === state.settingsFocusIndex);
  });
}
function renderPaletteSwatches(colors) {
  let html = '<div class="palette-swatches">';
  for (const color of colors) {
    html += `<div class="palette-swatch" style="background:${color}" title="${color}"></div>`;
  }
  html += "</div>";
  return html;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderInlineSelect(key) {
  const c = state.config;
  switch (key) {
    case "downscaleMode": {
      const opts = DOWNSCALE_MODES.map((m) => `<option value="${m}"${m === c.downscaleMode ? " selected" : ""}>${m}</option>`).join("");
      return `<select class="setting-inline-select" data-key="${key}">${opts}</select>`;
    }
    case "paletteName": {
      let opts = `<option value=""${c.paletteName === null ? " selected" : ""}>none</option>`;
      opts += state.palettes.map((p) => `<option value="${p.slug}"${p.slug === c.paletteName ? " selected" : ""}>${p.slug} (${p.numColors})</option>`).join("");
      return `<select class="setting-inline-select" data-key="${key}">${opts}</select>`;
    }
    default:
      return "";
  }
}
function renderInlineInput(key) {
  const c = state.config;
  switch (key) {
    case "gridSize": {
      const val = c.gridSize === null ? "" : c.gridSize;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case "gridPhaseX": {
      const val = c.gridPhaseX === null ? "" : c.gridPhaseX;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case "gridPhaseY": {
      const val = c.gridPhaseY === null ? "" : c.gridPhaseY;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case "maxGridCandidate": {
      return `<input class="setting-inline-input" type="text" value="${c.maxGridCandidate}" data-key="${key}">`;
    }
    case "aaThreshold": {
      const val = c.aaThreshold === null ? "" : c.aaThreshold.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case "autoColors": {
      const val = c.autoColors === null ? "" : c.autoColors;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case "bgColor": {
      const val = c.bgColor ?? "";
      return `<input class="setting-inline-input" type="text" value="${escapeHtml(val)}" placeholder="auto (#RRGGBB)" data-key="${key}">`;
    }
    case "borderThreshold": {
      const val = c.borderThreshold === null ? "" : c.borderThreshold.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="0.40" data-key="${key}">`;
    }
    case "bgTolerance": {
      const val = c.bgTolerance.toFixed(2);
      return `<input class="setting-inline-input" type="text" value="${val}" data-key="${key}">`;
    }
    case "outputScale": {
      const val = c.outputScale === null ? "" : c.outputScale;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="off" data-key="${key}">`;
    }
    case "outputWidth": {
      const val = c.outputWidth === null ? "" : c.outputWidth;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case "outputHeight": {
      const val = c.outputHeight === null ? "" : c.outputHeight;
      return `<input class="setting-inline-input" type="text" value="${val}" placeholder="auto" data-key="${key}">`;
    }
    case "lospecSlug": {
      const val = c.lospecSlug ?? "";
      return `<input class="setting-inline-input setting-inline-input-wide" type="text" value="${escapeHtml(val)}" placeholder="e.g. pico-8" data-key="${key}">`;
    }
    default:
      return "";
  }
}
function startEditing(key) {
  if (BOOLEAN_SETTINGS.includes(key)) {
    adjustSetting(key, 1);
    renderSettings();
    autoProcess();
    return;
  }
  if (SELECT_SETTINGS.includes(key)) {
    return;
  }
  if (FILE_SETTINGS.includes(key)) {
    if (key === "paletteFile") {
      loadPaletteFileDialog();
    }
    return;
  }
  if (INPUT_SETTINGS.includes(key)) {
    const input = document.querySelector(`.setting-inline-input[data-key="${key}"]`);
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }
}
function clearSetting(key) {
  const c = state.config;
  switch (key) {
    case "gridSize":
      c.gridSize = null;
      break;
    case "gridPhaseX":
      c.gridPhaseX = null;
      break;
    case "gridPhaseY":
      c.gridPhaseY = null;
      break;
    case "aaThreshold":
      c.aaThreshold = null;
      break;
    case "autoColors":
      c.autoColors = null;
      break;
    case "lospecSlug":
      c.lospecSlug = null;
      c.customPalette = null;
      state.lospecResult = null;
      state.paletteColors = null;
      break;
    case "paletteFile":
      if (!c.lospecSlug) {
        c.customPalette = null;
        state.paletteColors = null;
      }
      break;
    case "bgColor":
      c.bgColor = null;
      break;
    case "borderThreshold":
      c.borderThreshold = null;
      break;
    case "outputScale":
      c.outputScale = null;
      break;
    case "outputWidth":
      c.outputWidth = null;
      break;
    case "outputHeight":
      c.outputHeight = null;
      break;
  }
  renderSettings();
  autoProcess();
}
function commitEdit(key, rawValue) {
  const c = state.config;
  const val = rawValue.trim();
  switch (key) {
    case "gridSize":
      if (val === "" || val === "auto") {
        c.gridSize = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1)
          c.gridSize = n;
      }
      break;
    case "gridPhaseX":
      if (val === "" || val === "auto") {
        c.gridPhaseX = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 0)
          c.gridPhaseX = n;
      }
      break;
    case "gridPhaseY":
      if (val === "" || val === "auto") {
        c.gridPhaseY = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 0)
          c.gridPhaseY = n;
      }
      break;
    case "maxGridCandidate": {
      const n = parseInt(val);
      if (!isNaN(n) && n >= 2)
        c.maxGridCandidate = Math.min(64, n);
      break;
    }
    case "aaThreshold":
      if (val === "" || val === "off") {
        c.aaThreshold = null;
      } else {
        const n = parseFloat(val);
        if (!isNaN(n))
          c.aaThreshold = Math.max(0.01, Math.min(1, n));
      }
      break;
    case "autoColors":
      if (val === "" || val === "off") {
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
    case "bgColor":
      if (val === "" || val === "auto") {
        c.bgColor = null;
      } else {
        const hex = val.startsWith("#") ? val : "#" + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
          c.bgColor = hex.toUpperCase();
        }
      }
      break;
    case "borderThreshold":
      if (val === "" || val === "auto") {
        c.borderThreshold = null;
      } else {
        const n = parseFloat(val);
        if (!isNaN(n))
          c.borderThreshold = Math.max(0.01, Math.min(1, n));
      }
      break;
    case "bgTolerance": {
      const n = parseFloat(val);
      if (!isNaN(n))
        c.bgTolerance = Math.max(0.01, Math.min(0.5, n));
      break;
    }
    case "downscaleMode":
      if (DOWNSCALE_MODES.includes(val))
        c.downscaleMode = val;
      break;
    case "paletteName":
      c.paletteName = val === "" ? null : val;
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
    case "lospecSlug":
      if (val === "" || val === "none") {
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
    case "outputScale":
      if (val === "" || val === "off" || val === "1") {
        c.outputScale = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 2 && n <= 16)
          c.outputScale = n;
      }
      break;
    case "outputWidth":
      if (val === "" || val === "auto") {
        c.outputWidth = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1)
          c.outputWidth = n;
      }
      break;
    case "outputHeight":
      if (val === "" || val === "auto") {
        c.outputHeight = null;
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 1)
          c.outputHeight = n;
      }
      break;
  }
  renderSettings();
  autoProcess();
}
function renderDiagnostics() {
  const info = state.imageInfo;
  if (!info) {
    document.getElementById("diag-grid-info").innerHTML = '<div class="diag-item"><span class="label">No image loaded</span></div>';
    document.getElementById("diag-grid-bars").innerHTML = "";
    document.getElementById("diag-info").innerHTML = "";
    document.getElementById("diag-histogram").innerHTML = "";
    return;
  }
  let gridHtml = "";
  gridHtml += `<div class="diag-item"><span class="label">Detected size</span><span class="value">${info.gridSize ?? "none"}</span></div>`;
  gridHtml += `<div class="diag-item"><span class="label">Confidence</span><span class="value">${info.gridConfidence != null ? (info.gridConfidence * 100).toFixed(1) + "%" : "n/a"}</span></div>`;
  document.getElementById("diag-grid-info").innerHTML = gridHtml;
  let barsHtml = "";
  if (info.gridScores && info.gridScores.length > 0) {
    const maxScore = Math.max(...info.gridScores.map((s) => s[1]));
    const bestSize = info.gridSize;
    for (const [size, score] of info.gridScores) {
      const pct = maxScore > 0 ? score / maxScore * 100 : 0;
      const best = size === bestSize ? " best" : "";
      barsHtml += `<div class="grid-bar-row">`;
      barsHtml += `<span class="grid-bar-label">${size}</span>`;
      barsHtml += `<div class="grid-bar-track"><div class="grid-bar-fill${best}" style="width:${pct}%"></div></div>`;
      barsHtml += `<span class="grid-bar-value">${score.toFixed(3)}</span>`;
      barsHtml += `</div>`;
    }
  }
  document.getElementById("diag-grid-bars").innerHTML = barsHtml;
  let infoHtml = "";
  infoHtml += `<div class="diag-item"><span class="label">Dimensions</span><span class="value">${info.width} x ${info.height}</span></div>`;
  infoHtml += `<div class="diag-item"><span class="label">Unique colors</span><span class="value">${info.uniqueColors}</span></div>`;
  document.getElementById("diag-info").innerHTML = infoHtml;
  let histHtml = "";
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
  document.getElementById("diag-histogram").innerHTML = histHtml;
}
async function loadImageBlob(which) {
  const bytes = await invoke("get_image", { which });
  const arr = new Uint8Array(bytes);
  const blob = new Blob([arr], { type: "image/png" });
  return URL.createObjectURL(blob);
}
async function openImage(path) {
  setStatus("Loading...", "processing");
  showSpinners();
  try {
    const info = await invoke("open_image", { path });
    state.imageLoaded = true;
    state.imagePath = path;
    state.imageInfo = info;
    state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    state.lospecResult = null;
    state.lospecError = null;
    state.paletteColors = null;
    const fname = path.split("/").pop().split("\\").pop();
    document.getElementById("filename").textContent = fname;
    document.getElementById("welcome").style.display = "none";
    document.getElementById("original-pane").style.display = "flex";
    document.getElementById("processed-pane").style.display = "flex";
    const [origUrl, procUrl] = await Promise.all([
      loadImageBlob("original"),
      loadImageBlob("processed")
    ]);
    document.getElementById("original-img").src = origUrl;
    document.getElementById("processed-img").src = procUrl;
    document.getElementById("original-dims").textContent = `${info.width}\xD7${info.height}`;
    document.getElementById("processed-dims").textContent = `${info.width}\xD7${info.height}`;
    document.getElementById("settings-preview-img").src = procUrl;
    document.getElementById("settings-preview-img").style.display = "block";
    document.getElementById("settings-no-image").style.display = "none";
    renderSettings();
    renderDiagnostics();
    hideSpinners();
    setStatus(`Loaded \u2014 ${info.width}\xD7${info.height}, grid=${info.gridSize ?? "none"}, ${info.uniqueColors} colors`, "success");
  } catch (e) {
    hideSpinners();
    setStatus("Error: " + e, "error");
  }
}
function buildProcessConfig() {
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
    outputHeight: c.outputHeight
  };
}
async function processImage() {
  if (!state.imageLoaded || state.processing)
    return;
  state.processing = true;
  setStatus("Processing...", "processing");
  showSpinners();
  const t0 = performance.now();
  try {
    const result = await invoke("process", { pc: buildProcessConfig() });
    state.imageInfo = { ...state.imageInfo, ...result };
    const procUrl = await loadImageBlob("processed");
    document.getElementById("processed-img").src = procUrl;
    document.getElementById("processed-dims").textContent = `${result.width}\xD7${result.height}`;
    document.getElementById("settings-preview-img").src = procUrl;
    renderDiagnostics();
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    state.lastProcessTime = performance.now() - t0;
    setStatus(`Processed \u2014 ${result.width}\xD7${result.height}, ${result.uniqueColors} colors (${elapsed}s)`, "success");
  } catch (e) {
    setStatus("Error: " + e, "error");
  } finally {
    state.processing = false;
    hideSpinners();
  }
}
async function doOpen() {
  try {
    const result = await openDialog({
      multiple: false,
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"]
      }]
    });
    if (result) {
      await openImage(result);
    }
  } catch (e) {
    setStatus("Error: " + e, "error");
  }
}
async function doSave() {
  if (!state.imageLoaded)
    return;
  try {
    const result = await saveDialog({
      defaultPath: state.imagePath ? state.imagePath.replace(/\.[^.]+$/, "_fixed.png") : "output.png",
      filters: [{
        name: "PNG Image",
        extensions: ["png"]
      }]
    });
    if (result) {
      await invoke("save_image", { path: result });
      setStatus("Saved: " + result.split("/").pop().split("\\").pop(), "success");
    }
  } catch (e) {
    setStatus("Error: " + e, "error");
  }
}
document.addEventListener("keydown", (e) => {
  if (e.target.classList?.contains("setting-inline-input")) {
    if (e.key === "Enter") {
      e.preventDefault();
      const target = e.target;
      commitEdit(target.dataset.key, target.value);
      target.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.target.blur();
      renderSettings();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.target.blur();
      cycleTab(e.shiftKey ? -1 : 1);
    }
    return;
  }
  if (e.target.classList?.contains("setting-inline-select")) {
    if (e.key === "Tab") {
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
    }
    return;
  }
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    if (e.key === "Tab") {
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
    }
    return;
  }
  const key = e.key;
  if (key === "Tab") {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
    return;
  }
  if (key === "o") {
    doOpen();
    return;
  }
  if (key === "s") {
    doSave();
    return;
  }
  if (key === " ") {
    e.preventDefault();
    processImage();
    return;
  }
  if (key === "r") {
    resetConfig();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === "q") {
    window.close();
    return;
  }
  if (state.activeTab === "settings" && !state.processing) {
    const rows = getSettingRows();
    if (key === "j" || key === "ArrowDown") {
      e.preventDefault();
      state.settingsFocusIndex = Math.min(state.settingsFocusIndex + 1, rows.length - 1);
      renderSettings();
      return;
    }
    if (key === "k" || key === "ArrowUp") {
      e.preventDefault();
      state.settingsFocusIndex = Math.max(state.settingsFocusIndex - 1, 0);
      renderSettings();
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      const row = rows[state.settingsFocusIndex];
      if (row)
        startEditing(row.key);
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      switchTab("preview");
      return;
    }
    if (key === "l" || key === "ArrowRight") {
      e.preventDefault();
      const row = rows[state.settingsFocusIndex];
      if (row) {
        adjustSetting(row.key, 1);
        renderSettings();
        autoProcess();
      }
      return;
    }
    if (key === "h" || key === "ArrowLeft") {
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
var TABS = ["preview", "settings", "diagnostics", "batch", "sheet"];
function cycleTab(dir) {
  let idx = TABS.indexOf(state.activeTab);
  idx = (idx + dir + TABS.length) % TABS.length;
  switchTab(TABS[idx]);
}
function resetConfig() {
  state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  state.lospecResult = null;
  state.lospecError = null;
  state.paletteColors = null;
  renderSettings();
  if (state.imageLoaded) {
    autoProcess();
  }
  setStatus("Config reset to defaults");
}
var processTimer = null;
function autoProcess() {
  if (!state.imageLoaded)
    return;
  if (processTimer)
    clearTimeout(processTimer);
  processTimer = setTimeout(() => processImage(), 150);
}
function renderBatch() {
  const el = document.getElementById("batch-content");
  let html = "";
  html += '<div class="batch-section">';
  html += '<div class="batch-title">Batch Processing</div>';
  html += '<div class="batch-desc">Process multiple images with the current pipeline settings.</div>';
  html += "</div>";
  html += '<div class="batch-section">';
  html += `<div class="batch-row"><span class="batch-label">Files</span><span class="batch-value">${state.batchFiles.length} selected</span>`;
  html += `<button class="batch-btn" id="batch-add-files"${state.batchRunning ? " disabled" : ""}>Add Files</button>`;
  if (state.batchFiles.length > 0) {
    html += `<button class="batch-btn batch-btn-dim" id="batch-clear-files"${state.batchRunning ? " disabled" : ""}>Clear</button>`;
  }
  html += "</div>";
  if (state.batchFiles.length > 0) {
    html += '<div class="batch-file-list">';
    for (const f of state.batchFiles) {
      const name = f.split("/").pop().split("\\").pop();
      html += `<div class="batch-file">${escapeHtml(name)}</div>`;
    }
    html += "</div>";
  }
  html += "</div>";
  html += '<div class="batch-section">';
  html += `<div class="batch-row"><span class="batch-label">Output</span><span class="batch-value">${state.batchOutputDir ? escapeHtml(state.batchOutputDir.split("/").pop().split("\\").pop()) : "not set"}</span>`;
  html += `<button class="batch-btn" id="batch-choose-dir"${state.batchRunning ? " disabled" : ""}>Choose Folder</button>`;
  html += "</div>";
  html += "</div>";
  const canRun = state.batchFiles.length > 0 && state.batchOutputDir && !state.batchRunning;
  html += '<div class="batch-section">';
  html += `<button class="batch-btn batch-btn-primary" id="batch-run"${canRun ? "" : " disabled"}>Process All</button>`;
  html += "</div>";
  if (state.batchProgress) {
    const pct = Math.round(state.batchProgress.current / state.batchProgress.total * 100);
    html += '<div class="batch-section">';
    html += `<div class="batch-progress-info">${state.batchProgress.current}/${state.batchProgress.total} &mdash; ${escapeHtml(state.batchProgress.filename)}</div>`;
    html += `<div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%"></div></div>`;
    html += "</div>";
  }
  if (state.batchResult) {
    const r = state.batchResult;
    html += '<div class="batch-section">';
    html += `<div class="batch-result-summary">${r.succeeded} succeeded`;
    if (r.failed.length > 0) {
      html += `, <span class="batch-result-failed">${r.failed.length} failed</span>`;
    }
    html += "</div>";
    if (r.failed.length > 0) {
      html += '<div class="batch-errors">';
      for (const f of r.failed) {
        const name = f.path.split("/").pop().split("\\").pop();
        html += `<div class="batch-error">${escapeHtml(name)}: ${escapeHtml(f.error)}</div>`;
      }
      html += "</div>";
    }
    html += "</div>";
  }
  el.innerHTML = html;
}
async function batchAddFiles() {
  try {
    const result = await openDialog({
      multiple: true,
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"]
      }]
    });
    if (result) {
      const paths = Array.isArray(result) ? result : [result];
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
    setStatus("Error: " + e, "error");
  }
}
async function batchChooseDir() {
  try {
    const result = await openDialog({
      directory: true
    });
    if (result) {
      state.batchOutputDir = Array.isArray(result) ? result[0] : result;
      renderBatch();
    }
  } catch (e) {
    setStatus("Error: " + e, "error");
  }
}
async function batchRun() {
  if (state.batchRunning || state.batchFiles.length === 0 || !state.batchOutputDir)
    return;
  state.batchRunning = true;
  state.batchResult = null;
  state.batchProgress = { current: 0, total: state.batchFiles.length, filename: "" };
  renderBatch();
  setStatus("Batch processing...", "processing");
  const unlisten = await window.__TAURI__.event.listen("batch-progress", (event) => {
    state.batchProgress = event.payload;
    renderBatch();
  });
  try {
    const result = await invoke("batch_process", {
      inputPaths: state.batchFiles,
      outputDir: state.batchOutputDir,
      pc: buildProcessConfig(),
      overwrite: false
    });
    state.batchResult = result;
    setStatus(`Batch done: ${result.succeeded} succeeded, ${result.failed.length} failed`, result.failed.length > 0 ? "error" : "success");
  } catch (e) {
    setStatus("Batch error: " + e, "error");
  } finally {
    state.batchRunning = false;
    state.batchProgress = null;
    if (typeof unlisten === "function")
      unlisten();
    renderBatch();
  }
}
function renderSheet() {
  const el = document.getElementById("sheet-content");
  const sc = state.sheetConfig;
  const dis = state.sheetProcessing ? " disabled" : "";
  let html = "";
  html += '<div class="sheet-section">';
  html += '<div class="sheet-title">Sprite Sheet Processing</div>';
  html += '<div class="sheet-desc">Split a sprite sheet into individual tiles, run the normalize pipeline on each one, then reassemble into a clean sheet. You can also export each tile as a separate file.</div>';
  if (!state.imageLoaded) {
    html += '<div class="sheet-desc" style="color:var(--yellow);margin-top:6px">Load an image first in the Preview tab.</div>';
  }
  html += "</div>";
  html += '<div class="sheet-section">';
  html += '<div class="sheet-setting-label" style="margin-bottom:4px">Split Mode</div>';
  html += '<div class="sheet-mode-toggle">';
  html += `<button class="sheet-mode-btn${state.sheetMode === "fixed" ? " active" : ""}" data-mode="fixed">Fixed Grid</button>`;
  html += `<button class="sheet-mode-btn${state.sheetMode === "auto" ? " active" : ""}" data-mode="auto">Auto-Split</button>`;
  html += "</div>";
  if (state.sheetMode === "fixed") {
    html += '<div class="sheet-help">Use when your sheet has a uniform grid &mdash; all tiles are the same size with consistent spacing.</div>';
  } else {
    html += '<div class="sheet-help">Use when tiles are different sizes or irregularly placed. Detects sprites automatically by finding separator rows/columns in the image.</div>';
  }
  html += "</div>";
  html += '<div class="sheet-section">';
  if (state.sheetMode === "fixed") {
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Tile Width</span>';
    html += `<input class="sheet-input" type="number" id="sheet-tw" value="${sc.tileWidth ?? ""}" placeholder="px"${dis}></div>`;
    html += '<div class="sheet-help">Width of each tile in pixels. Required.</div>';
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Tile Height</span>';
    html += `<input class="sheet-input" type="number" id="sheet-th" value="${sc.tileHeight ?? ""}" placeholder="px"${dis}></div>`;
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
  html += "</div>";
  html += '<div class="sheet-section">';
  html += '<div class="sheet-setting"><span class="sheet-setting-label">Skip Normalize</span>';
  html += `<button class="batch-btn batch-btn-dim" id="sheet-no-normalize" style="min-width:40px"${dis}>${sc.noNormalize ? "on" : "off"}</button></div>`;
  html += '<div class="sheet-help">When on, tiles are split and reassembled without running the pipeline. Useful for just extracting or rearranging tiles.</div>';
  html += "</div>";
  const canAct = state.imageLoaded && !state.sheetProcessing;
  html += '<div class="sheet-section">';
  html += '<div class="sheet-actions">';
  html += `<button class="batch-btn" id="sheet-preview-btn"${canAct ? "" : " disabled"}>Preview Split</button>`;
  html += `<button class="batch-btn batch-btn-primary" id="sheet-process-btn"${canAct ? "" : " disabled"}>Process Sheet</button>`;
  html += `<button class="batch-btn" id="sheet-save-tiles-btn"${state.sheetPreview && !state.sheetProcessing ? "" : " disabled"}>Save Tiles</button>`;
  html += "</div>";
  html += '<div class="sheet-help"><strong>Preview Split</strong> shows how many tiles will be extracted. <strong>Process Sheet</strong> runs the normalize pipeline on each tile and reassembles. <strong>Save Tiles</strong> exports each tile as a separate PNG.</div>';
  html += "</div>";
  if (state.sheetPreview) {
    const p = state.sheetPreview;
    html += '<div class="sheet-section">';
    html += `<div class="sheet-info">${p.tileCount} tiles &mdash; ${p.cols}\xD7${p.rows} grid &mdash; ${p.tileWidth}\xD7${p.tileHeight}px each</div>`;
    html += "</div>";
    const gifDis = state.gifGenerating ? " disabled" : "";
    html += '<div class="sheet-section">';
    html += '<div class="sheet-title" style="margin-top:4px">GIF Animation</div>';
    html += '<div class="sheet-help">Generate an animated GIF from the processed tiles. Preview it here or export to a file.</div>';
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Animate</span>';
    html += '<div class="sheet-mode-toggle">';
    html += `<button class="sheet-mode-btn gif-mode-btn${state.gifMode === "row" ? " active" : ""}" data-gif-mode="row"${gifDis}>By Row</button>`;
    html += `<button class="sheet-mode-btn gif-mode-btn${state.gifMode === "all" ? " active" : ""}" data-gif-mode="all"${gifDis}>Entire Sheet</button>`;
    html += "</div></div>";
    if (state.gifMode === "row") {
      html += '<div class="sheet-setting"><span class="sheet-setting-label">Row</span>';
      html += `<input class="sheet-input" type="number" id="gif-row" value="${state.gifRow}" min="0" max="${p.rows - 1}"${gifDis}></div>`;
      html += `<div class="sheet-help">Which row to animate (0\u2013${p.rows - 1}). Each row becomes one animation sequence.</div>`;
    }
    html += '<div class="sheet-setting"><span class="sheet-setting-label">Frame Rate</span>';
    html += `<input class="sheet-input" type="number" id="gif-fps" value="${state.gifFps}" min="1" max="100"${gifDis}></div>`;
    html += '<div class="sheet-help">Frames per second (1\u2013100). 10 fps is a good default for pixel art animations.</div>';
    html += '<div class="sheet-actions" style="margin-top:4px">';
    html += `<button class="batch-btn batch-btn-primary" id="gif-preview-btn"${gifDis}>Preview GIF</button>`;
    html += `<button class="batch-btn" id="gif-export-btn"${state.gifPreviewUrl && !state.gifGenerating ? "" : " disabled"}>Export GIF</button>`;
    html += "</div>";
    if (state.gifGenerating) {
      html += '<div class="sheet-info" style="color:var(--mauve);margin-top:6px">Generating GIF...</div>';
    }
    if (state.gifPreviewUrl) {
      html += '<div class="gif-preview-container">';
      html += `<img class="gif-preview-img" src="${state.gifPreviewUrl}" alt="GIF Preview">`;
      html += "</div>";
    }
    html += "</div>";
  }
  if (state.sheetProcessing) {
    html += '<div class="sheet-section"><div class="sheet-info" style="color:var(--mauve)">Processing...</div></div>';
  }
  el.innerHTML = html;
}
function readSheetConfig() {
  const sc = state.sheetConfig;
  if (state.sheetMode === "fixed") {
    const tw = document.getElementById("sheet-tw");
    const th = document.getElementById("sheet-th");
    const sp = document.getElementById("sheet-sp");
    const mg = document.getElementById("sheet-mg");
    if (tw) {
      const v = parseInt(tw.value);
      sc.tileWidth = isNaN(v) || v < 1 ? null : v;
    }
    if (th) {
      const v = parseInt(th.value);
      sc.tileHeight = isNaN(v) || v < 1 ? null : v;
    }
    if (sp) {
      const v = parseInt(sp.value);
      sc.spacing = isNaN(v) ? 0 : Math.max(0, v);
    }
    if (mg) {
      const v = parseInt(mg.value);
      sc.margin = isNaN(v) ? 0 : Math.max(0, v);
    }
  } else {
    const sep = document.getElementById("sheet-sep");
    const min = document.getElementById("sheet-min");
    const pad = document.getElementById("sheet-pad");
    if (sep) {
      const v = parseFloat(sep.value);
      sc.separatorThreshold = isNaN(v) ? 0.9 : Math.max(0, Math.min(1, v));
    }
    if (min) {
      const v = parseInt(min.value);
      sc.minSpriteSize = isNaN(v) ? 8 : Math.max(1, v);
    }
    if (pad) {
      const v = parseInt(pad.value);
      sc.pad = isNaN(v) ? 0 : Math.max(0, v);
    }
  }
}
function buildSheetArgs() {
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
    noNormalize: sc.noNormalize || null
  };
}
async function sheetPreviewAction() {
  if (!state.imageLoaded || state.sheetProcessing)
    return;
  readSheetConfig();
  state.sheetProcessing = true;
  renderSheet();
  try {
    const result = await invoke("sheet_preview", buildSheetArgs());
    state.sheetPreview = result;
    setStatus(`Sheet: ${result.tileCount} tiles (${result.cols}\xD7${result.rows})`, "success");
  } catch (e) {
    setStatus("Sheet error: " + e, "error");
    state.sheetPreview = null;
  } finally {
    state.sheetProcessing = false;
    renderSheet();
  }
}
async function sheetProcessAction() {
  if (!state.imageLoaded || state.sheetProcessing)
    return;
  readSheetConfig();
  state.sheetProcessing = true;
  state.gifPreviewUrl = null;
  renderSheet();
  setStatus("Processing sheet...", "processing");
  const t0 = performance.now();
  try {
    const args = { ...buildSheetArgs(), pc: buildProcessConfig() };
    const result = await invoke("sheet_process", args);
    state.sheetPreview = result;
    const procUrl = await loadImageBlob("processed");
    document.getElementById("processed-img").src = procUrl;
    document.getElementById("processed-dims").textContent = `${result.outputWidth}\xD7${result.outputHeight}`;
    document.getElementById("settings-preview-img").src = procUrl;
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    setStatus(`Sheet processed: ${result.tileCount} tiles, ${result.outputWidth}\xD7${result.outputHeight} (${elapsed}s)`, "success");
  } catch (e) {
    setStatus("Sheet error: " + e, "error");
  } finally {
    state.sheetProcessing = false;
    renderSheet();
  }
}
async function sheetSaveTilesAction() {
  try {
    const result = await openDialog({ directory: true });
    if (result) {
      const dir = Array.isArray(result) ? result[0] : result;
      const count = await invoke("sheet_save_tiles", { outputDir: dir });
      setStatus(`Saved ${count} tiles to ${dir.split("/").pop().split("\\").pop()}`, "success");
    }
  } catch (e) {
    setStatus("Error saving tiles: " + e, "error");
  }
}
function readGifConfig() {
  const rowEl = document.getElementById("gif-row");
  const fpsEl = document.getElementById("gif-fps");
  if (rowEl) {
    const v = parseInt(rowEl.value);
    state.gifRow = isNaN(v) ? 0 : Math.max(0, v);
  }
  if (fpsEl) {
    const v = parseInt(fpsEl.value);
    state.gifFps = isNaN(v) ? 10 : Math.max(1, Math.min(100, v));
  }
}
async function gifPreviewAction() {
  if (state.gifGenerating)
    return;
  readGifConfig();
  state.gifGenerating = true;
  state.gifPreviewUrl = null;
  renderSheet();
  setStatus("Generating GIF preview...", "processing");
  try {
    const dataUrl = await invoke("sheet_generate_gif", {
      mode: state.gifMode,
      row: state.gifMode === "row" ? state.gifRow : null,
      fps: state.gifFps
    });
    state.gifPreviewUrl = dataUrl;
    setStatus("GIF preview generated", "success");
  } catch (e) {
    setStatus("GIF error: " + e, "error");
  } finally {
    state.gifGenerating = false;
    renderSheet();
  }
}
async function gifExportAction() {
  if (!state.gifPreviewUrl)
    return;
  readGifConfig();
  try {
    const defaultName = state.gifMode === "row" ? `row_${state.gifRow}.gif` : "animation.gif";
    const path = await saveDialog({
      filters: [{ name: "GIF", extensions: ["gif"] }],
      defaultPath: defaultName
    });
    if (path) {
      setStatus("Exporting GIF...", "processing");
      await invoke("sheet_export_gif", {
        path,
        mode: state.gifMode,
        row: state.gifMode === "row" ? state.gifRow : null,
        fps: state.gifFps
      });
      const fname = path.split("/").pop().split("\\").pop();
      setStatus(`GIF saved to ${fname}`, "success");
    }
  } catch (e) {
    setStatus("GIF export error: " + e, "error");
  }
}
document.querySelector(".tab-bar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab)
    switchTab(tab.dataset.tab);
});
var dropOverlay = document.getElementById("drop-overlay");
var dragCounter = 0;
document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add("active");
});
document.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove("active");
  }
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
});
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove("active");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.path) {
      await openImage(file.path);
    }
  }
});
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen("tauri://drag-drop", async (event) => {
    dropOverlay.classList.remove("active");
    dragCounter = 0;
    const paths = event.payload?.paths;
    if (paths && paths.length > 0) {
      await openImage(paths[0]);
    }
  });
  window.__TAURI__.event.listen("tauri://drag-enter", () => {
    dropOverlay.classList.add("active");
  });
  window.__TAURI__.event.listen("tauri://drag-leave", () => {
    dropOverlay.classList.remove("active");
    dragCounter = 0;
  });
}
document.getElementById("settings-list").addEventListener("click", (e) => {
  const target = e.target;
  if (target.classList?.contains("setting-clear") && !state.processing) {
    skipNextBlurCommit = true;
    const key = target.dataset.key;
    clearSetting(key);
    return;
  }
  if (target.classList?.contains("setting-toggle") && !state.processing) {
    const key = target.dataset.key;
    const row2 = target.closest(".setting-row");
    if (row2)
      state.settingsFocusIndex = parseInt(row2.dataset.index);
    if (BOOLEAN_SETTINGS.includes(key)) {
      adjustSetting(key, 1);
      renderSettings();
      autoProcess();
    } else {
      startEditing(key);
    }
    return;
  }
  const row = target.closest(".setting-row");
  if (row) {
    state.settingsFocusIndex = parseInt(row.dataset.index);
    renderSettings();
  }
});
var skipNextBlurCommit = false;
document.getElementById("settings-list").addEventListener("focusout", (e) => {
  const target = e.target;
  if (target.classList?.contains("setting-inline-input")) {
    setTimeout(() => {
      if (skipNextBlurCommit) {
        skipNextBlurCommit = false;
        return;
      }
      commitEdit(target.dataset.key, target.value);
    }, 50);
  }
});
document.getElementById("settings-list").addEventListener("change", (e) => {
  const target = e.target;
  if (target.tagName === "SELECT" && target.classList?.contains("setting-inline-select")) {
    commitEdit(target.dataset.key, target.value);
  }
});
async function init() {
  try {
    state.palettes = await invoke("list_palettes");
  } catch (e) {
    console.error("Failed to load palettes:", e);
  }
  renderSettings();
  renderDiagnostics();
  renderBatch();
  renderSheet();
}
document.getElementById("batch-content").addEventListener("click", (e) => {
  const target = e.target;
  if (target.id === "batch-add-files") {
    batchAddFiles();
    return;
  }
  if (target.id === "batch-clear-files") {
    state.batchFiles = [];
    state.batchResult = null;
    renderBatch();
    return;
  }
  if (target.id === "batch-choose-dir") {
    batchChooseDir();
    return;
  }
  if (target.id === "batch-run") {
    batchRun();
    return;
  }
});
document.getElementById("sheet-content").addEventListener("click", (e) => {
  const target = e.target;
  if (target.classList?.contains("sheet-mode-btn") && !target.classList.contains("gif-mode-btn")) {
    const mode = target.dataset.mode;
    if (mode) {
      state.sheetMode = mode;
      state.sheetPreview = null;
      renderSheet();
    }
    return;
  }
  if (target.classList?.contains("gif-mode-btn")) {
    const gifMode = target.dataset.gifMode;
    if (gifMode) {
      state.gifMode = gifMode;
      state.gifPreviewUrl = null;
      renderSheet();
    }
    return;
  }
  if (target.id === "sheet-no-normalize") {
    state.sheetConfig.noNormalize = !state.sheetConfig.noNormalize;
    renderSheet();
    return;
  }
  if (target.id === "sheet-preview-btn") {
    sheetPreviewAction();
    return;
  }
  if (target.id === "sheet-process-btn") {
    sheetProcessAction();
    return;
  }
  if (target.id === "sheet-save-tiles-btn") {
    sheetSaveTilesAction();
    return;
  }
  if (target.id === "gif-preview-btn") {
    gifPreviewAction();
    return;
  }
  if (target.id === "gif-export-btn") {
    gifExportAction();
    return;
  }
});
init();

//# debugId=7766D61EDE4B159A64756E2164756E21
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsicGl4Zml4L3VpL3NyYy9hcHAudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbCiAgICAiLy8gcGl4Zml4IOKAlCBhcHBsaWNhdGlvbiBsb2dpYyAoVHlwZVNjcmlwdClcbi8vIFVzZXMgd2luZG93Ll9fVEFVUklfXyAod2l0aEdsb2JhbFRhdXJpOiB0cnVlIGluIHRhdXJpLmNvbmYuanNvbilcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUYXVyaSBBUEkgYmluZGluZ3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gIGludGVyZmFjZSBXaW5kb3cge1xuICAgIF9fVEFVUklfXzoge1xuICAgICAgY29yZToge1xuICAgICAgICBpbnZva2U6IDxUID0gdW5rbm93bj4oY21kOiBzdHJpbmcsIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gUHJvbWlzZTxUPjtcbiAgICAgIH07XG4gICAgICBkaWFsb2c6IHtcbiAgICAgICAgb3BlbjogKG9wdGlvbnM/OiBEaWFsb2dPcHRpb25zKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuICAgICAgICBzYXZlOiAob3B0aW9ucz86IERpYWxvZ09wdGlvbnMpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG4gICAgICB9O1xuICAgICAgZXZlbnQ6IHtcbiAgICAgICAgbGlzdGVuOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogKGV2ZW50OiBUYXVyaUV2ZW50KSA9PiB2b2lkKSA9PiBQcm9taXNlPHZvaWQ+O1xuICAgICAgfTtcbiAgICB9O1xuICB9XG59XG5cbmludGVyZmFjZSBEaWFsb2dPcHRpb25zIHtcbiAgbXVsdGlwbGU/OiBib29sZWFuO1xuICBkaXJlY3Rvcnk/OiBib29sZWFuO1xuICBkZWZhdWx0UGF0aD86IHN0cmluZztcbiAgZmlsdGVycz86IHsgbmFtZTogc3RyaW5nOyBleHRlbnNpb25zOiBzdHJpbmdbXSB9W107XG59XG5cbmludGVyZmFjZSBUYXVyaUV2ZW50IHtcbiAgcGF5bG9hZD86IHsgcGF0aHM/OiBzdHJpbmdbXSB9O1xufVxuXG5jb25zdCB7IGludm9rZSB9ID0gd2luZG93Ll9fVEFVUklfXy5jb3JlO1xuY29uc3QgeyBvcGVuOiBvcGVuRGlhbG9nLCBzYXZlOiBzYXZlRGlhbG9nIH0gPSB3aW5kb3cuX19UQVVSSV9fLmRpYWxvZztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBCYWNrZW5kIHR5cGVzIChtaXJyb3IgUnVzdCBzZXJkZSBzdHJ1Y3RzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBJbWFnZUluZm8ge1xuICB3aWR0aDogbnVtYmVyO1xuICBoZWlnaHQ6IG51bWJlcjtcbiAgZ3JpZFNpemU6IG51bWJlciB8IG51bGw7XG4gIGdyaWRDb25maWRlbmNlOiBudW1iZXIgfCBudWxsO1xuICB1bmlxdWVDb2xvcnM6IG51bWJlcjtcbiAgZ3JpZFNjb3JlczogW251bWJlciwgbnVtYmVyXVtdO1xuICBoaXN0b2dyYW06IENvbG9yRW50cnlbXTtcbn1cblxuaW50ZXJmYWNlIFByb2Nlc3NSZXN1bHQge1xuICB3aWR0aDogbnVtYmVyO1xuICBoZWlnaHQ6IG51bWJlcjtcbiAgZ3JpZFNpemU6IG51bWJlciB8IG51bGw7XG4gIGdyaWRDb25maWRlbmNlOiBudW1iZXIgfCBudWxsO1xuICB1bmlxdWVDb2xvcnM6IG51bWJlcjtcbiAgZ3JpZFNjb3JlczogW251bWJlciwgbnVtYmVyXVtdO1xuICBoaXN0b2dyYW06IENvbG9yRW50cnlbXTtcbn1cblxuaW50ZXJmYWNlIENvbG9yRW50cnkge1xuICBoZXg6IHN0cmluZztcbiAgcjogbnVtYmVyO1xuICBnOiBudW1iZXI7XG4gIGI6IG51bWJlcjtcbiAgcGVyY2VudDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgUGFsZXR0ZUluZm8ge1xuICBuYW1lOiBzdHJpbmc7XG4gIHNsdWc6IHN0cmluZztcbiAgbnVtQ29sb3JzOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBMb3NwZWNSZXN1bHQge1xuICBuYW1lOiBzdHJpbmc7XG4gIHNsdWc6IHN0cmluZztcbiAgbnVtQ29sb3JzOiBudW1iZXI7XG4gIGNvbG9yczogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQcm9jZXNzQ29uZmlnIHtcbiAgZ3JpZFNpemU6IG51bWJlciB8IG51bGw7XG4gIGdyaWRQaGFzZVg6IG51bWJlciB8IG51bGw7XG4gIGdyaWRQaGFzZVk6IG51bWJlciB8IG51bGw7XG4gIG1heEdyaWRDYW5kaWRhdGU6IG51bWJlciB8IG51bGw7XG4gIG5vR3JpZERldGVjdDogYm9vbGVhbjtcbiAgZG93bnNjYWxlTW9kZTogc3RyaW5nO1xuICBhYVRocmVzaG9sZDogbnVtYmVyIHwgbnVsbDtcbiAgcGFsZXR0ZU5hbWU6IHN0cmluZyB8IG51bGw7XG4gIGF1dG9Db2xvcnM6IG51bWJlciB8IG51bGw7XG4gIGN1c3RvbVBhbGV0dGU6IHN0cmluZ1tdIHwgbnVsbDtcbiAgcmVtb3ZlQmc6IGJvb2xlYW47XG4gIG5vUXVhbnRpemU6IGJvb2xlYW47XG4gIGJnQ29sb3I6IHN0cmluZyB8IG51bGw7XG4gIGJvcmRlclRocmVzaG9sZDogbnVtYmVyIHwgbnVsbDtcbiAgYmdUb2xlcmFuY2U6IG51bWJlcjtcbiAgZmxvb2RGaWxsOiBib29sZWFuO1xuICBvdXRwdXRTY2FsZTogbnVtYmVyIHwgbnVsbDtcbiAgb3V0cHV0V2lkdGg6IG51bWJlciB8IG51bGw7XG4gIG91dHB1dEhlaWdodDogbnVtYmVyIHwgbnVsbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdGF0ZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBBcHBDb25maWcge1xuICBncmlkU2l6ZTogbnVtYmVyIHwgbnVsbDtcbiAgZ3JpZFBoYXNlWDogbnVtYmVyIHwgbnVsbDtcbiAgZ3JpZFBoYXNlWTogbnVtYmVyIHwgbnVsbDtcbiAgbWF4R3JpZENhbmRpZGF0ZTogbnVtYmVyO1xuICBub0dyaWREZXRlY3Q6IGJvb2xlYW47XG4gIGRvd25zY2FsZU1vZGU6IHN0cmluZztcbiAgYWFUaHJlc2hvbGQ6IG51bWJlciB8IG51bGw7XG4gIHBhbGV0dGVOYW1lOiBzdHJpbmcgfCBudWxsO1xuICBhdXRvQ29sb3JzOiBudW1iZXIgfCBudWxsO1xuICBsb3NwZWNTbHVnOiBzdHJpbmcgfCBudWxsO1xuICBjdXN0b21QYWxldHRlOiBzdHJpbmdbXSB8IG51bGw7XG4gIG5vUXVhbnRpemU6IGJvb2xlYW47XG4gIHJlbW92ZUJnOiBib29sZWFuO1xuICBiZ0NvbG9yOiBzdHJpbmcgfCBudWxsO1xuICBib3JkZXJUaHJlc2hvbGQ6IG51bWJlciB8IG51bGw7XG4gIGJnVG9sZXJhbmNlOiBudW1iZXI7XG4gIGZsb29kRmlsbDogYm9vbGVhbjtcbiAgb3V0cHV0U2NhbGU6IG51bWJlciB8IG51bGw7XG4gIG91dHB1dFdpZHRoOiBudW1iZXIgfCBudWxsO1xuICBvdXRwdXRIZWlnaHQ6IG51bWJlciB8IG51bGw7XG59XG5cbmludGVyZmFjZSBBcHBTdGF0ZSB7XG4gIGFjdGl2ZVRhYjogc3RyaW5nO1xuICBpbWFnZUxvYWRlZDogYm9vbGVhbjtcbiAgaW1hZ2VQYXRoOiBzdHJpbmcgfCBudWxsO1xuICBpbWFnZUluZm86IEltYWdlSW5mbyB8IG51bGw7XG4gIHNldHRpbmdzRm9jdXNJbmRleDogbnVtYmVyO1xuICBwcm9jZXNzaW5nOiBib29sZWFuO1xuICBwYWxldHRlczogUGFsZXR0ZUluZm9bXTtcbiAgcGFsZXR0ZUluZGV4OiBudW1iZXI7XG4gIGNvbmZpZzogQXBwQ29uZmlnO1xuICAvLyBMb3NwZWMgc3RhdGVcbiAgbG9zcGVjUmVzdWx0OiBMb3NwZWNSZXN1bHQgfCBudWxsO1xuICBsb3NwZWNFcnJvcjogc3RyaW5nIHwgbnVsbDtcbiAgbG9zcGVjTG9hZGluZzogYm9vbGVhbjtcbiAgLy8gUGFsZXR0ZSBzd2F0Y2hlcyBmb3IgY3VycmVudCBzZWxlY3Rpb25cbiAgcGFsZXR0ZUNvbG9yczogc3RyaW5nW10gfCBudWxsO1xuICAvLyBIZWxwIHZpc2liaWxpdHlcbiAgc2hvd0FsbEhlbHA6IGJvb2xlYW47XG4gIC8vIFRpbWluZ1xuICBsYXN0UHJvY2Vzc1RpbWU6IG51bWJlciB8IG51bGw7XG4gIC8vIEJhdGNoIHN0YXRlXG4gIGJhdGNoRmlsZXM6IHN0cmluZ1tdO1xuICBiYXRjaE91dHB1dERpcjogc3RyaW5nIHwgbnVsbDtcbiAgYmF0Y2hSdW5uaW5nOiBib29sZWFuO1xuICBiYXRjaFByb2dyZXNzOiB7IGN1cnJlbnQ6IG51bWJlcjsgdG90YWw6IG51bWJlcjsgZmlsZW5hbWU6IHN0cmluZyB9IHwgbnVsbDtcbiAgYmF0Y2hSZXN1bHQ6IHsgc3VjY2VlZGVkOiBudW1iZXI7IGZhaWxlZDogeyBwYXRoOiBzdHJpbmc7IGVycm9yOiBzdHJpbmcgfVtdIH0gfCBudWxsO1xuICAvLyBTaGVldCBzdGF0ZVxuICBzaGVldE1vZGU6ICdmaXhlZCcgfCAnYXV0byc7XG4gIHNoZWV0Q29uZmlnOiB7XG4gICAgdGlsZVdpZHRoOiBudW1iZXIgfCBudWxsO1xuICAgIHRpbGVIZWlnaHQ6IG51bWJlciB8IG51bGw7XG4gICAgc3BhY2luZzogbnVtYmVyO1xuICAgIG1hcmdpbjogbnVtYmVyO1xuICAgIHNlcGFyYXRvclRocmVzaG9sZDogbnVtYmVyO1xuICAgIG1pblNwcml0ZVNpemU6IG51bWJlcjtcbiAgICBwYWQ6IG51bWJlcjtcbiAgICBub05vcm1hbGl6ZTogYm9vbGVhbjtcbiAgfTtcbiAgc2hlZXRQcmV2aWV3OiB7IHRpbGVDb3VudDogbnVtYmVyOyB0aWxlV2lkdGg6IG51bWJlcjsgdGlsZUhlaWdodDogbnVtYmVyOyBjb2xzOiBudW1iZXI7IHJvd3M6IG51bWJlciB9IHwgbnVsbDtcbiAgc2hlZXRQcm9jZXNzaW5nOiBib29sZWFuO1xuICAvLyBHSUYgYW5pbWF0aW9uIHN0YXRlXG4gIGdpZk1vZGU6ICdyb3cnIHwgJ2FsbCc7XG4gIGdpZlJvdzogbnVtYmVyO1xuICBnaWZGcHM6IG51bWJlcjtcbiAgZ2lmUHJldmlld1VybDogc3RyaW5nIHwgbnVsbDtcbiAgZ2lmR2VuZXJhdGluZzogYm9vbGVhbjtcbn1cblxuY29uc3Qgc3RhdGU6IEFwcFN0YXRlID0ge1xuICBhY3RpdmVUYWI6ICdwcmV2aWV3JyxcbiAgaW1hZ2VMb2FkZWQ6IGZhbHNlLFxuICBpbWFnZVBhdGg6IG51bGwsXG4gIGltYWdlSW5mbzogbnVsbCxcbiAgc2V0dGluZ3NGb2N1c0luZGV4OiAwLFxuICBwcm9jZXNzaW5nOiBmYWxzZSxcbiAgcGFsZXR0ZXM6IFtdLFxuICBwYWxldHRlSW5kZXg6IDAsXG4gIGNvbmZpZzoge1xuICAgIGdyaWRTaXplOiBudWxsLFxuICAgIGdyaWRQaGFzZVg6IG51bGwsXG4gICAgZ3JpZFBoYXNlWTogbnVsbCxcbiAgICBtYXhHcmlkQ2FuZGlkYXRlOiAzMixcbiAgICBub0dyaWREZXRlY3Q6IGZhbHNlLFxuICAgIGRvd25zY2FsZU1vZGU6ICdzbmFwJyxcbiAgICBhYVRocmVzaG9sZDogbnVsbCxcbiAgICBwYWxldHRlTmFtZTogbnVsbCxcbiAgICBhdXRvQ29sb3JzOiBudWxsLFxuICAgIGxvc3BlY1NsdWc6IG51bGwsXG4gICAgY3VzdG9tUGFsZXR0ZTogbnVsbCxcbiAgICBub1F1YW50aXplOiBmYWxzZSxcbiAgICByZW1vdmVCZzogZmFsc2UsXG4gICAgYmdDb2xvcjogbnVsbCxcbiAgICBib3JkZXJUaHJlc2hvbGQ6IG51bGwsXG4gICAgYmdUb2xlcmFuY2U6IDAuMDUsXG4gICAgZmxvb2RGaWxsOiB0cnVlLFxuICAgIG91dHB1dFNjYWxlOiBudWxsLFxuICAgIG91dHB1dFdpZHRoOiBudWxsLFxuICAgIG91dHB1dEhlaWdodDogbnVsbCxcbiAgfSxcbiAgbG9zcGVjUmVzdWx0OiBudWxsLFxuICBsb3NwZWNFcnJvcjogbnVsbCxcbiAgbG9zcGVjTG9hZGluZzogZmFsc2UsXG4gIHBhbGV0dGVDb2xvcnM6IG51bGwsXG4gIHNob3dBbGxIZWxwOiBmYWxzZSxcbiAgbGFzdFByb2Nlc3NUaW1lOiBudWxsLFxuICAvLyBCYXRjaFxuICBiYXRjaEZpbGVzOiBbXSxcbiAgYmF0Y2hPdXRwdXREaXI6IG51bGwsXG4gIGJhdGNoUnVubmluZzogZmFsc2UsXG4gIGJhdGNoUHJvZ3Jlc3M6IG51bGwsXG4gIGJhdGNoUmVzdWx0OiBudWxsLFxuICAvLyBTaGVldFxuICBzaGVldE1vZGU6ICdhdXRvJyxcbiAgc2hlZXRDb25maWc6IHtcbiAgICB0aWxlV2lkdGg6IG51bGwsXG4gICAgdGlsZUhlaWdodDogbnVsbCxcbiAgICBzcGFjaW5nOiAwLFxuICAgIG1hcmdpbjogMCxcbiAgICBzZXBhcmF0b3JUaHJlc2hvbGQ6IDAuOTAsXG4gICAgbWluU3ByaXRlU2l6ZTogOCxcbiAgICBwYWQ6IDAsXG4gICAgbm9Ob3JtYWxpemU6IGZhbHNlLFxuICB9LFxuICBzaGVldFByZXZpZXc6IG51bGwsXG4gIHNoZWV0UHJvY2Vzc2luZzogZmFsc2UsXG4gIC8vIEdJRlxuICBnaWZNb2RlOiAncm93JyxcbiAgZ2lmUm93OiAwLFxuICBnaWZGcHM6IDEwLFxuICBnaWZQcmV2aWV3VXJsOiBudWxsLFxuICBnaWZHZW5lcmF0aW5nOiBmYWxzZSxcbn07XG5cbmNvbnN0IERFRkFVTFRfQ09ORklHOiBBcHBDb25maWcgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHN0YXRlLmNvbmZpZykpO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNldHRpbmdzIGRlZmluaXRpb25zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRE9XTlNDQUxFX01PREVTID0gWydzbmFwJywgJ2NlbnRlci13ZWlnaHRlZCcsICdtYWpvcml0eS12b3RlJywgJ2NlbnRlci1waXhlbCddO1xuXG5pbnRlcmZhY2UgU2V0dGluZ1NlY3Rpb24ge1xuICBzZWN0aW9uOiBzdHJpbmc7XG4gIGtleT86IHVuZGVmaW5lZDtcbn1cblxuaW50ZXJmYWNlIFNldHRpbmdSb3cge1xuICBzZWN0aW9uPzogdW5kZWZpbmVkO1xuICBrZXk6IHN0cmluZztcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IHN0cmluZztcbiAgaGVscDogc3RyaW5nO1xuICBjaGFuZ2VkOiBib29sZWFuO1xufVxuXG50eXBlIFNldHRpbmdFbnRyeSA9IFNldHRpbmdTZWN0aW9uIHwgU2V0dGluZ1JvdztcblxuZnVuY3Rpb24gZ2V0U2V0dGluZ3MoKTogU2V0dGluZ0VudHJ5W10ge1xuICBjb25zdCBjID0gc3RhdGUuY29uZmlnO1xuICByZXR1cm4gW1xuICAgIHsgc2VjdGlvbjogJ0dyaWQgRGV0ZWN0aW9uJyB9LFxuICAgIHtcbiAgICAgIGtleTogJ2dyaWRTaXplJywgbGFiZWw6ICdHcmlkIFNpemUnLFxuICAgICAgdmFsdWU6IGMuZ3JpZFNpemUgPT09IG51bGwgPyAnYXV0bycgOiBTdHJpbmcoYy5ncmlkU2l6ZSksXG4gICAgICBoZWxwOiAnSG93IG1hbnkgc2NyZWVuIHBpeGVscyBtYWtlIHVwIG9uZSBcImxvZ2ljYWxcIiBwaXhlbCBpbiB5b3VyIGFydC4gQXV0by1kZXRlY3Rpb24gd29ya3Mgd2VsbCBmb3IgbW9zdCBpbWFnZXMuIE92ZXJyaWRlIGlmIHRoZSBncmlkIGxvb2tzIHdyb25nLicsXG4gICAgICBjaGFuZ2VkOiBjLmdyaWRTaXplICE9PSBudWxsLFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiAnZ3JpZFBoYXNlWCcsIGxhYmVsOiAnUGhhc2UgWCcsXG4gICAgICB2YWx1ZTogYy5ncmlkUGhhc2VYID09PSBudWxsID8gJ2F1dG8nIDogU3RyaW5nKGMuZ3JpZFBoYXNlWCksXG4gICAgICBoZWxwOiAnT3ZlcnJpZGUgdGhlIFggb2Zmc2V0IG9mIHRoZSBncmlkIGFsaWdubWVudC4gVXN1YWxseSBhdXRvLWRldGVjdGVkLicsXG4gICAgICBjaGFuZ2VkOiBjLmdyaWRQaGFzZVggIT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdncmlkUGhhc2VZJywgbGFiZWw6ICdQaGFzZSBZJyxcbiAgICAgIHZhbHVlOiBjLmdyaWRQaGFzZVkgPT09IG51bGwgPyAnYXV0bycgOiBTdHJpbmcoYy5ncmlkUGhhc2VZKSxcbiAgICAgIGhlbHA6ICdPdmVycmlkZSB0aGUgWSBvZmZzZXQgb2YgdGhlIGdyaWQgYWxpZ25tZW50LiBVc3VhbGx5IGF1dG8tZGV0ZWN0ZWQuJyxcbiAgICAgIGNoYW5nZWQ6IGMuZ3JpZFBoYXNlWSAhPT0gbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogJ25vR3JpZERldGVjdCcsIGxhYmVsOiAnU2tpcCBHcmlkJyxcbiAgICAgIHZhbHVlOiBjLm5vR3JpZERldGVjdCA/ICdvbicgOiAnb2ZmJyxcbiAgICAgIGhlbHA6ICdTa2lwIGdyaWQgZGV0ZWN0aW9uIGVudGlyZWx5LiBVc2VmdWwgaWYgeW91ciBpbWFnZSBpcyBhbHJlYWR5IGF0IGxvZ2ljYWwgcmVzb2x1dGlvbi4nLFxuICAgICAgY2hhbmdlZDogYy5ub0dyaWREZXRlY3QsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdtYXhHcmlkQ2FuZGlkYXRlJywgbGFiZWw6ICdNYXggR3JpZCcsXG4gICAgICB2YWx1ZTogU3RyaW5nKGMubWF4R3JpZENhbmRpZGF0ZSksXG4gICAgICBoZWxwOiAnTWF4aW11bSBncmlkIHNpemUgdG8gdGVzdCBkdXJpbmcgYXV0by1kZXRlY3Rpb24gKGRlZmF1bHQ6IDMyKS4nLFxuICAgICAgY2hhbmdlZDogYy5tYXhHcmlkQ2FuZGlkYXRlICE9PSAzMixcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogJ2Rvd25zY2FsZU1vZGUnLCBsYWJlbDogJ01vZGUnLFxuICAgICAgdmFsdWU6IGMuZG93bnNjYWxlTW9kZSxcbiAgICAgIGhlbHA6ICdIb3cgdG8gY29tYmluZSBwaXhlbHMgaW4gZWFjaCBncmlkIGNlbGwuIFwic25hcFwiIGNsZWFucyBpbi1wbGFjZSBhdCBvcmlnaW5hbCByZXNvbHV0aW9uLiBPdGhlcnMgcmVkdWNlIHRvIGxvZ2ljYWwgcGl4ZWwgcmVzb2x1dGlvbi4nLFxuICAgICAgY2hhbmdlZDogYy5kb3duc2NhbGVNb2RlICE9PSAnc25hcCcsXG4gICAgfSxcbiAgICB7IHNlY3Rpb246ICdBbnRpLUFsaWFzaW5nJyB9LFxuICAgIHtcbiAgICAgIGtleTogJ2FhVGhyZXNob2xkJywgbGFiZWw6ICdBQSBSZW1vdmFsJyxcbiAgICAgIHZhbHVlOiBjLmFhVGhyZXNob2xkID09PSBudWxsID8gJ29mZicgOiBjLmFhVGhyZXNob2xkLnRvRml4ZWQoMiksXG4gICAgICBoZWxwOiAnUmVtb3ZlcyBzb2Z0IGJsZW5kaW5nIGJldHdlZW4gY29sb3JzIGFkZGVkIGJ5IEFJIGdlbmVyYXRvcnMuIExvd2VyIHZhbHVlcyBhcmUgbW9yZSBhZ2dyZXNzaXZlLiBUcnkgMC4zMFxcdTIwMTMwLjUwIGZvciBtb3N0IGltYWdlcy4nLFxuICAgICAgY2hhbmdlZDogYy5hYVRocmVzaG9sZCAhPT0gbnVsbCxcbiAgICB9LFxuICAgIHsgc2VjdGlvbjogJ0NvbG9yIFBhbGV0dGUnIH0sXG4gICAge1xuICAgICAga2V5OiAncGFsZXR0ZU5hbWUnLCBsYWJlbDogJ1BhbGV0dGUnLFxuICAgICAgdmFsdWU6IGMucGFsZXR0ZU5hbWUgPT09IG51bGwgPyAnbm9uZScgOiBjLnBhbGV0dGVOYW1lLFxuICAgICAgaGVscDogJ1NuYXAgYWxsIGNvbG9ycyB0byBhIGNsYXNzaWMgcGl4ZWwgYXJ0IHBhbGV0dGUuIE11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIExvc3BlYyBhbmQgQXV0byBDb2xvcnMuJyxcbiAgICAgIGNoYW5nZWQ6IGMucGFsZXR0ZU5hbWUgIT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdsb3NwZWNTbHVnJywgbGFiZWw6ICdMb3NwZWMnLFxuICAgICAgdmFsdWU6IGMubG9zcGVjU2x1ZyA9PT0gbnVsbCA/ICdub25lJyA6IGMubG9zcGVjU2x1ZyxcbiAgICAgIGhlbHA6ICdMb2FkIGFueSBwYWxldHRlIGZyb20gbG9zcGVjLmNvbSBieSBzbHVnIChlLmcuIFwicGljby04XCIsIFwiZW5kZXNnYS0zMlwiKS4gUHJlc3MgRW50ZXIgdG8gdHlwZSBhIHNsdWcgYW5kIGZldGNoIGl0LicsXG4gICAgICBjaGFuZ2VkOiBjLmxvc3BlY1NsdWcgIT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdhdXRvQ29sb3JzJywgbGFiZWw6ICdBdXRvIENvbG9ycycsXG4gICAgICB2YWx1ZTogYy5hdXRvQ29sb3JzID09PSBudWxsID8gJ29mZicgOiBTdHJpbmcoYy5hdXRvQ29sb3JzKSxcbiAgICAgIGhlbHA6ICdBdXRvLWV4dHJhY3QgdGhlIGJlc3QgTiBjb2xvcnMgZnJvbSB5b3VyIGltYWdlIHVzaW5nIGstbWVhbnMgY2x1c3RlcmluZyBpbiBPS0xBQiBjb2xvciBzcGFjZS4nLFxuICAgICAgY2hhbmdlZDogYy5hdXRvQ29sb3JzICE9PSBudWxsLFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiAncGFsZXR0ZUZpbGUnLCBsYWJlbDogJ0xvYWQgLmhleCcsXG4gICAgICB2YWx1ZTogYy5jdXN0b21QYWxldHRlICYmICFjLmxvc3BlY1NsdWcgPyBgJHtjLmN1c3RvbVBhbGV0dGUubGVuZ3RofSBjb2xvcnNgIDogJ25vbmUnLFxuICAgICAgaGVscDogJ0xvYWQgYSBwYWxldHRlIGZyb20gYSAuaGV4IGZpbGUgKG9uZSBoZXggY29sb3IgcGVyIGxpbmUpLiBPdmVycmlkZXMgcGFsZXR0ZSBhbmQgYXV0byBjb2xvcnMuJyxcbiAgICAgIGNoYW5nZWQ6IGMuY3VzdG9tUGFsZXR0ZSAhPT0gbnVsbCAmJiBjLmxvc3BlY1NsdWcgPT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdub1F1YW50aXplJywgbGFiZWw6ICdTa2lwIFF1YW50aXplJyxcbiAgICAgIHZhbHVlOiBjLm5vUXVhbnRpemUgPyAnb24nIDogJ29mZicsXG4gICAgICBoZWxwOiAnU2tpcCBjb2xvciBxdWFudGl6YXRpb24gZW50aXJlbHkuIFVzZWZ1bCBpZiB5b3Ugb25seSB3YW50IGdyaWQgc25hcHBpbmcgYW5kIEFBIHJlbW92YWwgd2l0aG91dCBwYWxldHRlIGNoYW5nZXMuJyxcbiAgICAgIGNoYW5nZWQ6IGMubm9RdWFudGl6ZSxcbiAgICB9LFxuICAgIHsgc2VjdGlvbjogJ0JhY2tncm91bmQnIH0sXG4gICAge1xuICAgICAga2V5OiAncmVtb3ZlQmcnLCBsYWJlbDogJ1JlbW92ZSBCRycsXG4gICAgICB2YWx1ZTogYy5yZW1vdmVCZyA/ICdvbicgOiAnb2ZmJyxcbiAgICAgIGhlbHA6ICdEZXRlY3QgYW5kIG1ha2UgdGhlIGJhY2tncm91bmQgdHJhbnNwYXJlbnQuIFRoZSBkb21pbmFudCBib3JkZXIgY29sb3IgaXMgdHJlYXRlZCBhcyBiYWNrZ3JvdW5kLicsXG4gICAgICBjaGFuZ2VkOiBjLnJlbW92ZUJnLFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiAnYmdDb2xvcicsIGxhYmVsOiAnQkcgQ29sb3InLFxuICAgICAgdmFsdWU6IGMuYmdDb2xvciA9PT0gbnVsbCA/ICdhdXRvJyA6IGMuYmdDb2xvcixcbiAgICAgIGhlbHA6ICdFeHBsaWNpdCBiYWNrZ3JvdW5kIGNvbG9yIGFzIGhleCAoZS5nLiBcIiNGRjAwRkZcIikuIElmIGF1dG8sIGRldGVjdHMgZnJvbSBib3JkZXIgcGl4ZWxzLicsXG4gICAgICBjaGFuZ2VkOiBjLmJnQ29sb3IgIT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdib3JkZXJUaHJlc2hvbGQnLCBsYWJlbDogJ0JvcmRlciBUaHJlc2gnLFxuICAgICAgdmFsdWU6IGMuYm9yZGVyVGhyZXNob2xkID09PSBudWxsID8gJzAuNDAnIDogYy5ib3JkZXJUaHJlc2hvbGQudG9GaXhlZCgyKSxcbiAgICAgIGhlbHA6ICdGcmFjdGlvbiBvZiBib3JkZXIgcGl4ZWxzIHRoYXQgbXVzdCBtYXRjaCBmb3IgYXV0by1kZXRlY3Rpb24gKDAuMFxcdTIwMTMxLjAsIGRlZmF1bHQ6IDAuNDApLicsXG4gICAgICBjaGFuZ2VkOiBjLmJvcmRlclRocmVzaG9sZCAhPT0gbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogJ2JnVG9sZXJhbmNlJywgbGFiZWw6ICdCRyBUb2xlcmFuY2UnLFxuICAgICAgdmFsdWU6IGMuYmdUb2xlcmFuY2UudG9GaXhlZCgyKSxcbiAgICAgIGhlbHA6ICdIb3cgZGlmZmVyZW50IGEgcGl4ZWwgY2FuIGJlIGZyb20gdGhlIGJhY2tncm91bmQgY29sb3IgYW5kIHN0aWxsIGNvdW50IGFzIGJhY2tncm91bmQuIEhpZ2hlciA9IG1vcmUgYWdncmVzc2l2ZS4nLFxuICAgICAgY2hhbmdlZDogYy5iZ1RvbGVyYW5jZSAhPT0gMC4wNSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogJ2Zsb29kRmlsbCcsIGxhYmVsOiAnRmxvb2QgRmlsbCcsXG4gICAgICB2YWx1ZTogYy5mbG9vZEZpbGwgPyAnb24nIDogJ29mZicsXG4gICAgICBoZWxwOiAnT246IG9ubHkgcmVtb3ZlIGNvbm5lY3RlZCBiYWNrZ3JvdW5kIGZyb20gZWRnZXMuIE9mZjogcmVtb3ZlIG1hdGNoaW5nIGNvbG9yIGV2ZXJ5d2hlcmUuJyxcbiAgICAgIGNoYW5nZWQ6ICFjLmZsb29kRmlsbCxcbiAgICB9LFxuICAgIHsgc2VjdGlvbjogJ091dHB1dCcgfSxcbiAgICB7XG4gICAgICBrZXk6ICdvdXRwdXRTY2FsZScsIGxhYmVsOiAnU2NhbGUnLFxuICAgICAgdmFsdWU6IGMub3V0cHV0U2NhbGUgPT09IG51bGwgPyAnb2ZmJyA6IGMub3V0cHV0U2NhbGUgKyAneCcsXG4gICAgICBoZWxwOiAnU2NhbGUgdGhlIG91dHB1dCBieSBhbiBpbnRlZ2VyIG11bHRpcGxpZXIgKDJ4LCAzeCwgZXRjKS4gR3JlYXQgZm9yIHVwc2NhbGluZyBzcHJpdGVzIGZvciBnYW1lIGVuZ2luZXMuJyxcbiAgICAgIGNoYW5nZWQ6IGMub3V0cHV0U2NhbGUgIT09IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6ICdvdXRwdXRXaWR0aCcsIGxhYmVsOiAnV2lkdGgnLFxuICAgICAgdmFsdWU6IGMub3V0cHV0V2lkdGggPT09IG51bGwgPyAnYXV0bycgOiBTdHJpbmcoYy5vdXRwdXRXaWR0aCksXG4gICAgICBoZWxwOiAnRXhwbGljaXQgb3V0cHV0IHdpZHRoIGluIHBpeGVscy4gT3ZlcnJpZGVzIHNjYWxlLicsXG4gICAgICBjaGFuZ2VkOiBjLm91dHB1dFdpZHRoICE9PSBudWxsLFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiAnb3V0cHV0SGVpZ2h0JywgbGFiZWw6ICdIZWlnaHQnLFxuICAgICAgdmFsdWU6IGMub3V0cHV0SGVpZ2h0ID09PSBudWxsID8gJ2F1dG8nIDogU3RyaW5nKGMub3V0cHV0SGVpZ2h0KSxcbiAgICAgIGhlbHA6ICdFeHBsaWNpdCBvdXRwdXQgaGVpZ2h0IGluIHBpeGVscy4gT3ZlcnJpZGVzIHNjYWxlLicsXG4gICAgICBjaGFuZ2VkOiBjLm91dHB1dEhlaWdodCAhPT0gbnVsbCxcbiAgICB9LFxuICBdO1xufVxuXG5mdW5jdGlvbiBnZXRTZXR0aW5nUm93cygpOiBTZXR0aW5nUm93W10ge1xuICByZXR1cm4gZ2V0U2V0dGluZ3MoKS5maWx0ZXIoKHMpOiBzIGlzIFNldHRpbmdSb3cgPT4gIXMuc2VjdGlvbik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2V0dGluZyBhZGp1c3RtZW50IChhcnJvdyBrZXlzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIGFkanVzdFNldHRpbmcoa2V5OiBzdHJpbmcsIGRpcmVjdGlvbjogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IGMgPSBzdGF0ZS5jb25maWc7XG4gIHN3aXRjaCAoa2V5KSB7XG4gICAgY2FzZSAnZ3JpZFNpemUnOlxuICAgICAgaWYgKGMuZ3JpZFNpemUgPT09IG51bGwpIHtcbiAgICAgICAgYy5ncmlkU2l6ZSA9IHN0YXRlLmltYWdlSW5mbz8uZ3JpZFNpemUgfHwgNDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGMuZ3JpZFNpemUgPSBNYXRoLm1heCgxLCBjLmdyaWRTaXplICsgZGlyZWN0aW9uKTtcbiAgICAgICAgaWYgKGMuZ3JpZFNpemUgPT09IDEgJiYgZGlyZWN0aW9uIDwgMCkgYy5ncmlkU2l6ZSA9IG51bGw7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdncmlkUGhhc2VYJzpcbiAgICAgIGlmIChjLmdyaWRQaGFzZVggPT09IG51bGwpIHtcbiAgICAgICAgYy5ncmlkUGhhc2VYID0gMDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGMuZ3JpZFBoYXNlWCA9IE1hdGgubWF4KDAsIGMuZ3JpZFBoYXNlWCArIGRpcmVjdGlvbik7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdncmlkUGhhc2VZJzpcbiAgICAgIGlmIChjLmdyaWRQaGFzZVkgPT09IG51bGwpIHtcbiAgICAgICAgYy5ncmlkUGhhc2VZID0gMDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGMuZ3JpZFBoYXNlWSA9IE1hdGgubWF4KDAsIGMuZ3JpZFBoYXNlWSArIGRpcmVjdGlvbik7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdtYXhHcmlkQ2FuZGlkYXRlJzpcbiAgICAgIGMubWF4R3JpZENhbmRpZGF0ZSA9IE1hdGgubWF4KDIsIE1hdGgubWluKDY0LCBjLm1heEdyaWRDYW5kaWRhdGUgKyBkaXJlY3Rpb24gKiA0KSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdub0dyaWREZXRlY3QnOlxuICAgICAgYy5ub0dyaWREZXRlY3QgPSAhYy5ub0dyaWREZXRlY3Q7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkb3duc2NhbGVNb2RlJzoge1xuICAgICAgbGV0IGlkeCA9IERPV05TQ0FMRV9NT0RFUy5pbmRleE9mKGMuZG93bnNjYWxlTW9kZSk7XG4gICAgICBpZHggPSAoaWR4ICsgZGlyZWN0aW9uICsgRE9XTlNDQUxFX01PREVTLmxlbmd0aCkgJSBET1dOU0NBTEVfTU9ERVMubGVuZ3RoO1xuICAgICAgYy5kb3duc2NhbGVNb2RlID0gRE9XTlNDQUxFX01PREVTW2lkeF07XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnYWFUaHJlc2hvbGQnOlxuICAgICAgaWYgKGMuYWFUaHJlc2hvbGQgPT09IG51bGwpIHtcbiAgICAgICAgYy5hYVRocmVzaG9sZCA9IDAuNTA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjLmFhVGhyZXNob2xkID0gTWF0aC5yb3VuZCgoYy5hYVRocmVzaG9sZCArIGRpcmVjdGlvbiAqIDAuMDUpICogMTAwKSAvIDEwMDtcbiAgICAgICAgaWYgKGMuYWFUaHJlc2hvbGQgPD0gMCkgYy5hYVRocmVzaG9sZCA9IG51bGw7XG4gICAgICAgIGVsc2UgaWYgKGMuYWFUaHJlc2hvbGQgPiAxLjApIGMuYWFUaHJlc2hvbGQgPSAxLjA7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdwYWxldHRlTmFtZSc6IHtcbiAgICAgIGNvbnN0IG5hbWVzOiAoc3RyaW5nIHwgbnVsbClbXSA9IFtudWxsLCAuLi5zdGF0ZS5wYWxldHRlcy5tYXAocCA9PiBwLnNsdWcpXTtcbiAgICAgIGxldCBpZHggPSBuYW1lcy5pbmRleE9mKGMucGFsZXR0ZU5hbWUpO1xuICAgICAgaWR4ID0gKGlkeCArIGRpcmVjdGlvbiArIG5hbWVzLmxlbmd0aCkgJSBuYW1lcy5sZW5ndGg7XG4gICAgICBjLnBhbGV0dGVOYW1lID0gbmFtZXNbaWR4XTtcbiAgICAgIGlmIChjLnBhbGV0dGVOYW1lICE9PSBudWxsKSB7XG4gICAgICAgIGMuYXV0b0NvbG9ycyA9IG51bGw7XG4gICAgICAgIGMubG9zcGVjU2x1ZyA9IG51bGw7XG4gICAgICAgIGMuY3VzdG9tUGFsZXR0ZSA9IG51bGw7XG4gICAgICAgIHN0YXRlLmxvc3BlY1Jlc3VsdCA9IG51bGw7XG4gICAgICAgIGZldGNoUGFsZXR0ZUNvbG9ycyhjLnBhbGV0dGVOYW1lKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YXRlLnBhbGV0dGVDb2xvcnMgPSBudWxsO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2F1dG9Db2xvcnMnOlxuICAgICAgaWYgKGMuYXV0b0NvbG9ycyA9PT0gbnVsbCkge1xuICAgICAgICBjLmF1dG9Db2xvcnMgPSAxNjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGMuYXV0b0NvbG9ycyA9IE1hdGgubWF4KDIsIGMuYXV0b0NvbG9ycyArIGRpcmVjdGlvbiAqIDIpO1xuICAgICAgICBpZiAoYy5hdXRvQ29sb3JzIDw9IDIgJiYgZGlyZWN0aW9uIDwgMCkgYy5hdXRvQ29sb3JzID0gbnVsbDtcbiAgICAgICAgZWxzZSBpZiAoYy5hdXRvQ29sb3JzID4gMjU2KSBjLmF1dG9Db2xvcnMgPSAyNTY7XG4gICAgICB9XG4gICAgICBpZiAoYy5hdXRvQ29sb3JzICE9PSBudWxsKSB7XG4gICAgICAgIGMucGFsZXR0ZU5hbWUgPSBudWxsO1xuICAgICAgICBjLmxvc3BlY1NsdWcgPSBudWxsO1xuICAgICAgICBjLmN1c3RvbVBhbGV0dGUgPSBudWxsO1xuICAgICAgICBzdGF0ZS5wYWxldHRlQ29sb3JzID0gbnVsbDtcbiAgICAgICAgc3RhdGUubG9zcGVjUmVzdWx0ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3JlbW92ZUJnJzpcbiAgICAgIGMucmVtb3ZlQmcgPSAhYy5yZW1vdmVCZztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2JvcmRlclRocmVzaG9sZCc6XG4gICAgICBpZiAoYy5ib3JkZXJUaHJlc2hvbGQgPT09IG51bGwpIHtcbiAgICAgICAgYy5ib3JkZXJUaHJlc2hvbGQgPSAwLjQwO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYy5ib3JkZXJUaHJlc2hvbGQgPSBNYXRoLnJvdW5kKChjLmJvcmRlclRocmVzaG9sZCArIGRpcmVjdGlvbiAqIDAuMDUpICogMTAwKSAvIDEwMDtcbiAgICAgICAgaWYgKGMuYm9yZGVyVGhyZXNob2xkIDw9IDApIGMuYm9yZGVyVGhyZXNob2xkID0gbnVsbDtcbiAgICAgICAgZWxzZSBpZiAoYy5ib3JkZXJUaHJlc2hvbGQgPiAxLjApIGMuYm9yZGVyVGhyZXNob2xkID0gMS4wO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnYmdUb2xlcmFuY2UnOlxuICAgICAgYy5iZ1RvbGVyYW5jZSA9IE1hdGgucm91bmQoKGMuYmdUb2xlcmFuY2UgKyBkaXJlY3Rpb24gKiAwLjAxKSAqIDEwMCkgLyAxMDA7XG4gICAgICBjLmJnVG9sZXJhbmNlID0gTWF0aC5tYXgoMC4wMSwgTWF0aC5taW4oMC41MCwgYy5iZ1RvbGVyYW5jZSkpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZmxvb2RGaWxsJzpcbiAgICAgIGMuZmxvb2RGaWxsID0gIWMuZmxvb2RGaWxsO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnb3V0cHV0U2NhbGUnOlxuICAgICAgaWYgKGMub3V0cHV0U2NhbGUgPT09IG51bGwpIHtcbiAgICAgICAgYy5vdXRwdXRTY2FsZSA9IDI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjLm91dHB1dFNjYWxlID0gYy5vdXRwdXRTY2FsZSArIGRpcmVjdGlvbjtcbiAgICAgICAgaWYgKGMub3V0cHV0U2NhbGUgPCAyKSBjLm91dHB1dFNjYWxlID0gbnVsbDtcbiAgICAgICAgZWxzZSBpZiAoYy5vdXRwdXRTY2FsZSA+IDE2KSBjLm91dHB1dFNjYWxlID0gMTY7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdvdXRwdXRXaWR0aCc6XG4gICAgICBpZiAoYy5vdXRwdXRXaWR0aCA9PT0gbnVsbCkge1xuICAgICAgICBjLm91dHB1dFdpZHRoID0gc3RhdGUuaW1hZ2VJbmZvPy53aWR0aCB8fCA2NDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGMub3V0cHV0V2lkdGggPSBNYXRoLm1heCgxLCBjLm91dHB1dFdpZHRoICsgZGlyZWN0aW9uICogOCk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdvdXRwdXRIZWlnaHQnOlxuICAgICAgaWYgKGMub3V0cHV0SGVpZ2h0ID09PSBudWxsKSB7XG4gICAgICAgIGMub3V0cHV0SGVpZ2h0ID0gc3RhdGUuaW1hZ2VJbmZvPy5oZWlnaHQgfHwgNjQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjLm91dHB1dEhlaWdodCA9IE1hdGgubWF4KDEsIGMub3V0cHV0SGVpZ2h0ICsgZGlyZWN0aW9uICogOCk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhbGV0dGUgY29sb3JzIGZldGNoaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hQYWxldHRlQ29sb3JzKHNsdWc6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbG9ycyA9IGF3YWl0IGludm9rZTxzdHJpbmdbXT4oJ2dldF9wYWxldHRlX2NvbG9ycycsIHsgc2x1ZyB9KTtcbiAgICBzdGF0ZS5wYWxldHRlQ29sb3JzID0gY29sb3JzO1xuICAgIHJlbmRlclNldHRpbmdzKCk7XG4gIH0gY2F0Y2gge1xuICAgIHN0YXRlLnBhbGV0dGVDb2xvcnMgPSBudWxsO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoTG9zcGVjKHNsdWc6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBzdGF0ZS5sb3NwZWNMb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUubG9zcGVjRXJyb3IgPSBudWxsO1xuICByZW5kZXJTZXR0aW5ncygpO1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGludm9rZTxMb3NwZWNSZXN1bHQ+KCdmZXRjaF9sb3NwZWMnLCB7IHNsdWcgfSk7XG4gICAgc3RhdGUubG9zcGVjUmVzdWx0ID0gcmVzdWx0O1xuICAgIHN0YXRlLmNvbmZpZy5sb3NwZWNTbHVnID0gc2x1ZztcbiAgICBzdGF0ZS5jb25maWcuY3VzdG9tUGFsZXR0ZSA9IHJlc3VsdC5jb2xvcnM7XG4gICAgc3RhdGUuY29uZmlnLnBhbGV0dGVOYW1lID0gbnVsbDtcbiAgICBzdGF0ZS5jb25maWcuYXV0b0NvbG9ycyA9IG51bGw7XG4gICAgc3RhdGUucGFsZXR0ZUNvbG9ycyA9IHJlc3VsdC5jb2xvcnM7XG4gICAgc3RhdGUubG9zcGVjTG9hZGluZyA9IGZhbHNlO1xuICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgYXV0b1Byb2Nlc3MoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHN0YXRlLmxvc3BlY0Vycm9yID0gU3RyaW5nKGUpO1xuICAgIHN0YXRlLmxvc3BlY0xvYWRpbmcgPSBmYWxzZTtcbiAgICByZW5kZXJTZXR0aW5ncygpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRQYWxldHRlRmlsZURpYWxvZygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcGVuRGlhbG9nKHtcbiAgICAgIG11bHRpcGxlOiBmYWxzZSxcbiAgICAgIGZpbHRlcnM6IFt7XG4gICAgICAgIG5hbWU6ICdQYWxldHRlIEZpbGVzJyxcbiAgICAgICAgZXh0ZW5zaW9uczogWydoZXgnLCAndHh0J10sXG4gICAgICB9XSxcbiAgICB9KTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICBjb25zdCBjb2xvcnMgPSBhd2FpdCBpbnZva2U8c3RyaW5nW10+KCdsb2FkX3BhbGV0dGVfZmlsZScsIHsgcGF0aDogcmVzdWx0IH0pO1xuICAgICAgc3RhdGUuY29uZmlnLmN1c3RvbVBhbGV0dGUgPSBjb2xvcnM7XG4gICAgICBzdGF0ZS5jb25maWcucGFsZXR0ZU5hbWUgPSBudWxsO1xuICAgICAgc3RhdGUuY29uZmlnLmF1dG9Db2xvcnMgPSBudWxsO1xuICAgICAgc3RhdGUuY29uZmlnLmxvc3BlY1NsdWcgPSBudWxsO1xuICAgICAgc3RhdGUubG9zcGVjUmVzdWx0ID0gbnVsbDtcbiAgICAgIHN0YXRlLnBhbGV0dGVDb2xvcnMgPSBjb2xvcnM7XG4gICAgICByZW5kZXJTZXR0aW5ncygpO1xuICAgICAgYXV0b1Byb2Nlc3MoKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBzZXRTdGF0dXMoJ0Vycm9yIGxvYWRpbmcgcGFsZXR0ZTogJyArIGUsICdlcnJvcicpO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVUkgcmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gc2V0U3RhdHVzKG1zZzogc3RyaW5nLCB0eXBlOiBzdHJpbmcgPSAnJyk6IHZvaWQge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdGF0dXMtbXNnJykhO1xuICBlbC50ZXh0Q29udGVudCA9IG1zZztcbiAgZWwuY2xhc3NOYW1lID0gJ3N0YXR1cy1tc2cnICsgKHR5cGUgPyAnICcgKyB0eXBlIDogJycpO1xufVxuXG5mdW5jdGlvbiBzaG93U3Bpbm5lcnMoKTogdm9pZCB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcmV2aWV3LXNwaW5uZXInKT8uY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5ncy1zcGlubmVyJyk/LmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xufVxuXG5mdW5jdGlvbiBoaWRlU3Bpbm5lcnMoKTogdm9pZCB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcmV2aWV3LXNwaW5uZXInKT8uY2xhc3NMaXN0LnJlbW92ZSgnYWN0aXZlJyk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5ncy1zcGlubmVyJyk/LmNsYXNzTGlzdC5yZW1vdmUoJ2FjdGl2ZScpO1xufVxuXG5mdW5jdGlvbiBzd2l0Y2hUYWIobmFtZTogc3RyaW5nKTogdm9pZCB7XG4gIHN0YXRlLmFjdGl2ZVRhYiA9IG5hbWU7XG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy50YWInKS5mb3JFYWNoKHQgPT4ge1xuICAgICh0IGFzIEhUTUxFbGVtZW50KS5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCAodCBhcyBIVE1MRWxlbWVudCkuZGF0YXNldC50YWIgPT09IG5hbWUpO1xuICB9KTtcbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLnRhYi1wYW5lbCcpLmZvckVhY2gocCA9PiB7XG4gICAgKHAgYXMgSFRNTEVsZW1lbnQpLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIHAuaWQgPT09ICdwYW5lbC0nICsgbmFtZSk7XG4gIH0pO1xuICAvLyBSZS1yZW5kZXIgZHluYW1pYyB0YWJzIHRvIHJlZmxlY3QgbGF0ZXN0IHN0YXRlXG4gIGlmIChuYW1lID09PSAnYmF0Y2gnKSByZW5kZXJCYXRjaCgpO1xuICBpZiAobmFtZSA9PT0gJ3NoZWV0JykgcmVuZGVyU2hlZXQoKTtcbn1cblxuLy8gU2V0dGluZ3MgdGhhdCBhbHdheXMgcmVuZGVyIGFzIDxzZWxlY3Q+IGRyb3Bkb3duc1xuY29uc3QgU0VMRUNUX1NFVFRJTkdTID0gWydkb3duc2NhbGVNb2RlJywgJ3BhbGV0dGVOYW1lJ107XG4vLyBTZXR0aW5ncyB0aGF0IGFyZSBib29sZWFuIHRvZ2dsZXNcbmNvbnN0IEJPT0xFQU5fU0VUVElOR1MgPSBbJ3JlbW92ZUJnJywgJ2Zsb29kRmlsbCcsICdub0dyaWREZXRlY3QnLCAnbm9RdWFudGl6ZSddO1xuLy8gU2V0dGluZ3MgdGhhdCByZXF1aXJlIEVudGVyLXRvLWVkaXQgKHRleHQvbnVtZXJpYyBpbnB1dClcbmNvbnN0IElOUFVUX1NFVFRJTkdTID0gWydncmlkU2l6ZScsICdncmlkUGhhc2VYJywgJ2dyaWRQaGFzZVknLCAnbWF4R3JpZENhbmRpZGF0ZScsICdhYVRocmVzaG9sZCcsICdhdXRvQ29sb3JzJywgJ2JnQ29sb3InLCAnYm9yZGVyVGhyZXNob2xkJywgJ2JnVG9sZXJhbmNlJywgJ2xvc3BlY1NsdWcnLCAnb3V0cHV0U2NhbGUnLCAnb3V0cHV0V2lkdGgnLCAnb3V0cHV0SGVpZ2h0J107XG4vLyBTZXR0aW5ncyB0aGF0IG9wZW4gYSBmaWxlIGRpYWxvZyBpbnN0ZWFkIG9mIGVkaXRpbmdcbmNvbnN0IEZJTEVfU0VUVElOR1MgPSBbJ3BhbGV0dGVGaWxlJ107XG4vLyBOdWxsYWJsZSBzZXR0aW5ncyDigJQgY2FuIGJlIHR1cm5lZCBvZmYgKG51bGwpIHdpdGggYSBjbGVhciBidXR0b25cbmNvbnN0IE5VTExBQkxFX1NFVFRJTkdTOiBSZWNvcmQ8c3RyaW5nLCB7IG9mZkxhYmVsOiBzdHJpbmc7IGRlZmF1bHRWYWx1ZTogKCkgPT4gdW5rbm93biB9PiA9IHtcbiAgZ3JpZFNpemU6ICAgICAgICAgeyBvZmZMYWJlbDogJ2F1dG8nLCAgZGVmYXVsdFZhbHVlOiAoKSA9PiBzdGF0ZS5pbWFnZUluZm8/LmdyaWRTaXplIHx8IDQgfSxcbiAgZ3JpZFBoYXNlWDogICAgICAgeyBvZmZMYWJlbDogJ2F1dG8nLCAgZGVmYXVsdFZhbHVlOiAoKSA9PiAwIH0sXG4gIGdyaWRQaGFzZVk6ICAgICAgIHsgb2ZmTGFiZWw6ICdhdXRvJywgIGRlZmF1bHRWYWx1ZTogKCkgPT4gMCB9LFxuICBhYVRocmVzaG9sZDogICAgICB7IG9mZkxhYmVsOiAnb2ZmJywgICBkZWZhdWx0VmFsdWU6ICgpID0+IDAuNTAgfSxcbiAgYXV0b0NvbG9yczogICAgICAgeyBvZmZMYWJlbDogJ29mZicsICAgZGVmYXVsdFZhbHVlOiAoKSA9PiAxNiB9LFxuICBsb3NwZWNTbHVnOiAgICAgICB7IG9mZkxhYmVsOiAnbm9uZScsICBkZWZhdWx0VmFsdWU6ICgpID0+IG51bGwgfSwgLy8gbG9zcGVjIGFsd2F5cyBvcGVucyBpbnB1dFxuICBiZ0NvbG9yOiAgICAgICAgICB7IG9mZkxhYmVsOiAnYXV0bycsICBkZWZhdWx0VmFsdWU6ICgpID0+IG51bGwgfSwgLy8gYmdDb2xvciBvcGVucyBpbnB1dFxuICBib3JkZXJUaHJlc2hvbGQ6ICB7IG9mZkxhYmVsOiAnMC40MCcsICBkZWZhdWx0VmFsdWU6ICgpID0+IDAuNDAgfSxcbiAgb3V0cHV0U2NhbGU6ICAgICAgeyBvZmZMYWJlbDogJ29mZicsICAgZGVmYXVsdFZhbHVlOiAoKSA9PiAyIH0sXG4gIG91dHB1dFdpZHRoOiAgICAgIHsgb2ZmTGFiZWw6ICdhdXRvJywgIGRlZmF1bHRWYWx1ZTogKCkgPT4gc3RhdGUuaW1hZ2VJbmZvPy53aWR0aCB8fCA2NCB9LFxuICBvdXRwdXRIZWlnaHQ6ICAgICB7IG9mZkxhYmVsOiAnYXV0bycsICBkZWZhdWx0VmFsdWU6ICgpID0+IHN0YXRlLmltYWdlSW5mbz8uaGVpZ2h0IHx8IDY0IH0sXG59O1xuXG5mdW5jdGlvbiByZW5kZXJTZXR0aW5ncygpOiB2b2lkIHtcbiAgY29uc3QgbGlzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5ncy1saXN0JykhO1xuXG4gIC8vIERvbid0IGNsb2JiZXIgdGhlIERPTSB3aGlsZSB0aGUgdXNlciBpcyBmb2N1c2VkIG9uIGFuIGlubGluZSBpbnB1dFxuICBjb25zdCBmb2N1c2VkID0gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcbiAgaWYgKGZvY3VzZWQgJiYgZm9jdXNlZC5jbGFzc0xpc3Q/LmNvbnRhaW5zKCdzZXR0aW5nLWlubGluZS1pbnB1dCcpICYmIGxpc3QuY29udGFpbnMoZm9jdXNlZCkpIHtcbiAgICAvLyBVcGRhdGUgbm9uLWlucHV0IHBhcnRzIG9ubHk6IGZvY3VzIGluZGljYXRvciwgY2hhbmdlZCBjbGFzc2VzXG4gICAgdXBkYXRlU2V0dGluZ3NGb2N1c09ubHkobGlzdCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgc2V0dGluZ3MgPSBnZXRTZXR0aW5ncygpO1xuICBsZXQgcm93SW5kZXggPSAwO1xuICBsZXQgaHRtbCA9ICcnO1xuXG4gIGZvciAoY29uc3QgcyBvZiBzZXR0aW5ncykge1xuICAgIGlmIChzLnNlY3Rpb24pIHtcbiAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJzZXR0aW5nLXNlY3Rpb25cIj4ke3Muc2VjdGlvbn08L2Rpdj5gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBpc0ZvY3VzZWQgPSByb3dJbmRleCA9PT0gc3RhdGUuc2V0dGluZ3NGb2N1c0luZGV4ID8gJyBmb2N1c2VkJyA6ICcnO1xuICAgICAgY29uc3QgY2hhbmdlZCA9IHMuY2hhbmdlZCA/ICcgY2hhbmdlZCcgOiAnJztcblxuICAgICAgaHRtbCArPSBgPGRpdiBjbGFzcz1cInNldHRpbmctcm93JHtpc0ZvY3VzZWR9XCIgZGF0YS1pbmRleD1cIiR7cm93SW5kZXh9XCIgZGF0YS1rZXk9XCIke3Mua2V5fVwiPmA7XG4gICAgICBodG1sICs9IGA8c3BhbiBjbGFzcz1cInNldHRpbmctaW5kaWNhdG9yXCI+JiM5NjU0Ozwvc3Bhbj5gO1xuICAgICAgaHRtbCArPSBgPHNwYW4gY2xhc3M9XCJzZXR0aW5nLWxhYmVsXCI+JHtzLmxhYmVsfTwvc3Bhbj5gO1xuICAgICAgaHRtbCArPSBgPHNwYW4gY2xhc3M9XCJzZXR0aW5nLXZhbHVlJHtjaGFuZ2VkfVwiPmA7XG5cbiAgICAgIGlmIChTRUxFQ1RfU0VUVElOR1MuaW5jbHVkZXMocy5rZXkpKSB7XG4gICAgICAgIC8vIEFsd2F5cyByZW5kZXIgYXMgZHJvcGRvd25cbiAgICAgICAgaHRtbCArPSByZW5kZXJJbmxpbmVTZWxlY3Qocy5rZXkpO1xuICAgICAgfSBlbHNlIGlmIChCT09MRUFOX1NFVFRJTkdTLmluY2x1ZGVzKHMua2V5KSkge1xuICAgICAgICAvLyBSZW5kZXIgYXMgY2xpY2thYmxlIHRvZ2dsZVxuICAgICAgICBodG1sICs9IGA8c3BhbiBjbGFzcz1cInNldHRpbmctdG9nZ2xlXCIgZGF0YS1rZXk9XCIke3Mua2V5fVwiPiR7ZXNjYXBlSHRtbChzLnZhbHVlKX08L3NwYW4+YDtcbiAgICAgIH0gZWxzZSBpZiAoRklMRV9TRVRUSU5HUy5pbmNsdWRlcyhzLmtleSkpIHtcbiAgICAgICAgLy8gRmlsZSBzZXR0aW5nczogY2xpY2thYmxlIHRvIG9wZW4gZGlhbG9nLCB3aXRoIGNsZWFyIGJ1dHRvbiB3aGVuIGFjdGl2ZVxuICAgICAgICBpZiAocy5jaGFuZ2VkKSB7XG4gICAgICAgICAgaHRtbCArPSBlc2NhcGVIdG1sKHMudmFsdWUpO1xuICAgICAgICAgIGh0bWwgKz0gYDxzcGFuIGNsYXNzPVwic2V0dGluZy1jbGVhclwiIGRhdGEta2V5PVwiJHtzLmtleX1cIiB0aXRsZT1cIkNsZWFyXCI+XFx1MDBkNzwvc3Bhbj5gO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGh0bWwgKz0gYDxzcGFuIGNsYXNzPVwic2V0dGluZy10b2dnbGVcIiBkYXRhLWtleT1cIiR7cy5rZXl9XCI+JHtlc2NhcGVIdG1sKHMudmFsdWUpfTwvc3Bhbj5gO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKElOUFVUX1NFVFRJTkdTLmluY2x1ZGVzKHMua2V5KSkge1xuICAgICAgICAvLyBBbHdheXMtdmlzaWJsZSBpbmxpbmUgaW5wdXRcbiAgICAgICAgaHRtbCArPSByZW5kZXJJbmxpbmVJbnB1dChzLmtleSk7XG4gICAgICAgIGlmIChzLmtleSBpbiBOVUxMQUJMRV9TRVRUSU5HUyAmJiBzLmNoYW5nZWQpIHtcbiAgICAgICAgICBjb25zdCBudWxsYWJsZSA9IE5VTExBQkxFX1NFVFRJTkdTW3Mua2V5XTtcbiAgICAgICAgICBodG1sICs9IGA8c3BhbiBjbGFzcz1cInNldHRpbmctY2xlYXJcIiBkYXRhLWtleT1cIiR7cy5rZXl9XCIgdGl0bGU9XCJSZXNldCB0byAke251bGxhYmxlLm9mZkxhYmVsfVwiPlxcdTAwZDc8L3NwYW4+YDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaHRtbCArPSBlc2NhcGVIdG1sKHMudmFsdWUpO1xuICAgICAgfVxuXG4gICAgICBodG1sICs9IGA8L3NwYW4+YDtcbiAgICAgIGh0bWwgKz0gYDwvZGl2PmA7XG4gICAgICAvLyBIZWxwIHRleHQgYWx3YXlzIHZpc2libGVcbiAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJzZXR0aW5nLWhlbHBcIj4ke3MuaGVscH08L2Rpdj5gO1xuXG4gICAgICAvLyBQYWxldHRlIHN3YXRjaGVzIChhZnRlciBwYWxldHRlLCBsb3NwZWMsIG9yIHBhbGV0dGVGaWxlIHJvdylcbiAgICAgIGlmICgocy5rZXkgPT09ICdwYWxldHRlTmFtZScgfHwgcy5rZXkgPT09ICdsb3NwZWNTbHVnJyB8fCBzLmtleSA9PT0gJ3BhbGV0dGVGaWxlJykgJiYgc3RhdGUucGFsZXR0ZUNvbG9ycyAmJiBzdGF0ZS5wYWxldHRlQ29sb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgaWYgKChzLmtleSA9PT0gJ3BhbGV0dGVOYW1lJyAmJiBzdGF0ZS5jb25maWcucGFsZXR0ZU5hbWUgIT09IG51bGwpIHx8XG4gICAgICAgICAgICAocy5rZXkgPT09ICdsb3NwZWNTbHVnJyAmJiBzdGF0ZS5jb25maWcubG9zcGVjU2x1ZyAhPT0gbnVsbCkgfHxcbiAgICAgICAgICAgIChzLmtleSA9PT0gJ3BhbGV0dGVGaWxlJyAmJiBzdGF0ZS5jb25maWcuY3VzdG9tUGFsZXR0ZSAhPT0gbnVsbCAmJiBzdGF0ZS5jb25maWcubG9zcGVjU2x1ZyA9PT0gbnVsbCkpIHtcbiAgICAgICAgICBodG1sICs9IHJlbmRlclBhbGV0dGVTd2F0Y2hlcyhzdGF0ZS5wYWxldHRlQ29sb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBMb3NwZWMgaW5mby9lcnJvciBhZnRlciBsb3NwZWMgcm93XG4gICAgICBpZiAocy5rZXkgPT09ICdsb3NwZWNTbHVnJykge1xuICAgICAgICBpZiAoc3RhdGUubG9zcGVjTG9hZGluZykge1xuICAgICAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJsb3NwZWMtaW5mbyBsb3NwZWMtbG9hZGluZ1wiPkZldGNoaW5nIHBhbGV0dGUuLi48L2Rpdj5gO1xuICAgICAgICB9IGVsc2UgaWYgKHN0YXRlLmxvc3BlY0Vycm9yKSB7XG4gICAgICAgICAgaHRtbCArPSBgPGRpdiBjbGFzcz1cImxvc3BlYy1lcnJvclwiPiR7ZXNjYXBlSHRtbChzdGF0ZS5sb3NwZWNFcnJvcil9PC9kaXY+YDtcbiAgICAgICAgfSBlbHNlIGlmIChzdGF0ZS5sb3NwZWNSZXN1bHQgJiYgc3RhdGUuY29uZmlnLmxvc3BlY1NsdWcpIHtcbiAgICAgICAgICBodG1sICs9IGA8ZGl2IGNsYXNzPVwibG9zcGVjLWluZm9cIj4ke2VzY2FwZUh0bWwoc3RhdGUubG9zcGVjUmVzdWx0Lm5hbWUpfSBcXHUyMDE0ICR7c3RhdGUubG9zcGVjUmVzdWx0Lm51bUNvbG9yc30gY29sb3JzPC9kaXY+YDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByb3dJbmRleCsrO1xuICAgIH1cbiAgfVxuICBsaXN0LmlubmVySFRNTCA9IGh0bWw7XG59XG5cbi8vIExpZ2h0d2VpZ2h0IHJlLXJlbmRlcjoganVzdCB1cGRhdGUgZm9jdXMvY2hhbmdlZCBjbGFzc2VzIHdpdGhvdXQgZGVzdHJveWluZyBpbnB1dHNcbmZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzRm9jdXNPbmx5KGxpc3Q6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gIGNvbnN0IHJvd3MgPSBsaXN0LnF1ZXJ5U2VsZWN0b3JBbGwoJy5zZXR0aW5nLXJvdycpO1xuICByb3dzLmZvckVhY2goKHJvdywgaSkgPT4ge1xuICAgIChyb3cgYXMgSFRNTEVsZW1lbnQpLmNsYXNzTGlzdC50b2dnbGUoJ2ZvY3VzZWQnLCBpID09PSBzdGF0ZS5zZXR0aW5nc0ZvY3VzSW5kZXgpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUGFsZXR0ZVN3YXRjaGVzKGNvbG9yczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBsZXQgaHRtbCA9ICc8ZGl2IGNsYXNzPVwicGFsZXR0ZS1zd2F0Y2hlc1wiPic7XG4gIGZvciAoY29uc3QgY29sb3Igb2YgY29sb3JzKSB7XG4gICAgaHRtbCArPSBgPGRpdiBjbGFzcz1cInBhbGV0dGUtc3dhdGNoXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiR7Y29sb3J9XCIgdGl0bGU9XCIke2NvbG9yfVwiPjwvZGl2PmA7XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvJi9nLCAnJmFtcDsnKS5yZXBsYWNlKC88L2csICcmbHQ7JykucmVwbGFjZSgvPi9nLCAnJmd0OycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVySW5saW5lU2VsZWN0KGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYyA9IHN0YXRlLmNvbmZpZztcbiAgc3dpdGNoIChrZXkpIHtcbiAgICBjYXNlICdkb3duc2NhbGVNb2RlJzoge1xuICAgICAgY29uc3Qgb3B0cyA9IERPV05TQ0FMRV9NT0RFUy5tYXAobSA9PlxuICAgICAgICBgPG9wdGlvbiB2YWx1ZT1cIiR7bX1cIiR7bSA9PT0gYy5kb3duc2NhbGVNb2RlID8gJyBzZWxlY3RlZCcgOiAnJ30+JHttfTwvb3B0aW9uPmBcbiAgICAgICkuam9pbignJyk7XG4gICAgICByZXR1cm4gYDxzZWxlY3QgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1zZWxlY3RcIiBkYXRhLWtleT1cIiR7a2V5fVwiPiR7b3B0c308L3NlbGVjdD5gO1xuICAgIH1cbiAgICBjYXNlICdwYWxldHRlTmFtZSc6IHtcbiAgICAgIGxldCBvcHRzID0gYDxvcHRpb24gdmFsdWU9XCJcIiR7Yy5wYWxldHRlTmFtZSA9PT0gbnVsbCA/ICcgc2VsZWN0ZWQnIDogJyd9Pm5vbmU8L29wdGlvbj5gO1xuICAgICAgb3B0cyArPSBzdGF0ZS5wYWxldHRlcy5tYXAocCA9PlxuICAgICAgICBgPG9wdGlvbiB2YWx1ZT1cIiR7cC5zbHVnfVwiJHtwLnNsdWcgPT09IGMucGFsZXR0ZU5hbWUgPyAnIHNlbGVjdGVkJyA6ICcnfT4ke3Auc2x1Z30gKCR7cC5udW1Db2xvcnN9KTwvb3B0aW9uPmBcbiAgICAgICkuam9pbignJyk7XG4gICAgICByZXR1cm4gYDxzZWxlY3QgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1zZWxlY3RcIiBkYXRhLWtleT1cIiR7a2V5fVwiPiR7b3B0c308L3NlbGVjdD5gO1xuICAgIH1cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICcnO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlcklubGluZUlucHV0KGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYyA9IHN0YXRlLmNvbmZpZztcbiAgc3dpdGNoIChrZXkpIHtcbiAgICBjYXNlICdncmlkU2l6ZSc6IHtcbiAgICAgIGNvbnN0IHZhbCA9IGMuZ3JpZFNpemUgPT09IG51bGwgPyAnJyA6IGMuZ3JpZFNpemU7XG4gICAgICByZXR1cm4gYDxpbnB1dCBjbGFzcz1cInNldHRpbmctaW5saW5lLWlucHV0XCIgdHlwZT1cInRleHRcIiB2YWx1ZT1cIiR7dmFsfVwiIHBsYWNlaG9sZGVyPVwiYXV0b1wiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnZ3JpZFBoYXNlWCc6IHtcbiAgICAgIGNvbnN0IHZhbCA9IGMuZ3JpZFBoYXNlWCA9PT0gbnVsbCA/ICcnIDogYy5ncmlkUGhhc2VYO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke3ZhbH1cIiBwbGFjZWhvbGRlcj1cImF1dG9cIiBkYXRhLWtleT1cIiR7a2V5fVwiPmA7XG4gICAgfVxuICAgIGNhc2UgJ2dyaWRQaGFzZVknOiB7XG4gICAgICBjb25zdCB2YWwgPSBjLmdyaWRQaGFzZVkgPT09IG51bGwgPyAnJyA6IGMuZ3JpZFBoYXNlWTtcbiAgICAgIHJldHVybiBgPGlucHV0IGNsYXNzPVwic2V0dGluZy1pbmxpbmUtaW5wdXRcIiB0eXBlPVwidGV4dFwiIHZhbHVlPVwiJHt2YWx9XCIgcGxhY2Vob2xkZXI9XCJhdXRvXCIgZGF0YS1rZXk9XCIke2tleX1cIj5gO1xuICAgIH1cbiAgICBjYXNlICdtYXhHcmlkQ2FuZGlkYXRlJzoge1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke2MubWF4R3JpZENhbmRpZGF0ZX1cIiBkYXRhLWtleT1cIiR7a2V5fVwiPmA7XG4gICAgfVxuICAgIGNhc2UgJ2FhVGhyZXNob2xkJzoge1xuICAgICAgY29uc3QgdmFsID0gYy5hYVRocmVzaG9sZCA9PT0gbnVsbCA/ICcnIDogYy5hYVRocmVzaG9sZC50b0ZpeGVkKDIpO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke3ZhbH1cIiBwbGFjZWhvbGRlcj1cIm9mZlwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnYXV0b0NvbG9ycyc6IHtcbiAgICAgIGNvbnN0IHZhbCA9IGMuYXV0b0NvbG9ycyA9PT0gbnVsbCA/ICcnIDogYy5hdXRvQ29sb3JzO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke3ZhbH1cIiBwbGFjZWhvbGRlcj1cIm9mZlwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnYmdDb2xvcic6IHtcbiAgICAgIGNvbnN0IHZhbCA9IGMuYmdDb2xvciA/PyAnJztcbiAgICAgIHJldHVybiBgPGlucHV0IGNsYXNzPVwic2V0dGluZy1pbmxpbmUtaW5wdXRcIiB0eXBlPVwidGV4dFwiIHZhbHVlPVwiJHtlc2NhcGVIdG1sKHZhbCl9XCIgcGxhY2Vob2xkZXI9XCJhdXRvICgjUlJHR0JCKVwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnYm9yZGVyVGhyZXNob2xkJzoge1xuICAgICAgY29uc3QgdmFsID0gYy5ib3JkZXJUaHJlc2hvbGQgPT09IG51bGwgPyAnJyA6IGMuYm9yZGVyVGhyZXNob2xkLnRvRml4ZWQoMik7XG4gICAgICByZXR1cm4gYDxpbnB1dCBjbGFzcz1cInNldHRpbmctaW5saW5lLWlucHV0XCIgdHlwZT1cInRleHRcIiB2YWx1ZT1cIiR7dmFsfVwiIHBsYWNlaG9sZGVyPVwiMC40MFwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnYmdUb2xlcmFuY2UnOiB7XG4gICAgICBjb25zdCB2YWwgPSBjLmJnVG9sZXJhbmNlLnRvRml4ZWQoMik7XG4gICAgICByZXR1cm4gYDxpbnB1dCBjbGFzcz1cInNldHRpbmctaW5saW5lLWlucHV0XCIgdHlwZT1cInRleHRcIiB2YWx1ZT1cIiR7dmFsfVwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnb3V0cHV0U2NhbGUnOiB7XG4gICAgICBjb25zdCB2YWwgPSBjLm91dHB1dFNjYWxlID09PSBudWxsID8gJycgOiBjLm91dHB1dFNjYWxlO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke3ZhbH1cIiBwbGFjZWhvbGRlcj1cIm9mZlwiIGRhdGEta2V5PVwiJHtrZXl9XCI+YDtcbiAgICB9XG4gICAgY2FzZSAnb3V0cHV0V2lkdGgnOiB7XG4gICAgICBjb25zdCB2YWwgPSBjLm91dHB1dFdpZHRoID09PSBudWxsID8gJycgOiBjLm91dHB1dFdpZHRoO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dFwiIHR5cGU9XCJ0ZXh0XCIgdmFsdWU9XCIke3ZhbH1cIiBwbGFjZWhvbGRlcj1cImF1dG9cIiBkYXRhLWtleT1cIiR7a2V5fVwiPmA7XG4gICAgfVxuICAgIGNhc2UgJ291dHB1dEhlaWdodCc6IHtcbiAgICAgIGNvbnN0IHZhbCA9IGMub3V0cHV0SGVpZ2h0ID09PSBudWxsID8gJycgOiBjLm91dHB1dEhlaWdodDtcbiAgICAgIHJldHVybiBgPGlucHV0IGNsYXNzPVwic2V0dGluZy1pbmxpbmUtaW5wdXRcIiB0eXBlPVwidGV4dFwiIHZhbHVlPVwiJHt2YWx9XCIgcGxhY2Vob2xkZXI9XCJhdXRvXCIgZGF0YS1rZXk9XCIke2tleX1cIj5gO1xuICAgIH1cbiAgICBjYXNlICdsb3NwZWNTbHVnJzoge1xuICAgICAgY29uc3QgdmFsID0gYy5sb3NwZWNTbHVnID8/ICcnO1xuICAgICAgcmV0dXJuIGA8aW5wdXQgY2xhc3M9XCJzZXR0aW5nLWlubGluZS1pbnB1dCBzZXR0aW5nLWlubGluZS1pbnB1dC13aWRlXCIgdHlwZT1cInRleHRcIiB2YWx1ZT1cIiR7ZXNjYXBlSHRtbCh2YWwpfVwiIHBsYWNlaG9sZGVyPVwiZS5nLiBwaWNvLThcIiBkYXRhLWtleT1cIiR7a2V5fVwiPmA7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuZnVuY3Rpb24gc3RhcnRFZGl0aW5nKGtleTogc3RyaW5nKTogdm9pZCB7XG4gIC8vIEJvb2xlYW5zIHRvZ2dsZSBpbW1lZGlhdGVseVxuICBpZiAoQk9PTEVBTl9TRVRUSU5HUy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgYWRqdXN0U2V0dGluZyhrZXksIDEpO1xuICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgYXV0b1Byb2Nlc3MoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gU2VsZWN0cyBhcmUgYWx3YXlzIHZpc2libGVcbiAgaWYgKFNFTEVDVF9TRVRUSU5HUy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbGUgc2V0dGluZ3Mgb3BlbiBhIGZpbGUgZGlhbG9nXG4gIGlmIChGSUxFX1NFVFRJTkdTLmluY2x1ZGVzKGtleSkpIHtcbiAgICBpZiAoa2V5ID09PSAncGFsZXR0ZUZpbGUnKSB7XG4gICAgICBsb2FkUGFsZXR0ZUZpbGVEaWFsb2coKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZvciBpbmxpbmUgaW5wdXRzLCBqdXN0IGZvY3VzIHRoZSBpbnB1dCBlbGVtZW50XG4gIGlmIChJTlBVVF9TRVRUSU5HUy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKGAuc2V0dGluZy1pbmxpbmUtaW5wdXRbZGF0YS1rZXk9XCIke2tleX1cIl1gKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICBpZiAoaW5wdXQpIHtcbiAgICAgIGlucHV0LmZvY3VzKCk7XG4gICAgICBpbnB1dC5zZWxlY3QoKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNsZWFyU2V0dGluZyhrZXk6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBjID0gc3RhdGUuY29uZmlnO1xuICBzd2l0Y2ggKGtleSkge1xuICAgIGNhc2UgJ2dyaWRTaXplJzogYy5ncmlkU2l6ZSA9IG51bGw7IGJyZWFrO1xuICAgIGNhc2UgJ2dyaWRQaGFzZVgnOiBjLmdyaWRQaGFzZVggPSBudWxsOyBicmVhaztcbiAgICBjYXNlICdncmlkUGhhc2VZJzogYy5ncmlkUGhhc2VZID0gbnVsbDsgYnJlYWs7XG4gICAgY2FzZSAnYWFUaHJlc2hvbGQnOiBjLmFhVGhyZXNob2xkID0gbnVsbDsgYnJlYWs7XG4gICAgY2FzZSAnYXV0b0NvbG9ycyc6IGMuYXV0b0NvbG9ycyA9IG51bGw7IGJyZWFrO1xuICAgIGNhc2UgJ2xvc3BlY1NsdWcnOlxuICAgICAgYy5sb3NwZWNTbHVnID0gbnVsbDtcbiAgICAgIGMuY3VzdG9tUGFsZXR0ZSA9IG51bGw7XG4gICAgICBzdGF0ZS5sb3NwZWNSZXN1bHQgPSBudWxsO1xuICAgICAgc3RhdGUucGFsZXR0ZUNvbG9ycyA9IG51bGw7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdwYWxldHRlRmlsZSc6XG4gICAgICBpZiAoIWMubG9zcGVjU2x1Zykge1xuICAgICAgICBjLmN1c3RvbVBhbGV0dGUgPSBudWxsO1xuICAgICAgICBzdGF0ZS5wYWxldHRlQ29sb3JzID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2JnQ29sb3InOiBjLmJnQ29sb3IgPSBudWxsOyBicmVhaztcbiAgICBjYXNlICdib3JkZXJUaHJlc2hvbGQnOiBjLmJvcmRlclRocmVzaG9sZCA9IG51bGw7IGJyZWFrO1xuICAgIGNhc2UgJ291dHB1dFNjYWxlJzogYy5vdXRwdXRTY2FsZSA9IG51bGw7IGJyZWFrO1xuICAgIGNhc2UgJ291dHB1dFdpZHRoJzogYy5vdXRwdXRXaWR0aCA9IG51bGw7IGJyZWFrO1xuICAgIGNhc2UgJ291dHB1dEhlaWdodCc6IGMub3V0cHV0SGVpZ2h0ID0gbnVsbDsgYnJlYWs7XG4gIH1cbiAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgYXV0b1Byb2Nlc3MoKTtcbn1cblxuZnVuY3Rpb24gY29tbWl0RWRpdChrZXk6IHN0cmluZywgcmF3VmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBjID0gc3RhdGUuY29uZmlnO1xuICBjb25zdCB2YWwgPSByYXdWYWx1ZS50cmltKCk7XG5cbiAgc3dpdGNoIChrZXkpIHtcbiAgICBjYXNlICdncmlkU2l6ZSc6XG4gICAgICBpZiAodmFsID09PSAnJyB8fCB2YWwgPT09ICdhdXRvJykge1xuICAgICAgICBjLmdyaWRTaXplID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG4gPSBwYXJzZUludCh2YWwpO1xuICAgICAgICBpZiAoIWlzTmFOKG4pICYmIG4gPj0gMSkgYy5ncmlkU2l6ZSA9IG47XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdncmlkUGhhc2VYJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ2F1dG8nKSB7XG4gICAgICAgIGMuZ3JpZFBoYXNlWCA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuID0gcGFyc2VJbnQodmFsKTtcbiAgICAgICAgaWYgKCFpc05hTihuKSAmJiBuID49IDApIGMuZ3JpZFBoYXNlWCA9IG47XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdncmlkUGhhc2VZJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ2F1dG8nKSB7XG4gICAgICAgIGMuZ3JpZFBoYXNlWSA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuID0gcGFyc2VJbnQodmFsKTtcbiAgICAgICAgaWYgKCFpc05hTihuKSAmJiBuID49IDApIGMuZ3JpZFBoYXNlWSA9IG47XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdtYXhHcmlkQ2FuZGlkYXRlJzoge1xuICAgICAgY29uc3QgbiA9IHBhcnNlSW50KHZhbCk7XG4gICAgICBpZiAoIWlzTmFOKG4pICYmIG4gPj0gMikgYy5tYXhHcmlkQ2FuZGlkYXRlID0gTWF0aC5taW4oNjQsIG4pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2FhVGhyZXNob2xkJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ29mZicpIHtcbiAgICAgICAgYy5hYVRocmVzaG9sZCA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuID0gcGFyc2VGbG9hdCh2YWwpO1xuICAgICAgICBpZiAoIWlzTmFOKG4pKSBjLmFhVGhyZXNob2xkID0gTWF0aC5tYXgoMC4wMSwgTWF0aC5taW4oMS4wLCBuKSk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdhdXRvQ29sb3JzJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ29mZicpIHtcbiAgICAgICAgYy5hdXRvQ29sb3JzID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG4gPSBwYXJzZUludCh2YWwpO1xuICAgICAgICBpZiAoIWlzTmFOKG4pICYmIG4gPj0gMikge1xuICAgICAgICAgIGMuYXV0b0NvbG9ycyA9IE1hdGgubWluKDI1Niwgbik7XG4gICAgICAgICAgYy5wYWxldHRlTmFtZSA9IG51bGw7XG4gICAgICAgICAgYy5sb3NwZWNTbHVnID0gbnVsbDtcbiAgICAgICAgICBjLmN1c3RvbVBhbGV0dGUgPSBudWxsO1xuICAgICAgICAgIHN0YXRlLnBhbGV0dGVDb2xvcnMgPSBudWxsO1xuICAgICAgICAgIHN0YXRlLmxvc3BlY1Jlc3VsdCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2JnQ29sb3InOlxuICAgICAgaWYgKHZhbCA9PT0gJycgfHwgdmFsID09PSAnYXV0bycpIHtcbiAgICAgICAgYy5iZ0NvbG9yID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFjY2VwdCB3aXRoIG9yIHdpdGhvdXQgI1xuICAgICAgICBjb25zdCBoZXggPSB2YWwuc3RhcnRzV2l0aCgnIycpID8gdmFsIDogJyMnICsgdmFsO1xuICAgICAgICBpZiAoL14jWzAtOUEtRmEtZl17Nn0kLy50ZXN0KGhleCkpIHtcbiAgICAgICAgICBjLmJnQ29sb3IgPSBoZXgudG9VcHBlckNhc2UoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnYm9yZGVyVGhyZXNob2xkJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ2F1dG8nKSB7XG4gICAgICAgIGMuYm9yZGVyVGhyZXNob2xkID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG4gPSBwYXJzZUZsb2F0KHZhbCk7XG4gICAgICAgIGlmICghaXNOYU4obikpIGMuYm9yZGVyVGhyZXNob2xkID0gTWF0aC5tYXgoMC4wMSwgTWF0aC5taW4oMS4wLCBuKSk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdiZ1RvbGVyYW5jZSc6IHtcbiAgICAgIGNvbnN0IG4gPSBwYXJzZUZsb2F0KHZhbCk7XG4gICAgICBpZiAoIWlzTmFOKG4pKSBjLmJnVG9sZXJhbmNlID0gTWF0aC5tYXgoMC4wMSwgTWF0aC5taW4oMC41MCwgbikpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2Rvd25zY2FsZU1vZGUnOlxuICAgICAgaWYgKERPV05TQ0FMRV9NT0RFUy5pbmNsdWRlcyh2YWwpKSBjLmRvd25zY2FsZU1vZGUgPSB2YWw7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdwYWxldHRlTmFtZSc6XG4gICAgICBjLnBhbGV0dGVOYW1lID0gdmFsID09PSAnJyA/IG51bGwgOiB2YWw7XG4gICAgICBpZiAoYy5wYWxldHRlTmFtZSAhPT0gbnVsbCkge1xuICAgICAgICBjLmF1dG9Db2xvcnMgPSBudWxsO1xuICAgICAgICBjLmxvc3BlY1NsdWcgPSBudWxsO1xuICAgICAgICBjLmN1c3RvbVBhbGV0dGUgPSBudWxsO1xuICAgICAgICBzdGF0ZS5sb3NwZWNSZXN1bHQgPSBudWxsO1xuICAgICAgICBmZXRjaFBhbGV0dGVDb2xvcnMoYy5wYWxldHRlTmFtZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdGF0ZS5wYWxldHRlQ29sb3JzID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2xvc3BlY1NsdWcnOlxuICAgICAgLy8gTG9zcGVjOiBjb21taXQgdHJpZ2dlcnMgYSBmZXRjaFxuICAgICAgaWYgKHZhbCA9PT0gJycgfHwgdmFsID09PSAnbm9uZScpIHtcbiAgICAgICAgYy5sb3NwZWNTbHVnID0gbnVsbDtcbiAgICAgICAgYy5jdXN0b21QYWxldHRlID0gbnVsbDtcbiAgICAgICAgc3RhdGUubG9zcGVjUmVzdWx0ID0gbnVsbDtcbiAgICAgICAgc3RhdGUucGFsZXR0ZUNvbG9ycyA9IG51bGw7XG4gICAgICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgICAgIGF1dG9Qcm9jZXNzKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGZldGNoTG9zcGVjKHZhbCk7XG4gICAgICByZXR1cm47XG4gICAgY2FzZSAnb3V0cHV0U2NhbGUnOlxuICAgICAgaWYgKHZhbCA9PT0gJycgfHwgdmFsID09PSAnb2ZmJyB8fCB2YWwgPT09ICcxJykge1xuICAgICAgICBjLm91dHB1dFNjYWxlID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG4gPSBwYXJzZUludCh2YWwpO1xuICAgICAgICBpZiAoIWlzTmFOKG4pICYmIG4gPj0gMiAmJiBuIDw9IDE2KSBjLm91dHB1dFNjYWxlID0gbjtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ291dHB1dFdpZHRoJzpcbiAgICAgIGlmICh2YWwgPT09ICcnIHx8IHZhbCA9PT0gJ2F1dG8nKSB7XG4gICAgICAgIGMub3V0cHV0V2lkdGggPSBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgbiA9IHBhcnNlSW50KHZhbCk7XG4gICAgICAgIGlmICghaXNOYU4obikgJiYgbiA+PSAxKSBjLm91dHB1dFdpZHRoID0gbjtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ291dHB1dEhlaWdodCc6XG4gICAgICBpZiAodmFsID09PSAnJyB8fCB2YWwgPT09ICdhdXRvJykge1xuICAgICAgICBjLm91dHB1dEhlaWdodCA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuID0gcGFyc2VJbnQodmFsKTtcbiAgICAgICAgaWYgKCFpc05hTihuKSAmJiBuID49IDEpIGMub3V0cHV0SGVpZ2h0ID0gbjtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgYXV0b1Byb2Nlc3MoKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEaWFnbm9zdGljcyByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZW5kZXJEaWFnbm9zdGljcygpOiB2b2lkIHtcbiAgY29uc3QgaW5mbyA9IHN0YXRlLmltYWdlSW5mbztcbiAgaWYgKCFpbmZvKSB7XG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RpYWctZ3JpZC1pbmZvJykhLmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBjbGFzcz1cImRpYWctaXRlbVwiPjxzcGFuIGNsYXNzPVwibGFiZWxcIj5ObyBpbWFnZSBsb2FkZWQ8L3NwYW4+PC9kaXY+JztcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlhZy1ncmlkLWJhcnMnKSEuaW5uZXJIVE1MID0gJyc7XG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RpYWctaW5mbycpIS5pbm5lckhUTUwgPSAnJztcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlhZy1oaXN0b2dyYW0nKSEuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IGdyaWRIdG1sID0gJyc7XG4gIGdyaWRIdG1sICs9IGA8ZGl2IGNsYXNzPVwiZGlhZy1pdGVtXCI+PHNwYW4gY2xhc3M9XCJsYWJlbFwiPkRldGVjdGVkIHNpemU8L3NwYW4+PHNwYW4gY2xhc3M9XCJ2YWx1ZVwiPiR7aW5mby5ncmlkU2l6ZSA/PyAnbm9uZSd9PC9zcGFuPjwvZGl2PmA7XG4gIGdyaWRIdG1sICs9IGA8ZGl2IGNsYXNzPVwiZGlhZy1pdGVtXCI+PHNwYW4gY2xhc3M9XCJsYWJlbFwiPkNvbmZpZGVuY2U8L3NwYW4+PHNwYW4gY2xhc3M9XCJ2YWx1ZVwiPiR7aW5mby5ncmlkQ29uZmlkZW5jZSAhPSBudWxsID8gKGluZm8uZ3JpZENvbmZpZGVuY2UgKiAxMDApLnRvRml4ZWQoMSkgKyAnJScgOiAnbi9hJ308L3NwYW4+PC9kaXY+YDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RpYWctZ3JpZC1pbmZvJykhLmlubmVySFRNTCA9IGdyaWRIdG1sO1xuXG4gIGxldCBiYXJzSHRtbCA9ICcnO1xuICBpZiAoaW5mby5ncmlkU2NvcmVzICYmIGluZm8uZ3JpZFNjb3Jlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgbWF4U2NvcmUgPSBNYXRoLm1heCguLi5pbmZvLmdyaWRTY29yZXMubWFwKHMgPT4gc1sxXSkpO1xuICAgIGNvbnN0IGJlc3RTaXplID0gaW5mby5ncmlkU2l6ZTtcbiAgICBmb3IgKGNvbnN0IFtzaXplLCBzY29yZV0gb2YgaW5mby5ncmlkU2NvcmVzKSB7XG4gICAgICBjb25zdCBwY3QgPSBtYXhTY29yZSA+IDAgPyAoc2NvcmUgLyBtYXhTY29yZSAqIDEwMCkgOiAwO1xuICAgICAgY29uc3QgYmVzdCA9IHNpemUgPT09IGJlc3RTaXplID8gJyBiZXN0JyA6ICcnO1xuICAgICAgYmFyc0h0bWwgKz0gYDxkaXYgY2xhc3M9XCJncmlkLWJhci1yb3dcIj5gO1xuICAgICAgYmFyc0h0bWwgKz0gYDxzcGFuIGNsYXNzPVwiZ3JpZC1iYXItbGFiZWxcIj4ke3NpemV9PC9zcGFuPmA7XG4gICAgICBiYXJzSHRtbCArPSBgPGRpdiBjbGFzcz1cImdyaWQtYmFyLXRyYWNrXCI+PGRpdiBjbGFzcz1cImdyaWQtYmFyLWZpbGwke2Jlc3R9XCIgc3R5bGU9XCJ3aWR0aDoke3BjdH0lXCI+PC9kaXY+PC9kaXY+YDtcbiAgICAgIGJhcnNIdG1sICs9IGA8c3BhbiBjbGFzcz1cImdyaWQtYmFyLXZhbHVlXCI+JHtzY29yZS50b0ZpeGVkKDMpfTwvc3Bhbj5gO1xuICAgICAgYmFyc0h0bWwgKz0gYDwvZGl2PmA7XG4gICAgfVxuICB9XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaWFnLWdyaWQtYmFycycpIS5pbm5lckhUTUwgPSBiYXJzSHRtbDtcblxuICBsZXQgaW5mb0h0bWwgPSAnJztcbiAgaW5mb0h0bWwgKz0gYDxkaXYgY2xhc3M9XCJkaWFnLWl0ZW1cIj48c3BhbiBjbGFzcz1cImxhYmVsXCI+RGltZW5zaW9uczwvc3Bhbj48c3BhbiBjbGFzcz1cInZhbHVlXCI+JHtpbmZvLndpZHRofSB4ICR7aW5mby5oZWlnaHR9PC9zcGFuPjwvZGl2PmA7XG4gIGluZm9IdG1sICs9IGA8ZGl2IGNsYXNzPVwiZGlhZy1pdGVtXCI+PHNwYW4gY2xhc3M9XCJsYWJlbFwiPlVuaXF1ZSBjb2xvcnM8L3NwYW4+PHNwYW4gY2xhc3M9XCJ2YWx1ZVwiPiR7aW5mby51bmlxdWVDb2xvcnN9PC9zcGFuPjwvZGl2PmA7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaWFnLWluZm8nKSEuaW5uZXJIVE1MID0gaW5mb0h0bWw7XG5cbiAgbGV0IGhpc3RIdG1sID0gJyc7XG4gIGlmIChpbmZvLmhpc3RvZ3JhbSkge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgaW5mby5oaXN0b2dyYW0pIHtcbiAgICAgIGhpc3RIdG1sICs9IGA8ZGl2IGNsYXNzPVwiY29sb3Itcm93XCI+YDtcbiAgICAgIGhpc3RIdG1sICs9IGA8ZGl2IGNsYXNzPVwiY29sb3Itc3dhdGNoXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiR7ZW50cnkuaGV4fVwiPjwvZGl2PmA7XG4gICAgICBoaXN0SHRtbCArPSBgPHNwYW4gY2xhc3M9XCJjb2xvci1oZXhcIj4ke2VudHJ5LmhleH08L3NwYW4+YDtcbiAgICAgIGhpc3RIdG1sICs9IGA8ZGl2IGNsYXNzPVwiY29sb3ItYmFyLXRyYWNrXCI+PGRpdiBjbGFzcz1cImNvbG9yLWJhci1maWxsXCIgc3R5bGU9XCJ3aWR0aDoke01hdGgubWluKGVudHJ5LnBlcmNlbnQsIDEwMCl9JTtiYWNrZ3JvdW5kOiR7ZW50cnkuaGV4fVwiPjwvZGl2PjwvZGl2PmA7XG4gICAgICBoaXN0SHRtbCArPSBgPHNwYW4gY2xhc3M9XCJjb2xvci1wZXJjZW50XCI+JHtlbnRyeS5wZXJjZW50LnRvRml4ZWQoMSl9JTwvc3Bhbj5gO1xuICAgICAgaGlzdEh0bWwgKz0gYDwvZGl2PmA7XG4gICAgfVxuICB9XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaWFnLWhpc3RvZ3JhbScpIS5pbm5lckhUTUwgPSBoaXN0SHRtbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbWFnZSBsb2FkaW5nIGFuZCBwcm9jZXNzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEltYWdlQmxvYih3aGljaDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBpbnZva2U8bnVtYmVyW10+KCdnZXRfaW1hZ2UnLCB7IHdoaWNoIH0pO1xuICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcyk7XG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiAnaW1hZ2UvcG5nJyB9KTtcbiAgcmV0dXJuIFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5JbWFnZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgc2V0U3RhdHVzKCdMb2FkaW5nLi4uJywgJ3Byb2Nlc3NpbmcnKTtcbiAgc2hvd1NwaW5uZXJzKCk7XG4gIHRyeSB7XG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IGludm9rZTxJbWFnZUluZm8+KCdvcGVuX2ltYWdlJywgeyBwYXRoIH0pO1xuICAgIHN0YXRlLmltYWdlTG9hZGVkID0gdHJ1ZTtcbiAgICBzdGF0ZS5pbWFnZVBhdGggPSBwYXRoO1xuICAgIHN0YXRlLmltYWdlSW5mbyA9IGluZm87XG4gICAgc3RhdGUuY29uZmlnID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUX0NPTkZJRykpO1xuICAgIHN0YXRlLmxvc3BlY1Jlc3VsdCA9IG51bGw7XG4gICAgc3RhdGUubG9zcGVjRXJyb3IgPSBudWxsO1xuICAgIHN0YXRlLnBhbGV0dGVDb2xvcnMgPSBudWxsO1xuXG4gICAgY29uc3QgZm5hbWUgPSBwYXRoLnNwbGl0KCcvJykucG9wKCkhLnNwbGl0KCdcXFxcJykucG9wKCkhO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmaWxlbmFtZScpIS50ZXh0Q29udGVudCA9IGZuYW1lO1xuXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3dlbGNvbWUnKSEuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnb3JpZ2luYWwtcGFuZScpIS5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcm9jZXNzZWQtcGFuZScpIS5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xuXG4gICAgY29uc3QgW29yaWdVcmwsIHByb2NVcmxdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgbG9hZEltYWdlQmxvYignb3JpZ2luYWwnKSxcbiAgICAgIGxvYWRJbWFnZUJsb2IoJ3Byb2Nlc3NlZCcpLFxuICAgIF0pO1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnb3JpZ2luYWwtaW1nJykgYXMgSFRNTEltYWdlRWxlbWVudCkuc3JjID0gb3JpZ1VybDtcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Byb2Nlc3NlZC1pbWcnKSBhcyBIVE1MSW1hZ2VFbGVtZW50KS5zcmMgPSBwcm9jVXJsO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdvcmlnaW5hbC1kaW1zJykhLnRleHRDb250ZW50ID0gYCR7aW5mby53aWR0aH1cXHUwMGQ3JHtpbmZvLmhlaWdodH1gO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcm9jZXNzZWQtZGltcycpIS50ZXh0Q29udGVudCA9IGAke2luZm8ud2lkdGh9XFx1MDBkNyR7aW5mby5oZWlnaHR9YDtcblxuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3MtcHJldmlldy1pbWcnKSBhcyBIVE1MSW1hZ2VFbGVtZW50KS5zcmMgPSBwcm9jVXJsO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5ncy1wcmV2aWV3LWltZycpIS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3Mtbm8taW1hZ2UnKSEuc3R5bGUuZGlzcGxheSA9ICdub25lJztcblxuICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgcmVuZGVyRGlhZ25vc3RpY3MoKTtcbiAgICBoaWRlU3Bpbm5lcnMoKTtcbiAgICBzZXRTdGF0dXMoYExvYWRlZCBcXHUyMDE0ICR7aW5mby53aWR0aH1cXHUwMGQ3JHtpbmZvLmhlaWdodH0sIGdyaWQ9JHtpbmZvLmdyaWRTaXplID8/ICdub25lJ30sICR7aW5mby51bmlxdWVDb2xvcnN9IGNvbG9yc2AsICdzdWNjZXNzJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBoaWRlU3Bpbm5lcnMoKTtcbiAgICBzZXRTdGF0dXMoJ0Vycm9yOiAnICsgZSwgJ2Vycm9yJyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYnVpbGRQcm9jZXNzQ29uZmlnKCk6IFByb2Nlc3NDb25maWcge1xuICBjb25zdCBjID0gc3RhdGUuY29uZmlnO1xuICByZXR1cm4ge1xuICAgIGdyaWRTaXplOiBjLmdyaWRTaXplLFxuICAgIGdyaWRQaGFzZVg6IGMuZ3JpZFBoYXNlWCxcbiAgICBncmlkUGhhc2VZOiBjLmdyaWRQaGFzZVksXG4gICAgbWF4R3JpZENhbmRpZGF0ZTogYy5tYXhHcmlkQ2FuZGlkYXRlID09PSAzMiA/IG51bGwgOiBjLm1heEdyaWRDYW5kaWRhdGUsXG4gICAgbm9HcmlkRGV0ZWN0OiBjLm5vR3JpZERldGVjdCxcbiAgICBkb3duc2NhbGVNb2RlOiBjLmRvd25zY2FsZU1vZGUsXG4gICAgYWFUaHJlc2hvbGQ6IGMuYWFUaHJlc2hvbGQsXG4gICAgcGFsZXR0ZU5hbWU6IGMucGFsZXR0ZU5hbWUsXG4gICAgYXV0b0NvbG9yczogYy5hdXRvQ29sb3JzLFxuICAgIGN1c3RvbVBhbGV0dGU6IGMuY3VzdG9tUGFsZXR0ZSxcbiAgICBub1F1YW50aXplOiBjLm5vUXVhbnRpemUsXG4gICAgcmVtb3ZlQmc6IGMucmVtb3ZlQmcsXG4gICAgYmdDb2xvcjogYy5iZ0NvbG9yLFxuICAgIGJvcmRlclRocmVzaG9sZDogYy5ib3JkZXJUaHJlc2hvbGQsXG4gICAgYmdUb2xlcmFuY2U6IGMuYmdUb2xlcmFuY2UsXG4gICAgZmxvb2RGaWxsOiBjLmZsb29kRmlsbCxcbiAgICBvdXRwdXRTY2FsZTogYy5vdXRwdXRTY2FsZSxcbiAgICBvdXRwdXRXaWR0aDogYy5vdXRwdXRXaWR0aCxcbiAgICBvdXRwdXRIZWlnaHQ6IGMub3V0cHV0SGVpZ2h0LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcm9jZXNzSW1hZ2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmICghc3RhdGUuaW1hZ2VMb2FkZWQgfHwgc3RhdGUucHJvY2Vzc2luZykgcmV0dXJuO1xuICBzdGF0ZS5wcm9jZXNzaW5nID0gdHJ1ZTtcbiAgc2V0U3RhdHVzKCdQcm9jZXNzaW5nLi4uJywgJ3Byb2Nlc3NpbmcnKTtcbiAgc2hvd1NwaW5uZXJzKCk7XG4gIGNvbnN0IHQwID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW52b2tlPFByb2Nlc3NSZXN1bHQ+KCdwcm9jZXNzJywgeyBwYzogYnVpbGRQcm9jZXNzQ29uZmlnKCkgfSk7XG4gICAgc3RhdGUuaW1hZ2VJbmZvID0geyAuLi5zdGF0ZS5pbWFnZUluZm8hLCAuLi5yZXN1bHQgfTtcblxuICAgIGNvbnN0IHByb2NVcmwgPSBhd2FpdCBsb2FkSW1hZ2VCbG9iKCdwcm9jZXNzZWQnKTtcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Byb2Nlc3NlZC1pbWcnKSBhcyBIVE1MSW1hZ2VFbGVtZW50KS5zcmMgPSBwcm9jVXJsO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcm9jZXNzZWQtZGltcycpIS50ZXh0Q29udGVudCA9IGAke3Jlc3VsdC53aWR0aH1cXHUwMGQ3JHtyZXN1bHQuaGVpZ2h0fWA7XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5ncy1wcmV2aWV3LWltZycpIGFzIEhUTUxJbWFnZUVsZW1lbnQpLnNyYyA9IHByb2NVcmw7XG5cbiAgICByZW5kZXJEaWFnbm9zdGljcygpO1xuICAgIGNvbnN0IGVsYXBzZWQgPSAoKHBlcmZvcm1hbmNlLm5vdygpIC0gdDApIC8gMTAwMCkudG9GaXhlZCgyKTtcbiAgICBzdGF0ZS5sYXN0UHJvY2Vzc1RpbWUgPSBwZXJmb3JtYW5jZS5ub3coKSAtIHQwO1xuICAgIHNldFN0YXR1cyhgUHJvY2Vzc2VkIFxcdTIwMTQgJHtyZXN1bHQud2lkdGh9XFx1MDBkNyR7cmVzdWx0LmhlaWdodH0sICR7cmVzdWx0LnVuaXF1ZUNvbG9yc30gY29sb3JzICgke2VsYXBzZWR9cylgLCAnc3VjY2VzcycpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgc2V0U3RhdHVzKCdFcnJvcjogJyArIGUsICdlcnJvcicpO1xuICB9IGZpbmFsbHkge1xuICAgIHN0YXRlLnByb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICBoaWRlU3Bpbm5lcnMoKTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZpbGUgZGlhbG9nc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGRvT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcGVuRGlhbG9nKHtcbiAgICAgIG11bHRpcGxlOiBmYWxzZSxcbiAgICAgIGZpbHRlcnM6IFt7XG4gICAgICAgIG5hbWU6ICdJbWFnZXMnLFxuICAgICAgICBleHRlbnNpb25zOiBbJ3BuZycsICdqcGcnLCAnanBlZycsICdnaWYnLCAnd2VicCcsICdibXAnXSxcbiAgICAgIH1dLFxuICAgIH0pO1xuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgIGF3YWl0IG9wZW5JbWFnZShyZXN1bHQpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHNldFN0YXR1cygnRXJyb3I6ICcgKyBlLCAnZXJyb3InKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBkb1NhdmUoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmICghc3RhdGUuaW1hZ2VMb2FkZWQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzYXZlRGlhbG9nKHtcbiAgICAgIGRlZmF1bHRQYXRoOiBzdGF0ZS5pbWFnZVBhdGggPyBzdGF0ZS5pbWFnZVBhdGgucmVwbGFjZSgvXFwuW14uXSskLywgJ19maXhlZC5wbmcnKSA6ICdvdXRwdXQucG5nJyxcbiAgICAgIGZpbHRlcnM6IFt7XG4gICAgICAgIG5hbWU6ICdQTkcgSW1hZ2UnLFxuICAgICAgICBleHRlbnNpb25zOiBbJ3BuZyddLFxuICAgICAgfV0sXG4gICAgfSk7XG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgYXdhaXQgaW52b2tlKCdzYXZlX2ltYWdlJywgeyBwYXRoOiByZXN1bHQgfSk7XG4gICAgICBzZXRTdGF0dXMoJ1NhdmVkOiAnICsgcmVzdWx0LnNwbGl0KCcvJykucG9wKCkhLnNwbGl0KCdcXFxcJykucG9wKCkhLCAnc3VjY2VzcycpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHNldFN0YXR1cygnRXJyb3I6ICcgKyBlLCAnZXJyb3InKTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEtleWJvYXJkIGhhbmRsaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gIC8vIFdoZW4gZm9jdXNlZCBvbiBhbiBhbHdheXMtdmlzaWJsZSBpbmxpbmUgaW5wdXQsIGhhbmRsZSBFbnRlci9Fc2NhcGUvVGFiXG4gIGlmICgoZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQpLmNsYXNzTGlzdD8uY29udGFpbnMoJ3NldHRpbmctaW5saW5lLWlucHV0JykpIHtcbiAgICBpZiAoZS5rZXkgPT09ICdFbnRlcicpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgICBjb21taXRFZGl0KHRhcmdldC5kYXRhc2V0LmtleSEsIHRhcmdldC52YWx1ZSk7XG4gICAgICB0YXJnZXQuYmx1cigpO1xuICAgIH0gZWxzZSBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuYmx1cigpO1xuICAgICAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgICB9IGVsc2UgaWYgKGUua2V5ID09PSAnVGFiJykge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmJsdXIoKTtcbiAgICAgIGN5Y2xlVGFiKGUuc2hpZnRLZXkgPyAtMSA6IDEpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBXaGVuIGZvY3VzZWQgb24gYW4gaW5saW5lIHNlbGVjdCwgbGV0IGl0IGhhbmRsZSBpdHMgb3duIGtleXMgZXhjZXB0IFRhYlxuICBpZiAoKGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50KS5jbGFzc0xpc3Q/LmNvbnRhaW5zKCdzZXR0aW5nLWlubGluZS1zZWxlY3QnKSkge1xuICAgIGlmIChlLmtleSA9PT0gJ1RhYicpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGN5Y2xlVGFiKGUuc2hpZnRLZXkgPyAtMSA6IDEpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBJZ25vcmUgb3RoZXIgdHlwaW5nIGluIGlucHV0cyAoc2hlZXQgaW5wdXRzLCBldGMuKVxuICBjb25zdCB0YWcgPSAoZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQpLnRhZ05hbWU7XG4gIGlmICh0YWcgPT09ICdJTlBVVCcgfHwgdGFnID09PSAnVEVYVEFSRUEnKSB7XG4gICAgLy8gU3RpbGwgYWxsb3cgVGFiIHRvIHN3aXRjaCB0YWJzIGZyb20gYW55IGlucHV0XG4gICAgaWYgKGUua2V5ID09PSAnVGFiJykgeyBlLnByZXZlbnREZWZhdWx0KCk7IGN5Y2xlVGFiKGUuc2hpZnRLZXkgPyAtMSA6IDEpOyB9XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qga2V5ID0gZS5rZXk7XG5cbiAgLy8gVGFiIHN3aXRjaGluZ1xuICBpZiAoa2V5ID09PSAnVGFiJykgeyBlLnByZXZlbnREZWZhdWx0KCk7IGN5Y2xlVGFiKGUuc2hpZnRLZXkgPyAtMSA6IDEpOyByZXR1cm47IH1cblxuICAvLyBHbG9iYWwgc2hvcnRjdXRzXG4gIGlmIChrZXkgPT09ICdvJykgeyBkb09wZW4oKTsgcmV0dXJuOyB9XG4gIGlmIChrZXkgPT09ICdzJykgeyBkb1NhdmUoKTsgcmV0dXJuOyB9XG4gIGlmIChrZXkgPT09ICcgJykgeyBlLnByZXZlbnREZWZhdWx0KCk7IHByb2Nlc3NJbWFnZSgpOyByZXR1cm47IH1cbiAgaWYgKGtleSA9PT0gJ3InKSB7IHJlc2V0Q29uZmlnKCk7IHJldHVybjsgfVxuICBpZiAoKGUuY3RybEtleSB8fCBlLm1ldGFLZXkpICYmIGtleSA9PT0gJ3EnKSB7IHdpbmRvdy5jbG9zZSgpOyByZXR1cm47IH1cblxuICAvLyBTZXR0aW5ncyBuYXZpZ2F0aW9uIChvbmx5IG9uIHNldHRpbmdzIHRhYiwgYmxvY2tlZCBkdXJpbmcgcHJvY2Vzc2luZylcbiAgaWYgKHN0YXRlLmFjdGl2ZVRhYiA9PT0gJ3NldHRpbmdzJyAmJiAhc3RhdGUucHJvY2Vzc2luZykge1xuICAgIGNvbnN0IHJvd3MgPSBnZXRTZXR0aW5nUm93cygpO1xuICAgIGlmIChrZXkgPT09ICdqJyB8fCBrZXkgPT09ICdBcnJvd0Rvd24nKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBzdGF0ZS5zZXR0aW5nc0ZvY3VzSW5kZXggPSBNYXRoLm1pbihzdGF0ZS5zZXR0aW5nc0ZvY3VzSW5kZXggKyAxLCByb3dzLmxlbmd0aCAtIDEpO1xuICAgICAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGtleSA9PT0gJ2snIHx8IGtleSA9PT0gJ0Fycm93VXAnKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBzdGF0ZS5zZXR0aW5nc0ZvY3VzSW5kZXggPSBNYXRoLm1heChzdGF0ZS5zZXR0aW5nc0ZvY3VzSW5kZXggLSAxLCAwKTtcbiAgICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChrZXkgPT09ICdFbnRlcicpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3Nbc3RhdGUuc2V0dGluZ3NGb2N1c0luZGV4XTtcbiAgICAgIGlmIChyb3cpIHN0YXJ0RWRpdGluZyhyb3cua2V5KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGtleSA9PT0gJ0VzY2FwZScpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHN3aXRjaFRhYigncHJldmlldycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoa2V5ID09PSAnbCcgfHwga2V5ID09PSAnQXJyb3dSaWdodCcpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3Nbc3RhdGUuc2V0dGluZ3NGb2N1c0luZGV4XTtcbiAgICAgIGlmIChyb3cpIHtcbiAgICAgICAgYWRqdXN0U2V0dGluZyhyb3cua2V5LCAxKTtcbiAgICAgICAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgICAgICAgYXV0b1Byb2Nlc3MoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGtleSA9PT0gJ2gnIHx8IGtleSA9PT0gJ0Fycm93TGVmdCcpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3Nbc3RhdGUuc2V0dGluZ3NGb2N1c0luZGV4XTtcbiAgICAgIGlmIChyb3cpIHtcbiAgICAgICAgYWRqdXN0U2V0dGluZyhyb3cua2V5LCAtMSk7XG4gICAgICAgIHJlbmRlclNldHRpbmdzKCk7XG4gICAgICAgIGF1dG9Qcm9jZXNzKCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG59KTtcblxuY29uc3QgVEFCUyA9IFsncHJldmlldycsICdzZXR0aW5ncycsICdkaWFnbm9zdGljcycsICdiYXRjaCcsICdzaGVldCddO1xuXG5mdW5jdGlvbiBjeWNsZVRhYihkaXI6IG51bWJlcik6IHZvaWQge1xuICBsZXQgaWR4ID0gVEFCUy5pbmRleE9mKHN0YXRlLmFjdGl2ZVRhYik7XG4gIGlkeCA9IChpZHggKyBkaXIgKyBUQUJTLmxlbmd0aCkgJSBUQUJTLmxlbmd0aDtcbiAgc3dpdGNoVGFiKFRBQlNbaWR4XSk7XG59XG5cbmZ1bmN0aW9uIHJlc2V0Q29uZmlnKCk6IHZvaWQge1xuICBzdGF0ZS5jb25maWcgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRfQ09ORklHKSk7XG4gIHN0YXRlLmxvc3BlY1Jlc3VsdCA9IG51bGw7XG4gIHN0YXRlLmxvc3BlY0Vycm9yID0gbnVsbDtcbiAgc3RhdGUucGFsZXR0ZUNvbG9ycyA9IG51bGw7XG4gIHJlbmRlclNldHRpbmdzKCk7XG4gIGlmIChzdGF0ZS5pbWFnZUxvYWRlZCkge1xuICAgIGF1dG9Qcm9jZXNzKCk7XG4gIH1cbiAgc2V0U3RhdHVzKCdDb25maWcgcmVzZXQgdG8gZGVmYXVsdHMnKTtcbn1cblxuLy8gQXV0by1wcm9jZXNzIHdpdGggZGVib3VuY2VcbmxldCBwcm9jZXNzVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5mdW5jdGlvbiBhdXRvUHJvY2VzcygpOiB2b2lkIHtcbiAgaWYgKCFzdGF0ZS5pbWFnZUxvYWRlZCkgcmV0dXJuO1xuICBpZiAocHJvY2Vzc1RpbWVyKSBjbGVhclRpbWVvdXQocHJvY2Vzc1RpbWVyKTtcbiAgcHJvY2Vzc1RpbWVyID0gc2V0VGltZW91dCgoKSA9PiBwcm9jZXNzSW1hZ2UoKSwgMTUwKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBCYXRjaCB0YWJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZW5kZXJCYXRjaCgpOiB2b2lkIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmF0Y2gtY29udGVudCcpITtcbiAgbGV0IGh0bWwgPSAnJztcblxuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiYmF0Y2gtc2VjdGlvblwiPic7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJiYXRjaC10aXRsZVwiPkJhdGNoIFByb2Nlc3Npbmc8L2Rpdj4nO1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiYmF0Y2gtZGVzY1wiPlByb2Nlc3MgbXVsdGlwbGUgaW1hZ2VzIHdpdGggdGhlIGN1cnJlbnQgcGlwZWxpbmUgc2V0dGluZ3MuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICAvLyBGaWxlIGxpc3RcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImJhdGNoLXNlY3Rpb25cIj4nO1xuICBodG1sICs9IGA8ZGl2IGNsYXNzPVwiYmF0Y2gtcm93XCI+PHNwYW4gY2xhc3M9XCJiYXRjaC1sYWJlbFwiPkZpbGVzPC9zcGFuPjxzcGFuIGNsYXNzPVwiYmF0Y2gtdmFsdWVcIj4ke3N0YXRlLmJhdGNoRmlsZXMubGVuZ3RofSBzZWxlY3RlZDwvc3Bhbj5gO1xuICBodG1sICs9IGA8YnV0dG9uIGNsYXNzPVwiYmF0Y2gtYnRuXCIgaWQ9XCJiYXRjaC1hZGQtZmlsZXNcIiR7c3RhdGUuYmF0Y2hSdW5uaW5nID8gJyBkaXNhYmxlZCcgOiAnJ30+QWRkIEZpbGVzPC9idXR0b24+YDtcbiAgaWYgKHN0YXRlLmJhdGNoRmlsZXMubGVuZ3RoID4gMCkge1xuICAgIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJiYXRjaC1idG4gYmF0Y2gtYnRuLWRpbVwiIGlkPVwiYmF0Y2gtY2xlYXItZmlsZXNcIiR7c3RhdGUuYmF0Y2hSdW5uaW5nID8gJyBkaXNhYmxlZCcgOiAnJ30+Q2xlYXI8L2J1dHRvbj5gO1xuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgaWYgKHN0YXRlLmJhdGNoRmlsZXMubGVuZ3RoID4gMCkge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJiYXRjaC1maWxlLWxpc3RcIj4nO1xuICAgIGZvciAoY29uc3QgZiBvZiBzdGF0ZS5iYXRjaEZpbGVzKSB7XG4gICAgICBjb25zdCBuYW1lID0gZi5zcGxpdCgnLycpLnBvcCgpIS5zcGxpdCgnXFxcXCcpLnBvcCgpITtcbiAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJiYXRjaC1maWxlXCI+JHtlc2NhcGVIdG1sKG5hbWUpfTwvZGl2PmA7XG4gICAgfVxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICAvLyBPdXRwdXQgZGlyZWN0b3J5XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJiYXRjaC1zZWN0aW9uXCI+JztcbiAgaHRtbCArPSBgPGRpdiBjbGFzcz1cImJhdGNoLXJvd1wiPjxzcGFuIGNsYXNzPVwiYmF0Y2gtbGFiZWxcIj5PdXRwdXQ8L3NwYW4+PHNwYW4gY2xhc3M9XCJiYXRjaC12YWx1ZVwiPiR7c3RhdGUuYmF0Y2hPdXRwdXREaXIgPyBlc2NhcGVIdG1sKHN0YXRlLmJhdGNoT3V0cHV0RGlyLnNwbGl0KCcvJykucG9wKCkhLnNwbGl0KCdcXFxcJykucG9wKCkhKSA6ICdub3Qgc2V0J308L3NwYW4+YDtcbiAgaHRtbCArPSBgPGJ1dHRvbiBjbGFzcz1cImJhdGNoLWJ0blwiIGlkPVwiYmF0Y2gtY2hvb3NlLWRpclwiJHtzdGF0ZS5iYXRjaFJ1bm5pbmcgPyAnIGRpc2FibGVkJyA6ICcnfT5DaG9vc2UgRm9sZGVyPC9idXR0b24+YDtcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICAvLyBSdW4gYnV0dG9uXG4gIGNvbnN0IGNhblJ1biA9IHN0YXRlLmJhdGNoRmlsZXMubGVuZ3RoID4gMCAmJiBzdGF0ZS5iYXRjaE91dHB1dERpciAmJiAhc3RhdGUuYmF0Y2hSdW5uaW5nO1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiYmF0Y2gtc2VjdGlvblwiPic7XG4gIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJiYXRjaC1idG4gYmF0Y2gtYnRuLXByaW1hcnlcIiBpZD1cImJhdGNoLXJ1blwiJHtjYW5SdW4gPyAnJyA6ICcgZGlzYWJsZWQnfT5Qcm9jZXNzIEFsbDwvYnV0dG9uPmA7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgLy8gUHJvZ3Jlc3NcbiAgaWYgKHN0YXRlLmJhdGNoUHJvZ3Jlc3MpIHtcbiAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKChzdGF0ZS5iYXRjaFByb2dyZXNzLmN1cnJlbnQgLyBzdGF0ZS5iYXRjaFByb2dyZXNzLnRvdGFsKSAqIDEwMCk7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImJhdGNoLXNlY3Rpb25cIj4nO1xuICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJiYXRjaC1wcm9ncmVzcy1pbmZvXCI+JHtzdGF0ZS5iYXRjaFByb2dyZXNzLmN1cnJlbnR9LyR7c3RhdGUuYmF0Y2hQcm9ncmVzcy50b3RhbH0gJm1kYXNoOyAke2VzY2FwZUh0bWwoc3RhdGUuYmF0Y2hQcm9ncmVzcy5maWxlbmFtZSl9PC9kaXY+YDtcbiAgICBodG1sICs9IGA8ZGl2IGNsYXNzPVwiYmF0Y2gtcHJvZ3Jlc3MtYmFyXCI+PGRpdiBjbGFzcz1cImJhdGNoLXByb2dyZXNzLWZpbGxcIiBzdHlsZT1cIndpZHRoOiR7cGN0fSVcIj48L2Rpdj48L2Rpdj5gO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH1cblxuICAvLyBSZXN1bHRzXG4gIGlmIChzdGF0ZS5iYXRjaFJlc3VsdCkge1xuICAgIGNvbnN0IHIgPSBzdGF0ZS5iYXRjaFJlc3VsdDtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiYmF0Y2gtc2VjdGlvblwiPic7XG4gICAgaHRtbCArPSBgPGRpdiBjbGFzcz1cImJhdGNoLXJlc3VsdC1zdW1tYXJ5XCI+JHtyLnN1Y2NlZWRlZH0gc3VjY2VlZGVkYDtcbiAgICBpZiAoci5mYWlsZWQubGVuZ3RoID4gMCkge1xuICAgICAgaHRtbCArPSBgLCA8c3BhbiBjbGFzcz1cImJhdGNoLXJlc3VsdC1mYWlsZWRcIj4ke3IuZmFpbGVkLmxlbmd0aH0gZmFpbGVkPC9zcGFuPmA7XG4gICAgfVxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgaWYgKHIuZmFpbGVkLmxlbmd0aCA+IDApIHtcbiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJiYXRjaC1lcnJvcnNcIj4nO1xuICAgICAgZm9yIChjb25zdCBmIG9mIHIuZmFpbGVkKSB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBmLnBhdGguc3BsaXQoJy8nKS5wb3AoKSEuc3BsaXQoJ1xcXFwnKS5wb3AoKSE7XG4gICAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJiYXRjaC1lcnJvclwiPiR7ZXNjYXBlSHRtbChuYW1lKX06ICR7ZXNjYXBlSHRtbChmLmVycm9yKX08L2Rpdj5gO1xuICAgICAgfVxuICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICB9XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfVxuXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGJhdGNoQWRkRmlsZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3BlbkRpYWxvZyh7XG4gICAgICBtdWx0aXBsZTogdHJ1ZSxcbiAgICAgIGZpbHRlcnM6IFt7XG4gICAgICAgIG5hbWU6ICdJbWFnZXMnLFxuICAgICAgICBleHRlbnNpb25zOiBbJ3BuZycsICdqcGcnLCAnanBlZycsICdnaWYnLCAnd2VicCcsICdibXAnXSxcbiAgICAgIH1dLFxuICAgIH0pO1xuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgIC8vIHJlc3VsdCBtYXkgYmUgYSBzdHJpbmcgb3IgYXJyYXkgZGVwZW5kaW5nIG9uIHNlbGVjdGlvblxuICAgICAgY29uc3QgcGF0aHMgPSBBcnJheS5pc0FycmF5KHJlc3VsdCkgPyByZXN1bHQgOiBbcmVzdWx0XTtcbiAgICAgIC8vIEFkZCB0byBleGlzdGluZyBsaXN0LCBkZWR1cFxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBuZXcgU2V0KHN0YXRlLmJhdGNoRmlsZXMpO1xuICAgICAgZm9yIChjb25zdCBwIG9mIHBhdGhzKSB7XG4gICAgICAgIGlmIChwICYmICFleGlzdGluZy5oYXMocCkpIHtcbiAgICAgICAgICBzdGF0ZS5iYXRjaEZpbGVzLnB1c2gocCk7XG4gICAgICAgICAgZXhpc3RpbmcuYWRkKHApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZW5kZXJCYXRjaCgpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHNldFN0YXR1cygnRXJyb3I6ICcgKyBlLCAnZXJyb3InKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBiYXRjaENob29zZURpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcGVuRGlhbG9nKHtcbiAgICAgIGRpcmVjdG9yeTogdHJ1ZSxcbiAgICB9KTtcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICBzdGF0ZS5iYXRjaE91dHB1dERpciA9IEFycmF5LmlzQXJyYXkocmVzdWx0KSA/IHJlc3VsdFswXSA6IHJlc3VsdDtcbiAgICAgIHJlbmRlckJhdGNoKCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgc2V0U3RhdHVzKCdFcnJvcjogJyArIGUsICdlcnJvcicpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGJhdGNoUnVuKCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoc3RhdGUuYmF0Y2hSdW5uaW5nIHx8IHN0YXRlLmJhdGNoRmlsZXMubGVuZ3RoID09PSAwIHx8ICFzdGF0ZS5iYXRjaE91dHB1dERpcikgcmV0dXJuO1xuICBzdGF0ZS5iYXRjaFJ1bm5pbmcgPSB0cnVlO1xuICBzdGF0ZS5iYXRjaFJlc3VsdCA9IG51bGw7XG4gIHN0YXRlLmJhdGNoUHJvZ3Jlc3MgPSB7IGN1cnJlbnQ6IDAsIHRvdGFsOiBzdGF0ZS5iYXRjaEZpbGVzLmxlbmd0aCwgZmlsZW5hbWU6ICcnIH07XG4gIHJlbmRlckJhdGNoKCk7XG4gIHNldFN0YXR1cygnQmF0Y2ggcHJvY2Vzc2luZy4uLicsICdwcm9jZXNzaW5nJyk7XG5cbiAgLy8gTGlzdGVuIGZvciBwcm9ncmVzcyBldmVudHNcbiAgY29uc3QgdW5saXN0ZW4gPSBhd2FpdCB3aW5kb3cuX19UQVVSSV9fLmV2ZW50Lmxpc3RlbignYmF0Y2gtcHJvZ3Jlc3MnLCAoZXZlbnQ6IHsgcGF5bG9hZDogeyBjdXJyZW50OiBudW1iZXI7IHRvdGFsOiBudW1iZXI7IGZpbGVuYW1lOiBzdHJpbmcgfSB9KSA9PiB7XG4gICAgc3RhdGUuYmF0Y2hQcm9ncmVzcyA9IGV2ZW50LnBheWxvYWQ7XG4gICAgcmVuZGVyQmF0Y2goKTtcbiAgfSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbnZva2U8eyBzdWNjZWVkZWQ6IG51bWJlcjsgZmFpbGVkOiB7IHBhdGg6IHN0cmluZzsgZXJyb3I6IHN0cmluZyB9W10gfT4oJ2JhdGNoX3Byb2Nlc3MnLCB7XG4gICAgICBpbnB1dFBhdGhzOiBzdGF0ZS5iYXRjaEZpbGVzLFxuICAgICAgb3V0cHV0RGlyOiBzdGF0ZS5iYXRjaE91dHB1dERpcixcbiAgICAgIHBjOiBidWlsZFByb2Nlc3NDb25maWcoKSxcbiAgICAgIG92ZXJ3cml0ZTogZmFsc2UsXG4gICAgfSk7XG4gICAgc3RhdGUuYmF0Y2hSZXN1bHQgPSByZXN1bHQ7XG4gICAgc2V0U3RhdHVzKGBCYXRjaCBkb25lOiAke3Jlc3VsdC5zdWNjZWVkZWR9IHN1Y2NlZWRlZCwgJHtyZXN1bHQuZmFpbGVkLmxlbmd0aH0gZmFpbGVkYCwgcmVzdWx0LmZhaWxlZC5sZW5ndGggPiAwID8gJ2Vycm9yJyA6ICdzdWNjZXNzJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBzZXRTdGF0dXMoJ0JhdGNoIGVycm9yOiAnICsgZSwgJ2Vycm9yJyk7XG4gIH0gZmluYWxseSB7XG4gICAgc3RhdGUuYmF0Y2hSdW5uaW5nID0gZmFsc2U7XG4gICAgc3RhdGUuYmF0Y2hQcm9ncmVzcyA9IG51bGw7XG4gICAgaWYgKHR5cGVvZiB1bmxpc3RlbiA9PT0gJ2Z1bmN0aW9uJykgdW5saXN0ZW4oKTtcbiAgICByZW5kZXJCYXRjaCgpO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2hlZXQgdGFiXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVuZGVyU2hlZXQoKTogdm9pZCB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0LWNvbnRlbnQnKSE7XG4gIGNvbnN0IHNjID0gc3RhdGUuc2hlZXRDb25maWc7XG4gIGNvbnN0IGRpcyA9IHN0YXRlLnNoZWV0UHJvY2Vzc2luZyA/ICcgZGlzYWJsZWQnIDogJyc7XG4gIGxldCBodG1sID0gJyc7XG5cbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LXNlY3Rpb25cIj4nO1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtdGl0bGVcIj5TcHJpdGUgU2hlZXQgUHJvY2Vzc2luZzwvZGl2Pic7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1kZXNjXCI+U3BsaXQgYSBzcHJpdGUgc2hlZXQgaW50byBpbmRpdmlkdWFsIHRpbGVzLCBydW4gdGhlIG5vcm1hbGl6ZSBwaXBlbGluZSBvbiBlYWNoIG9uZSwgdGhlbiByZWFzc2VtYmxlIGludG8gYSBjbGVhbiBzaGVldC4gWW91IGNhbiBhbHNvIGV4cG9ydCBlYWNoIHRpbGUgYXMgYSBzZXBhcmF0ZSBmaWxlLjwvZGl2Pic7XG4gIGlmICghc3RhdGUuaW1hZ2VMb2FkZWQpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtZGVzY1wiIHN0eWxlPVwiY29sb3I6dmFyKC0teWVsbG93KTttYXJnaW4tdG9wOjZweFwiPkxvYWQgYW4gaW1hZ2UgZmlyc3QgaW4gdGhlIFByZXZpZXcgdGFiLjwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICAvLyBNb2RlIHRvZ2dsZVxuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2VjdGlvblwiPic7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZXR0aW5nLWxhYmVsXCIgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjRweFwiPlNwbGl0IE1vZGU8L2Rpdj4nO1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtbW9kZS10b2dnbGVcIj4nO1xuICBodG1sICs9IGA8YnV0dG9uIGNsYXNzPVwic2hlZXQtbW9kZS1idG4ke3N0YXRlLnNoZWV0TW9kZSA9PT0gJ2ZpeGVkJyA/ICcgYWN0aXZlJyA6ICcnfVwiIGRhdGEtbW9kZT1cImZpeGVkXCI+Rml4ZWQgR3JpZDwvYnV0dG9uPmA7XG4gIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJzaGVldC1tb2RlLWJ0biR7c3RhdGUuc2hlZXRNb2RlID09PSAnYXV0bycgPyAnIGFjdGl2ZScgOiAnJ31cIiBkYXRhLW1vZGU9XCJhdXRvXCI+QXV0by1TcGxpdDwvYnV0dG9uPmA7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmIChzdGF0ZS5zaGVldE1vZGUgPT09ICdmaXhlZCcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtaGVscFwiPlVzZSB3aGVuIHlvdXIgc2hlZXQgaGFzIGEgdW5pZm9ybSBncmlkICZtZGFzaDsgYWxsIHRpbGVzIGFyZSB0aGUgc2FtZSBzaXplIHdpdGggY29uc2lzdGVudCBzcGFjaW5nLjwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWhlbHBcIj5Vc2Ugd2hlbiB0aWxlcyBhcmUgZGlmZmVyZW50IHNpemVzIG9yIGlycmVndWxhcmx5IHBsYWNlZC4gRGV0ZWN0cyBzcHJpdGVzIGF1dG9tYXRpY2FsbHkgYnkgZmluZGluZyBzZXBhcmF0b3Igcm93cy9jb2x1bW5zIGluIHRoZSBpbWFnZS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgLy8gTW9kZS1zcGVjaWZpYyBzZXR0aW5nc1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2VjdGlvblwiPic7XG4gIGlmIChzdGF0ZS5zaGVldE1vZGUgPT09ICdmaXhlZCcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2V0dGluZ1wiPjxzcGFuIGNsYXNzPVwic2hlZXQtc2V0dGluZy1sYWJlbFwiPlRpbGUgV2lkdGg8L3NwYW4+JztcbiAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9XCJzaGVldC1pbnB1dFwiIHR5cGU9XCJudW1iZXJcIiBpZD1cInNoZWV0LXR3XCIgdmFsdWU9XCIke3NjLnRpbGVXaWR0aCA/PyAnJ31cIiBwbGFjZWhvbGRlcj1cInB4XCIke2Rpc30+PC9kaXY+YDtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtaGVscFwiPldpZHRoIG9mIGVhY2ggdGlsZSBpbiBwaXhlbHMuIFJlcXVpcmVkLjwvZGl2Pic7XG5cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2V0dGluZ1wiPjxzcGFuIGNsYXNzPVwic2hlZXQtc2V0dGluZy1sYWJlbFwiPlRpbGUgSGVpZ2h0PC9zcGFuPic7XG4gICAgaHRtbCArPSBgPGlucHV0IGNsYXNzPVwic2hlZXQtaW5wdXRcIiB0eXBlPVwibnVtYmVyXCIgaWQ9XCJzaGVldC10aFwiIHZhbHVlPVwiJHtzYy50aWxlSGVpZ2h0ID8/ICcnfVwiIHBsYWNlaG9sZGVyPVwicHhcIiR7ZGlzfT48L2Rpdj5gO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1oZWxwXCI+SGVpZ2h0IG9mIGVhY2ggdGlsZSBpbiBwaXhlbHMuIFJlcXVpcmVkLjwvZGl2Pic7XG5cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2V0dGluZ1wiPjxzcGFuIGNsYXNzPVwic2hlZXQtc2V0dGluZy1sYWJlbFwiPlNwYWNpbmc8L3NwYW4+JztcbiAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9XCJzaGVldC1pbnB1dFwiIHR5cGU9XCJudW1iZXJcIiBpZD1cInNoZWV0LXNwXCIgdmFsdWU9XCIke3NjLnNwYWNpbmd9XCIgcGxhY2Vob2xkZXI9XCIwXCIke2Rpc30+PC9kaXY+YDtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtaGVscFwiPkdhcCBiZXR3ZWVuIHRpbGVzIGluIHBpeGVscy4gU2V0IHRvIDAgaWYgdGlsZXMgYXJlIHBhY2tlZCBlZGdlLXRvLWVkZ2UuPC9kaXY+JztcblxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZXR0aW5nXCI+PHNwYW4gY2xhc3M9XCJzaGVldC1zZXR0aW5nLWxhYmVsXCI+TWFyZ2luPC9zcGFuPic7XG4gICAgaHRtbCArPSBgPGlucHV0IGNsYXNzPVwic2hlZXQtaW5wdXRcIiB0eXBlPVwibnVtYmVyXCIgaWQ9XCJzaGVldC1tZ1wiIHZhbHVlPVwiJHtzYy5tYXJnaW59XCIgcGxhY2Vob2xkZXI9XCIwXCIke2Rpc30+PC9kaXY+YDtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtaGVscFwiPkJvcmRlciBhcm91bmQgdGhlIGVudGlyZSBzaGVldCBpbiBwaXhlbHMuIFVzdWFsbHkgMC48L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZXR0aW5nXCI+PHNwYW4gY2xhc3M9XCJzaGVldC1zZXR0aW5nLWxhYmVsXCI+U2VwLiBUaHJlc2hvbGQ8L3NwYW4+JztcbiAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9XCJzaGVldC1pbnB1dFwiIHR5cGU9XCJudW1iZXJcIiBpZD1cInNoZWV0LXNlcFwiIHZhbHVlPVwiJHtzYy5zZXBhcmF0b3JUaHJlc2hvbGR9XCIgc3RlcD1cIjAuMDVcIiBtaW49XCIwXCIgbWF4PVwiMVwiJHtkaXN9PjwvZGl2PmA7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWhlbHBcIj5Ib3cgdW5pZm9ybSBhIHJvdy9jb2x1bW4gbXVzdCBiZSB0byBjb3VudCBhcyBhIHNlcGFyYXRvciAoMCZuZGFzaDsxKS4gSGlnaGVyID0gc3RyaWN0ZXIuIDAuOTAgd29ya3MgZm9yIG1vc3Qgc2hlZXRzLjwvZGl2Pic7XG5cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2V0dGluZ1wiPjxzcGFuIGNsYXNzPVwic2hlZXQtc2V0dGluZy1sYWJlbFwiPk1pbiBTcHJpdGUgU2l6ZTwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gYDxpbnB1dCBjbGFzcz1cInNoZWV0LWlucHV0XCIgdHlwZT1cIm51bWJlclwiIGlkPVwic2hlZXQtbWluXCIgdmFsdWU9XCIke3NjLm1pblNwcml0ZVNpemV9XCIgbWluPVwiMVwiJHtkaXN9PjwvZGl2PmA7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWhlbHBcIj5JZ25vcmUgZGV0ZWN0ZWQgcmVnaW9ucyBzbWFsbGVyIHRoYW4gdGhpcyBtYW55IHBpeGVscy4gRmlsdGVycyBvdXQgbm9pc2UgYW5kIHRpbnkgZnJhZ21lbnRzLjwvZGl2Pic7XG5cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2V0dGluZ1wiPjxzcGFuIGNsYXNzPVwic2hlZXQtc2V0dGluZy1sYWJlbFwiPlBhZGRpbmc8L3NwYW4+JztcbiAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9XCJzaGVldC1pbnB1dFwiIHR5cGU9XCJudW1iZXJcIiBpZD1cInNoZWV0LXBhZFwiIHZhbHVlPVwiJHtzYy5wYWR9XCIgbWluPVwiMFwiJHtkaXN9PjwvZGl2PmA7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWhlbHBcIj5FeHRyYSBwaXhlbHMgdG8gaW5jbHVkZSBhcm91bmQgZWFjaCBkZXRlY3RlZCBzcHJpdGUuIFVzZWZ1bCBpZiBhdXRvLWRldGVjdGlvbiBjcm9wcyB0b28gdGlnaHRseS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgLy8gU2tpcCBub3JtYWxpemUgdG9nZ2xlXG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZWN0aW9uXCI+JztcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LXNldHRpbmdcIj48c3BhbiBjbGFzcz1cInNoZWV0LXNldHRpbmctbGFiZWxcIj5Ta2lwIE5vcm1hbGl6ZTwvc3Bhbj4nO1xuICBodG1sICs9IGA8YnV0dG9uIGNsYXNzPVwiYmF0Y2gtYnRuIGJhdGNoLWJ0bi1kaW1cIiBpZD1cInNoZWV0LW5vLW5vcm1hbGl6ZVwiIHN0eWxlPVwibWluLXdpZHRoOjQwcHhcIiR7ZGlzfT4ke3NjLm5vTm9ybWFsaXplID8gJ29uJyA6ICdvZmYnfTwvYnV0dG9uPjwvZGl2PmA7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1oZWxwXCI+V2hlbiBvbiwgdGlsZXMgYXJlIHNwbGl0IGFuZCByZWFzc2VtYmxlZCB3aXRob3V0IHJ1bm5pbmcgdGhlIHBpcGVsaW5lLiBVc2VmdWwgZm9yIGp1c3QgZXh0cmFjdGluZyBvciByZWFycmFuZ2luZyB0aWxlcy48L2Rpdj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuXG4gIC8vIEFjdGlvbiBidXR0b25zXG4gIGNvbnN0IGNhbkFjdCA9IHN0YXRlLmltYWdlTG9hZGVkICYmICFzdGF0ZS5zaGVldFByb2Nlc3Npbmc7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZWN0aW9uXCI+JztcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWFjdGlvbnNcIj4nO1xuICBodG1sICs9IGA8YnV0dG9uIGNsYXNzPVwiYmF0Y2gtYnRuXCIgaWQ9XCJzaGVldC1wcmV2aWV3LWJ0blwiJHtjYW5BY3QgPyAnJyA6ICcgZGlzYWJsZWQnfT5QcmV2aWV3IFNwbGl0PC9idXR0b24+YDtcbiAgaHRtbCArPSBgPGJ1dHRvbiBjbGFzcz1cImJhdGNoLWJ0biBiYXRjaC1idG4tcHJpbWFyeVwiIGlkPVwic2hlZXQtcHJvY2Vzcy1idG5cIiR7Y2FuQWN0ID8gJycgOiAnIGRpc2FibGVkJ30+UHJvY2VzcyBTaGVldDwvYnV0dG9uPmA7XG4gIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJiYXRjaC1idG5cIiBpZD1cInNoZWV0LXNhdmUtdGlsZXMtYnRuXCIke3N0YXRlLnNoZWV0UHJldmlldyAmJiAhc3RhdGUuc2hlZXRQcm9jZXNzaW5nID8gJycgOiAnIGRpc2FibGVkJ30+U2F2ZSBUaWxlczwvYnV0dG9uPmA7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1oZWxwXCI+PHN0cm9uZz5QcmV2aWV3IFNwbGl0PC9zdHJvbmc+IHNob3dzIGhvdyBtYW55IHRpbGVzIHdpbGwgYmUgZXh0cmFjdGVkLiA8c3Ryb25nPlByb2Nlc3MgU2hlZXQ8L3N0cm9uZz4gcnVucyB0aGUgbm9ybWFsaXplIHBpcGVsaW5lIG9uIGVhY2ggdGlsZSBhbmQgcmVhc3NlbWJsZXMuIDxzdHJvbmc+U2F2ZSBUaWxlczwvc3Ryb25nPiBleHBvcnRzIGVhY2ggdGlsZSBhcyBhIHNlcGFyYXRlIFBORy48L2Rpdj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuXG4gIC8vIFByZXZpZXcgaW5mb1xuICBpZiAoc3RhdGUuc2hlZXRQcmV2aWV3KSB7XG4gICAgY29uc3QgcCA9IHN0YXRlLnNoZWV0UHJldmlldztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2VjdGlvblwiPic7XG4gICAgaHRtbCArPSBgPGRpdiBjbGFzcz1cInNoZWV0LWluZm9cIj4ke3AudGlsZUNvdW50fSB0aWxlcyAmbWRhc2g7ICR7cC5jb2xzfVxcdTAwZDcke3Aucm93c30gZ3JpZCAmbWRhc2g7ICR7cC50aWxlV2lkdGh9XFx1MDBkNyR7cC50aWxlSGVpZ2h0fXB4IGVhY2g8L2Rpdj5gO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgICAvLyBHSUYgYW5pbWF0aW9uIHNlY3Rpb25cbiAgICBjb25zdCBnaWZEaXMgPSBzdGF0ZS5naWZHZW5lcmF0aW5nID8gJyBkaXNhYmxlZCcgOiAnJztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2VjdGlvblwiPic7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LXRpdGxlXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjRweFwiPkdJRiBBbmltYXRpb248L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1oZWxwXCI+R2VuZXJhdGUgYW4gYW5pbWF0ZWQgR0lGIGZyb20gdGhlIHByb2Nlc3NlZCB0aWxlcy4gUHJldmlldyBpdCBoZXJlIG9yIGV4cG9ydCB0byBhIGZpbGUuPC9kaXY+JztcblxuICAgIC8vIE1vZGUgdG9nZ2xlXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LXNldHRpbmdcIj48c3BhbiBjbGFzcz1cInNoZWV0LXNldHRpbmctbGFiZWxcIj5BbmltYXRlPC9zcGFuPic7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LW1vZGUtdG9nZ2xlXCI+JztcbiAgICBodG1sICs9IGA8YnV0dG9uIGNsYXNzPVwic2hlZXQtbW9kZS1idG4gZ2lmLW1vZGUtYnRuJHtzdGF0ZS5naWZNb2RlID09PSAncm93JyA/ICcgYWN0aXZlJyA6ICcnfVwiIGRhdGEtZ2lmLW1vZGU9XCJyb3dcIiR7Z2lmRGlzfT5CeSBSb3c8L2J1dHRvbj5gO1xuICAgIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJzaGVldC1tb2RlLWJ0biBnaWYtbW9kZS1idG4ke3N0YXRlLmdpZk1vZGUgPT09ICdhbGwnID8gJyBhY3RpdmUnIDogJyd9XCIgZGF0YS1naWYtbW9kZT1cImFsbFwiJHtnaWZEaXN9PkVudGlyZSBTaGVldDwvYnV0dG9uPmA7XG4gICAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcblxuICAgIC8vIFJvdyBzZWxlY3RvciAocm93IG1vZGUgb25seSlcbiAgICBpZiAoc3RhdGUuZ2lmTW9kZSA9PT0gJ3JvdycpIHtcbiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZXR0aW5nXCI+PHNwYW4gY2xhc3M9XCJzaGVldC1zZXR0aW5nLWxhYmVsXCI+Um93PC9zcGFuPic7XG4gICAgICBodG1sICs9IGA8aW5wdXQgY2xhc3M9XCJzaGVldC1pbnB1dFwiIHR5cGU9XCJudW1iZXJcIiBpZD1cImdpZi1yb3dcIiB2YWx1ZT1cIiR7c3RhdGUuZ2lmUm93fVwiIG1pbj1cIjBcIiBtYXg9XCIke3Aucm93cyAtIDF9XCIke2dpZkRpc30+PC9kaXY+YDtcbiAgICAgIGh0bWwgKz0gYDxkaXYgY2xhc3M9XCJzaGVldC1oZWxwXCI+V2hpY2ggcm93IHRvIGFuaW1hdGUgKDBcXHUyMDEzJHtwLnJvd3MgLSAxfSkuIEVhY2ggcm93IGJlY29tZXMgb25lIGFuaW1hdGlvbiBzZXF1ZW5jZS48L2Rpdj5gO1xuICAgIH1cblxuICAgIC8vIEZQUyBpbnB1dFxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1zZXR0aW5nXCI+PHNwYW4gY2xhc3M9XCJzaGVldC1zZXR0aW5nLWxhYmVsXCI+RnJhbWUgUmF0ZTwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gYDxpbnB1dCBjbGFzcz1cInNoZWV0LWlucHV0XCIgdHlwZT1cIm51bWJlclwiIGlkPVwiZ2lmLWZwc1wiIHZhbHVlPVwiJHtzdGF0ZS5naWZGcHN9XCIgbWluPVwiMVwiIG1heD1cIjEwMFwiJHtnaWZEaXN9PjwvZGl2PmA7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWhlbHBcIj5GcmFtZXMgcGVyIHNlY29uZCAoMVxcdTIwMTMxMDApLiAxMCBmcHMgaXMgYSBnb29kIGRlZmF1bHQgZm9yIHBpeGVsIGFydCBhbmltYXRpb25zLjwvZGl2Pic7XG5cbiAgICAvLyBBY3Rpb24gYnV0dG9uc1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzaGVldC1hY3Rpb25zXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjRweFwiPic7XG4gICAgaHRtbCArPSBgPGJ1dHRvbiBjbGFzcz1cImJhdGNoLWJ0biBiYXRjaC1idG4tcHJpbWFyeVwiIGlkPVwiZ2lmLXByZXZpZXctYnRuXCIke2dpZkRpc30+UHJldmlldyBHSUY8L2J1dHRvbj5gO1xuICAgIGh0bWwgKz0gYDxidXR0b24gY2xhc3M9XCJiYXRjaC1idG5cIiBpZD1cImdpZi1leHBvcnQtYnRuXCIke3N0YXRlLmdpZlByZXZpZXdVcmwgJiYgIXN0YXRlLmdpZkdlbmVyYXRpbmcgPyAnJyA6ICcgZGlzYWJsZWQnfT5FeHBvcnQgR0lGPC9idXR0b24+YDtcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuXG4gICAgLy8gR2VuZXJhdGluZyBpbmRpY2F0b3JcbiAgICBpZiAoc3RhdGUuZ2lmR2VuZXJhdGluZykge1xuICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNoZWV0LWluZm9cIiBzdHlsZT1cImNvbG9yOnZhcigtLW1hdXZlKTttYXJnaW4tdG9wOjZweFwiPkdlbmVyYXRpbmcgR0lGLi4uPC9kaXY+JztcbiAgICB9XG5cbiAgICAvLyBQcmV2aWV3IGFyZWFcbiAgICBpZiAoc3RhdGUuZ2lmUHJldmlld1VybCkge1xuICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImdpZi1wcmV2aWV3LWNvbnRhaW5lclwiPic7XG4gICAgICBodG1sICs9IGA8aW1nIGNsYXNzPVwiZ2lmLXByZXZpZXctaW1nXCIgc3JjPVwiJHtzdGF0ZS5naWZQcmV2aWV3VXJsfVwiIGFsdD1cIkdJRiBQcmV2aWV3XCI+YDtcbiAgICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfVxuXG4gIGlmIChzdGF0ZS5zaGVldFByb2Nlc3NpbmcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2hlZXQtc2VjdGlvblwiPjxkaXYgY2xhc3M9XCJzaGVldC1pbmZvXCIgc3R5bGU9XCJjb2xvcjp2YXIoLS1tYXV2ZSlcIj5Qcm9jZXNzaW5nLi4uPC9kaXY+PC9kaXY+JztcbiAgfVxuXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59XG5cbmZ1bmN0aW9uIHJlYWRTaGVldENvbmZpZygpOiB2b2lkIHtcbiAgY29uc3Qgc2MgPSBzdGF0ZS5zaGVldENvbmZpZztcbiAgaWYgKHN0YXRlLnNoZWV0TW9kZSA9PT0gJ2ZpeGVkJykge1xuICAgIGNvbnN0IHR3ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0LXR3JykgYXMgSFRNTElucHV0RWxlbWVudCB8IG51bGw7XG4gICAgY29uc3QgdGggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXQtdGgnKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzaGVldC1zcCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBudWxsO1xuICAgIGNvbnN0IG1nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0LW1nJykgYXMgSFRNTElucHV0RWxlbWVudCB8IG51bGw7XG4gICAgaWYgKHR3KSB7IGNvbnN0IHYgPSBwYXJzZUludCh0dy52YWx1ZSk7IHNjLnRpbGVXaWR0aCA9IGlzTmFOKHYpIHx8IHYgPCAxID8gbnVsbCA6IHY7IH1cbiAgICBpZiAodGgpIHsgY29uc3QgdiA9IHBhcnNlSW50KHRoLnZhbHVlKTsgc2MudGlsZUhlaWdodCA9IGlzTmFOKHYpIHx8IHYgPCAxID8gbnVsbCA6IHY7IH1cbiAgICBpZiAoc3ApIHsgY29uc3QgdiA9IHBhcnNlSW50KHNwLnZhbHVlKTsgc2Muc3BhY2luZyA9IGlzTmFOKHYpID8gMCA6IE1hdGgubWF4KDAsIHYpOyB9XG4gICAgaWYgKG1nKSB7IGNvbnN0IHYgPSBwYXJzZUludChtZy52YWx1ZSk7IHNjLm1hcmdpbiA9IGlzTmFOKHYpID8gMCA6IE1hdGgubWF4KDAsIHYpOyB9XG4gIH0gZWxzZSB7XG4gICAgY29uc3Qgc2VwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NoZWV0LXNlcCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBudWxsO1xuICAgIGNvbnN0IG1pbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzaGVldC1taW4nKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICBjb25zdCBwYWQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXQtcGFkJykgYXMgSFRNTElucHV0RWxlbWVudCB8IG51bGw7XG4gICAgaWYgKHNlcCkgeyBjb25zdCB2ID0gcGFyc2VGbG9hdChzZXAudmFsdWUpOyBzYy5zZXBhcmF0b3JUaHJlc2hvbGQgPSBpc05hTih2KSA/IDAuOTAgOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCB2KSk7IH1cbiAgICBpZiAobWluKSB7IGNvbnN0IHYgPSBwYXJzZUludChtaW4udmFsdWUpOyBzYy5taW5TcHJpdGVTaXplID0gaXNOYU4odikgPyA4IDogTWF0aC5tYXgoMSwgdik7IH1cbiAgICBpZiAocGFkKSB7IGNvbnN0IHYgPSBwYXJzZUludChwYWQudmFsdWUpOyBzYy5wYWQgPSBpc05hTih2KSA/IDAgOiBNYXRoLm1heCgwLCB2KTsgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGJ1aWxkU2hlZXRBcmdzKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgY29uc3Qgc2MgPSBzdGF0ZS5zaGVldENvbmZpZztcbiAgcmV0dXJuIHtcbiAgICBtb2RlOiBzdGF0ZS5zaGVldE1vZGUsXG4gICAgdGlsZVdpZHRoOiBzYy50aWxlV2lkdGgsXG4gICAgdGlsZUhlaWdodDogc2MudGlsZUhlaWdodCxcbiAgICBzcGFjaW5nOiBzYy5zcGFjaW5nLFxuICAgIG1hcmdpbjogc2MubWFyZ2luLFxuICAgIHNlcGFyYXRvclRocmVzaG9sZDogc2Muc2VwYXJhdG9yVGhyZXNob2xkLFxuICAgIG1pblNwcml0ZVNpemU6IHNjLm1pblNwcml0ZVNpemUsXG4gICAgcGFkOiBzYy5wYWQsXG4gICAgbm9Ob3JtYWxpemU6IHNjLm5vTm9ybWFsaXplIHx8IG51bGwsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNoZWV0UHJldmlld0FjdGlvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKCFzdGF0ZS5pbWFnZUxvYWRlZCB8fCBzdGF0ZS5zaGVldFByb2Nlc3NpbmcpIHJldHVybjtcbiAgcmVhZFNoZWV0Q29uZmlnKCk7XG4gIHN0YXRlLnNoZWV0UHJvY2Vzc2luZyA9IHRydWU7XG4gIHJlbmRlclNoZWV0KCk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW52b2tlPHsgdGlsZUNvdW50OiBudW1iZXI7IHRpbGVXaWR0aDogbnVtYmVyOyB0aWxlSGVpZ2h0OiBudW1iZXI7IGNvbHM6IG51bWJlcjsgcm93czogbnVtYmVyIH0+KCdzaGVldF9wcmV2aWV3JywgYnVpbGRTaGVldEFyZ3MoKSk7XG4gICAgc3RhdGUuc2hlZXRQcmV2aWV3ID0gcmVzdWx0O1xuICAgIHNldFN0YXR1cyhgU2hlZXQ6ICR7cmVzdWx0LnRpbGVDb3VudH0gdGlsZXMgKCR7cmVzdWx0LmNvbHN9XFx1MDBkNyR7cmVzdWx0LnJvd3N9KWAsICdzdWNjZXNzJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBzZXRTdGF0dXMoJ1NoZWV0IGVycm9yOiAnICsgZSwgJ2Vycm9yJyk7XG4gICAgc3RhdGUuc2hlZXRQcmV2aWV3ID0gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICBzdGF0ZS5zaGVldFByb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICByZW5kZXJTaGVldCgpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNoZWV0UHJvY2Vzc0FjdGlvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKCFzdGF0ZS5pbWFnZUxvYWRlZCB8fCBzdGF0ZS5zaGVldFByb2Nlc3NpbmcpIHJldHVybjtcbiAgcmVhZFNoZWV0Q29uZmlnKCk7XG4gIHN0YXRlLnNoZWV0UHJvY2Vzc2luZyA9IHRydWU7XG4gIHN0YXRlLmdpZlByZXZpZXdVcmwgPSBudWxsO1xuICByZW5kZXJTaGVldCgpO1xuICBzZXRTdGF0dXMoJ1Byb2Nlc3Npbmcgc2hlZXQuLi4nLCAncHJvY2Vzc2luZycpO1xuICBjb25zdCB0MCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICB0cnkge1xuICAgIGNvbnN0IGFyZ3MgPSB7IC4uLmJ1aWxkU2hlZXRBcmdzKCksIHBjOiBidWlsZFByb2Nlc3NDb25maWcoKSB9O1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGludm9rZTx7IHRpbGVDb3VudDogbnVtYmVyOyB0aWxlV2lkdGg6IG51bWJlcjsgdGlsZUhlaWdodDogbnVtYmVyOyBjb2xzOiBudW1iZXI7IHJvd3M6IG51bWJlcjsgb3V0cHV0V2lkdGg6IG51bWJlcjsgb3V0cHV0SGVpZ2h0OiBudW1iZXIgfT4oJ3NoZWV0X3Byb2Nlc3MnLCBhcmdzKTtcbiAgICBzdGF0ZS5zaGVldFByZXZpZXcgPSByZXN1bHQ7XG5cbiAgICAvLyBVcGRhdGUgcHJldmlldyB3aXRoIHRoZSBwcm9jZXNzZWQgc2hlZXRcbiAgICBjb25zdCBwcm9jVXJsID0gYXdhaXQgbG9hZEltYWdlQmxvYigncHJvY2Vzc2VkJyk7XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcm9jZXNzZWQtaW1nJykgYXMgSFRNTEltYWdlRWxlbWVudCkuc3JjID0gcHJvY1VybDtcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncHJvY2Vzc2VkLWRpbXMnKSEudGV4dENvbnRlbnQgPSBgJHtyZXN1bHQub3V0cHV0V2lkdGh9XFx1MDBkNyR7cmVzdWx0Lm91dHB1dEhlaWdodH1gO1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3MtcHJldmlldy1pbWcnKSBhcyBIVE1MSW1hZ2VFbGVtZW50KS5zcmMgPSBwcm9jVXJsO1xuXG4gICAgY29uc3QgZWxhcHNlZCA9ICgocGVyZm9ybWFuY2Uubm93KCkgLSB0MCkgLyAxMDAwKS50b0ZpeGVkKDIpO1xuICAgIHNldFN0YXR1cyhgU2hlZXQgcHJvY2Vzc2VkOiAke3Jlc3VsdC50aWxlQ291bnR9IHRpbGVzLCAke3Jlc3VsdC5vdXRwdXRXaWR0aH1cXHUwMGQ3JHtyZXN1bHQub3V0cHV0SGVpZ2h0fSAoJHtlbGFwc2VkfXMpYCwgJ3N1Y2Nlc3MnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHNldFN0YXR1cygnU2hlZXQgZXJyb3I6ICcgKyBlLCAnZXJyb3InKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBzdGF0ZS5zaGVldFByb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICByZW5kZXJTaGVldCgpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNoZWV0U2F2ZVRpbGVzQWN0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9wZW5EaWFsb2coeyBkaXJlY3Rvcnk6IHRydWUgfSk7XG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgY29uc3QgZGlyID0gQXJyYXkuaXNBcnJheShyZXN1bHQpID8gcmVzdWx0WzBdIDogcmVzdWx0O1xuICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBpbnZva2U8bnVtYmVyPignc2hlZXRfc2F2ZV90aWxlcycsIHsgb3V0cHV0RGlyOiBkaXIgfSk7XG4gICAgICBzZXRTdGF0dXMoYFNhdmVkICR7Y291bnR9IHRpbGVzIHRvICR7ZGlyLnNwbGl0KCcvJykucG9wKCkhLnNwbGl0KCdcXFxcJykucG9wKCkhfWAsICdzdWNjZXNzJyk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgc2V0U3RhdHVzKCdFcnJvciBzYXZpbmcgdGlsZXM6ICcgKyBlLCAnZXJyb3InKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWFkR2lmQ29uZmlnKCk6IHZvaWQge1xuICBjb25zdCByb3dFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnaWYtcm93JykgYXMgSFRNTElucHV0RWxlbWVudCB8IG51bGw7XG4gIGNvbnN0IGZwc0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dpZi1mcHMnKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgaWYgKHJvd0VsKSB7XG4gICAgY29uc3QgdiA9IHBhcnNlSW50KHJvd0VsLnZhbHVlKTtcbiAgICBzdGF0ZS5naWZSb3cgPSBpc05hTih2KSA/IDAgOiBNYXRoLm1heCgwLCB2KTtcbiAgfVxuICBpZiAoZnBzRWwpIHtcbiAgICBjb25zdCB2ID0gcGFyc2VJbnQoZnBzRWwudmFsdWUpO1xuICAgIHN0YXRlLmdpZkZwcyA9IGlzTmFOKHYpID8gMTAgOiBNYXRoLm1heCgxLCBNYXRoLm1pbigxMDAsIHYpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnaWZQcmV2aWV3QWN0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoc3RhdGUuZ2lmR2VuZXJhdGluZykgcmV0dXJuO1xuICByZWFkR2lmQ29uZmlnKCk7XG4gIHN0YXRlLmdpZkdlbmVyYXRpbmcgPSB0cnVlO1xuICBzdGF0ZS5naWZQcmV2aWV3VXJsID0gbnVsbDtcbiAgcmVuZGVyU2hlZXQoKTtcbiAgc2V0U3RhdHVzKCdHZW5lcmF0aW5nIEdJRiBwcmV2aWV3Li4uJywgJ3Byb2Nlc3NpbmcnKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBkYXRhVXJsID0gYXdhaXQgaW52b2tlPHN0cmluZz4oJ3NoZWV0X2dlbmVyYXRlX2dpZicsIHtcbiAgICAgIG1vZGU6IHN0YXRlLmdpZk1vZGUsXG4gICAgICByb3c6IHN0YXRlLmdpZk1vZGUgPT09ICdyb3cnID8gc3RhdGUuZ2lmUm93IDogbnVsbCxcbiAgICAgIGZwczogc3RhdGUuZ2lmRnBzLFxuICAgIH0pO1xuICAgIHN0YXRlLmdpZlByZXZpZXdVcmwgPSBkYXRhVXJsO1xuICAgIHNldFN0YXR1cygnR0lGIHByZXZpZXcgZ2VuZXJhdGVkJywgJ3N1Y2Nlc3MnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHNldFN0YXR1cygnR0lGIGVycm9yOiAnICsgZSwgJ2Vycm9yJyk7XG4gIH0gZmluYWxseSB7XG4gICAgc3RhdGUuZ2lmR2VuZXJhdGluZyA9IGZhbHNlO1xuICAgIHJlbmRlclNoZWV0KCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2lmRXhwb3J0QWN0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoIXN0YXRlLmdpZlByZXZpZXdVcmwpIHJldHVybjtcbiAgcmVhZEdpZkNvbmZpZygpO1xuICB0cnkge1xuICAgIGNvbnN0IGRlZmF1bHROYW1lID0gc3RhdGUuZ2lmTW9kZSA9PT0gJ3JvdycgPyBgcm93XyR7c3RhdGUuZ2lmUm93fS5naWZgIDogJ2FuaW1hdGlvbi5naWYnO1xuICAgIGNvbnN0IHBhdGggPSBhd2FpdCBzYXZlRGlhbG9nKHtcbiAgICAgIGZpbHRlcnM6IFt7IG5hbWU6ICdHSUYnLCBleHRlbnNpb25zOiBbJ2dpZiddIH1dLFxuICAgICAgZGVmYXVsdFBhdGg6IGRlZmF1bHROYW1lLFxuICAgIH0pO1xuICAgIGlmIChwYXRoKSB7XG4gICAgICBzZXRTdGF0dXMoJ0V4cG9ydGluZyBHSUYuLi4nLCAncHJvY2Vzc2luZycpO1xuICAgICAgYXdhaXQgaW52b2tlKCdzaGVldF9leHBvcnRfZ2lmJywge1xuICAgICAgICBwYXRoLFxuICAgICAgICBtb2RlOiBzdGF0ZS5naWZNb2RlLFxuICAgICAgICByb3c6IHN0YXRlLmdpZk1vZGUgPT09ICdyb3cnID8gc3RhdGUuZ2lmUm93IDogbnVsbCxcbiAgICAgICAgZnBzOiBzdGF0ZS5naWZGcHMsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGZuYW1lID0gKHBhdGggYXMgc3RyaW5nKS5zcGxpdCgnLycpLnBvcCgpIS5zcGxpdCgnXFxcXCcpLnBvcCgpITtcbiAgICAgIHNldFN0YXR1cyhgR0lGIHNhdmVkIHRvICR7Zm5hbWV9YCwgJ3N1Y2Nlc3MnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBzZXRTdGF0dXMoJ0dJRiBleHBvcnQgZXJyb3I6ICcgKyBlLCAnZXJyb3InKTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRhYiBjbGljayBoYW5kbGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy50YWItYmFyJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGU6IEV2ZW50KSA9PiB7XG4gIGNvbnN0IHRhYiA9IChlLnRhcmdldCBhcyBIVE1MRWxlbWVudCkuY2xvc2VzdCgnLnRhYicpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgaWYgKHRhYikgc3dpdGNoVGFiKHRhYi5kYXRhc2V0LnRhYiEpO1xufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRHJhZyBhbmQgZHJvcFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IGRyb3BPdmVybGF5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Ryb3Atb3ZlcmxheScpITtcbmxldCBkcmFnQ291bnRlciA9IDA7XG5cbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2RyYWdlbnRlcicsIChlOiBEcmFnRXZlbnQpID0+IHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICBkcmFnQ291bnRlcisrO1xuICBkcm9wT3ZlcmxheS5jbGFzc0xpc3QuYWRkKCdhY3RpdmUnKTtcbn0pO1xuXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdkcmFnbGVhdmUnLCAoZTogRHJhZ0V2ZW50KSA9PiB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZHJhZ0NvdW50ZXItLTtcbiAgaWYgKGRyYWdDb3VudGVyIDw9IDApIHtcbiAgICBkcmFnQ291bnRlciA9IDA7XG4gICAgZHJvcE92ZXJsYXkuY2xhc3NMaXN0LnJlbW92ZSgnYWN0aXZlJyk7XG4gIH1cbn0pO1xuXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdkcmFnb3ZlcicsIChlOiBEcmFnRXZlbnQpID0+IHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xufSk7XG5cbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2Ryb3AnLCBhc3luYyAoZTogRHJhZ0V2ZW50KSA9PiB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZHJhZ0NvdW50ZXIgPSAwO1xuICBkcm9wT3ZlcmxheS5jbGFzc0xpc3QucmVtb3ZlKCdhY3RpdmUnKTtcblxuICBjb25zdCBmaWxlcyA9IGUuZGF0YVRyYW5zZmVyPy5maWxlcztcbiAgaWYgKGZpbGVzICYmIGZpbGVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBmaWxlID0gZmlsZXNbMF0gYXMgRmlsZSAmIHsgcGF0aD86IHN0cmluZyB9O1xuICAgIGlmIChmaWxlLnBhdGgpIHtcbiAgICAgIGF3YWl0IG9wZW5JbWFnZShmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxufSk7XG5cbi8vIFRhdXJpIG5hdGl2ZSBmaWxlIGRyb3AgZXZlbnRzXG5pZiAod2luZG93Ll9fVEFVUklfXz8uZXZlbnQpIHtcbiAgd2luZG93Ll9fVEFVUklfXy5ldmVudC5saXN0ZW4oJ3RhdXJpOi8vZHJhZy1kcm9wJywgYXN5bmMgKGV2ZW50OiBUYXVyaUV2ZW50KSA9PiB7XG4gICAgZHJvcE92ZXJsYXkuY2xhc3NMaXN0LnJlbW92ZSgnYWN0aXZlJyk7XG4gICAgZHJhZ0NvdW50ZXIgPSAwO1xuICAgIGNvbnN0IHBhdGhzID0gZXZlbnQucGF5bG9hZD8ucGF0aHM7XG4gICAgaWYgKHBhdGhzICYmIHBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IG9wZW5JbWFnZShwYXRoc1swXSk7XG4gICAgfVxuICB9KTtcblxuICB3aW5kb3cuX19UQVVSSV9fLmV2ZW50Lmxpc3RlbigndGF1cmk6Ly9kcmFnLWVudGVyJywgKCkgPT4ge1xuICAgIGRyb3BPdmVybGF5LmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xuICB9KTtcblxuICB3aW5kb3cuX19UQVVSSV9fLmV2ZW50Lmxpc3RlbigndGF1cmk6Ly9kcmFnLWxlYXZlJywgKCkgPT4ge1xuICAgIGRyb3BPdmVybGF5LmNsYXNzTGlzdC5yZW1vdmUoJ2FjdGl2ZScpO1xuICAgIGRyYWdDb3VudGVyID0gMDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2V0dGluZ3MgY2xpY2sgaGFuZGxpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3MtbGlzdCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlOiBFdmVudCkgPT4ge1xuICBjb25zdCB0YXJnZXQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudDtcblxuICAvLyBDbGVhciBidXR0b24gY2xpY2sgKMOXIHRvIHJlc2V0IG51bGxhYmxlIHNldHRpbmcpXG4gIGlmICh0YXJnZXQuY2xhc3NMaXN0Py5jb250YWlucygnc2V0dGluZy1jbGVhcicpICYmICFzdGF0ZS5wcm9jZXNzaW5nKSB7XG4gICAgc2tpcE5leHRCbHVyQ29tbWl0ID0gdHJ1ZTtcbiAgICBjb25zdCBrZXkgPSB0YXJnZXQuZGF0YXNldC5rZXkhO1xuICAgIGNsZWFyU2V0dGluZyhrZXkpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEJvb2xlYW4gb3IgbnVsbGFibGUtb2ZmIHRvZ2dsZSBjbGlja1xuICBpZiAodGFyZ2V0LmNsYXNzTGlzdD8uY29udGFpbnMoJ3NldHRpbmctdG9nZ2xlJykgJiYgIXN0YXRlLnByb2Nlc3NpbmcpIHtcbiAgICBjb25zdCBrZXkgPSB0YXJnZXQuZGF0YXNldC5rZXkhO1xuICAgIGNvbnN0IHJvdyA9IHRhcmdldC5jbG9zZXN0KCcuc2V0dGluZy1yb3cnKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgaWYgKHJvdykgc3RhdGUuc2V0dGluZ3NGb2N1c0luZGV4ID0gcGFyc2VJbnQocm93LmRhdGFzZXQuaW5kZXghKTtcbiAgICBpZiAoQk9PTEVBTl9TRVRUSU5HUy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICBhZGp1c3RTZXR0aW5nKGtleSwgMSk7XG4gICAgICByZW5kZXJTZXR0aW5ncygpO1xuICAgICAgYXV0b1Byb2Nlc3MoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTnVsbGFibGUgc2V0dGluZyBpbiBcIm9mZlwiIHN0YXRlIOKAlCBlbmFibGUgaXRcbiAgICAgIHN0YXJ0RWRpdGluZyhrZXkpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBDbGljayBvbiByb3cgdG8gZm9jdXMgaXRcbiAgY29uc3Qgcm93ID0gdGFyZ2V0LmNsb3Nlc3QoJy5zZXR0aW5nLXJvdycpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgaWYgKHJvdykge1xuICAgIHN0YXRlLnNldHRpbmdzRm9jdXNJbmRleCA9IHBhcnNlSW50KHJvdy5kYXRhc2V0LmluZGV4ISk7XG4gICAgcmVuZGVyU2V0dGluZ3MoKTtcbiAgfVxufSk7XG5cbi8vIENvbW1pdCBpbmxpbmUgaW5wdXQgb24gYmx1clxubGV0IHNraXBOZXh0Qmx1ckNvbW1pdCA9IGZhbHNlO1xuZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NldHRpbmdzLWxpc3QnKSEuYWRkRXZlbnRMaXN0ZW5lcignZm9jdXNvdXQnLCAoZTogRm9jdXNFdmVudCkgPT4ge1xuICBjb25zdCB0YXJnZXQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudDtcbiAgaWYgKHRhcmdldC5jbGFzc0xpc3Q/LmNvbnRhaW5zKCdzZXR0aW5nLWlubGluZS1pbnB1dCcpKSB7XG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBpZiAoc2tpcE5leHRCbHVyQ29tbWl0KSB7IHNraXBOZXh0Qmx1ckNvbW1pdCA9IGZhbHNlOyByZXR1cm47IH1cbiAgICAgIGNvbW1pdEVkaXQoKHRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5kYXRhc2V0LmtleSEsICh0YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUpO1xuICAgIH0sIDUwKTtcbiAgfVxufSk7XG5cbi8vIENvbW1pdCBzZWxlY3QgY2hhbmdlc1xuZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NldHRpbmdzLWxpc3QnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGU6IEV2ZW50KSA9PiB7XG4gIGNvbnN0IHRhcmdldCA9IGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50O1xuICBpZiAodGFyZ2V0LnRhZ05hbWUgPT09ICdTRUxFQ1QnICYmIHRhcmdldC5jbGFzc0xpc3Q/LmNvbnRhaW5zKCdzZXR0aW5nLWlubGluZS1zZWxlY3QnKSkge1xuICAgIGNvbW1pdEVkaXQodGFyZ2V0LmRhdGFzZXQua2V5ISwgdGFyZ2V0LnZhbHVlKTtcbiAgfVxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5pdFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgc3RhdGUucGFsZXR0ZXMgPSBhd2FpdCBpbnZva2U8UGFsZXR0ZUluZm9bXT4oJ2xpc3RfcGFsZXR0ZXMnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBsb2FkIHBhbGV0dGVzOicsIGUpO1xuICB9XG4gIHJlbmRlclNldHRpbmdzKCk7XG4gIHJlbmRlckRpYWdub3N0aWNzKCk7XG4gIHJlbmRlckJhdGNoKCk7XG4gIHJlbmRlclNoZWV0KCk7XG59XG5cbi8vIEJhdGNoIHBhbmVsIGNsaWNrIGRlbGVnYXRpb25cbmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdiYXRjaC1jb250ZW50JykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGU6IEV2ZW50KSA9PiB7XG4gIGNvbnN0IHRhcmdldCA9IGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50O1xuICBpZiAodGFyZ2V0LmlkID09PSAnYmF0Y2gtYWRkLWZpbGVzJykgeyBiYXRjaEFkZEZpbGVzKCk7IHJldHVybjsgfVxuICBpZiAodGFyZ2V0LmlkID09PSAnYmF0Y2gtY2xlYXItZmlsZXMnKSB7IHN0YXRlLmJhdGNoRmlsZXMgPSBbXTsgc3RhdGUuYmF0Y2hSZXN1bHQgPSBudWxsOyByZW5kZXJCYXRjaCgpOyByZXR1cm47IH1cbiAgaWYgKHRhcmdldC5pZCA9PT0gJ2JhdGNoLWNob29zZS1kaXInKSB7IGJhdGNoQ2hvb3NlRGlyKCk7IHJldHVybjsgfVxuICBpZiAodGFyZ2V0LmlkID09PSAnYmF0Y2gtcnVuJykgeyBiYXRjaFJ1bigpOyByZXR1cm47IH1cbn0pO1xuXG4vLyBTaGVldCBwYW5lbCBjbGljayBkZWxlZ2F0aW9uXG5kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hlZXQtY29udGVudCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlOiBFdmVudCkgPT4ge1xuICBjb25zdCB0YXJnZXQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudDtcbiAgaWYgKHRhcmdldC5jbGFzc0xpc3Q/LmNvbnRhaW5zKCdzaGVldC1tb2RlLWJ0bicpICYmICF0YXJnZXQuY2xhc3NMaXN0LmNvbnRhaW5zKCdnaWYtbW9kZS1idG4nKSkge1xuICAgIGNvbnN0IG1vZGUgPSB0YXJnZXQuZGF0YXNldC5tb2RlIGFzICdmaXhlZCcgfCAnYXV0byc7XG4gICAgaWYgKG1vZGUpIHsgc3RhdGUuc2hlZXRNb2RlID0gbW9kZTsgc3RhdGUuc2hlZXRQcmV2aWV3ID0gbnVsbDsgcmVuZGVyU2hlZXQoKTsgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGFyZ2V0LmNsYXNzTGlzdD8uY29udGFpbnMoJ2dpZi1tb2RlLWJ0bicpKSB7XG4gICAgY29uc3QgZ2lmTW9kZSA9IHRhcmdldC5kYXRhc2V0LmdpZk1vZGUgYXMgJ3JvdycgfCAnYWxsJztcbiAgICBpZiAoZ2lmTW9kZSkgeyBzdGF0ZS5naWZNb2RlID0gZ2lmTW9kZTsgc3RhdGUuZ2lmUHJldmlld1VybCA9IG51bGw7IHJlbmRlclNoZWV0KCk7IH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRhcmdldC5pZCA9PT0gJ3NoZWV0LW5vLW5vcm1hbGl6ZScpIHsgc3RhdGUuc2hlZXRDb25maWcubm9Ob3JtYWxpemUgPSAhc3RhdGUuc2hlZXRDb25maWcubm9Ob3JtYWxpemU7IHJlbmRlclNoZWV0KCk7IHJldHVybjsgfVxuICBpZiAodGFyZ2V0LmlkID09PSAnc2hlZXQtcHJldmlldy1idG4nKSB7IHNoZWV0UHJldmlld0FjdGlvbigpOyByZXR1cm47IH1cbiAgaWYgKHRhcmdldC5pZCA9PT0gJ3NoZWV0LXByb2Nlc3MtYnRuJykgeyBzaGVldFByb2Nlc3NBY3Rpb24oKTsgcmV0dXJuOyB9XG4gIGlmICh0YXJnZXQuaWQgPT09ICdzaGVldC1zYXZlLXRpbGVzLWJ0bicpIHsgc2hlZXRTYXZlVGlsZXNBY3Rpb24oKTsgcmV0dXJuOyB9XG4gIGlmICh0YXJnZXQuaWQgPT09ICdnaWYtcHJldmlldy1idG4nKSB7IGdpZlByZXZpZXdBY3Rpb24oKTsgcmV0dXJuOyB9XG4gIGlmICh0YXJnZXQuaWQgPT09ICdnaWYtZXhwb3J0LWJ0bicpIHsgZ2lmRXhwb3J0QWN0aW9uKCk7IHJldHVybjsgfVxufSk7XG5cbmluaXQoKTtcbiIKICBdLAogICJtYXBwaW5ncyI6ICI7QUFtQ0EsTUFBUSxXQUFXLE9BQU8sVUFBVTtBQUNwQyxNQUFRLE1BQU0sWUFBWSxNQUFNLGVBQWUsT0FBTyxVQUFVO0FBZ0poRSxJQUFNLFFBQWtCO0FBQUEsRUFDdEIsV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsb0JBQW9CO0FBQUEsRUFDcEIsWUFBWTtBQUFBLEVBQ1osVUFBVSxDQUFDO0FBQUEsRUFDWCxjQUFjO0FBQUEsRUFDZCxRQUFRO0FBQUEsSUFDTixVQUFVO0FBQUEsSUFDVixZQUFZO0FBQUEsSUFDWixZQUFZO0FBQUEsSUFDWixrQkFBa0I7QUFBQSxJQUNsQixjQUFjO0FBQUEsSUFDZCxlQUFlO0FBQUEsSUFDZixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixZQUFZO0FBQUEsSUFDWixZQUFZO0FBQUEsSUFDWixlQUFlO0FBQUEsSUFDZixZQUFZO0FBQUEsSUFDWixVQUFVO0FBQUEs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QUNsQixjQUFZO0FBQ1osY0FBWTtBQUFBO0FBSWQsU0FBUyxlQUFlLGVBQWUsRUFBRyxpQkFBaUIsU0FBUyxDQUFDLE1BQWE7QUFDaEYsUUFBTSxTQUFTLEVBQUU7QUFDakIsTUFBSSxPQUFPLE9BQU8sbUJBQW1CO0FBQUUsa0JBQWM7QUFBRztBQUFBLEVBQVE7QUFDaEUsTUFBSSxPQUFPLE9BQU8scUJBQXFCO0FBQUUsVUFBTSxhQUFhLENBQUM7QUFBRyxVQUFNLGNBQWM7QUFBTSxnQkFBWTtBQUFHO0FBQUEsRUFBUTtBQUNqSCxNQUFJLE9BQU8sT0FBTyxvQkFBb0I7QUFBRSxtQkFBZTtBQUFHO0FBQUEsRUFBUTtBQUNsRSxNQUFJLE9BQU8sT0FBTyxhQUFhO0FBQUUsYUFBUztBQUFHO0FBQUEsRUFBUTtBQUFBLENBQ3REO0FBR0QsU0FBUyxlQUFlLGVBQWUsRUFBRyxpQkFBaUIsU0FBUyxDQUFDLE1BQWE7QUFDaEYsUUFBTSxTQUFTLEVBQUU7QUFDakIsTUFBSSxPQUFPLFdBQVcsU0FBUyxnQkFBZ0IsTUFBTSxPQUFPLFVBQVUsU0FBUyxjQUFjLEdBQUc7QUFDOUYsVUFBTSxPQUFPLE9BQU8sUUFBUTtBQUM1QixRQUFJLE1BQU07QUFBRSxZQUFNLFlBQVk7QUFBTSxZQUFNLGVBQWU7QUFBTSxrQkFBWTtBQUFBLElBQUc7QUFDOUU7QUFBQSxFQUNGO0FBQ0EsTUFBSSxPQUFPLFdBQVcsU0FBUyxjQUFjLEdBQUc7QUFDOUMsVUFBTSxVQUFVLE9BQU8sUUFBUTtBQUMvQixRQUFJLFNBQVM7QUFBRSxZQUFNLFVBQVU7QUFBUyxZQUFNLGdCQUFnQjtBQUFNLGtCQUFZO0FBQUEsSUFBRztBQUNuRjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLE9BQU8sT0FBTyxzQkFBc0I7QUFBRSxVQUFNLFlBQVksZUFBZSxNQUFNLFlBQVk7QUFBYSxnQkFBWTtBQUFHO0FBQUEsRUFBUTtBQUNqSSxNQUFJLE9BQU8sT0FBTyxxQkFBcUI7QUFBRSx1QkFBbUI7QUFBRztBQUFBLEVBQVE7QUFDdkUsTUFBSSxPQUFPLE9BQU8scUJBQXFCO0FBQUUsdUJBQW1CO0FBQUc7QUFBQSxFQUFRO0FBQ3ZFLE1BQUksT0FBTyxPQUFPLHdCQUF3QjtBQUFFLHlCQUFxQjtBQUFHO0FBQUEsRUFBUTtBQUM1RSxNQUFJLE9BQU8sT0FBTyxtQkFBbUI7QUFBRSxxQkFBaUI7QUFBRztBQUFBLEVBQVE7QUFDbkUsTUFBSSxPQUFPLE9BQU8sa0JBQWtCO0FBQUUsb0JBQWdCO0FBQUc7QUFBQSxFQUFRO0FBQUEsQ0FDbEU7QUFFRCxLQUFLOyIsCiAgImRlYnVnSWQiOiAiNzc2NkQ2MUVERTRCMTU5QTY0NzU2RTIxNjQ3NTZFMjEiLAogICJuYW1lcyI6IFtdCn0=
