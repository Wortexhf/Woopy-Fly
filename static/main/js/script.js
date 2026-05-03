// ════════════════════════════════════════════════════════════
//  WoopyFly — script.js
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  localStorage helpers
// ════════════════════════════════════════════════════════════
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Останні відтворені треки (max 10)
function addRecentTrack(track) {
  if (!track?.title) return;
  // Унікальний ключ — id якщо є, інакше external_url або audio_url
  const key = track.id ? String(track.id) : (track.external_url || track.audio_url || track.title);
  let recent = LS.get('woopy_recent', []);
  recent = recent.filter(t => {
    const tk = t.id ? String(t.id) : (t.external_url || t.audio_url || t.title);
    return tk !== key;
  });
  recent.unshift({
    id:           track.id || null,
    title:        track.title,
    artist:       track.artist || '',
    cover:        track.cover || track.coverUrl || '',
    source:       track.source || 'file',
    audio_url:    track.audio_url || '',
    external_url: track.external_url || '',
    previewUrl:   track.previewUrl || '',
    duration:     track.duration || '0:00',
    liked:        track.liked || false,
  });
  recent = recent.slice(0, 10);
  LS.set('woopy_recent', recent);
}

function getRecentTracks() { return LS.get('woopy_recent', []); }

// Історія пошуку (max 4)
function addSearchHistory(query) {
  if (!query?.trim()) return;
  let hist = LS.get('woopy_search_hist', []);
  hist = hist.filter(q => q !== query);
  hist.unshift(query);
  hist = hist.slice(0, 4);
  LS.set('woopy_search_hist', hist);
}

function getSearchHistory() { return LS.get('woopy_search_hist', []); }

let currentPlaylist   = [];
let allTracks         = [];
let cur               = 0;
let playing           = false;
let shuffled          = false;
let repeated          = false;
let muted             = false;
let currentView       = 'home';
let currentPlaylistId = null;
let isSeeking         = false;

const audio = new Audio();
audio.volume  = 0.8;
audio.preload = 'metadata';

let fakeTimer    = null;
let fakePct      = 0;
let fakeTotalSec = 0;

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindProgressBar();
  bindVolume();
  loadAllTracks();
  loadPlaylists();
  setupSearch();
  setupNav();
  setupUploadModal();
  setupPlaylistModal();
  setTrackDisplay(null);
});

// ─── API helpers ─────────────────────────────────────────────
async function api(url, opts = {}) {
  try { const r = await fetch(url, opts); return await r.json(); }
  catch (e) { console.error('API', url, e); return null; }
}
function getCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

// ════════════════════════════════════════════════════════════
//  ТРЕКИ З БД
// ════════════════════════════════════════════════════════════
async function loadAllTracks() {
  const data = await api('/api/tracks/');
  if (!data) return;
  allTracks = data;
  if (currentView === 'home') renderHomeView();
}

function renderHomeView() {
  const list = document.getElementById('recent-list');
  if (!list) return;

  const recent  = getRecentTracks();
  const likedIds = new Set(allTracks.filter(t => t.liked).map(t => t.id));

  // Синхронізуємо liked статус з актуальним станом БД (якщо трек збережений)
  const recentSync = recent.map(t => {
    const live = allTracks.find(a => a.id && a.id === t.id);
    return live ? { ...t, liked: live.liked, audio_url: live.audio_url } : t;
  });

  list.innerHTML = '';

  if (recentSync.length > 0) {
    // Секція "Нещодавно"
    const recentList = document.createElement('div');
    recentList.className = 'track-list';
    recentSync.forEach((t, i) => recentList.appendChild(buildTrackRow(t, i, recentSync, 'home')));

    list.innerHTML = '<div class="section-label-small">🕐 Нещодавно прослухані</div>';
    list.appendChild(recentList);

    if (allTracks.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'section-label-small';
      divider.style.marginTop = '20px';
      divider.textContent = '🎵 Всі треки';
      list.appendChild(divider);
      const allList = document.createElement('div');
      allList.className = 'track-list';
      currentPlaylist = allTracks;
      allTracks.forEach((t, i) => allList.appendChild(buildTrackRow(t, i, allTracks, 'home')));
      list.appendChild(allList);
    }
  } else if (allTracks.length > 0) {
    currentPlaylist = allTracks;
    allTracks.forEach((t, i) => list.appendChild(buildTrackRow(t, i, allTracks, 'home')));
  } else {
    list.innerHTML = '<p style="color:var(--text3);font-size:13px">Завантажте перший трек або знайдіть через пошук…</p>';
  }
}

// ════════════════════════════════════════════════════════════
//  РЯДОК ТРЕКУ
// ════════════════════════════════════════════════════════════
function buildTrackRow(track, index, playlist, context) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.trackId = track.id || '';
  row.onclick = () => { currentPlaylist = playlist; setTrack(index); };

  const thumb = track.cover
    ? `<div class="tr-thumb" style="background-image:url('${track.cover}');background-size:cover;background-position:center"></div>`
    : `<div class="tr-thumb" style="background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:18px">🎵</div>`;

  let badge = '';
  if (track.source === 'youtube')     badge = `<span class="src-badge yt">YT</span>`;
  else if (track.source === 'spotify') badge = `<span class="src-badge sp">SP</span>`;
  else if (track.source === 'soundcloud') badge = `<span class="src-badge sc">SC</span>`;

  const likeBtn = track.id
    ? `<button class="tr-like ${track.liked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLikeTrack(${track.id},this)">♥</button>` : '';
  const menuBtn = track.id
    ? `<button class="tr-menu" onclick="event.stopPropagation();openAddToPlaylist(${track.id})" title="Додати до плейлиста">⋯</button>` : '';
  const delBtn = track.id
    ? `<button class="tr-del" onclick="event.stopPropagation();deleteTrack(${track.id},this)" title="Видалити трек">🗑</button>` : '';

  row.innerHTML = `
    ${thumb}
    <div class="tr-info">
      <p>${track.title} ${badge}</p>
      <span>${track.artist || 'Unknown'}</span>
    </div>
    <div class="tr-dur">${track.duration || '—'}</div>
    ${likeBtn}${menuBtn}${delBtn}
  `;
  return row;
}

// ════════════════════════════════════════════════════════════
//  ПЛЕЄР
// ════════════════════════════════════════════════════════════
function setTrack(i) {
  if (!currentPlaylist.length) return;
  cur = i;
  const t = currentPlaylist[i];
  if (!t) return;

  stopAll();
  setTrackDisplay(t);
  updateNowPanel(t);
  highlightActiveRow();
  addRecentTrack(t);  // зберігаємо в историю

  if (t.source === 'file' && t.audio_url) {
    playAudioFile(t.audio_url);

  } else if (t.source === 'youtube' && t.external_url) {
    streamYouTubeAudio(t.external_url);
    playing = false;

  } else if (t.source === 'soundcloud' && t.external_url) {
    showSoundCloudEmbed(t.external_url);
    startFakeProgress(t.duration);
    playing = true;

  } else if (t.source === 'spotify' && t.previewUrl) {
    showSpotifyPreviewBanner();
    playAudioFile(t.previewUrl);

  } else {
    startFakeProgress(t.duration);
    playing = true;
  }

  updatePlayBtn();

  // Preload наступного треку у фоні через 3 сек
  schedulePreload();
}

// ════════════════════════════════════════════════════════════
//  PRELOAD наступного треку
// ════════════════════════════════════════════════════════════
let preloadTimer   = null;
let preloadCache   = {};   // videoId → blob URL
let preloadingId   = null;

function schedulePreload() {
  clearTimeout(preloadTimer);
  // Чекаємо 3 сек щоб поточний трек спочатку завантажився
  preloadTimer = setTimeout(() => preloadNextTrack(), 3000);
}

async function preloadNextTrack() {
  if (!currentPlaylist.length) return;
  const nextIdx = shuffled
    ? null  // при shuffle не знаємо наперед
    : (cur + 1) % currentPlaylist.length;

  if (nextIdx === null || nextIdx === cur) return;
  const next = currentPlaylist[nextIdx];
  if (!next) return;

  // Preload тільки YouTube треків — MP3 браузер сам кешує
  if (next.source !== 'youtube' || !next.external_url) return;

  const vid = getYouTubeVideoId(next.external_url);
  if (!vid || preloadCache[vid] || preloadingId === vid) return;

  preloadingId = vid;
  showPreloadIndicator(next.title);

  try {
    const res = await fetch(`/api/ytdlp/${vid}/`);
    if (!res.ok) throw new Error('fetch failed');

    // Зберігаємо як blob щоб не качати повторно
    const blob = await res.blob();
    preloadCache[vid] = URL.createObjectURL(blob);
    console.log(`✓ Preloaded: ${next.title}`);
  } catch (e) {
    console.warn('Preload failed:', next.title, e);
  } finally {
    preloadingId = null;
    hidePreloadIndicator();
  }
}

function showPreloadIndicator(title) {
  let el = document.getElementById('preload-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'preload-indicator';
    el.style.cssText = `
      position:fixed; bottom:96px; right:16px; z-index:200;
      background:var(--bg3); border:1px solid var(--border);
      border-radius:8px; padding:8px 12px; font-size:12px;
      color:var(--text2); display:flex; align-items:center; gap:8px;
      box-shadow:0 2px 12px rgba(0,0,0,.3);
    `;
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="yt-spinner" style="width:14px;height:14px;border-width:2px"></div> Завантаження: ${title.slice(0,30)}…`;
  el.style.display = 'flex';
}

function hidePreloadIndicator() {
  const el = document.getElementById('preload-indicator');
  if (el) el.style.display = 'none';
}

function playAudioFile(src) {
  audio.src = src;
  audio.load();
  audio.play()
    .then(() => { playing = true; updatePlayBtn(); })
    .catch(err => { console.warn('autoplay blocked:', err); playing = false; updatePlayBtn(); });
}

function stopAll() {
  audio.pause();
  clearFake();
  hideEmbedPlayer();
  hideSpotifyBanner();
  playing = false;
}

// ─── Audio events ─────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (isSeeking || !isFinite(audio.duration) || audio.duration === 0) return;
  setProgressUI((audio.currentTime / audio.duration) * 100, audio.currentTime);
});
audio.addEventListener('durationchange', () => {
  if (!isFinite(audio.duration)) return;
  const el = document.getElementById('time-tot');
  if (el) el.textContent = fmtTime(audio.duration);
});
audio.addEventListener('ended', () => { if (repeated) setTrack(cur); else nextTrack(); });
audio.addEventListener('play',  () => { playing = true;  updatePlayBtn(); });
audio.addEventListener('pause', () => { playing = false; updatePlayBtn(); });
audio.addEventListener('error', () => {
  // Якщо грає YouTube через yt-dlp і виникла помилка
  const spinner = document.getElementById('yt-spinner-overlay');
  if (spinner) {
    spinner.innerHTML = `<span style="font-size:20px">🚫</span><span style="font-size:11px;color:#fff">Недоступне</span>`;
    spinner.style.display = 'flex';
  }
  playing = false; updatePlayBtn();
});

// ─── Progress bar ──────────────────────────────────────────────
function bindProgressBar() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  bar.addEventListener('mousedown',  () => { isSeeking = true; });
  bar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
  bar.addEventListener('input', () => {
    const pct = parseFloat(bar.value);
    updateTimeCur(getSecFromPct(pct));
  });
  const doSeek = () => { seek(parseFloat(bar.value)); isSeeking = false; };
  bar.addEventListener('mouseup',  doSeek);
  bar.addEventListener('touchend', doSeek);
  bar.addEventListener('change',   doSeek);
}

function seek(pct) {
  if (audio.src && isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (pct / 100) * audio.duration;
  } else if (fakeTimer !== null) {
    fakePct = pct;
    const elapsed = fakeTotalSec * (pct / 100);
    setProgressUI(pct, elapsed);
  }
}

function getSecFromPct(pct) {
  if (audio.src && isFinite(audio.duration) && audio.duration > 0) return (pct / 100) * audio.duration;
  return fakeTotalSec * (pct / 100);
}

function setProgressUI(pct, elapsed) {
  const bar = document.getElementById('progress');
  if (bar && !isSeeking) bar.value = pct;
  updateTimeCur(elapsed);
}

function updateTimeCur(sec) {
  const el = document.getElementById('time-cur');
  if (el) el.textContent = fmtTime(sec);
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function bindVolume() {
  const v = document.getElementById('volume');
  if (v) v.addEventListener('input', function () { audio.volume = this.value / 100; });
}

// ─── Fake progress ─────────────────────────────────────────────
function startFakeProgress(durationStr) {
  clearFake();
  fakePct = 0;
  const parts = (durationStr || '3:00').split(':').map(Number);
  fakeTotalSec = (parts[0] || 0) * 60 + (parts[1] || 0);
  if (fakeTotalSec === 0) fakeTotalSec = 180;
  const el = document.getElementById('time-tot');
  if (el) el.textContent = durationStr || '0:00';
  fakeTimer = setInterval(() => {
    if (!playing || isSeeking) return;
    fakePct = Math.min(100, fakePct + (100 / fakeTotalSec) * 0.25);
    setProgressUI(fakePct, fakeTotalSec * (fakePct / 100));
    if (fakePct >= 100) { clearFake(); if (repeated) setTrack(cur); else nextTrack(); }
  }, 250);
}

function clearFake() {
  if (fakeTimer !== null) { clearInterval(fakeTimer); fakeTimer = null; }
}

// ─── Controls ──────────────────────────────────────────────────
function togglePlay() {
  if (!currentPlaylist[cur]) return;

  // MP3 / Spotify / yt-dlp stream
  if (playing) {
    audio.pause(); clearFake(); playing = false;
  } else {
    if (audio.src) audio.play().catch(console.warn);
    else { startFakeProgress(currentPlaylist[cur].duration); playing = true; }
  }
  updatePlayBtn();
}

function updatePlayBtn() {
  const icon = document.getElementById('play-icon');
  if (icon) icon.setAttribute('d', playing
    ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'
    : 'M8 5v14l11-7z');
}

function prevTrack() { if (currentPlaylist.length) setTrack((cur - 1 + currentPlaylist.length) % currentPlaylist.length); }
function nextTrack() {
  if (!currentPlaylist.length) return;
  if (shuffled) { let r; do { r = Math.floor(Math.random() * currentPlaylist.length); } while (r === cur && currentPlaylist.length > 1); setTrack(r); }
  else setTrack((cur + 1) % currentPlaylist.length);
}
function toggleShuffle() { shuffled = !shuffled; document.getElementById('btn-shuffle')?.classList.toggle('active', shuffled); }
function toggleRepeat()  { repeated = !repeated; document.getElementById('btn-repeat')?.classList.toggle('active', repeated); }
function toggleMute() {
  muted = !muted; audio.muted = muted;
  const b = document.getElementById('vol-btn');
  if (b) b.innerHTML = muted
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-13.27-9L4 4.27 7.73 8H3v8h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
}

// ─── Display ───────────────────────────────────────────────────
function setTrackDisplay(t) {
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  if (!t) {
    set('now-title', 'Nothing playing'); set('pb-title', 'Nothing playing');
    set('now-artist', '—'); set('pb-artist', '—');
    return;
  }
  set('now-title', t.title); set('pb-title', t.title);
  set('now-artist', t.artist || 'Unknown'); set('pb-artist', t.artist || 'Unknown');
  set('time-tot', t.duration || '0:00');
  setProgressUI(0, 0);

  ['now-cover','pb-cover'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const img = t.cover || t.coverUrl || '';
    if (img) { el.style.cssText = `background-image:url('${img}');background-size:cover;background-position:center`; el.textContent = ''; }
    else { el.style.cssText = 'background:var(--bg4)'; el.textContent = '🎵'; }
  });
  ['heart-btn','pb-like'].forEach(id => document.getElementById(id)?.classList.toggle('liked', !!t.liked));
}

function updateNowPanel(t) {
  const qList = document.querySelector('.queue-list'); if (!qList) return;
  qList.innerHTML = '';
  for (let n = 1; n <= 4; n++) {
    const nt = currentPlaylist[(cur + n) % currentPlaylist.length];
    if (!nt || nt === t) continue;
    const item = document.createElement('div'); item.className = 'q-item';
    const thumb = nt.cover
      ? `<div class="q-thumb" style="background-image:url('${nt.cover}');background-size:cover;background-position:center"></div>`
      : `<div class="q-thumb">🎵</div>`;
    item.innerHTML = `${thumb}<div class="q-info"><p>${nt.title}</p><span>${nt.artist||''}</span></div>`;
    item.onclick = () => setTrack(currentPlaylist.indexOf(nt));
    qList.appendChild(item);
  }
}

function highlightActiveRow() {
  document.querySelectorAll('.track-row').forEach(row =>
    row.classList.toggle('active', row.dataset.trackId == (currentPlaylist[cur]?.id || ''))
  );
}

// ─── Embed players ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
//  YOUTUBE IFRAME API — повне керування плеєром
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
//  YOUTUBE — stream через yt-dlp (Django backend)
// ════════════════════════════════════════════════════════════

function getYouTubeVideoId(url) {
  try {
    const u = new URL(url);
    return (u.searchParams.get('v') || u.pathname.split('/').pop())
      .split('&')[0].split('?')[0];
  } catch { return url.split('&')[0].split('?')[0]; }
}

async function streamYouTubeAudio(url) {
  const videoId = getYouTubeVideoId(url);
  const t = currentPlaylist[cur];

  // Якщо трек вже в кеші preload — грємо одразу без спіннера!
  if (preloadCache[videoId]) {
    const cachedUrl = preloadCache[videoId];
    delete preloadCache[videoId]; // використовуємо один раз
    playAudioFile(cachedUrl);
    return;
  }

  // Показуємо обкладинку зі спіннером поверх неї
  const cover = document.getElementById('now-cover');
  if (cover) {
    cover.style.display = '';
    let spinner = document.getElementById('yt-spinner-overlay');
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.id = 'yt-spinner-overlay';
      spinner.style.cssText = `
        position:absolute; inset:0; border-radius:12px;
        background:rgba(0,0,0,.55); display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:10px; z-index:5;
      `;
      cover.style.position = 'relative';
      cover.appendChild(spinner);
    }
    spinner.innerHTML = `
      <div class="yt-spinner"></div>
      <span style="font-size:12px;color:#fff">Завантаження…</span>
    `;
    spinner.style.display = 'flex';
  }

  try {
    const streamUrl = `/api/ytdlp/${videoId}/`;
    // Відразу граємо — Django сам поверне помилку якщо щось не так
    const spinner = document.getElementById('yt-spinner-overlay');
    if (spinner) spinner.style.display = 'none';
    playAudioFile(streamUrl);
  } catch (e) {
    console.warn('yt-dlp stream error:', e);
    const spinner = document.getElementById('yt-spinner-overlay');
    if (spinner) {
      spinner.innerHTML = `<span style="font-size:24px">🚫</span><span style="font-size:12px;color:#fff">Недоступне</span>`;
      spinner.style.display = 'flex';
    }
    playing = false;
    updatePlayBtn();
  }
}

function closeYTPlayer() {
  // Прибираємо спіннер якщо є
  const spinner = document.getElementById('yt-spinner-overlay');
  if (spinner) spinner.remove();
  // Скидаємо position на обкладинці
  const cover = document.getElementById('now-cover');
  if (cover) { cover.style.display = ''; cover.style.position = ''; }
}

function hideEmbedPlayer() {
  closeYTPlayer();
  const c = document.getElementById('embed-container');
  if (c) { c.style.display = 'none'; c.innerHTML = ''; }
}

// ─── Spotify preview banner ─────────────────────────────────────
function showSpotifyPreviewBanner() {
  let b = document.getElementById('spotify-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'spotify-banner';
    b.style.cssText = 'background:rgba(30,215,96,.15);border:1px solid rgba(30,215,96,.3);color:#1ed760;border-radius:8px;padding:8px 12px;font-size:12px;text-align:center;margin-bottom:8px';
    b.textContent = '⚠️ Spotify: тільки 30 сек превью';
    const panel = document.querySelector('.now-panel');
    if (panel) panel.insertBefore(b, panel.querySelector('.now-cover'));
  }
  b.style.display = 'block';
}
function hideSpotifyBanner() {
  const b = document.getElementById('spotify-banner');
  if (b) b.style.display = 'none';
}

// ════════════════════════════════════════════════════════════
//  ЛАЙКИ
// ════════════════════════════════════════════════════════════
async function deleteTrack(trackId, btn) {
  if (!confirm('Видалити трек?')) return;
  btn.textContent = '⏳'; btn.disabled = true;
  const data = await api(`/api/tracks/${trackId}/delete/`, {
    method: 'DELETE', headers: { 'X-CSRFToken': getCsrf() },
  });
  if (data?.deleted) {
    // Прибираємо з локального масиву
    allTracks = allTracks.filter(t => t.id !== trackId);
    currentPlaylist = currentPlaylist.filter(t => t.id !== trackId);
    // Прибираємо рядок з DOM
    btn.closest('.track-row')?.remove();
    showToast('Трек видалено');
    // Якщо грав — зупиняємо
    if (currentPlaylist[cur]?.id === trackId) { stopAll(); setTrackDisplay(null); }
  } else {
    btn.textContent = '🗑'; btn.disabled = false;
    showToast('Помилка видалення', true);
  }
}

// Зберегти пошуковий трек в БД і повернути збережений об'єкт
async function ensureTrackSaved(track) {
  if (track.id) return track;  // вже збережений в БД

  const fd = new FormData();
  fd.append('title',    track.title || '');
  fd.append('artist',   track.artist || '');
  fd.append('source',   track.source || 'youtube');
  fd.append('duration', track.duration || '0:00');
  fd.append('cover_url', track.cover || track.coverUrl || '');

  // URL аудіо — для Spotify previewUrl, для YouTube/SoundCloud external_url
  const url = track.external_url || track.previewUrl || '';
  fd.append('external_url', url);

  const data = await fetch('/api/tracks/external/', {
    method: 'POST', headers: { 'X-CSRFToken': getCsrf() }, body: fd,
  }).then(r => r.json()).catch(() => null);

  if (data?.id) {
    allTracks.unshift(data);
    // Оновлюємо об'єкт в currentPlaylist щоб мав id
    const idx = currentPlaylist.indexOf(track);
    if (idx !== -1) currentPlaylist[idx] = { ...currentPlaylist[idx], ...data };
    return data;
  }
  return null;
}

async function likeSearchTrack(btn, trackJson) {
  const track = JSON.parse(trackJson);
  btn.disabled = true; btn.style.opacity = '0.5';

  const saved = await ensureTrackSaved(track);
  if (!saved) { showToast('Помилка збереження', true); btn.disabled = false; btn.style.opacity = ''; return; }

  await toggleLikeTrack(saved.id, btn);
  btn.disabled = false; btn.style.opacity = '';
  // Оновлюємо атрибут кнопки щоб наступний клік мав id
  btn.onclick = (e) => { e.stopPropagation(); toggleLikeTrack(saved.id, btn); };
}

async function addSearchTrackToPlaylist(btn, trackJson) {
  const track = JSON.parse(trackJson);
  btn.disabled = true;

  const saved = await ensureTrackSaved(track);
  if (!saved) { showToast('Помилка збереження', true); btn.disabled = false; return; }

  btn.disabled = false;
  openAddToPlaylist(saved.id);
  btn.onclick = (e) => { e.stopPropagation(); openAddToPlaylist(saved.id); };
}

async function toggleLikeTrack(trackId, btn) {
  const data = await api(`/api/tracks/${trackId}/like/`, { method: 'POST', headers: { 'X-CSRFToken': getCsrf() } });
  if (!data) return;
  const t = allTracks.find(x => x.id === trackId);
  if (t) t.liked = data.liked;
  document.querySelectorAll(`.track-row[data-track-id="${trackId}"] .tr-like`).forEach(b => b.classList.toggle('liked', data.liked));
  if (currentPlaylist[cur]?.id === trackId) {
    currentPlaylist[cur].liked = data.liked;
    ['heart-btn','pb-like'].forEach(id => document.getElementById(id)?.classList.toggle('liked', data.liked));
  }
  if (currentView === 'liked') showLiked();
}
function toggleLike() { const t = currentPlaylist[cur]; if (t?.id) toggleLikeTrack(t.id, null); }

async function showLiked() {
  currentView = 'liked'; setActiveNav('liked');
  const data = await api('/api/liked/'); if (!data) return;
  showMainView(`<div class="section-title">♥ Liked Tracks <span style="color:var(--text3);font-size:14px">(${data.length})</span></div><div class="track-list" id="liked-list"></div>`);
  const list = document.getElementById('liked-list');
  if (data.length === 0) { list.innerHTML = '<p style="color:var(--text3);font-size:13px">Ще нічого не лайкнуто...</p>'; return; }
  currentPlaylist = data;
  data.forEach((t, i) => list.appendChild(buildTrackRow(t, i, data, 'liked')));
}

// ════════════════════════════════════════════════════════════
//  ЗАВАНТАЖЕНІ ТРЕКИ (окремий розділ під плейлистами)
// ════════════════════════════════════════════════════════════
async function showUploaded() {
  currentView = 'uploaded'; setActiveNav('uploaded');
  const uploaded = allTracks.filter(t => t.source === 'file');
  showMainView(`<div class="section-title">📁 Завантажені треки <span style="color:var(--text3);font-size:14px">(${uploaded.length})</span></div><div class="track-list" id="uploaded-list"></div>`);
  const list = document.getElementById('uploaded-list');
  if (uploaded.length === 0) { list.innerHTML = '<p style="color:var(--text3);font-size:13px">Жодного завантаженого треку. Натисни «Додати» вгорі.</p>'; return; }
  currentPlaylist = uploaded;
  uploaded.forEach((t, i) => list.appendChild(buildTrackRow(t, i, uploaded, 'uploaded')));
}

// ════════════════════════════════════════════════════════════
//  ПЛЕЙЛИСТИ
// ════════════════════════════════════════════════════════════
async function loadPlaylists() {
  const data = await api('/api/playlists/');
  if (data) renderSidebarPlaylists(data);
}

function renderSidebarPlaylists(playlists) {
  const list = document.querySelector('.playlist-list'); if (!list) return;
  list.innerHTML = '';
  playlists.forEach(pl => {
    const item = document.createElement('div'); item.className = 'pl-item';
    item.innerHTML = `<div class="pl-thumb">${pl.emoji}</div><div class="pl-meta"><p>${pl.name}</p><span>${pl.track_count} tracks</span></div>`;
    item.onclick = () => openPlaylistView(pl.id, pl.name, pl.emoji);
    list.appendChild(item);
  });
}

async function openPlaylistView(id, name, emoji) {
  currentView = 'playlist'; currentPlaylistId = id;
  const data = await api(`/api/playlists/${id}/tracks/`); if (!data) return;
  showMainView(`<div class="section-title">${emoji} ${name} <span style="color:var(--text3);font-size:14px">(${data.tracks.length})</span></div><div class="track-list" id="pl-track-list"></div>`);
  const list = document.getElementById('pl-track-list');
  if (data.tracks.length === 0) { list.innerHTML = '<p style="color:var(--text3);font-size:13px">Плейлист порожній. Додай треки через ⋯</p>'; return; }
  currentPlaylist = data.tracks;
  data.tracks.forEach((t, i) => {
    const row = buildTrackRow(t, i, data.tracks, 'playlist');
    const rm = document.createElement('button');
    rm.className = 'tr-menu'; rm.title = 'Видалити з плейлиста'; rm.textContent = '✕';
    rm.onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/playlists/${id}/tracks/${t.id}/remove/`, { method: 'DELETE', headers: { 'X-CSRFToken': getCsrf() } });
      loadPlaylists(); openPlaylistView(id, name, emoji);
    };
    row.appendChild(rm); list.appendChild(row);
  });
}

function openAddToPlaylist(trackId) {
  const modal = document.getElementById('playlist-pick-modal'); if (!modal) return;
  modal.dataset.trackId = trackId;
  api('/api/playlists/').then(data => {
    if (!data) return;
    const list = modal.querySelector('.modal-pl-list'); list.innerHTML = '';
    if (data.length === 0) { list.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:8px">Спочатку створи плейлист</p>'; }
    data.forEach(pl => {
      const btn = document.createElement('div'); btn.className = 'modal-pl-item';
      btn.innerHTML = `${pl.emoji} ${pl.name} <span style="color:var(--text3)">(${pl.track_count})</span>`;
      btn.onclick = async () => {
        await api(`/api/playlists/${pl.id}/tracks/${trackId}/`, { method: 'POST', headers: { 'X-CSRFToken': getCsrf() } });
        loadPlaylists(); closeModal('playlist-pick-modal'); showToast(`Додано до «${pl.name}»`);
      };
      list.appendChild(btn);
    });
    modal.style.display = 'flex';
  });
}

function setupPlaylistModal() {
  const btn = document.querySelector('.btn-new');
  if (btn) btn.onclick = () => { document.getElementById('new-playlist-modal').style.display = 'flex'; };
  const form = document.getElementById('new-playlist-form'); if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('pl-name-input').value.trim();
    const emoji = document.getElementById('pl-emoji-input').value.trim() || '🎵';
    if (!name) return;
    await api('/api/playlists/create/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() }, body: JSON.stringify({ name, emoji }) });
    loadPlaylists(); closeModal('new-playlist-modal');
    document.getElementById('pl-name-input').value = '';
    document.getElementById('pl-emoji-input').value = '';
    showToast(`Плейлист «${name}» створено!`);
  };
}

// ════════════════════════════════════════════════════════════
//  ПОШУК — Spotify метадані + YouTube відео
// ════════════════════════════════════════════════════════════
function setupSearch() {
  const input = document.querySelector('.search-input'); if (!input) return;
  let timer;

  // При фокусі — показуємо підказки з историї
  input.addEventListener('focus', () => {
    if (!input.value.trim()) showSearchHistory();
  });

  input.addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) { showSearchHistory(); return; }
    timer = setTimeout(() => doSearch(q), 450);
  });

  // Ховаємо при кліку поза пошуком
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('#custom-view')) {
      // нічого не робимо — нехай view залишається
    }
  });
}

function showSearchHistory() {
  const hist = getSearchHistory();
  if (!hist.length) { showView('home'); return; }
  currentView = 'search';
  showMainView(`
    <div class="section-title">Останні пошуки</div>
    <div class="search-history-list">
      ${hist.map(q => `
        <div class="history-item" onclick="runHistorySearch('${q.replace(/'/g, "\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>${q}</span>
          <button onclick="event.stopPropagation();removeHistoryItem('${q.replace(/'/g, "\'")}',this.closest('.history-item'))" class="hist-del">✕</button>
        </div>
      `).join('')}
    </div>
  `);
}

function runHistorySearch(query) {
  const input = document.querySelector('.search-input');
  if (input) input.value = query;
  doSearch(query);
}

function removeHistoryItem(query, el) {
  let hist = getSearchHistory().filter(q => q !== query);
  LS.set('woopy_search_hist', hist);
  el?.remove();
  if (!hist.length) showView('home');
}

async function doSearch(query) {
  currentView = 'search';
  addSearchHistory(query);  // зберігаємо в историю

  // Чекаємо поки ключі завантажаться з сервера
  if (window.configReady) await window.configReady;

  showMainView(`
    <div class="section-title">Пошук: «${query}»</div>
    <div id="search-status" style="color:var(--text3);font-size:13px;padding:8px 0">
      🔍 Шукаємо…
    </div>
  `);

  // Паралельно запускаємо всі пошуки
  const [local, ytResults, spResults] = await Promise.all([
    Promise.resolve(allTracks.filter(t =>
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      (t.artist || '').toLowerCase().includes(query.toLowerCase())
    )),
    searchYouTube(query),
    searchSpotify(query),
  ]);

  const hasAny = local.length || ytResults.length || spResults.length;

  // Оновлюємо статус
  const status = document.getElementById('search-status');
  if (status) {
    if (!hasAny) {
      status.textContent = '❌ Нічого не знайдено';
    } else {
      const parts = [];
      if (local.length)    parts.push(`${local.length} своїх`);
      if (ytResults.length) parts.push(`${ytResults.length} з YouTube`);
      if (spResults.length) parts.push(`${spResults.length} зі Spotify`);
      status.textContent = `✓ Знайдено: ${parts.join(', ')}`;
      status.style.color = 'var(--accent)';
    }
  }

  showMainView(`
    <div class="section-title">Пошук: «${query}»</div>
    <div id="search-status" style="color:var(--text3);font-size:13px;padding:8px 0">✓ Знайдено: ${
      [local.length && `${local.length} своїх`, ytResults.length && `${ytResults.length} з YouTube`, spResults.length && `${spResults.length} зі Spotify`]
      .filter(Boolean).join(', ') || 'нічого'
    }</div>

    ${local.length ? `<div class="search-section-label">📁 Мої треки</div><div class="track-list" id="local-results"></div>` : ''}
    ${ytResults.length ? `<div class="search-section-label">▶️ YouTube</div><div class="track-list" id="yt-results"></div>` : ''}
    ${spResults.length ? `<div class="search-section-label">🎵 Spotify <span style="font-size:11px;color:var(--text3)">(30 сек превью)</span></div><div class="track-list" id="sp-results"></div>` : ''}
    ${!hasAny ? '<p style="color:var(--text3);font-size:13px;padding:20px 0">Нічого не знайдено. Спробуй іншу назву.</p>' : ''}
  `);

  // Об'єднуємо для плейлиста
  const combined = [...local, ...ytResults, ...spResults];
  currentPlaylist = combined;

  // Рендеримо кожну секцію
  if (local.length) {
    const list = document.getElementById('local-results');
    local.forEach((t, i) => list.appendChild(buildTrackRow(t, i, combined, 'search')));
  }
  if (ytResults.length) {
    const list = document.getElementById('yt-results');
    ytResults.forEach((t, i) => list.appendChild(buildSearchResultRow(t, local.length + i, combined)));
  }
  if (spResults.length) {
    const list = document.getElementById('sp-results');
    spResults.forEach((t, i) => list.appendChild(buildSearchResultRow(t, local.length + ytResults.length + i, combined)));
  }
}

// Рядок результату пошуку (без лайка/меню — трек ще не в БД)
function buildSearchResultRow(track, index, playlist) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.onclick = () => { currentPlaylist = playlist; setTrack(index); };

  const thumb = track.cover
    ? `<div class="tr-thumb" style="background-image:url('${track.cover}');background-size:cover;background-position:center"></div>`
    : `<div class="tr-thumb" style="background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:18px">${track.source === 'youtube' ? '▶️' : '🎵'}</div>`;

  let badge = '';
  if (track.source === 'youtube')  badge = `<span class="src-badge yt">YT</span>${track.isOfficial ? '<span class="src-badge official">✓ Official</span>' : ''}`;
  if (track.source === 'spotify')  badge = `<span class="src-badge sp">SP</span>`;

  // Кнопки лайк і плейлист — зберігають трек в БД автоматично
  const likeBtn = `<button class="tr-like" onclick="event.stopPropagation();likeSearchTrack(this, ${JSON.stringify(JSON.stringify(track))})" title="Лайк">♥</button>`;
  const menuBtn = `<button class="tr-menu" onclick="event.stopPropagation();addSearchTrackToPlaylist(this, ${JSON.stringify(JSON.stringify(track))})" title="Додати до плейлиста">⋯</button>`;

  row.innerHTML = `
    ${thumb}
    <div class="tr-info"><p>${track.title} ${badge}</p><span>${track.artist || 'Unknown'}</span></div>
    <div class="tr-dur">${track.duration || '—'}</div>
    ${likeBtn}${menuBtn}
  `;
  return row;
}

// Зберегти знайдений трек у БД Django
async function saveSearchTrack(event, trackJson) {
  const track = JSON.parse(trackJson);
  const btn = event.target;
  btn.textContent = '⏳'; btn.disabled = true;

  let data;
  if (track.source === 'spotify' && track.previewUrl) {
    // Spotify — зберігаємо як зовнішній з previewUrl
    data = await api('/api/tracks/external/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        external_url: track.previewUrl,
        source: 'spotify',
        duration: track.duration,
        cover_url: track.cover,
      }),
    });
  } else if (track.source === 'youtube' && track.external_url) {
    data = await api('/api/tracks/external/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        external_url: track.external_url,
        source: 'youtube',
        duration: track.duration,
        cover_url: track.cover,
      }),
    });
  }

  if (data?.id) {
    allTracks.unshift(data);
    btn.textContent = '✅';
    showToast(`«${track.title}» збережено!`);
    // Оновлюємо поточний трек в плейлисті щоб мати id для лайків
    const idx = currentPlaylist.findIndex(t => t === track || (t.title === track.title && t.source === track.source));
    if (idx !== -1) currentPlaylist[idx] = { ...currentPlaylist[idx], ...data };
  } else {
    btn.textContent = '❌'; btn.disabled = false;
    showToast('Помилка збереження', true);
  }
}

// ─── YouTube пошук ─────────────────────────────────────────────
async function searchYouTube(query) {
  const key = (typeof CONFIG !== 'undefined') ? CONFIG.YOUTUBE_API_KEY : '';
  if (!key || key === 'YOUR_YOUTUBE_API_KEY') {
    console.warn('YouTube API key not set');
    return [];
  }

  try {
    // Крок 1: пошук — шукаємо з "topic" або "official" для кращих результатів
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query + ' official audio')}&type=video&maxResults=15&key=${key}`
    );
    if (!searchRes.ok) {
      const err = await searchRes.json().catch(() => ({}));
      console.warn('YouTube search API error:', err?.error?.message || searchRes.status);
      return [];
    }
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return [];

    // Крок 2: деталі відео — тривалість + embeddable + тип каналу
    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const detailRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&id=${ids}&key=${key}`
    );
    const detailData = detailRes.ok ? await detailRes.json() : { items: [] };

    const durationMap    = {};
    const embeddableSet  = new Set();
    const channelTypeMap = {}; // videoId -> 'topic'|'official'|'other'

    (detailData.items || []).forEach(v => {
      durationMap[v.id] = parseISO8601(v.contentDetails.duration);

      const ch = (v.snippet?.channelTitle || '').toLowerCase();
      // Topic канали: "Artist - Topic", офіційні: "ArtistVEVO", "ArtistOfficial"
      if (ch.endsWith('- topic') || ch.endsWith('– topic')) {
        channelTypeMap[v.id] = 'topic';
        embeddableSet.add(v.id); // topic канали завжди embeddable
      } else if (
        ch.includes('vevo') ||
        ch.includes('official') ||
        ch.includes('records') ||
        ch.includes('music') ||
        v.status?.embeddable
      ) {
        channelTypeMap[v.id] = 'official';
        embeddableSet.add(v.id);
      }
      // Решта — не додаємо до embeddableSet (відфільтруємо)
    });

    // Пріоритет: topic > official > решта
    const priority = id => channelTypeMap[id] === 'topic' ? 0 : channelTypeMap[id] === 'official' ? 1 : 2;

    return searchData.items
      .filter(item => embeddableSet.has(item.id.videoId))
      .sort((a, b) => priority(a.id.videoId) - priority(b.id.videoId))
      .slice(0, 5)
      .map(item => {
        const chTitle = item.snippet.channelTitle;
        // Для Topic каналів беремо назву без " - Topic"
        const artist = chTitle.replace(/\s*[-–]\s*topic$/i, '');
        return {
          id: null,
          source: 'youtube',
          title: item.snippet.title,
          artist,
          cover: item.snippet.thumbnails?.medium?.url || '',
          external_url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          duration: durationMap[item.id.videoId] || '0:00',
          isOfficial: channelTypeMap[item.id.videoId] === 'topic',
          liked: false,
        };
      });
  } catch (e) {
    console.warn('YouTube search error:', e);
    return [];
  }
}

function parseISO8601(str) {
  // PT4M13S → 4:13
  const m = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), sec = parseInt(m[3] || 0);
  const totalMin = h * 60 + min;
  return `${totalMin}:${sec.toString().padStart(2, '0')}`;
}

// ─── Spotify пошук (тільки метадані + preview) ─────────────────
async function searchSpotify(query) {
  if (typeof CONFIG === 'undefined' || !CONFIG.SPOTIFY_CLIENT_ID) return [];
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + btoa(CONFIG.SPOTIFY_CLIENT_ID + ':' + CONFIG.SPOTIFY_CLIENT_SECRET) },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return [];
    const { access_token } = await tokenRes.json();

    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
      headers: { 'Authorization': 'Bearer ' + access_token },
    });
    if (!res.ok) return [];
    const data = await res.json();

    return data.tracks.items
      .filter(t => t.preview_url) // тільки ті що мають preview
      .map(t => ({
        id: null,
        source: 'spotify',
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        duration: fmtTime(t.duration_ms / 1000),
        cover: t.album.images[0]?.url || '',
        previewUrl: t.preview_url,
        liked: false,
      }));
  } catch { return []; }
}

// ════════════════════════════════════════════════════════════
//  UPLOAD
// ════════════════════════════════════════════════════════════
function setupUploadModal() {
  document.getElementById('upload-track-btn')?.addEventListener('click', () => {
    document.getElementById('upload-modal').style.display = 'flex';
  });
  document.getElementById('tab-file')?.addEventListener('click', () => switchUploadTab('file'));
  document.getElementById('tab-external')?.addEventListener('click', () => switchUploadTab('external'));

  const fileForm = document.getElementById('upload-file-form');
  if (fileForm) fileForm.onsubmit = async (e) => {
    e.preventDefault();
    const sb = fileForm.querySelector('button[type=submit]');
    sb.disabled = true; sb.textContent = 'Завантаження...';
    const data = await fetch('/api/tracks/upload/', {
      method: 'POST', headers: { 'X-CSRFToken': getCsrf() }, body: new FormData(fileForm),
    }).then(r => r.json()).catch(() => null);
    sb.disabled = false; sb.textContent = 'Завантажити';
    if (data?.id) { allTracks.unshift(data); renderHomeView(); closeModal('upload-modal'); fileForm.reset(); showToast(`«${data.title}» завантажено!`); }
    else showToast('Помилка завантаження', true);
  };

  const extForm = document.getElementById('upload-external-form');
  if (extForm) extForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('title',        document.getElementById('ext-title').value.trim());
    fd.append('artist',       document.getElementById('ext-artist').value.trim());
    fd.append('external_url', document.getElementById('ext-url').value.trim());
    fd.append('source',       'soundcloud');
    const coverFile = document.getElementById('ext-cover-file')?.files[0];
    if (coverFile) fd.append('cover_file', coverFile);
    const data = await fetch('/api/tracks/external/', {
      method: 'POST', headers: { 'X-CSRFToken': getCsrf() }, body: fd,
    }).then(r => r.json()).catch(() => null);
    if (data?.id) { allTracks.unshift(data); renderHomeView(); closeModal('upload-modal'); extForm.reset(); showToast(`«${data.title}» додано!`); }
    else showToast('Помилка додавання', true);
  };
}

function switchUploadTab(tab) {
  document.getElementById('tab-file')?.classList.toggle('active', tab === 'file');
  document.getElementById('tab-external')?.classList.toggle('active', tab === 'external');
  const ff = document.getElementById('form-file'); if (ff) ff.style.display = tab === 'file' ? 'block' : 'none';
  const fe = document.getElementById('form-external'); if (fe) fe.style.display = tab === 'external' ? 'block' : 'none';
}

// ════════════════════════════════════════════════════════════
//  НАВІГАЦІЯ
// ════════════════════════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const label = item.textContent.trim().toLowerCase();
      if (label.includes('home'))       showView('home');
      else if (label.includes('search')) focusSearch();
      else if (label.includes('library')) showLibrary();
      else if (label.includes('liked'))  showLiked();
      else if (label.includes('завант')) showUploaded();
    });
  });
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach(item => {
    const l = item.textContent.trim().toLowerCase();
    item.classList.toggle('active',
      (view==='home'     && l.includes('home'))     ||
      (view==='search'   && l.includes('search'))   ||
      (view==='library'  && l.includes('library'))  ||
      (view==='liked'    && l.includes('liked'))    ||
      (view==='uploaded' && l.includes('завант'))
    );
  });
}

function showView(view) {
  currentView = view; setActiveNav(view);
  document.getElementById('home-view').style.display = view === 'home' ? 'block' : 'none';
  const sv = document.getElementById('search-view'); if (sv) sv.style.display = 'none';
  const cv = document.getElementById('custom-view'); if (cv) cv.style.display = 'none';
  if (view === 'home') { document.querySelector('.search-input').value = ''; renderHomeView(); }
}

function showMainView(html) {
  let cv = document.getElementById('custom-view');
  if (!cv) { cv = document.createElement('div'); cv.id = 'custom-view'; document.querySelector('.main').appendChild(cv); }
  cv.innerHTML = html; cv.style.display = 'block';
  document.getElementById('home-view').style.display = 'none';
  const sv = document.getElementById('search-view'); if (sv) sv.style.display = 'none';
}

function focusSearch() { document.querySelector('.search-input')?.focus(); }

async function showLibrary() {
  currentView = 'library'; setActiveNav('library');
  showMainView(`<div class="section-title">Library — всі треки</div><div class="track-list" id="library-list"></div>`);
  const list = document.getElementById('library-list');
  if (allTracks.length === 0) { list.innerHTML = '<p style="color:var(--text3);font-size:13px">Треків ще немає.</p>'; return; }
  currentPlaylist = allTracks;
  allTracks.forEach((t, i) => list.appendChild(buildTrackRow(t, i, allTracks, 'library')));
}

// ─── Utils ───────────────────────────────────────────────────
function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function showToast(msg, isError = false) {
  const old = document.getElementById('toast'); if (old) old.remove();
  const t = document.createElement('div'); t.id = 'toast'; t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:${isError?'#c84b4b':'var(--accent)'};color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4)`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener('click', e => {
  ['upload-modal','new-playlist-modal','playlist-pick-modal'].forEach(id => {
    const m = document.getElementById(id); if (m && e.target === m) m.style.display = 'none';
  });
});
