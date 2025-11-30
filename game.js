// game.js
// Scream Go Hero — simple endless flappy-like with mic amplitude control

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const reqMicBtn = document.getElementById('reqMic');
const stopMicBtn = document.getElementById('stopMic');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sensSlider = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const scoreEl = document.getElementById('score');

sensVal.textContent = sensSlider.value;
sensSlider.addEventListener('input', ()=> sensVal.textContent = sensSlider.value);

// ---------- background image (user-provided) ----------
const bg = new Image();
bg.src = "https://img.itch.zone/aW1nLzQ1MzE4MzIucG5n/original/tzKyzs.png"; // provided background url
let bgX = 0;

// ---------- game state ----------
let running = false;
let score = 0;
let speed = 2.8;

const hero = { x: 140, y: 200, w: 34, h: 36, vy: 0 };
const gravity = 0.6;
const jumpBase = -7;

let obstacles = [];
let spawnTimer = 0;
const spawnIntervalBase = 110;

// ---------- audio/mic ----------
let micStream = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let rmsLoop = null;
let lastJump = 0;
const jumpCooldown = 160; // ms

async function startMic(){
  if(micStream) return;
  try{
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    dataArray = new Uint8Array(analyser.fftSize);
    reqMicBtn.disabled = true;
    stopMicBtn.disabled = false;
    startRMSLoop();
    log("Mic active");
  }catch(e){
    alert("Microphone permission denied or unavailable.\n" + e.message);
  }
}

function stopMic(){
  if(!micStream) return;
  stopRMSLoop();
  micStream.getTracks().forEach(t=>t.stop());
  micStream = null;
  audioCtx && audioCtx.close();
  audioCtx = null;
  analyser = null;
  dataArray = null;
  reqMicBtn.disabled = false;
  stopMicBtn.disabled = true;
  log("Mic stopped");
}

function startRMSLoop(){
  if(!analyser) return;
  if(rmsLoop) return;
  function loop(){
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for(let i=0;i<dataArray.length;i++){
      const v = (dataArray[i] - 128) / 128;
      sum += v*v;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    handleRMS(rms);
    rmsLoop = requestAnimationFrame(loop);
  }
  loop();
}

function stopRMSLoop(){
  if(rmsLoop){ cancelAnimationFrame(rmsLoop); rmsLoop = null; }
}

function handleRMS(rms){
  const thresh = parseFloat(sensSlider.value);
  // if RMS goes above threshold, trigger jump (cooldown applied)
  const now = performance.now();
  if(rms > thresh && (now - lastJump) > jumpCooldown){
    lastJump = now;
    const loudnessFactor = Math.min(1, (rms - thresh) / (0.35 - thresh)); // scale 0..1
    const extra = loudnessFactor * 12; // louder → higher jump
    jump(jumpBase - extra);
  }
}

// ---------- controls wiring ----------
reqMicBtn.onclick = () => startMic();
stopMicBtn.onclick = () => stopMic();

startBtn.onclick = () => startGame();
stopBtn.onclick = () => stopGame();

canvas.addEventListener('click', () => jump(-10)); // fallback tap

// ---------- game functions ----------
function resetGame(){
  score = 0;
  speed = 2.8;
  obstacles = [];
  spawnTimer = 0;
  hero.y = canvas.height / 2;
  hero.vy = 0;
  bgX = 0;
  scoreEl.textContent = score;
}

function startGame(){
  if(running) return;
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  resetGame();
  loop();
  // ensure mic loop is active if mic already enabled
  if(analyser && !rmsLoop) startRMSLoop();
}

function stopGame(){
  if(!running) return;
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  stopRMSLoop();
  log("Game over. Score: " + Math.floor(score));
}

function jump(force = -9){
  hero.vy = force;
}

function spawnObstacle(){
  const gap = 110 + Math.random()*70;
  const topH = 60 + Math.random() * (canvas.height - 260);
  const obsW = 56;
  // top pipe
  obstacles.push({ x: canvas.width + 10, w: obsW, y: 0, h: topH, type: 'top' });
  // bottom pipe
  obstacles.push({ x: canvas.width + 10, w: obsW, y: topH + gap, h: canvas.height - (topH + gap) , type: 'bottom' });
}

function rectsIntersect(a,b){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

function loop(){
  update();
  draw();
  if(running) requestAnimationFrame(loop);
}

function update(){
  // hero physics
  hero.vy += gravity;
  hero.y += hero.vy;
  // ground & ceiling
  if(hero.y + hero.h > canvas.height - 36){
    hero.y = canvas.height - 36 - hero.h;
    hero.vy = 0;
    // hit ground -> end
    stopGame();
  }
  if(hero.y < 0){
    hero.y = 0;
    hero.vy = 0;
  }

  // obstacles movement
  for(let o of obstacles){
    o.x -= (speed + Math.min(3.5, score/150));
  }
  obstacles = obstacles.filter(o => o.x + o.w > -50);

  // spawn logic
  spawnTimer++;
  const interval = Math.max(70, spawnIntervalBase - Math.floor(score/12));
  if(spawnTimer > interval){
    spawnTimer = 0;
    spawnObstacle();
  }

  // collision check with both top and bottom pipes
  for(let o of obstacles){
    const rect = { x:o.x, y:o.y, w:o.w, h:o.h };
    const heroRect = { x: hero.x, y: hero.y, w: hero.w, h: hero.h };
    if(rectsIntersect(rect, heroRect)){
      stopGame();
    }
  }

  // scoring: when an obstacle pair passes hero (use the top ones)
  for(let i = 0; i < obstacles.length; i++){
    const o = obstacles[i];
    if(o.type === 'top' && !o.passed && o.x + o.w < hero.x){
      o.passed = true;
      score += 1;
      speed += 0.03;
    }
  }

  scoreEl.textContent = Math.floor(score);
  // background parallax
  bgX = (bgX - (speed/2)) % canvas.width;
}

// ---------- drawing ----------
function draw(){
  // background
  if(bg.complete){
    // draw tiled scrolling bg
    const bw = canvas.width;
    ctx.drawImage(bg, bgX, 0, bw, canvas.height);
    ctx.drawImage(bg, bgX + bw, 0, bw, canvas.height);
  } else {
    ctx.fillStyle = "#87c9ff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, canvas.height - 36, canvas.width, 36);

  // draw hero (simple stylized sprite: black body + red headband)
  const hx = hero.x, hy = hero.y, hw = hero.w, hh = hero.h;
  // body
  ctx.fillStyle = "#0b0b0b";
  roundRect(ctx, hx, hy, hw, hh, 6, true, false);
  // eye
  ctx.fillStyle = "#fff";
  ctx.fillRect(hx + hw*0.6, hy + hh*0.25, hw*0.18, hh*0.18);
  // headband
  ctx.fillStyle = "#ff3b58";
  ctx.fillRect(hx - 4, hy + hh*0.05, hw + 8, hh*0.18);
  // tail of band
  ctx.beginPath();
  ctx.moveTo(hx + hw + 4, hy + hh*0.1);
  ctx.lineTo(hx + hw + 22, hy - 2);
  ctx.lineTo(hx + hw + 12, hy + 12);
  ctx.fill();

  // obstacles (pipes)
  ctx.fillStyle = "#111";
  for(let o of obstacles){
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }

  // HUD small text
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "14px Arial";
  ctx.fillText("Scream louder to jump higher!", 12, 22);
}

// helper: rounded rect
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof stroke === 'undefined') { stroke = true; }
  if (typeof r === 'undefined') { r = 5; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ---------- small logger for console-ish feedback (not required) ----------
function log(s){
  // you can expand this to show messages on-screen
  console.log(s);
}

// cleanup on unload
window.addEventListener('beforeunload', () => {
  stopRMSLoop();
  stopMic();
});

function stopRMSLoop(){ if(rmsLoop){ cancelAnimationFrame(rmsLoop); rmsLoop = null; } }

// initial draw
bg.onload = () => { draw(); };
draw();
