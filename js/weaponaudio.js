"use strict";
// =================================================================
// WEAPON AUDIO
//
// Built on decoded AudioBuffers rather than <audio> elements, because this layer needs three
// things those can't do well: many overlapping copies of the same shot, gapless loops that
// fade in and out, and reload sequences scheduled against the clock so the parts still line
// up when reload speed changes with levelling.
//
// Files live in ./Audio/Weapons/ as .ogg. Anything missing simply stays silent and logs once.
// =================================================================

const WEAPON_AUDIO_DIR = './Audio/Weapons/';

// Per weapon index. `fire` is a one-shot, `fireLoop` runs while the trigger is held.
const WEAPON_SOUNDS = {
  0:  { fire:'Puños' },
  1:  { fire:'PistolaShooting', reload:['PistolaReloadingA','PistolaReloadingB'] },
  2:  { fire:'RifleShooting',   reload:['RifleReloadingA','RifleReloadingB','RifleReloadingC'] },
  3:  { fireLoop:'MetralletaShooting', reload:['PistolaReloadingA','PistolaReloadingB'] },
  4:  { fire:'BurbujasShooting' },
  5:  { thrown:true, impact:'JamonImpact', explode:'JamonExplosion' },
  6:  { thrown:true, explode:'Petardo', evolvedExtra:'Traca', fuseUntil:'explosion' },
  7:  { thrown:true, impact:['TequifresaImpactA','TequifresaImpactB'] },
  8:  { fire:'Confetti' },
  // A hard attack and a tail that only fades once the trigger is released.
  9:  { fireLoop:'Megatron', loopFadeIn:0.015, loopFadeOut:0.40 },
  10: { fireLoop:'LaserOn', loopFadeIn:0.02, loopFadeOut:0.08 },
  11: { meleeMiss:['EspadaA','EspadaB','EspadaC','EspadaD','EspadaE'], meleeHit:'EspadaHit' },
};

const THROW_SOUNDS = ['ThrowA','ThrowB','ThrowC','ThrowD'];
const BUBBLE_POP_SOUNDS = ['BurbujaPopA','BurbujaPopB','BurbujaPopC','BurbujaPopD'];
const SOUND_BULLET_IMPACT = 'BulletImpact';
const SOUND_SHOOT_FAIL = 'ShootingFail';
const SOUND_FUSE = 'Fuse';

const wsndBuffers = {};      // name -> AudioBuffer
const wsndMissing = new Set();
let wsndReady = false;

// Every distinct file referenced above, gathered so preloading needs no separate list.
function wsndAllNames(){
  const names = new Set([...THROW_SOUNDS, ...BUBBLE_POP_SOUNDS,
    SOUND_BULLET_IMPACT, SOUND_SHOOT_FAIL, SOUND_FUSE]);
  for(const k in WEAPON_SOUNDS){
    const s = WEAPON_SOUNDS[k];
    ['fire','fireLoop','impact','explode','evolvedExtra','meleeHit'].forEach(f=>{
      if(typeof s[f] === 'string') names.add(s[f]);
      else if(Array.isArray(s[f])) s[f].forEach(n=>names.add(n));
    });
    ['reload','meleeMiss','impact'].forEach(f=>{
      if(Array.isArray(s[f])) s[f].forEach(n=>names.add(n));
    });
  }
  return [...names];
}

// Decoding needs an AudioContext, which browsers won't allow until the player interacts —
// so this runs on the first click rather than at page load.
function loadWeaponAudio(){
  if(wsndReady || !audioCtx) return;
  wsndReady = true;
  const names = wsndAllNames();
  let loaded = 0, failed = 0;
  names.forEach(name=>{
    const url = WEAPON_AUDIO_DIR + encodeURIComponent(name) + '.ogg';
    fetch(url)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(buf=>audioCtx.decodeAudioData(buf))
      .then(decoded=>{ wsndBuffers[name] = decoded; loaded++; })
      .catch(()=>{ wsndMissing.add(name); failed++; });
  });
  setTimeout(()=>{
    console.log('Weapon audio: '+loaded+' loaded, '+failed+' missing of '+names.length+
      (failed ? ' ('+[...wsndMissing].join(', ')+')' : ''));
  }, 3000);
}

function wsndPick(v){ return Array.isArray(v) ? v[Math.floor(Math.random()*v.length)] : v; }

// One-shot. Returns the source so a caller can stop it early (the fuse does this).
function wsndPlay(name, opts){
  if(!audioCtx || !name) return null;
  const buf = wsndBuffers[name];
  if(!buf) return null;
  opts = opts || {};
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  if(opts.rate) src.playbackRate.value = opts.rate;
  const gain = audioCtx.createGain();
  gain.gain.value = (opts.volume===undefined) ? 0.8 : opts.volume;
  const panner = audioCtx.createStereoPanner();
  panner.pan.value = opts.pan || 0;
  src.connect(gain).connect(panner).connect(masterGain);
  src.start(audioCtx.currentTime + (opts.delay || 0));
  return { src, gain };
}

// Looping handle with a fade in, and a fade out on release so a held weapon tails off
// instead of being cut dead.
function wsndStartLoop(name, opts){
  if(!audioCtx || !name) return null;
  const buf = wsndBuffers[name];
  if(!buf) return null;
  opts = opts || {};
  const src = audioCtx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const gain = audioCtx.createGain();
  const target = (opts.volume===undefined) ? 0.75 : opts.volume;
  const now = audioCtx.currentTime;
  const fadeIn = opts.fadeIn || 0.02;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(target, now + fadeIn);
  src.connect(gain).connect(masterGain);
  src.start(now);
  return { src, gain, target };
}

function wsndStopLoop(handle, fadeOut){
  if(!handle || !audioCtx) return;
  const now = audioCtx.currentTime;
  const f = Math.max(0.01, fadeOut || 0.05);
  try{
    handle.gain.gain.cancelScheduledValues(now);
    handle.gain.gain.setValueAtTime(Math.max(0.0001, handle.gain.gain.value), now);
    handle.gain.gain.exponentialRampToValueAtTime(0.0001, now + f);
    handle.src.stop(now + f + 0.02);
  }catch(e){}
}

// ---------- looping trigger sounds ----------
let wsndLoopHandle = null, wsndLoopWeapon = -1;

// Driven per frame rather than from the fire call, because a loop has to know when the
// trigger is *released* as well as pressed.
function updateWeaponAudio(){
  const wIdx = player.currentWeapon;
  const def = WEAPON_SOUNDS[wIdx];
  const wantLoop = !!(def && def.fireLoop) && mouseDown && !player.reloading &&
                   gameState === 'playing' && wsndHasAmmo(wIdx);

  if(wantLoop && (!wsndLoopHandle || wsndLoopWeapon !== wIdx)){
    if(wsndLoopHandle) wsndStopLoop(wsndLoopHandle, 0.03);
    wsndLoopHandle = wsndStartLoop(def.fireLoop, { fadeIn: def.loopFadeIn || 0.02 });
    wsndLoopWeapon = wIdx;
  } else if(!wantLoop && wsndLoopHandle){
    const prev = WEAPON_SOUNDS[wsndLoopWeapon];
    wsndStopLoop(wsndLoopHandle, (prev && prev.loopFadeOut) || 0.06);
    wsndLoopHandle = null; wsndLoopWeapon = -1;
  }
}

function wsndHasAmmo(wIdx){
  const w = ALL_WEAPONS[wIdx];
  if(!w || w.noAmmo) return true;
  const a = player.ammoByWeapon[wIdx];
  return !!a && a.mag > 0;
}

// ---------- firing ----------
function weaponFireSound(wIdx){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def) return;
  if(def.fireLoop) return;              // handled by the loop above
  if(def.thrown) return;                // the throw sound fires at the animation's zenith
  if(def.meleeMiss) return;             // decided by whether the swing connected
  if(def.fire) wsndPlay(def.fire, { volume:0.75 });
}

// Espada: the swing resolves instantly, so the result is known before the sound is chosen.
function weaponMeleeSound(wIdx, didHit){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def) return;
  if(def.meleeMiss){
    wsndPlay(didHit ? def.meleeHit : wsndPick(def.meleeMiss), { volume:0.8 });
  } else if(def.fire){
    wsndPlay(def.fire, { volume:0.8 });
  }
}

function weaponDryFireSound(){ wsndPlay(SOUND_SHOOT_FAIL, { volume:0.6 }); }
function weaponBulletImpactSound(pan){ wsndPlay(SOUND_BULLET_IMPACT, { volume:0.45, pan:pan||0 }); }
function weaponBubblePopSound(pan){ wsndPlay(wsndPick(BUBBLE_POP_SOUNDS), { volume:0.5, pan:pan||0 }); }

// ---------- throwing and fuses ----------
// The fuse starts on the button press, so its opening strike lines up with the throw, and is
// cut when the charge goes off — the file runs longer than any fuse actually lasts.
let activeFuses = [];
function weaponThrowSound(wIdx){
  wsndPlay(wsndPick(THROW_SOUNDS), { volume:0.7 });
}

function weaponStartFuse(wIdx){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def || !def.thrown) return null;
  if(def.fuseUntil !== 'explosion') return null;
  const handle = wsndPlay(SOUND_FUSE, { volume:0.6 });
  if(handle) activeFuses.push(handle);
  return handle;
}

function weaponStopFuse(handle){
  if(!handle) return;
  const i = activeFuses.indexOf(handle);
  if(i !== -1) activeFuses.splice(i,1);
  try{
    const now = audioCtx.currentTime;
    handle.gain.gain.cancelScheduledValues(now);
    handle.gain.gain.setValueAtTime(Math.max(0.0001, handle.gain.gain.value), now);
    handle.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    handle.src.stop(now + 0.06);
  }catch(e){}
}

function weaponImpactSound(wIdx, pan){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def || !def.impact) return;
  wsndPlay(wsndPick(def.impact), { volume:0.7, pan:pan||0 });
}

function weaponExplodeSound(wIdx, pan){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def || !def.explode) return;
  wsndPlay(def.explode, { volume:0.85, pan:pan||0 });
}

function weaponEvolvedExtraSound(wIdx, pan, delay){
  const def = WEAPON_SOUNDS[wIdx];
  if(!def || !def.evolvedExtra) return;
  wsndPlay(def.evolvedExtra, { volume:0.8, pan:pan||0, delay:delay||0 });
}

// ---------- reload sequences ----------
// Parts are scheduled against the reload's actual duration rather than played back to back,
// so they stay in step when reload speed changes with levelling: the first lands on the
// press, the last ENDS on completion, and a middle part (the rifle's) is centred.
let reloadSources = [];
function weaponReloadSequence(wIdx, totalTime){
  weaponCancelReload();
  const def = WEAPON_SOUNDS[wIdx];
  if(!def || !def.reload || !audioCtx) return;
  const parts = def.reload;

  const durOf = name => (wsndBuffers[name] ? wsndBuffers[name].duration : 0);
  const schedule = [];

  if(parts.length >= 1) schedule.push({ name:parts[0], at:0 });
  if(parts.length === 2){
    // Second part ends exactly on completion.
    schedule.push({ name:parts[1], at: Math.max(0, totalTime - durOf(parts[1])) });
  } else if(parts.length >= 3){
    // Middle part centred on the halfway point, last part ending on completion.
    schedule.push({ name:parts[1], at: Math.max(0, totalTime/2 - durOf(parts[1])/2) });
    schedule.push({ name:parts[2], at: Math.max(0, totalTime - durOf(parts[2])) });
  }

  schedule.forEach(s=>{
    const h = wsndPlay(s.name, { volume:0.7, delay:s.at });
    if(h) reloadSources.push(h);
  });
}

// Switching weapons or dying mid-reload shouldn't leave parts firing into silence.
function weaponCancelReload(){
  reloadSources.forEach(h=>{ try{ h.src.stop(); }catch(e){} });
  reloadSources = [];
}
