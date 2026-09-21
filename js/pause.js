"use strict";
// =================================================================
// PAUSE MENU
//
// Shown on Esc. Resume, Settings (opens the tuning panel), Controls, and a read-out of the
// build so far: every stat with its level and what it's worth, and every carried weapon.
//
// Weapon stats are not a fixed list. Each weapon shows only the stats that its own level-up
// table and evolution rotation actually raise, so a hitscan pistol doesn't list a blast
// radius it will never have, and a firecracker doesn't list a fire rate that never changes.
// =================================================================

let pauseView = 'stats';   // stats | controls

// Keys prefixed with @ are translatable key names; the rest are literal keycaps.
const PAUSE_CONTROLS = [
  { keys:['W','A','S','D'],      what:'ctl.move' },
  { keys:['@key.shift'],         what:'ctl.sprint' },
  { keys:['@key.mouse'],         what:'ctl.look' },
  { keys:['@key.click'],         what:'ctl.fire' },
  { keys:['R'],                  what:'ctl.reload' },
  { keys:['E'],                  what:'ctl.interact' },
  { keys:['1','2','3','4'],      what:'ctl.slots' },
  { keys:['@key.wheel'],         what:'ctl.wheel' },
  { keys:['M'],                  what:'ctl.mute' },
  { keys:['B'],                  what:'ctl.cursor' },
  { keys:['@key.esc'],           what:'ctl.pause' },
];

function initPauseMenu(){
  const bind = (id, fn)=>{ const b = document.getElementById(id); if(b) b.addEventListener('click', e=>{ e.stopPropagation(); fn(); }); };
  bind('btnResume', ()=>requestLock());
  bind('btnPauseSettings', openSettingsFromPause);
  bind('btnPauseControls', ()=>setPauseView(pauseView === 'controls' ? 'stats' : 'controls'));
  buildControlList();
}

// Hands over to the B-menu state, which is where the tuning panel lives.
function openSettingsFromPause(){
  gameState = 'settings';
  pauseOverlay.classList.add('hidden');
  updateLockButtonLabel();
  updateToolPanelVisibility();
}

function setPauseView(view){
  pauseView = view;
  document.getElementById('pauseStatsView').classList.toggle('hidden', view !== 'stats');
  document.getElementById('pauseControlsView').classList.toggle('hidden', view !== 'controls');
  const b = document.getElementById('btnPauseControls');
  if(b){ b.classList.toggle('active', view === 'controls'); b.textContent = view === 'controls' ? t('pause.statsBtn') : t('pause.controls'); }
}

// Browsers refuse to re-capture the mouse for roughly a second after Esc releases it. A click
// on Resume inside that window is silently rejected, which read as the menu ignoring you and
// then suddenly working. Resume is held visibly unavailable for that window instead.
const POINTER_RELOCK_COOLDOWN = 1150;   // ms
let resumeReadyTimer = null;
function holdResumeForCooldown(){
  const b = document.getElementById('btnResume');
  if(!b) return;
  b.disabled = true;
  b.classList.add('cooling');
  clearTimeout(resumeReadyTimer);
  resumeReadyTimer = setTimeout(()=>{ b.disabled = false; b.classList.remove('cooling'); }, POINTER_RELOCK_COOLDOWN);
}

// Rebuilt every time the menu opens, so it always reflects the current build.
function openPauseMenu(){
  holdResumeForCooldown();
  setPauseView('stats');
  const s = document.getElementById('pauseSummary');
  if(s) s.textContent = t('pause.summary', {lv:player.level, w:wave.number, p:(player.points||0).toLocaleString()});
  buildControlList();   // rebuilt so it follows a language change made since last time
  buildStatList();
  buildWeaponList();
  scalePausePanel();
}

function scalePausePanel(){
  const p = document.getElementById('pausePanel');
  if(!p) return;
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  p.style.transform = 'scale(' + (Math.round(Math.min(1, w/1230, h/760)*1000)/1000) + ')';
}

// ---------- stats ----------
function buildStatList(){
  const el2 = document.getElementById('pauseStatList');
  if(!el2) return;
  let html = '';
  STATS.forEach(s=>{
    const lvl = statLevel(s.key);
    let pips = '';
    for(let i=0;i<s.maxLevel;i++) pips += '<i class="'+(i<lvl?'on':'')+'"></i>';
    const icon = s.icon ? '<img src="'+STATS_DIR+encodeURIComponent(s.icon)+'.png" alt="">' : '<span></span>';
    html += '<div class="pStat'+(lvl===0?' zero':'')+'">'+icon+
      '<div><div class="pName">'+statName(s)+'</div><div class="pPips">'+pips+'</div></div>'+
      '<div class="pVal">'+(lvl===0 ? '—' : formatStatValue(s))+'</div></div>';
  });
  el2.innerHTML = html;
}

// ---------- weapons ----------
// Which stat keys a weapon can actually improve: its base level table, plus its evolution
// rotation once it has evolved.
function weaponGrowthKeys(wIdx){
  const keys = [];
  const add = k=>{ if(k && keys.indexOf(k) === -1) keys.push(k); };
  (BASE_LEVEL_TABLES[wIdx] || []).forEach(step=>add(step.stat));
  if(player.weaponEvolved[wIdx] && EVOLUTIONS[wIdx]) EVOLUTIONS[wIdx].rotation.forEach(add);
  // The weapon's own identity stat is always shown, even if levelling never touches it.
  add('damage');
  return keys;
}

// The same key means different things on different weapons — "radius" is a blast on a
// firecracker, a puddle on a bottle and a reach on a sword — so each is resolved by type.
function weaponStatLine(wIdx, key){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx] || createDefaultMods();
  const f1 = v=>(Math.round(v*10)/10).toString();
  const pct = v=>Math.round(v*100)+'%';
  switch(key){
    case 'damage': {
      if(w.type === 'bait') return null;                       // the ham does no damage itself
      if(w.type === 'beam') return ['DPS', f1((w.beamDps||0)*mods.dpsMult)];
      if(w.type === 'stream') return ['DPS', f1((w.streamDps||0)*mods.dpsMult)];
      if(w.type === 'puddle') return null;                      // reported as DPS under 'dot'
      const d = effectiveDamage(wIdx);
      const pel = (w.pellets||1) > 1 ? ' ×'+effectivePellets(wIdx) : '';
      return ['DAMAGE', Math.round(d) + pel];
    }
    case 'fireRate':
      return ['RATE', f1(1/Math.max(0.01, getShotCooldown(wIdx))) + '/s'];
    case 'ammo':
      if(w.noAmmo) return null;
      if(mods.noReload) return ['MAGAZINE', String(effectiveMag(wIdx))];
      return ['AMMO', effectiveMag(wIdx) + ' / ' + effectiveReserve(wIdx)];
    case 'bounce':
      return ['RICOCHETS', String(effectiveChainCount(wIdx))];
    case 'radius': {
      const r = (()=>{
        switch(w.type){
          case 'grenade': return ['BLAST', effectiveBlastRadius(wIdx)];
          case 'puddle':  return ['PUDDLE', effectivePuddleRadius(wIdx)];
          case 'cone':    return ['RANGE', (w.coneRange||5)*mods.radiusMult];
          case 'bubble':  return ['BUBBLE', (w.bubbleRadius||0.5)*mods.radiusMult];
          case 'bait':    return ['LURE', (w.baitRadius||16)*mods.radiusMult];
          case 'stream':  return ['WIDTH', (w.streamRadius||0.5)*mods.radiusMult];
          case 'melee':   return ['REACH', (w.meleeRange||2.6)*mods.radiusMult];
        }
        return null;
      })();
      return r ? [r[0], f1(r[1]) + 'm'] : null;
    }
    case 'duration': {
      switch(w.type){
        case 'puddle': return ['LASTS', f1(effectivePuddleDuration(wIdx)) + 's'];
        case 'bubble': return ['LASTS', f1((w.bubbleLife||6)*mods.durationMult) + 's'];
        case 'bait':   return ['FEAST', f1((w.baitSeconds||40)*mods.durationMult) + 's'];
        case 'stream': return ['REACH', f1((w.streamLife||1)*mods.durationMult*(w.streamSpeed||16)*0.6) + 'm'];
      }
      return null;
    }
    case 'dot':
      if(w.type === 'puddle') return ['DPS', f1(effectivePuddleDps(wIdx))];
      if(w.type === 'stream') return ['DPS', f1((w.streamDps||0)*mods.dpsMult)];
      if(w.type === 'beam')   return ['DPS', f1((w.beamDps||0)*mods.dpsMult)];
      return null;
    case 'knockback':       return ['SHOVE', '×' + f1(mods.knockbackMult||1)];
    case 'pierceCount':     return ['PIERCES', String(1 + (mods.pierceCount||0))];
    case 'infectChance':    return ['INFECT', pct(0.45 + (mods.infectChance||0))];
    case 'coughDamage':     return ['COUGH', String(16 + (mods.coughDamage||0))];
    case 'coughSpread':     return ['SPREAD', pct(0.25 + (mods.coughSpread||0))];
    case 'burnDamage':      return ['BURN', f1(mods.burnDamage||0) + '/s'];
    case 'burnDuration':    return ['BURNS', f1(mods.burnDuration||0) + 's'];
    case 'windDamage':      return ['SLASH', pct(mods.windDamage||0)];
    case 'windRange':       return ['SLASH RNG', f1((w.windRange||14) + (mods.windRange||0)) + 'm'];
    case 'subCount':        return ['BLASTS', String(1 + (mods.subCount||0))];
    case 'explosionDamage': return ['BOOM', String(Math.round(mods.explosionDamage||0))];
    case 'explosionRadius': return ['BOOM RNG', f1(mods.explosionRadius||0) + 'm'];
  }
  return null;
}

function buildWeaponList(){
  const el2 = document.getElementById('pauseWeaponList');
  if(!el2) return;
  let html = '';
  player.slots.forEach(wIdx=>{
    if(wIdx === null || wIdx === undefined) return;
    const w = ALL_WEAPONS[wIdx];
    const evolved = !!player.weaponEvolved[wIdx];
    const name = evolved ? evolutionName(wIdx) : weaponName(wIdx);
    const lvl = player.weaponLevel[wIdx] || 1;
    const badge = w.noLevel ? '<span class="pwLevel">'+t('pause.base')+'</span>'
                : evolved ? '<span class="pwLevel evo">'+t('pause.evolved',{n:player.weaponEvoLevel[wIdx]||0})+'</span>'
                : '<span class="pwLevel">'+t('pause.level',{n:lvl})+'</span>';
    const lines = [];
    weaponGrowthKeys(wIdx).forEach(k=>{
      const line = weaponStatLine(wIdx, k);
      if(line && !lines.some(l=>l[0]===line[0])) lines.push(line);   // one row per label
    });
    const stats = lines.map(l=>'<div class="pwStat"><span>'+t('ws.'+l[0])+'</span><b>'+l[1]+'</b></div>').join('');
    const src = hudIconFor(wIdx);
    html += '<div class="pWeapon">'+(src?'<img src="'+src+'" alt="">':'<span></span>')+
      '<div><div class="pwHead"><span class="pwName">'+name+'</span>'+badge+'</div>'+
      '<div class="pwStats">'+stats+'</div></div></div>';
  });
  el2.innerHTML = html || '<div class="pEmpty">'+t('pause.noWeapons')+'</div>';
}

function buildControlList(){
  const el2 = document.getElementById('pauseControlList');
  if(!el2) return;
  const cap = k => k.charAt(0) === '@' ? t(k.slice(1)) : k;
  el2.innerHTML = PAUSE_CONTROLS.map(c=>
    '<div class="pCtrl"><div class="keys">'+c.keys.map(k=>'<kbd>'+cap(k)+'</kbd>').join('')+'</div><div>'+t(c.what)+'</div></div>'
  ).join('');
}
