// game.js
// Scream Go Hero — main game logic (mic + canvas + recorder + optional firebase hooks)
// Drop this file next to the HTML you already pasted. It's a single ES module and expects the
// DOM structure/IDs present in your index.html (reqMic, stopMic, startBtn, stopBtn, sensitivity, gameCanvas, etc.)
//
// Notes:
//  - Browsers only allow getUserMedia / WebAudio after a user gesture. This script will request mic
//    permission on Start Game (a visible user gesture) and again if user clicks "Request Mic".
//  - If you deploy to GitHub Pages, the browser will ask for mic permission when the Start/Game button is pressed.
//  - Firebase upload and score persistence are optional — there's a commented section you can enable
//    by pasting your firebase config and uncommenting the relevant functions.
//
// Author: written to sound handcrafted and human. — KK mode friendly :)

/* =========================
   Config & Constants
   ========================= */
const CANVAS_ID = "gameCanvas";
const REQ_MIC_ID = "reqMic";
const STOP_MIC_ID = "stopMic";
const START_BTN_ID = "startBtn";
const STOP_BTN_ID = "stopBtn";
const SENS_ID = "sensitivity";
const SENS_VAL_ID = "sensVal";
const SCORE_ID = "score";
const REC_START_ID = "recStart";
const REC_STOP_ID = "recStop";
const LABEL_INPUT_ID = "labelInput";
const UPLOAD_PROGRESS_ID = "uploadProgress";
const UPLOAD_MSG_ID = "uploadMsg";
const STORED_INFO_ID = "storedInfo";
const CLIPS_LIST_ID = "clipsList";
const DEBUG_INFO_ID = "debugInfo";

const GRAVITY = 0.55;          // gravity for hero
const BASE_JUMP = -8;         // base upward impulse
const JUMP_COOLDOWN = 140;    // milliseconds between RMS-triggered jumps
const OBSTACLE_ACCEL = 0.02;  // how speed scales with score

/* =========================
   Optional Firebase hooks
   =========================
If you want to enable storage + realtime DB integration:
1) Paste your firebaseConfig object below and uncomment the import + init lines.
2) Uncomment uploadClip() calls in the recorder/upload area.
*/
// import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
// import { getStorage, ref as stRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";
// import { getDatabase, ref as dbRef, push as dbPush, set as dbSet } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
// import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
// const firebaseConfig = { /* paste your firebase config here if you want upload/score saving */ };
// let firebaseApp, storage, database, auth;

/* =========================
   State
   ========================= */
let canvas, ctx;
let width, height;

let running = false;
let score = 0;
let gameSpeed = 2.6;

let hero = { x: 130, y: 180, w: 36, h: 36, vy: 0 };
let obstacles = [];
let spawnTimer = 0;
let spawnEvery = 110;

let micStream = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let rmsLoop = null;
let lastJumpAt = 0;

let mediaRecorder = null;
let recordedBlobs = [];

let storedClip = null; // { url, label, createdAt } — can be set when we upload or load clips

/* =========================
   DOM refs
   ========================= */
const $ = id => document.getElementById(id);
const reqMicBtn = $(REQ_MIC_ID);
const stopMicBtn = $(STOP_MIC_ID);
const startBtn = $(START_BTN_ID);
const stopBtn = $(STOP_BTN_ID);
const sens = $(SENS_ID);
const sensVal = $(SENS_VAL_ID);
const scoreEl = $(SCORE_ID);
const recStartBtn = $(REC_START_ID);
const recStopBtn = $(REC_STOP_ID);
const labelInput = $(LABEL_INPUT_ID);
const uploadProgress = $(UPLOAD_PROGRESS_ID);
const uploadMsg = $(UPLOAD_MSG_ID);
const storedInfo = $(STORED_INFO_ID);
const clipsList = $(CLIPS_LIST_ID);
const debugInfo = $(DEBUG_INFO_ID);

/* =========================
   Helpers
   ========================= */
function logDebug(msg) {
  if (debugInfo) debugInfo.textContent = String(msg);
  // also console for deeper debugging
  console.debug("[ScreamGoHero] ", msg);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* =========================
   Canvas & drawing
   ========================= */
function setupCanvas() {
  canvas = $(CANVAS_ID);
  if (!canvas) throw new Error("Canvas element not found: " + CANVAS_ID);
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  // keep internal resolution fixed but scale CSS size responsively
  width = canvas.width;
  height = canvas.height;
  // nothing else to do; our canvas is fixed 900x420 as per HTML
}

function clearCanvas() {
  ctx.clearRect(0, 0, width, height);
}

/* draw background: tiled scrolling bg image (fetched from HTML user's URL earlier) */
const BACKGROUND_URL = "https://img.itch.zone/aW1nLzQ1MzE4MzIucG5n/original/tzKyzs.png"; // user-provided
const bgImage = new Image();
bgImage.src = BACKGROUND_URL;
let bgOffset = 0;

/* small hand-drawn hero (so it doesn't look AI-generated) */
function drawHero(hero) {
  const { x, y, w, h } = hero;
  // body (rounded)
  ctx.fillStyle = "#0b0b0b";
  roundRect(ctx, x, y, w, h, 6, true);
  // small white eye
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + w * 0.58, y + h * 0.18, Math.max(2, w * 0.16), Math.max(2, h * 0.16));
  // red headband
  ctx.fillStyle = "#ff2d4b";
  ctx.fillRect(x - 4, y + h * 0.06, w + 8, Math.max(6, h * 0.16));
  // headband tail
  ctx.beginPath();
  ctx.moveTo(x + w + 2, y + h * 0.10);
  ctx.lineTo(x + w + 22, y - 6);
  ctx.lineTo(x + w + 10, y + 14);
  ctx.closePath();
  ctx.fill();
}

function drawObstacles() {
  ctx.fillStyle = "#0b0b0b";
  for (let o of obstacles) {
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }
}

function drawHUD() {
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "14px 'Rubik', sans-serif";
  ctx.fillText("Scream louder to jump higher!", 12, 22);
  // score in top-left
  ctx.font = "bold 18px 'Inter', sans-serif";
  ctx.fillText("Score: " + Math.floor(score), width - 110, 28);
}

/* roundRect helper */
function roundRect(ctx, x, y, w, h, r, fill = true) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
}

/* =========================
   Game loop & update
   ========================= */
function startGameLoop() {
  running = true;
  score = 0;
  gameSpeed = 2.6;
  hero.y = height / 2 - hero.h / 2;
  hero.vy = 0;
  obstacles = [];
  spawnTimer = 0;
  bgOffset = 0;
  requestAnimationFrame(tick);
  logDebug("Game started. Mic permission will be requested on Start if not granted.");
}

function stopGameLoop() {
  running = false;
  stopRMSLoop();
  logDebug("Game stopped. Score: " + Math.floor(score));
}

function tick() {
  if (!running) return;
  update();
  render();
  requestAnimationFrame(tick);
}

function update() {
  // hero physics
  hero.vy += GRAVITY;
  hero.y += hero.vy;
  // ground collision
  if (hero.y + hero.h > height - 36) {
    hero.y = height - 36 - hero.h;
    hero.vy = 0;
    stopGameLoop(); // hit ground -> end
    return;
  }
  if (hero.y < 0) {
    hero.y = 0;
    hero.vy = 0;
  }

  // obstacles move left
  for (let o of obstacles) {
    o.x -= (gameSpeed + Math.min(4, score * OBSTACLE_ACCEL));
  }
  // remove off-screen obstacles
  obstacles = obstacles.filter(o => o.x + o.w > -40);

  // spawn obstacles (pairs: top + bottom)
  spawnTimer++;
  const effectiveSpawn = Math.max(70, spawnEvery - Math.floor(score / 12));
  if (spawnTimer > effectiveSpawn) {
    spawnTimer = 0;
    spawnPair();
  }

  // collision
  for (let o of obstacles) {
    if (rectIntersect({ x: hero.x, y: hero.y, w: hero.w, h: hero.h }, o)) {
      stopGameLoop();
      return;
    }
  }

  // scoring - each pair's top pipe when passed
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.isTop && !o.passed && o.x + o.w < hero.x) {
      o.passed = true;
      score += 1;
      // small speed increase
      gameSpeed += 0.03;
    }
  }
}

/* spawn a top+bottom pipe pair */
function spawnPair() {
  const gap = 110 + Math.random() * 70;
  const topHeight = 50 + Math.random() * (height - 260);
  const w = 56;
  const xStart = width + 20;
  obstacles.push({ x: xStart, y: 0, w: w, h: topHeight, isTop: true });
  obstacles.push({ x: xStart, y: topHeight + gap, w: w, h: height - (topHeight + gap) - 36, isTop: false });
}

/* render everything */
function render() {
  // background
  if (bgImage.complete) {
    // tile the bg horizontally
    const bw = width;
    bgOffset = (bgOffset - (gameSpeed * 0.5)) % bw;
    ctx.drawImage(bgImage, bgOffset, 0, bw, height);
    ctx.drawImage(bgImage, bgOffset + bw, 0, bw, height);
  } else {
    ctx.fillStyle = "#88c0ff";
    ctx.fillRect(0, 0, width, height);
  }

  // ground
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(0, height - 36, width, 36);

  // obstacles
  drawObstacles();

  // hero
  drawHero(hero);

  // HUD
  drawHUD();
}

/* intersection helper */
function rectIntersect(a, b) {
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

/* =========================
   Audio / Microphone
   ========================= */
async function ensureMicPermission() {
  // call getUserMedia only after a user gesture. Start Game triggers this.
  if (micStream) return micStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // resume audio context in case of autoplay policy
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    dataArray = new Uint8Array(analyser.fftSize);
    reqMicBtn.disabled = true;
    stopMicBtn.disabled = false;
    startRMSLoop();
    logDebug("Mic ready and streaming.");
    return micStream;
  } catch (err) {
    console.error("Mic error:", err);
    alert("Microphone permission is required to play. Please allow microphone access and try again.");
    throw err;
  }
}

function stopMic() {
  try {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    analyser = null;
    dataArray = null;
  } finally {
    reqMicBtn.disabled = false;
    stopMicBtn.disabled = true;
    stopRMSLoop();
    logDebug("Mic stopped.");
  }
}

function startRMSLoop() {
  if (!analyser || rmsLoop) return;
  function loop() {
    analyser.getByteTimeDomainData(dataArray);
    // compute RMS
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    handleRMS(rms);
    rmsLoop = requestAnimationFrame(loop);
  }
  loop();
}

function stopRMSLoop() {
  if (rmsLoop) cancelAnimationFrame(rmsLoop);
  rmsLoop = null;
}

/* Called every frame of RMS loop */
function handleRMS(rms) {
  // small smoothing could be added, but raw works fine for these screams
  const threshold = parseFloat(sens.value);
  // if rms is above threshold and cooldown passed -> jump
  const now = performance.now();
  if (rms > threshold && now - lastJumpAt > JUMP_COOLDOWN) {
    lastJumpAt = now;
    // louder means bigger jump: scale factor based on RMS distance above threshold
    const loudness = clamp((rms - threshold) / (0.4 - threshold), 0, 1); // 0..1
    const extra = loudness * 12; // up to +12 impulse
    hero.vy = BASE_JUMP - extra;
    // try to play stored clip if present
    playStoredClip();
  }
}

/* =========================
   Recording & Upload (optional)
   ========================= */
recStartBtn && (recStartBtn.onclick = async () => {
  // ensure mic is available
  try {
    await ensureMicPermission();
    recordedBlobs = [];
    mediaRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });
  } catch (e) {
    console.warn("Recording failed to start:", e);
    return;
  }
  mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size) recordedBlobs.push(e.data);
  };
  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedBlobs, { type: "audio/webm" });
    // create a local preview and store metadata locally
    const url = URL.createObjectURL(blob);
    storedClip = { url, blob, label: labelInput.value || ("scream_" + Date.now()), createdAt: Date.now() };
    updateStoredInfo();
    // OPTIONAL: if you want to upload to firebase, call uploadClip(blob, storedClip.label)
    // await uploadClip(blob, storedClip.label);
  };
  mediaRecorder.start();
  recStartBtn.disabled = true;
  recStopBtn.disabled = false;
  uploadMsg && (uploadMsg.textContent = "Recording...");
});

recStopBtn && (recStopBtn.onclick = () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  recStartBtn.disabled = false;
  recStopBtn.disabled = true;
  uploadMsg && (uploadMsg.textContent = "Processing...");
});

/* update UI area describing stored clip */
function updateStoredInfo() {
  if (!storedInfo) return;
  if (!storedClip) {
    storedInfo.textContent = "No stored scream yet.";
    return;
  }
  storedInfo.innerHTML = `Stored: <strong>${escapeHtml(storedClip.label || "scream")}</strong> — <small>${new Date(storedClip.createdAt || Date.now()).toLocaleString()}</small>
    <div class="stored-actions">
      <button id="playStoredBtn" class="btn">Play</button>
      <button id="downloadStoredBtn" class="btn">Download</button>
    </div>`;
  // wire buttons
  setTimeout(() => {
    const playB = document.getElementById("playStoredBtn");
    const dlB = document.getElementById("downloadStoredBtn");
    if (playB) playB.onclick = () => playStoredClip();
    if (dlB) dlB.onclick = () => {
      if (!storedClip) return;
      if (storedClip.blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(storedClip.blob);
        a.download = (storedClip.label || "scream") + ".webm";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (storedClip.url) {
        const a = document.createElement("a");
        a.href = storedClip.url;
        a.download = (storedClip.label || "scream") + ".webm";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };
  }, 60);
}

/* simple HTML escape for labels in UI */
function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

/* play stored clip if any */
function playStoredClip() {
  if (!storedClip) return;
  // prefer blob (local) then url
  try {
    if (storedClip.blob) {
      const u = URL.createObjectURL(storedClip.blob);
      const a = new Audio(u);
      a.play().catch(()=>{});
    } else if (storedClip.url) {
      const a = new Audio(storedClip.url);
      a.play().catch(()=>{});
    }
  } catch (e) {
    console.warn("playStoredClip error", e);
  }
}

/* =========================
   Upload helper (optional Firebase)
   =========================
Uncomment and wire firebase imports above to enable. The function expects firebase storage + database available.
*/
async function uploadClip(blob, label) {
  // this function intentionally left as a placeholder. paste your config above then implement:
  //  - create a storage ref under voices/{uid}/{timestamp}_{label}.webm
  //  - uploadBytesResumable and track uploadProgress UI
  //  - getDownloadURL and save metadata to realtime DB under /voices
  // Example steps are provided in the HTML file comments earlier.
  uploadMsg && (uploadMsg.textContent = "Upload not configured. Paste firebase config in game.js to enable.");
}

/* =========================
   Event wiring and lifecycle
   ========================= */
function wireUI() {
  // request mic button (explicit)
  reqMicBtn && (reqMicBtn.onclick = async () => {
    try {
      await ensureMicPermission();
      logDebug("Mic permission granted via Request Mic button.");
    } catch (e) {
      logDebug("User denied mic permission or error: " + e.message);
    }
  });

  stopMicBtn && (stopMicBtn.onclick = () => {
    stopMic();
  });

  // Start game: must be a user gesture to allow getUserMedia + AudioContext resume
  startBtn && (startBtn.onclick = async () => {
    // ensure mic first — this will trigger browser permission dialog if needed.
    try {
      await ensureMicPermission();
    } catch (e) {
      // user denied mic -> still allow start (so tapping/canvas works), but show a warning
      const proceed = confirm("Microphone permission was not granted. You can still play with tap to jump, but voice won't work. Start anyway?");
      if (!proceed) return;
    }
    // start the game loop
    startGameLoop();
    startBtn.disabled = true;
    stopBtn.disabled = false;
  });

  stopBtn && (stopBtn.onclick = () => {
    stopGameLoop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });

  // sensitivity UI mirror
  sens && (sens.oninput = () => {
    if (sensVal) sensVal.textContent = sens.value;
  });

  // canvas tap fallback - use event delegation to find canvas
  const canvasEl = document.getElementById(CANVAS_ID);
  if (canvasEl) {
    canvasEl.addEventListener("click", () => {
      // small jump for tap
      hero.vy = -10;
    });
  }

  // clean up on unload
  window.addEventListener("beforeunload", () => {
    stopRMSLoop();
    stopMic();
  });
}

/* =========================
   Utilities
   ========================= */
function rectIntersect(a, b) {
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

/* =========================
   Init
   ========================= */
function init() {
  try {
    setupCanvas();
  } catch (err) {
    console.error("Init error:", err);
    return;
  }

  // set initial hero positioning relative to canvas
  if (!canvas) return;
  hero.y = canvas.height / 2 - hero.h / 2;

  wireUI();
  updateStoredInfo();
  logDebug("Initialized. Press Start Game to begin. On GitHub Pages you'll be prompted to allow microphone access when you press the Start button.");
}

/* start */
init();

/* =========================
   End of file
   ========================= */
