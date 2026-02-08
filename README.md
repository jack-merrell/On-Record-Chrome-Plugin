# Region Tab Recorder (Chrome Extension)

This extension lets you click the action button, drag to select a region of the current tab, and record that region.

## How it works
- Click the extension action to start region selection.
- Drag to select the region to record.
- Click **Stop** when done.
- Choose export format from the modal.

## Export formats
- **Video**: exports the browser’s native `MediaRecorder` output (MP4 if supported, otherwise WebM).
- **GIF**: rendered via `gif.js` in the offscreen document.

GIF export is CPU‑heavy and can take a while for longer or high‑FPS clips.

## Install (developer mode)
1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked** and select this folder.

## Files
- `manifest.json`: MV3 manifest.
- `background.js`: service worker for orchestration.
- `content.js`: selection overlay + modal UI.
- `offscreen.html` / `offscreen.js`: tab capture + recording.
