let recorder = null;
let recordedChunks = [];
let recordingMime = "video/webm";
let lastRecording = null;
let drawHandle = null;
let drawTimer = null;
let drawContext = null;
let recordingCanvas = null;
let sourceVideo = null;
let stopPromise = null;
let stopResolve = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return;

  if (message.type === "start-recording") {
    (async () => {
      try {
        await startRecording(message.streamId, message.rect, message.captureCursor);
        sendResponse({ ok: true });
      } catch (error) {
        const messageText = error?.message || "Error starting tab capture";
        sendResponse({ ok: false, error: messageText });
      }
    })();
    return true;
  }

  if (message.type === "stop-recording") {
    (async () => {
      await stopRecording();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "export") {
    (async () => {
      const result = await exportRecording(
        message.format,
        message.options || {},
        message.filename
      );
      sendResponse(result);
    })();
    return true;
  }

  if (message.type === "preview") {
    (async () => {
      const result = await getPreview();
      sendResponse(result);
    })();
    return true;
  }

  if (message.type === "clear-recording") {
    (async () => {
      clearRecording();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "revoke-blob-url") {
    if (message.url && typeof URL !== "undefined" && URL.revokeObjectURL) {
      try {
        URL.revokeObjectURL(message.url);
      } catch (_) {}
    }
    sendResponse({ ok: true });
    return true;
  }

});

async function startRecording(streamId, rect, captureCursor = true) {
  cleanup();
  if (!streamId) {
    throw new Error("Missing tab stream id");
  }

  const cursorSetting = captureCursor ? "always" : "never";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        cursor: cursorSetting,
      },
      cursor: cursorSetting,
    },
  });

  sourceVideo = document.createElement("video");
  sourceVideo.srcObject = stream;
  sourceVideo.muted = true;
  await sourceVideo.play();
  await waitForVideoReady(sourceVideo);

  const viewportWidth = rect.viewportWidth || recordingCanvas?.width || 1;
  const viewportHeight = rect.viewportHeight || recordingCanvas?.height || 1;
  const viewportOffsetX = rect.viewportOffsetX || 0;
  const viewportOffsetY = rect.viewportOffsetY || 0;

  const scaleX = sourceVideo.videoWidth / viewportWidth;
  const scaleY = sourceVideo.videoHeight / viewportHeight;
  const scale = Math.min(scaleX, scaleY);
  const scaledWidth = viewportWidth * scale;
  const scaledHeight = viewportHeight * scale;
  const offsetX = Math.max(0, (sourceVideo.videoWidth - scaledWidth) / 2);
  const offsetY = Math.max(0, (sourceVideo.videoHeight - scaledHeight) / 2);

  const sx = Math.round((rect.x + viewportOffsetX) * scale + offsetX);
  const sy = Math.round((rect.y + viewportOffsetY) * scale + offsetY);
  const sw = Math.round(rect.width * scale);
  const sh = Math.round(rect.height * scale);
  const boundedSw = Math.max(1, Math.min(sw, sourceVideo.videoWidth - sx));
  const boundedSh = Math.max(1, Math.min(sh, sourceVideo.videoHeight - sy));

  recordingCanvas = document.createElement("canvas");
  recordingCanvas.width = Math.max(1, Math.floor(boundedSw));
  recordingCanvas.height = Math.max(1, Math.floor(boundedSh));
  drawContext = recordingCanvas.getContext("2d", { alpha: false });

  const drawFrame = () => {
    if (!sourceVideo || sourceVideo.readyState < 2) return;
    drawContext.drawImage(
      sourceVideo,
      sx,
      sy,
      boundedSw,
      boundedSh,
      0,
      0,
      recordingCanvas.width,
      recordingCanvas.height
    );
  };

  drawTimer = setInterval(drawFrame, 33);

  const canvasStream = recordingCanvas.captureStream(30);
  const mime = pickSupportedMime();
  recordingMime = mime;
  recorder = new MediaRecorder(canvasStream, { mimeType: mime });
  recordedChunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    lastRecording = new Blob(recordedChunks, { type: recordingMime });
    recordedChunks = [];
    if (sourceVideo?.srcObject) {
      sourceVideo.srcObject.getTracks().forEach((track) => track.stop());
    }
    if (stopResolve) {
      stopResolve();
      stopResolve = null;
      stopPromise = null;
    }
  };

  recorder.start();
}

async function stopRecording() {
  if (!recorder) return;
  if (!stopPromise) {
    stopPromise = new Promise((resolve) => {
      stopResolve = resolve;
    });
  }
  if (recorder.state !== "inactive") {
    try {
      recorder.requestData();
    } catch (_) {}
  }
  recorder.stop();
  recorder = null;
  if (drawHandle) {
    cancelAnimationFrame(drawHandle);
    drawHandle = null;
  }
  if (drawTimer) {
    clearInterval(drawTimer);
    drawTimer = null;
  }
  await stopPromise;
}

async function exportRecording(format, options, filenameOverride) {
  await ensureRecordingReady();
  if (!lastRecording) {
    return { ok: false, error: "Nothing recorded yet" };
  }

  if (format === "video") {
    const ext = recordingMime.startsWith("video/mp4") ? "mp4" : "webm";
    const filename = filenameOverride || `recording-${Date.now()}.${ext}`;
    return await downloadBlob(lastRecording, filename);
  }

  if (format === "gif") {
    return await exportGif(options, filenameOverride);
  }

  return { ok: false, error: "Unknown format" };
}

async function exportGif(options, filenameOverride) {
  const fps = Math.min(30, Math.max(4, Number(options?.fps || 12)));
  const widthOption = Number.isFinite(Number(options?.width)) ? Number(options?.width) : null;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read recording data"));
    reader.readAsDataURL(lastRecording);
  });

  const video = document.createElement("video");
  video.src = dataUrl;
  video.muted = true;
  video.playsInline = true;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load recording for GIF"));
  });

  const duration = video.duration || 0;
  if (!duration || !Number.isFinite(duration)) {
    return { ok: false, error: "Recording duration is unavailable for GIF export." };
  }

  const maxWidth = widthOption ? Math.min(1280, Math.max(240, widthOption)) : video.videoWidth;
  const scale = maxWidth / video.videoWidth;
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });

  const gif = new GIF({
    workers: 2,
    workerScript: "vendor/gif.worker.js",
    width,
    height,
    quality: 10,
    dither: false,
  });

  const frameDelay = Math.round(1000 / fps);
  const frameCount = Math.max(1, Math.floor(duration * fps));

  for (let i = 0; i < frameCount; i += 1) {
    const t = Math.min(duration, i / fps);
    await seekVideo(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    gif.addFrame(ctx, { copy: true, delay: frameDelay });
  }

  const gifBlob = await new Promise((resolve, reject) => {
    gif.on("finished", resolve);
    gif.on("abort", () => reject(new Error("GIF export aborted")));
    gif.on("error", () => reject(new Error("GIF export failed")));
    gif.render();
  });

  const filename = filenameOverride || `recording-${Date.now()}.gif`;
  return await downloadBlob(gifBlob, filename);
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("error", onError);
      reject(new Error("Failed to seek video for GIF"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

async function getPreview() {
  await ensureRecordingReady();
  if (!lastRecording) {
    return { ok: false, error: "Nothing recorded yet" };
  }
  const payload = await blobToDataUrl(lastRecording, "preview.webm");
  if (payload.ok) payload.size = lastRecording.size || 0;
  return payload;
}

async function ensureRecordingReady() {
  if (recorder) {
    await stopRecording();
    return;
  }
  if (stopPromise) {
    await stopPromise;
  }
}

function blobToDataUrl(blob, filename) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ ok: true, dataUrl: reader.result, filename });
    };
    reader.onerror = () => {
      resolve({ ok: false, error: "Failed to read recording data" });
    };
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, filename) {
  return new Promise((resolve) => {
    if (typeof URL === "undefined" || !URL.createObjectURL) {
      resolve({ ok: false, error: "Blob URLs are not supported in this context." });
      return;
    }
    const url = URL.createObjectURL(blob);
    resolve({ ok: true, blobUrl: url, filename });
  });
}

function pickSupportedMime() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "video/webm";
}

function waitForVideoReady(video) {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        video.removeEventListener("loadedmetadata", onReady);
        resolve();
      }
    };
    video.addEventListener("loadedmetadata", onReady);
    setTimeout(resolve, 200);
  });
}

function cleanup() {
  if (drawHandle) {
    cancelAnimationFrame(drawHandle);
    drawHandle = null;
  }
  if (drawTimer) {
    clearInterval(drawTimer);
    drawTimer = null;
  }
  if (sourceVideo?.srcObject) {
    sourceVideo.srcObject.getTracks().forEach((track) => track.stop());
  }
  sourceVideo = null;
  recorder = null;
  recordedChunks = [];
}

function clearRecording() {
  lastRecording = null;
  recordedChunks = [];
}
