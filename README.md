# On Record — Chrome Extension

Record the quiet rectangle. Pin it down before it dissolves.

On Record lets you select a region of the current tab and capture it as a video or a GIF — a soft machine for small moments.

Project website: [on-record.vercel.app](https://on-record.vercel.app/)

## How it works
- Click the extension icon to begin the selection.
- Drag out the region you want to keep.
- Click **Stop** when you’re done.
- Choose an export format in the modal.

## Export formats
- **Video**: browser-native `MediaRecorder` output (MP4 if supported, otherwise WebM).
- **GIF**: rendered via `gif.js` in the offscreen document.

GIF export is CPU‑heavy and may take a while for longer or high‑FPS clips.

## Install (developer mode)
1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked** and select this folder.

## Project layout
- `manifest.json`: MV3 manifest.
- `background.js`: service worker for orchestration.
- `content.js`: selection overlay + modal UI.
- `offscreen.html` / `offscreen.js`: tab capture + recording.
