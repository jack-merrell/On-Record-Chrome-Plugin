let overlay = null;
let selectionBox = null;
let recordingOutline = null;
let startX = 0;
let startY = 0;
let isSelecting = false;
let controls = null;
let modal = null;
let setupModal = null;
let styleTag = null;
let progressOverlay = null;
let setupKeyHandler = null;
let exportKeyHandler = null;
let recordingKeyHandler = null;
let exportInProgress = false;
let currentConfig = {
  formatChoice: "video",
  durationSec: 5,
  startDelay: false,
  captureCursor: false,
};

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  if (message.type === "ping") return;

  if (message.type === "show-setup") {
    if (modal || setupModal) return;
    showSetupModal();
  }

  if (message.type === "start-selection") {
    if (modal || setupModal) return;
    beginSelection(currentConfig);
  }

  if (message.type === "recording-started") {
    showControls("Recording");
    setControlsStatus("Recording");
    showProgressOverlay(message.durationSec || currentConfig.durationSec || 0);
    setCursorHidden(!currentConfig.captureCursor);
    if (message.rect) {
      showRecordingOutline(message.rect);
    }
  }

  if (message.type === "recording-prep") {
    showControls("Starting");
    setControlsStatus("Starting");
    setCursorHidden(!currentConfig.captureCursor);
  }

  if (message.type === "recording-ready") {
    hideControls();
    showExportModal(
      message.formatChoice || currentConfig.formatChoice,
      message.tabTitle || document.title || "Recording"
    );
    safeSendMessage({ type: "preview" });
    setCursorHidden(false);
    hideRecordingOutline();
  }
  if (message.type === "recording-cancelled") {
    hideControls();
    cleanupSelection();
    showSetupModal();
    setCursorHidden(false);
    hideRecordingOutline();
  }

  if (message.type === "export-error") {
    if (message.format === "gif") {
      setGifBusy(false);
    }
    exportInProgress = false;
    showToast(message.message || "Export failed");
  }
  if (message.type === "export-complete") {
    if (message.format === "gif") {
      setGifBusy(false);
    }
    exportInProgress = false;
  }

  if (message.type === "preview-ready") {
    if (message.preview?.ok && message.preview?.dataUrl) {
      attachPreview(message.preview.dataUrl, message.preview?.size || 0);
    } else {
      showToast(message.preview?.error || "Preview unavailable");
    }
  }

});

function safeSendMessage(payload) {
  try {
    if (!chrome?.runtime?.id) return;
    chrome.runtime.sendMessage(payload);
  } catch (_) {}
}

function beginSelection(config) {
  cleanupUI();
  injectStyles();
  if (config) {
    currentConfig = { ...currentConfig, ...config };
  }

  overlay = document.createElement("div");
  overlay.id = "rr-overlay";

  selectionBox = document.createElement("div");
  selectionBox.id = "rr-selection";
  const selectionShade = document.createElement("div");
  selectionShade.className = "rr-selection-shade";
  selectionBox.appendChild(selectionShade);
  overlay.appendChild(selectionBox);

  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", onMouseDown);
  overlay.addEventListener("mousemove", onMouseMove);
  overlay.addEventListener("mouseup", onMouseUp);
  overlay.addEventListener("mouseleave", onMouseUp);
}

function onMouseDown(event) {
  isSelecting = true;
  startX = event.clientX;
  startY = event.clientY;
  updateSelectionBox(event.clientX, event.clientY);
}

function onMouseMove(event) {
  if (!isSelecting) return;
  updateSelectionBox(event.clientX, event.clientY);
}

function onMouseUp(event) {
  if (!isSelecting) return;
  isSelecting = false;

  const endX = event.clientX;
  const endY = event.clientY;
  updateSelectionBox(endX, endY);

  const overlayRect = overlay?.getBoundingClientRect();
  const baseX = overlayRect ? overlayRect.left : 0;
  const baseY = overlayRect ? overlayRect.top : 0;

  const x = Math.max(0, Math.min(startX, endX));
  const y = Math.max(0, Math.min(startY, endY));
  const width = Math.min(window.innerWidth, Math.abs(endX - startX));
  const height = Math.min(window.innerHeight, Math.abs(endY - startY));

  if (width < 10 || height < 10) {
    cleanupSelection();
    return;
  }

  cleanupSelection();

  safeSendMessage({
    type: "selection-complete",
    rect: {
      x: x - baseX,
      y: y - baseY,
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      viewportWidth: window.visualViewport?.width || document.documentElement.clientWidth,
      viewportHeight: window.visualViewport?.height || document.documentElement.clientHeight,
      viewportOffsetX: window.visualViewport?.offsetLeft || 0,
      viewportOffsetY: window.visualViewport?.offsetTop || 0,
      outerWidth: window.outerWidth || window.visualViewport?.width || document.documentElement.clientWidth,
      outerHeight: window.outerHeight || window.visualViewport?.height || document.documentElement.clientHeight,
    },
    config: currentConfig,
  });
}

function showRecordingOutline(rect) {
  hideRecordingOutline();
  recordingOutline = document.createElement("div");
  recordingOutline.id = "rr-recording-outline";
  recordingOutline.style.left = `${rect.x}px`;
  recordingOutline.style.top = `${rect.y}px`;
  recordingOutline.style.width = `${rect.width}px`;
  recordingOutline.style.height = `${rect.height}px`;
  document.body.appendChild(recordingOutline);
}

function hideRecordingOutline() {
  if (!recordingOutline) return;
  recordingOutline.remove();
  recordingOutline = null;
}

function updateSelectionBox(currentX, currentY) {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);

  selectionBox.style.left = `${x}px`;
  selectionBox.style.top = `${y}px`;
  selectionBox.style.width = `${w}px`;
  selectionBox.style.height = `${h}px`;
}

function cleanupSelection() {
  if (!overlay) return;
  overlay.removeEventListener("mousedown", onMouseDown);
  overlay.removeEventListener("mousemove", onMouseMove);
  overlay.removeEventListener("mouseup", onMouseUp);
  overlay.removeEventListener("mouseleave", onMouseUp);
  overlay.remove();
  overlay = null;
  selectionBox = null;
}

function showControls(statusText) {
  if (controls) return;
  controls = document.createElement("div");
  controls.id = "rr-controls";
  controls.innerHTML = `
    <div class="rr-status">${statusText || "Recording"}</div>
    <button class="rr-stop">Stop</button>
  `;
  controls.querySelector(".rr-stop").addEventListener("click", () => {
    safeSendMessage({ type: "stop-recording" });
  });
  document.body.appendChild(controls);
  requestAnimationFrame(() => {
    controls.classList.add("rr-enter");
  });

  if (!recordingKeyHandler) {
    recordingKeyHandler = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      safeSendMessage({ type: "cancel-recording" });
    };
    document.addEventListener("keydown", recordingKeyHandler);
  }
}

function setControlsStatus(text) {
  if (!controls) return;
  const status = controls.querySelector(".rr-status");
  if (status) status.textContent = text;
}

function hideControls() {
  if (!controls) return;
  controls.remove();
  controls = null;
  removeProgressOverlay();
  setCursorHidden(false);
  hideRecordingOutline();
  if (recordingKeyHandler) {
    document.removeEventListener("keydown", recordingKeyHandler);
    recordingKeyHandler = null;
  }
}

function showSetupModal() {
  if (setupModal) return;
  injectStyles();

  setupModal = document.createElement("div");
  setupModal.id = "rr-setup";
  setupModal.innerHTML = `
    <div class="rr-modal-backdrop"></div>
    <div class="rr-modal-panel">
      <div class="rr-modal-title">Record Settings</div>
      <div class="rr-field">
        <label class="rr-label" for="rr-duration">Duration (seconds)</label>
        <input id="rr-duration" class="rr-input" type="number" min="1" max="600" value="${currentConfig.durationSec}" />
      </div>
      <div class="rr-field">
        <label class="rr-label" for="rr-delay">Start delay (1 second)</label>
        <label class="rr-toggle">
          <input id="rr-delay" type="checkbox" ${currentConfig.startDelay ? "checked" : ""} />
          <span class="rr-toggle-track"></span>
        </label>
      </div>
      <div class="rr-field">
        <label class="rr-label" for="rr-cursor">Capture cursor</label>
        <label class="rr-toggle">
          <input id="rr-cursor" type="checkbox" ${currentConfig.captureCursor ? "checked" : ""} />
          <span class="rr-toggle-track"></span>
        </label>
      </div>
      <div class="rr-modal-actions">
        <button class="rr-primary">Select Area</button>
        <button class="rr-secondary">Cancel</button>
      </div>
    </div>
  `;

  setupModal.querySelector(".rr-primary").addEventListener("click", () => {
    applySetupAndStart();
  });

  setupModal.querySelector(".rr-secondary").addEventListener("click", () => {
    closeSetupModal();
  });

  setupKeyHandler = (event) => {
    if (!setupModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSetupModal();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      applySetupAndStart();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const input = setupModal.querySelector("#rr-duration");
      if (!input) return;
      const step = event.key === "ArrowUp" ? 1 : -1;
      const current = Number(input.value || 0);
      const next = Math.min(600, Math.max(1, (Number.isFinite(current) ? current : 5) + step));
      input.value = String(next);
      event.preventDefault();
    }
  };
  document.addEventListener("keydown", setupKeyHandler);

  document.body.appendChild(setupModal);
}

function applySetupAndStart() {
  if (!setupModal) return;
  const durationRaw = Number(
    setupModal.querySelector("#rr-duration")?.value || 0
  );
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0
    ? Math.min(durationRaw, 600)
    : 5;
  const startDelay = !!setupModal.querySelector("#rr-delay")?.checked;
  const captureCursor = !!setupModal.querySelector("#rr-cursor")?.checked;
  currentConfig = { formatChoice: "video", durationSec, startDelay, captureCursor };
  closeSetupModal();
  beginSelection(currentConfig);
}

function closeSetupModal() {
  if (!setupModal) return;
  setupModal.remove();
  setupModal = null;
  if (setupKeyHandler) {
    document.removeEventListener("keydown", setupKeyHandler);
    setupKeyHandler = null;
  }
}

function showExportModal(formatChoice, tabTitle) {
  if (modal) return;
  const defaultName = buildDefaultName(tabTitle);
  modal = document.createElement("div");
  modal.id = "rr-modal";
  modal.innerHTML = `
    <div class="rr-modal-backdrop"></div>
    <div class="rr-modal-panel">
      <div class="rr-modal-title">Export Recording</div>
      <div class="rr-preview">
        <div class="rr-preview-label">Preview</div>
        <div class="rr-preview-frame">
          <div class="rr-preview-empty">Generating preview…</div>
        </div>
      </div>
      <div class="rr-field">
        <div class="rr-field-row">
          <label class="rr-label" for="rr-filename">Filename</label>
          <div class="rr-label rr-dimensions" id="rr-dimensions">0×0</div>
        </div>
        <input id="rr-filename" class="rr-input" type="text" spellcheck="false" value="${defaultName}" />
      </div>
      <div class="rr-modal-actions">
        <button data-format="video" class="rr-export-video">
          <span>Export Video (mp4)</span>
          <span class="rr-export-size" id="rr-export-size">0 MB</span>
        </button>
      </div>
      <div class="rr-field rr-gif-controls">
        <div class="rr-field-row rr-gif-row">
          <div class="rr-gif-option">
            <label class="rr-label" for="rr-gif-width">GIF width</label>
            <select id="rr-gif-width" class="rr-select">
              <option value="original">Original</option>
              <option value="320">320px</option>
              <option value="480">480px</option>
              <option value="640">640px</option>
              <option value="720" selected>720px</option>
              <option value="960">960px</option>
              <option value="1280">1280px</option>
            </select>
          </div>
          <div class="rr-gif-option">
            <label class="rr-label" for="rr-gif-fps">GIF fps</label>
            <select id="rr-gif-fps" class="rr-select">
              <option value="4">4 fps</option>
              <option value="6">6 fps</option>
              <option value="8">8 fps</option>
              <option value="10">10 fps</option>
              <option value="12" selected>12 fps</option>
              <option value="15">15 fps</option>
              <option value="20">20 fps</option>
              <option value="24">24 fps</option>
            </select>
          </div>
        </div>
        <div class="rr-gif-warning" id="rr-gif-warning">Large GIF settings may fail or take a long time to export.</div>
        <button class="rr-gif">Export GIF</button>
      </div>
      <div class="rr-modal-actions rr-secondary-actions">
        <button class="rr-reset rr-secondary-btn">Delete and start over</button>
        <button class="rr-modal-close rr-secondary-btn">Done</button>
      </div>
    </div>
  `;

  modal.querySelectorAll("button[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      if (exportInProgress) return;
      exportInProgress = true;
      const format = button.getAttribute("data-format");
      const nameInput = modal.querySelector("#rr-filename");
      const baseName = nameInput?.value?.trim() || defaultName;
      const filename = format === "video"
        ? ensureExt(baseName, "mp4")
        : baseName;
      safeSendMessage({ type: "export", format, filename });
    });
  });

  modal.querySelector(".rr-gif").addEventListener("click", () => {
    if (exportInProgress) return;
    exportInProgress = true;
    const widthValue = modal.querySelector("#rr-gif-width")?.value || "720";
    const width = widthValue === "original" ? null : Number(widthValue);
    const fps = Number(modal.querySelector("#rr-gif-fps")?.value || 12);
    const nameInput = modal.querySelector("#rr-filename");
    const baseName = nameInput?.value?.trim() || defaultName;
    const filename = ensureExt(baseName, "gif");
    const options = { width, fps };
    setGifBusy(true);
    safeSendMessage({ type: "export", format: "gif", options, filename });
  });

  const gifWidth = modal.querySelector("#rr-gif-width");
  const gifFps = modal.querySelector("#rr-gif-fps");
  const gifWarning = modal.querySelector("#rr-gif-warning");
  if (gifWidth && gifFps && gifWarning) {
    const updateWarning = () => {
      const widthVal = gifWidth.value === "original" ? 9999 : Number(gifWidth.value || 0);
      const fpsVal = Number(gifFps.value || 0);
      const duration = Number(currentConfig.durationSec || 0);
      const isLarge = widthVal >= 960 || fpsVal >= 15 || duration > 10;
      gifWarning.style.display = isLarge ? "block" : "none";
    };
    gifWidth.addEventListener("change", updateWarning);
    gifFps.addEventListener("change", updateWarning);
    updateWarning();
  }



  modal.querySelector(".rr-reset").addEventListener("click", () => {
    safeSendMessage({ type: "clear-recording" });
    modal.remove();
    modal = null;
    safeSendMessage({ type: "show-setup" });
    if (exportKeyHandler) {
      document.removeEventListener("keydown", exportKeyHandler);
      exportKeyHandler = null;
    }
  });

  modal.querySelector(".rr-modal-close").addEventListener("click", () => {
    safeSendMessage({ type: "clear-recording" });
    modal.remove();
    modal = null;
    if (exportKeyHandler) {
      document.removeEventListener("keydown", exportKeyHandler);
      exportKeyHandler = null;
    }
  });

  exportKeyHandler = (event) => {
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      safeSendMessage({ type: "clear-recording" });
      modal.remove();
      modal = null;
      safeSendMessage({ type: "show-setup" });
    }
    if (event.key === "Enter") {
      if (event.repeat || exportInProgress) return;
      event.preventDefault();
      const nameInput = modal.querySelector("#rr-filename");
      const baseName = nameInput?.value?.trim() || defaultName;
      const filename = ensureExt(baseName, "mp4");
      exportInProgress = true;
      safeSendMessage({ type: "export", format: "video", filename });
    }
  };
  document.addEventListener("keydown", exportKeyHandler);

  document.body.appendChild(modal);
}

function attachPreview(dataUrl, sizeBytes) {
  if (!modal) return;
  const frame = modal.querySelector(".rr-preview-frame");
  if (!frame) return;
  frame.innerHTML = "";
  const video = document.createElement("video");
  video.src = dataUrl;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.className = "rr-preview-video";
  video.addEventListener("loadedmetadata", () => {
    const dimEl = modal?.querySelector("#rr-dimensions");
    if (dimEl && video.videoWidth && video.videoHeight) {
      dimEl.textContent = `${video.videoWidth}×${video.videoHeight}`;
    }
  });
  frame.appendChild(video);
  const exportSizeEl = modal.querySelector("#rr-export-size");
  if (exportSizeEl) exportSizeEl.textContent = formatBytes(sizeBytes);
}

function setGifBusy(isBusy) {
  if (!modal) return;
  const btn = modal.querySelector(".rr-gif");
  if (!btn) return;
  btn.classList.toggle("rr-busy", isBusy);
}

function buildDefaultName(tabTitle) {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(
    now.getHours()
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
    now.getSeconds()
  ).padStart(2, "0")}`;
  const safeTitle = String(tabTitle || "Recording")
    .replace(/[\\\\/:*?\"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 18) || "Recording";
  return `${safeTitle}${stamp}`;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "rr-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function injectStyles() {
  if (styleTag) return;
  styleTag = document.createElement("style");
  styleTag.textContent = `
    :root {
      --rr-ink: #111111;
      --rr-border: #d9d9d9;
      --rr-surface: #ffffff;
      --rr-muted: #6b6b6b;
    }
    #rr-overlay,
    #rr-controls,
    #rr-modal,
    #rr-setup,
    .rr-toast {
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 18px;
      box-sizing: border-box;
    }
    #rr-controls *,
    #rr-modal *,
    #rr-setup *,
    .rr-toast * {
      box-sizing: border-box;
    }
    #rr-overlay {
      position: fixed;
      inset: 0;
      background: transparent;
      cursor: crosshair;
      z-index: 2147483647;
    }
    #rr-selection {
      position: absolute;
      border: 2px solid transparent;
      background: transparent;
      box-sizing: border-box;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    }
    #rr-selection .rr-selection-shade {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.02);
      -webkit-backdrop-filter: invert(1);
      backdrop-filter: invert(1);
      pointer-events: none;
    }
    .rr-hide-cursor,
    .rr-hide-cursor * {
      cursor: none !important;
    }
    #rr-recording-outline {
      position: fixed;
      border: none;
      outline: 2px solid #ffffff;
      pointer-events: none;
      z-index: 2147483646;
      box-sizing: border-box;
      mix-blend-mode: difference;
    }
    #rr-controls {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--rr-surface);
      color: var(--rr-ink);
      border: 1px solid var(--rr-ink);
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      overflow: hidden;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 180ms ease, transform 180ms ease;
    }
    #rr-controls.rr-enter {
      opacity: 1;
      transform: translateY(0);
    }
    #rr-controls .rr-status {
      font-size: 11px;
    }
    #rr-controls .rr-stop {
      border: 1px solid var(--rr-ink);
      background: var(--rr-surface);
      color: var(--rr-ink);
      padding: 4px 10px;
      cursor: pointer;
      font-weight: 500;
    }
    #rr-controls.rr-progress::before {
      content: "";
      position: absolute;
      inset: 0;
      background: #ffffff;
      transform-origin: left center;
      transform: scaleX(0);
      mix-blend-mode: difference;
      pointer-events: none;
    }
    #rr-controls.rr-progress.rr-animate::before {
      animation: rr-progress var(--rr-duration, 5s) linear forwards;
    }
    @keyframes rr-progress {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    #rr-modal,
    #rr-setup {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .rr-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.82);
    }
    .rr-modal-panel {
      position: relative;
      z-index: 1;
      width: min(360px, 90vw);
      background: var(--rr-surface);
      border: 1px solid var(--rr-ink);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .rr-modal-title {
      font-size: 16px;
      font-weight: 500;
      color: var(--rr-ink);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .rr-modal-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .rr-export-video {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .rr-export-size {
      font-size: 11px;
      color: var(--rr-muted);
    }
    .rr-secondary-actions {
      margin-top: 6px;
    }
    .rr-preview {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rr-preview-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--rr-muted);
    }
    .rr-preview-frame {
      border: 1px solid var(--rr-ink);
      background: #f8f8f8;
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .rr-preview-empty {
      font-size: 12px;
      color: var(--rr-muted);
    }
    .rr-preview-video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center center;
      display: block;
    }
    #rr-modal button,
    #rr-setup button {
      flex: 1 1 auto;
      border: 1px solid var(--rr-ink);
      padding: 8px 10px;
      background: var(--rr-surface);
      color: var(--rr-ink);
      cursor: pointer;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 12px;
      text-align: left;
    }
    .rr-secondary-btn {
      border-color: #b0b0b0 !important;
      color: #5e5e5e !important;
      background: #e0e0e0 !important;
    }
    .rr-secondary-actions button {
      border-color: #b0b0b0 !important;
      color: #5e5e5e !important;
      background: #e0e0e0 !important;
    }
    .rr-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rr-toggle {
      position: relative;
      width: 44px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .rr-toggle input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .rr-toggle-track {
      width: 100%;
      height: 100%;
      border: 1px solid var(--rr-ink);
      background: #f2f2f2;
      position: relative;
    }
    .rr-toggle-track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      background: #B4B4B4;
      transition: transform 180ms ease;
    }
    .rr-toggle input:checked + .rr-toggle-track::after {
      transform: translateX(18px);
      background: var(--rr-ink);
    }
    .rr-field-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .rr-dimensions {
      text-align: right;
    }
    .rr-gif-controls {
      margin-top: 6px;
      gap: 10px;
    }
    .rr-gif-warning {
      font-size: 8px;
      color: #4a474e;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      display: none;
    }
    .rr-gif-row {
      display: flex;
      gap: 16px;
      align-items: flex-end;
    }
    .rr-gif-option {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }
    .rr-select {
      border: 1px solid var(--rr-border);
      padding: 8px 10px;
      font-size: 13px;
      color: #ffffff;
      background: #3f3f3f;
      appearance: none;
    }
    .rr-gif {
      border: 1px solid var(--rr-ink);
    }
    .rr-gif.rr-busy {
      position: relative;
      color: transparent;
      pointer-events: none;
      overflow: hidden;
    }
    .rr-gif.rr-busy::before {
      content: "";
      position: absolute;
      inset: 0;
      background: #ffffff;
      transform-origin: left center;
      transform: scaleX(0);
      mix-blend-mode: difference;
      animation: rr-gif-progress 1.4s linear infinite;
    }
    .rr-gif.rr-busy::after {
      content: "Exporting…";
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--rr-ink);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    @keyframes rr-gif-progress {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    .rr-label {
      font-size: 12px;
      line-height: 14px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--rr-muted);
      white-space: nowrap;
      display: block;
      width: 100%;
      word-break: normal;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rr-options {
      display: flex;
      gap: 10px;
    }
    .rr-option {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--rr-ink);
    }
    .rr-input {
      border: 1px solid var(--rr-border);
      padding: 8px 10px;
      font-size: 13px;
      color: #ffffff;
      background: #3f3f3f;
    }
    .rr-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--rr-surface);
      color: var(--rr-ink);
      padding: 8px 12px;
      border: 1px solid var(--rr-ink);
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      z-index: 2147483647;
    }
  `;
  document.head.appendChild(styleTag);
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / kb))} KB`;
}

function ensureExt(name, ext) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim();
  if (!cleaned) return `recording.${ext}`;
  const lower = cleaned.toLowerCase();
  if (lower.endsWith(`.${ext}`)) return cleaned;
  return `${cleaned}.${ext}`;
}

function cleanupUI() {
  cleanupSelection();
  hideControls();
  if (modal) {
    modal.remove();
    modal = null;
    if (exportKeyHandler) {
      document.removeEventListener("keydown", exportKeyHandler);
      exportKeyHandler = null;
    }
  }
  if (setupModal) {
    closeSetupModal();
  }
  removeProgressOverlay();
}

function showProgressOverlay(durationSec) {
  if (!controls) return;
  controls.classList.add("rr-progress");
  if (durationSec && durationSec > 0) {
    controls.style.setProperty("--rr-duration", `${durationSec}s`);
  } else {
    controls.style.setProperty("--rr-duration", "5s");
  }
  // force restart
  controls.classList.remove("rr-animate");
  void controls.offsetWidth;
  controls.classList.add("rr-animate");
}

function removeProgressOverlay() {
  if (!controls) return;
  controls.classList.remove("rr-animate");
  controls.classList.remove("rr-progress");
}

function setCursorHidden(hidden) {
  document.documentElement.classList.toggle("rr-hide-cursor", hidden);
}
