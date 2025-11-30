// script.js - frontend for KK local music server
(async () => {
  const API_BASE = "";
  const servePathEl = document.getElementById("servePath");
  const tracksList = document.getElementById("tracksList");
  const audio = document.getElementById("audio");
  const playBtn = document.getElementById("play");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const seek = document.getElementById("seek");
  const curTime = document.getElementById("curTime");
  const durTime = document.getElementById("durTime");
  const volume = document.getElementById("volume");
  const muteBtn = document.getElementById("mute");
  const shuffleBtn = document.getElementById("shuffle");
  const repeatBtn = document.getElementById("repeat");
  const rateSel = document.getElementById("rate");
  const rescanBtn = document.getElementById("rescanBtn");
  const searchBox = document.getElementById("searchBox");
  const filterExt = document.getElementById("filterExt");
  const sortBtn = document.getElementById("sortBtn");
  const exportBtn = document.getElementById("exportBtn");
  const clearBtn = document.getElementById("clearBtn");
  const savePl = document.getElementById("savePl");
  const plName = document.getElementById("plName");
  const plSelect = document.getElementById("plSelect");
  const loadPl = document.getElementById("loadPl");
  const delPl = document.getElementById("delPl");
  const bass = document.getElementById("bass");
  const treble = document.getElementById("treble");
  const crossfade = document.getElementById("crossfade");
  const rate = document.getElementById("rate");
  const artImg = document.getElementById("art");
  const visCanvas = document.getElementById("vis");
  const servePath = document.getElementById("servePath");

  let files = []; // all files from server
  let filtered = [];
  let current = -1;
  let isShuffle = false;
  let repeatMode = 0;
  let favorites = new Set();
  let playlists = {};
  let queue = [];
  let crossfadeMs = 0;

  // WebAudio setup for visualizer + filters
  let audioCtx, analyser, sourceNode, dataArray, gainNode, bassFilter, trebleFilter;
  function ensureAudioCtx() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    gainNode = audioCtx.createGain();
    bassFilter = audioCtx.createBiquadFilter(); bassFilter.type = "lowshelf";
    trebleFilter = audioCtx.createBiquadFilter(); trebleFilter.type = "highshelf";
    sourceNode = audioCtx.createMediaElementSource(audio);
    // chain: source -> bass -> treble -> gain -> analyser -> dst
    sourceNode.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    trebleFilter.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    drawVis();
  }

  function drawVis(){
    const canvas = visCanvas;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = 80;
    function frame(){
      requestAnimationFrame(frame);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0,0,W,H);
      const barWidth = (W / dataArray.length) * 1.2;
      let x = 0;
      for (let i=0;i<dataArray.length;i++){
        const v = dataArray[i] / 255;
        const h = v * H;
        ctx.fillStyle = `hsl(${220 - (v*140)}, 80%, 60%)`;
        ctx.fillRect(x, H - h, barWidth, h);
        x += barWidth + 1;
      }
    }
    frame();
  }

  // Utility fetch list
  async function fetchList(){
    const res = await fetch("/api/list");
    const j = await res.json();
    files = j.files || [];
    favorites = new Set(j.favorites || []);
    playlists = j.playlists || {};
    servePath.textContent = "Configured folder";
    filtered = files.slice();
    renderPlaylist();
    renderPlaylists();
  }

  function formatTime(s){
    if (!s) return "0:00";
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60).toString().padStart(2,"0");
    return `${m}:${sec}`;
  }

  // Render tracks
  function renderPlaylist(){
    tracksList.innerHTML = "";
    const list = filtered;
    list.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "track";
      const left = document.createElement("div");
      const title = document.createElement("div"); title.textContent = t.title || t.name; title.className="meta";
      const sub = document.createElement("div"); sub.textContent = `${t.artist || ""} ${t.duration? "• "+formatTime(t.duration):""}`; sub.className="muted";
      left.appendChild(title); left.appendChild(sub);
      const actions = document.createElement("div"); actions.className="track-actions";
      const fav = document.createElement("button"); fav.textContent = favorites.has(t.relpath) ? "★" : "☆"; fav.className="btn";
      fav.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (favorites.has(t.relpath)) {
          await fetch("/api/fav", {method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({relpath:t.relpath})});
          favorites.delete(t.relpath);
        } else {
          await fetch("/api/fav",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({relpath:t.relpath})});
          favorites.add(t.relpath);
        }
        renderPlaylist();
      });
      const play = document.createElement("button"); play.textContent="Play"; play.className="btn";
      play.addEventListener("click", (ev)=>{ ev.stopPropagation(); playByIndex(i); });
      const addq = document.createElement("button"); addq.textContent="Queue"; addq.className="btn";
      addq.addEventListener("click",(ev)=>{ ev.stopPropagation(); queue.push(list[i]); });
      const dl = document.createElement("a"); dl.textContent="Download"; dl.href = `/stream/${encodeURIComponent(t.relpath)}`; dl.download = t.name; dl.className="btn";
      actions.appendChild(fav); actions.appendChild(play); actions.appendChild(addq); actions.appendChild(dl);

      li.appendChild(left); li.appendChild(actions);
      li.addEventListener('click', ()=> playByIndex(i));
      tracksList.appendChild(li);
    });
  }

  // playlist operations
  function renderPlaylists(){
    plSelect.innerHTML = "";
    Object.keys(playlists || {}).forEach(name => {
      const o = document.createElement("option"); o.value = name; o.textContent = name;
      plSelect.appendChild(o);
    });
  }

  // search & filter
  searchBox.addEventListener('input', ()=> {
    const q = searchBox.value.trim().toLowerCase();
    filtered = files.filter(f => {
      const keepExt = !filterExt.value || f.name.toLowerCase().endsWith(filterExt.value);
      const keepQ = !q || (f.name.toLowerCase().includes(q) || (f.title||"").toLowerCase().includes(q));
      return keepExt && keepQ;
    });
    renderPlaylist();
  });

  filterExt.addEventListener('change', ()=> searchBox.dispatchEvent(new Event('input')));

  sortBtn.addEventListener('click', ()=> {
    filtered.sort((a,b)=> a.name.localeCompare(b.name));
    renderPlaylist();
  });

  rescanBtn.addEventListener('click', async ()=>{
    const r = await fetch("/api/rescan",{method:"POST"});
    const j = await r.json();
    files = j.files || [];
    filtered = files.slice();
    renderPlaylist();
  });

  // playback controls
  playBtn.addEventListener('click', ()=> {
    if (audio.paused) audio.play(); else audio.pause();
  });
  prevBtn.addEventListener('click', ()=> prevTrack());
  nextBtn.addEventListener('click', ()=> nextTrack());
  shuffleBtn.addEventListener('click', ()=> { isShuffle=!isShuffle; shuffleBtn.textContent = isShuffle ? "Shuffle: on" : "Shuffle"; });
  repeatBtn.addEventListener('click', ()=> { repeatMode=(repeatMode+1)%3; const l=["Repeat: off","Repeat: all","Repeat: one"]; repeatBtn.textContent = l[repeatMode];});

  volume.addEventListener('input', ()=> {
    audio.volume = Number(volume.value);
  });
  muteBtn.addEventListener('click', ()=> {
    audio.muted = !audio.muted; muteBtn.textContent = audio.muted ? "Unmute" : "Mute";
  });
  rate.addEventListener('change', ()=> audio.playbackRate = Number(rate.value));

  seek.addEventListener('input', ()=> audio.currentTime = Number(seek.value));
  audio.addEventListener('timeupdate', ()=> {
    seek.max = Math.floor(audio.duration || 0);
    seek.value = Math.floor(audio.currentTime || 0);
    curTime.textContent = formatTime(audio.currentTime || 0);
    durTime.textContent = formatTime(audio.duration || 0);
  });

  audio.addEventListener('play', ()=> playBtn.textContent = "⏸");
  audio.addEventListener('pause', ()=> playBtn.textContent = "▶");

  audio.addEventListener('ended', ()=> {
    if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
    if (queue.length) { const q = queue.shift(); playTrackObj(q); return; }
    if (isShuffle) { playRandom(); return; }
    // next in filtered
    const nextIdx = current+1;
    if (nextIdx < filtered.length) playByIndex(nextIdx);
    else if (repeatMode === 1) playByIndex(0);
  });

  function playRandom(){ if (!filtered.length) return; const i = Math.floor(Math.random()*filtered.length); playByIndex(i); }
  function prevTrack(){ if (audio.currentTime > 3) { audio.currentTime = 0; } else { const prev = Math.max(0, current-1); playByIndex(prev); } }
  function nextTrack(){ if (isShuffle) { playRandom(); return; } const nxt = (current+1); if (nxt < filtered.length) playByIndex(nxt); else if (repeatMode===1) playByIndex(0); }

  function playByIndex(i){
    const t = filtered[i];
    if (!t) return;
    current = i;
    playTrackObj(t);
    updateNowMeta(t);
  }

  async function playTrackObj(t){
    // ensure audioCtx initialized
    ensureAudioCtx();
    crossfadeMs = Number(crossfade.value) || 0;
    const url = `/stream/${encodeURIComponent(t.relpath)}`;
    // implement crossfade if required (simple fade)
    if (crossfadeMs > 0 && !audio.paused) {
      const oldVol = audio.volume;
      const steps = 10;
      const stepDelay = crossfadeMs / steps;
      // fade out
      for (let i=steps;i>=0;i--){
        audio.volume = oldVol * (i/steps);
        await new Promise(r=>setTimeout(r, stepDelay));
      }
      audio.pause();
    }
    audio.src = url;
    audio.playbackRate = Number(rate.value) || 1;
    audio.volume = Number(volume.value) || 0.9;
    await audio.play();
    // show album art if available
    try {
      const res = await fetch(`/api/art/${encodeURIComponent(t.relpath)}`);
      if (res.ok) {
        artImg.src = `/api/art/${encodeURIComponent(t.relpath)}`;
        artImg.classList.remove("hidden");
      } else {
        artImg.classList.add("hidden");
      }
    } catch (err) {
      artImg.classList.add("hidden");
    }
  }

  function updateNowMeta(t){
    document.getElementById("nowTitle").textContent = t.title || t.name;
    document.getElementById("nowMeta").textContent = `${t.artist || ""} • ${t.duration ? formatTime(t.duration) : ""}`;
  }

  // favorites clear
  clearBtn.addEventListener('click', async ()=> {
    // delete all favorites via API by iterating
    for (const f of favorites) {
      await fetch("/api/fav",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({relpath:f})});
    }
    favorites.clear();
    renderPlaylist();
  });

  // playlists save/load/delete
  savePl.addEventListener('click', async ()=>{
    const name = plName.value.trim();
    if (!name) return alert("Give playlist name");
    // save current filtered order as playlist
    const rels = filtered.map(f=>f.relpath);
    await fetch("/api/playlists",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,tracks:rels})});
    const resp = await fetch("/api/list");
    const j = await resp.json();
    playlists = j.playlists || {};
    renderPlaylists();
  });

  loadPl.addEventListener('click', ()=> {
    const name = plSelect.value;
    if (!name) return;
    const rels = playlists[name] || [];
    filtered = rels.map(r => files.find(f => f.relpath === r)).filter(Boolean);
    renderPlaylist();
  });

  delPl.addEventListener('click', async ()=> {
    const name = plSelect.value;
    if (!name) return;
    await fetch("/api/playlists",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
    const resp = await fetch("/api/list");
    const j = await resp.json();
    playlists = j.playlists || {};
    renderPlaylists();
  });

  function renderPlaylists(){
    plSelect.innerHTML = "";
    Object.keys(playlists || {}).forEach(k => {
      const o = document.createElement("option"); o.value = k; o.textContent = k;
      plSelect.appendChild(o);
    });
  }

  exportBtn.addEventListener('click', ()=> {
    const toExport = filtered.map(f => ({name:f.name, relpath: f.relpath, title: f.title, fav: favorites.has(f.relpath)}));
    const blob = new Blob([JSON.stringify(toExport, null, 2)], {type:"application/json"});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "export_playlist.json"; a.click();
  });

  // EQ controls
  bass.addEventListener('input', ()=> {
    ensureAudioCtx();
    bassFilter.gain.value = Number(bass.value);
  });
  treble.addEventListener('input', ()=> {
    ensureAudioCtx();
    trebleFilter.gain.value = Number(treble.value);
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); if (audio.paused) audio.play(); else audio.pause(); }
    if (e.key === 'ArrowRight') nextTrack();
    if (e.key === 'ArrowLeft') prevTrack();
    if (e.key.toLowerCase() === 's') { isShuffle=!isShuffle; shuffleBtn.textContent = isShuffle ? "Shuffle: on" : "Shuffle"; }
    if (e.key.toLowerCase() === 'r') { repeatMode=(repeatMode+1)%3; const l=["Repeat: off","Repeat: all","Repeat: one"]; repeatBtn.textContent = l[repeatMode]; }
    if (e.key.toLowerCase() === 'l') { audio.loop = !audio.loop; }
  });

  // initial fetch
  await fetchList();

  // small helpers:
  function ensureAudioCtx(){
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      bassFilter = audioCtx.createBiquadFilter(); bassFilter.type = "lowshelf";
      trebleFilter = audioCtx.createBiquadFilter(); trebleFilter.type = "highshelf";
      gainNode = audioCtx.createGain();
      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(bassFilter);
      bassFilter.connect(trebleFilter);
      trebleFilter.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      drawVis();
    }
  }

  function drawVis(){
    const canvas = visCanvas;
    const ctx = canvas.getContext('2d');
    function raf(){
      requestAnimationFrame(raf);
      if (!analyser) return;
      analyser.getByteFrequencyData(dataArray);
      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = 80;
      ctx.clearRect(0,0,W,H);
      const barWidth = (W / dataArray.length) * 1.2;
      let x = 0;
      for (let i=0;i<dataArray.length;i++){
        const v = dataArray[i]/255;
        const h = v * H;
        ctx.fillStyle = `hsl(${220 - (v*140)},80%,60%)`;
        ctx.fillRect(x, H - h, barWidth, h);
        x += barWidth + 1;
      }
    }
    raf();
  }

})();
