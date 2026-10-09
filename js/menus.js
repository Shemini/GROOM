"use strict";
// =================================================================
// END OF RUN AND PLAYER SETTINGS
// =================================================================

// ---------- final score ----------
// Kills per minute of combat. "Combat" is only while there are enemies alive, so pausing and
// the gaps between waves don't count against you — but leaving a wave alive to bunch up does.
function runKillsPerMinute(){
  const minutes = runStats.combatTime / 60;
  return minutes > 0.05 ? player.kills / minutes : 0;
}
function runPaceMult(){
  return runKillsPerMinute() / SCORE_PACE_REFERENCE;
}
function runFinalScore(){
  return Math.round((player.points || 0) * runPaceMult());
}

function formatRunTime(sec){
  const s = Math.floor(sec), m = Math.floor(s/60), h = Math.floor(m/60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + pad(m%60) + ':' + pad(s%60) : m + ':' + pad(s%60);
}

// ---------- the end-of-run screen ----------
function showRunSummary(){
  const fmt = n => Math.round(n).toLocaleString();
  const kpm = runKillsPerMinute(), pace = runPaceMult();

  document.getElementById('runSummary').textContent = t('go.summary', { w:wave.number, l:player.level });
  document.getElementById('runScoreMath').innerHTML =
    t('go.points') + ' <b>' + fmt(player.points || 0) + '</b> &nbsp;×&nbsp; ' +
    t('go.pace') + ' <b>×' + pace.toFixed(2) + '</b> &nbsp;(' + kpm.toFixed(1) + ' ' + t('go.kpmShort') + ')';

  const stats = [
    [t('go.kills'), fmt(player.kills)],
    [t('go.kpm'), kpm.toFixed(1)],
    [t('go.wave'), wave.number],
    [t('go.level'), player.level],
    [t('go.time'), formatRunTime(runStats.runTime)],
  ];
  document.getElementById('runStatList').innerHTML = stats.map(s=>
    '<div class="runStat"><span>' + s[0] + '</span><b>' + s[1] + '</b></div>').join('');

  // Every weapon you carried, plus any you'd swapped away that still did damage, biggest first.
  const dmg = runStats.damageByWeapon;
  const ids = new Set(player.slots.filter(s=>s !== null && s !== undefined));
  Object.keys(dmg).forEach(k=>{ if(dmg[k] > 0) ids.add(+k); });
  const total = Object.values(dmg).reduce((a,b)=>a+b, 0);
  const rows = [...ids].map(i=>({ i, d: dmg[i] || 0 })).sort((a,b)=>b.d - a.d);
  const top = rows.length ? Math.max(1, rows[0].d) : 1;
  document.getElementById('runWeaponList').innerHTML = rows.length ? rows.map(r=>{
    const name = player.weaponEvolved[r.i] ? evolutionName(r.i) : weaponName(r.i);
    const src = hudIconFor(r.i);
    const pct = total > 0 ? Math.round(r.d/total*100) : 0;
    return '<div class="runWeapon">' + (src ? '<img src="' + src + '" alt="">' : '<span></span>') +
      '<div><div class="rwName">' + name + '</div><div class="rwBar"><i style="width:' + (r.d/top*100).toFixed(1) + '%"></i></div></div>' +
      '<div class="rwNum">' + fmt(r.d) + '<small>' + pct + '%</small></div></div>';
  }).join('') : '<div class="pEmpty">' + t('go.noDamage') + '</div>';

  // Shown first: the count-up below stops as soon as the screen is hidden, so starting it
  // while still hidden ended it after a single frame.
  gameOverOverlay.classList.remove('hidden');
  scaleStonePanel('runPanel', 1170, 820);

  // Counts up rather than appearing, so the number lands.
  const el2 = document.getElementById('runScore');
  const target = runFinalScore(), t0 = performance.now();
  const tick = ()=>{
    const k = Math.min(1, (performance.now() - t0)/1400);
    el2.textContent = fmt(target * (1 - Math.pow(1-k, 3)));
    if(k < 1 && !gameOverOverlay.classList.contains('hidden')) requestAnimationFrame(tick);
  };
  tick();
}

function scaleStonePanel(id, w, h){
  const p = document.getElementById(id);
  if(!p) return;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  p.style.transform = 'scale(' + (Math.round(Math.min(1, vw/w, vh/h)*1000)/1000) + ')';
}

// =================================================================
// SETTINGS
// =================================================================
const PREFS_KEY = 'groom.prefs';
const SENSITIVITY_DEFAULT = 0.0022;   // the slider's midpoint
const SENSITIVITY_RANGE = 4;          // ends of the slider: a quarter of it, and four times it
let masterVolume = 1;
let settingsReturnTo = null;          // 'pause' when opened from the pause menu

// The slider is logarithmic: equal steps feel like equal changes, and the middle is exactly
// the sensitivity the game has always used.
function sliderToSensitivity(v){ return SENSITIVITY_DEFAULT * Math.pow(SENSITIVITY_RANGE, (v - 50)/50); }
function sensitivityToSlider(s){ return Math.round(50 + 50*Math.log(s/SENSITIVITY_DEFAULT)/Math.log(SENSITIVITY_RANGE)); }

function getMasterVolume(){ return masterVolume; }

// Everything in game runs through one gain node; the title music uses plain audio elements,
// which are handled by the landing screen reading getMasterVolume().
function applyMasterVolume(){
  if(typeof masterGain !== 'undefined' && masterGain) masterGain.gain.value = muted ? 0 : 0.7*masterVolume;
  if(typeof refreshTitleVolume === 'function') refreshTitleVolume();
}

function loadPrefs(){
  try{
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if(typeof p.sensitivity === 'number' && p.sensitivity > 0) settings.mouseSensitivity = p.sensitivity;
    if(typeof p.volume === 'number') masterVolume = Math.max(0, Math.min(1, p.volume));
  }catch(e){}
}
function savePrefs(){
  try{ localStorage.setItem(PREFS_KEY, JSON.stringify({ sensitivity: settings.mouseSensitivity, volume: masterVolume })); }catch(e){}
}

function refreshSettingsUI(){
  const sens = document.getElementById('setSens');
  if(sens) sens.value = sensitivityToSlider(settings.mouseSensitivity);
  const sv = document.getElementById('setSensVal');
  if(sv) sv.textContent = '×' + (settings.mouseSensitivity/SENSITIVITY_DEFAULT).toFixed(2);
  const vol = document.getElementById('setVol');
  if(vol) vol.value = Math.round(masterVolume*100);
  const vv = document.getElementById('setVolVal');
  if(vv) vv.textContent = Math.round(masterVolume*100) + '%';
  const lang = document.getElementById('setLang');
  if(lang) lang.textContent = t('set.langName');
  // Keep the developer panel's raw slider in step with this one.
  const dev = document.getElementById('mouseSensitivity');
  if(dev) dev.value = settings.mouseSensitivity;
  const devVal = document.getElementById('vMouseSensitivity');
  if(devVal) devVal.textContent = settings.mouseSensitivity.toFixed(4);
}

function openSettingsModal(from){
  settingsReturnTo = from || null;
  refreshSettingsUI();
  document.getElementById('settingsModal').classList.remove('hidden');
  scaleStonePanel('playerSettingsPanel', 600, 560);
}
function closeSettingsModal(){
  document.getElementById('settingsModal').classList.add('hidden');
  savePrefs();
  settingsReturnTo = null;
}
function settingsModalOpen(){
  const m = document.getElementById('settingsModal');
  return m && !m.classList.contains('hidden');
}

function initMenus(){
  loadPrefs();
  applyMasterVolume();
  const stop = e=>e.stopPropagation();
  const on = (id, ev, fn)=>{ const n = document.getElementById(id); if(n) n.addEventListener(ev, e=>{ stop(e); fn(e); }); };

  on('setSens', 'input', e=>{ settings.mouseSensitivity = sliderToSensitivity(+e.target.value); refreshSettingsUI(); });
  on('setVol', 'input', e=>{ masterVolume = (+e.target.value)/100; applyMasterVolume(); refreshSettingsUI(); });
  on('setLang', 'click', ()=>{ cycleLanguage(); refreshSettingsUI(); });
  on('setBack', 'click', closeSettingsModal);
  // Clicks inside the panel must not reach the title screen or the game behind it.
  ['settingsModal', 'gameOverOverlay'].forEach(id=>{ const n = document.getElementById(id); if(n) n.addEventListener('click', stop); });

  on('btnSettingsMenu', 'click', ()=>openSettingsModal('title'));
  window.addEventListener('resize', ()=>{
    if(settingsModalOpen()) scaleStonePanel('playerSettingsPanel', 600, 560);
    if(!gameOverOverlay.classList.contains('hidden')) scaleStonePanel('runPanel', 1170, 820);
  });
  refreshSettingsUI();
}
