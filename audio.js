"use strict";
// SOUND
// =================================================================
function initAudio(){
  if(audioCtx){ if(audioCtx.state==='suspended') audioCtx.resume(); return; }
  audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  masterGain = audioCtx.createGain(); masterGain.gain.value = muted?0:0.7;
  masterGain.connect(audioCtx.destination);
}
function toggleMute(){ muted=!muted; if(masterGain) masterGain.gain.value=muted?0:0.7; }
function computePan(worldPos){
  if(!camera) return 0;
  const rel = new THREE.Vector3().subVectors(worldPos, camera.position);
  if(rel.lengthSq()<0.0001) return 0;
  rel.normalize();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix,0);
  return THREE.MathUtils.clamp(rel.dot(right),-1,1);
}

// =================================================================
// ENEMY FILE-BASED AUDIO — folder layout: ./Audio/<EnemyType>/<Category>/<EnemyType>_<Category>_<N>.mp3
// Files are entirely optional: a missing file just means that attempt produces no sound
// (cached after the first failure so we don't keep re-requesting a known-404 file).
// =================================================================
const ENEMY_AUDIO_TYPE = 'TrajeA';
const AUDIO_CATEGORIES = {
  dying:   { folder:'Dying',   count:5, rareProb:0.04  },
  passive: { folder:'Passive', count:8, rareProb:0.005 },
  callout: { folder:'Callout', count:8, rareProb:0.005 },
  attack:  { folder:'Attack',  count:5, rareProb:0.04  }, // no exact rare % was given for attack — reused Dying's 4% as a sensible default; adjust AUDIO_CATEGORIES.attack.rareProb if you want it different
};
const CALLOUT_RANGE = 15; // meters — no exact distance was specified; tune this constant to taste
const CALLOUT_COOLDOWN = 30; // seconds, per enemy

const audioMissingCache = new Set();
function pickRareLastIndex(count, rareProb){
  if(Math.random() < rareProb) return count;
  return 1 + Math.floor(Math.random()*(count-1));
}
function createRateLimiter(maxPerSecond){
  let count=0, windowStart=-999;
  return function tryConsume(nowSeconds){
    if(nowSeconds - windowStart >= 1){ windowStart = nowSeconds; count = 0; }
    if(count >= maxPerSecond) return false;
    count++; return true;
  };
}
const dyingSoundLimiter = createRateLimiter(3);
const calloutSoundLimiter = createRateLimiter(3);
const attackSoundLimiter = createRateLimiter(6);

function playEnemyClip(categoryKey, pan, volume){
  const cat = AUDIO_CATEGORIES[categoryKey];
  if(!cat || !audioCtx) return;
  const idx = pickRareLastIndex(cat.count, cat.rareProb);
  const url = `./Audio/${ENEMY_AUDIO_TYPE}/${cat.folder}/${ENEMY_AUDIO_TYPE}_${cat.folder}_${idx}.mp3`;
  if(audioMissingCache.has(url)) return;
  try{
    const audioEl = new Audio(url);
    const source = audioCtx.createMediaElementSource(audioEl);
    const gain = audioCtx.createGain(); gain.gain.value = volume;
    const panner = audioCtx.createStereoPanner(); panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(masterGain);
    audioEl.play().catch(()=>{ audioMissingCache.add(url); });
  } catch(e){ audioMissingCache.add(url); }
}
function playNoise(dur, filterFreq, vol, pan=0){
  if(!audioCtx) return;
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate*dur));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*(1-i/bufferSize);
  const src = audioCtx.createBufferSource(); src.buffer=buffer;
  const filter = audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=filterFreq;
  const gain = audioCtx.createGain(); gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  const panner = audioCtx.createStereoPanner(); panner.pan.value=pan;
  src.connect(filter).connect(gain).connect(panner).connect(masterGain);
  src.start();
}
function playTone(freq, dur, type, vol, pan=0, glideTo=null){
  if(!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(); osc.type=type; osc.frequency.setValueAtTime(freq,t0);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo,1), t0+dur);
  const gain = audioCtx.createGain(); gain.gain.setValueAtTime(vol,t0); gain.gain.exponentialRampToValueAtTime(0.001,t0+dur);
  const panner = audioCtx.createStereoPanner(); panner.pan.value=pan;
  osc.connect(gain).connect(panner).connect(masterGain);
  osc.start(t0); osc.stop(t0+dur+0.02);
}
function soundShot(weapon){
  switch(weapon.type){
    case 'hitscan':
      if(weapon.name==='PISTOL'){ playNoise(0.09,2200,0.4); playTone(180,0.06,'square',0.22); }
      else if(weapon.name==='SHOTGUN'){ playNoise(0.18,900,0.5); playTone(90,0.14,'sawtooth',0.28); }
      else if(weapon.name==='SMG'){ playNoise(0.05,2600,0.26); playTone(240,0.04,'square',0.16); }
      else { playNoise(0.07,2000,0.4); playTone(140,0.08,'square',0.28); }
      break;
    case 'chain':   playNoise(0.05,3000,0.3); playTone(900,0.1,'sawtooth',0.25,0,1600); break;
    case 'pierce':  playNoise(0.14,1800,0.5); playTone(90,0.28,'square',0.35,0,40); break;
    case 'grenade': playNoise(0.15,700,0.35); playTone(110,0.12,'square',0.2); break;
    case 'puddle':  playNoise(0.1,1200,0.3); break;
    case 'vortex':  playTone(300,0.3,'sine',0.25,0,900); break;
  }
}
function soundHit(headshot, crit){ playTone(headshot?1400:900,0.06,'sine',0.2); if(crit) playTone(1800,0.08,'sine',0.15); }
function soundDeath(pan){ playNoise(0.35,700,0.3,pan); playTone(220,0.3,'sawtooth',0.2,pan,60); }
function soundHurt(){ playNoise(0.25,500,0.4); playTone(100,0.25,'sawtooth',0.25,0,50); }
function soundGroan(pan, dist){
  const vol = THREE.MathUtils.clamp(0.32*(1-dist/28),0.03,0.32);
  playTone(70+Math.random()*30,0.9,'sawtooth',vol,pan,55);
}
function soundPurchase(){ playTone(500,0.08,'square',0.2); setTimeout(()=>playTone(760,0.1,'square',0.2),80); }
function soundDenied(){ playNoise(0.14,400,0.3); playTone(120,0.16,'square',0.2,0,70); }
function soundReloadStart(){ playNoise(0.06,1500,0.15); }
function soundReloadDone(){ playTone(400,0.05,'square',0.15); setTimeout(()=>playTone(600,0.06,'square',0.15),60); }
function soundWaveStart(){ playNoise(0.4,600,0.25); playTone(80,0.5,'sawtooth',0.25,0,40); }
function soundWaveClear(){ [520,660,780].forEach((f,i)=>setTimeout(()=>playTone(f,0.15,'square',0.2), i*90)); }
function soundLevelUp(){ [660,880,990,1320].forEach((f,i)=>setTimeout(()=>playTone(f,0.12,'triangle',0.22), i*70)); }
function soundExplosion(pan){ playNoise(0.5,500,0.5,pan); playTone(70,0.4,'sawtooth',0.3,pan,30); }
function soundSplat(){ playNoise(0.12,1000,0.3); }
function soundVortexSpawn(pan){ playTone(200,0.4,'sine',0.25,pan,600); playNoise(0.3,2000,0.15,pan); }
function soundChain(){ playTone(1600,0.06,'sawtooth',0.18); playTone(2200,0.05,'sawtooth',0.12); }
function soundBoxSpin(){ playNoise(0.6,1800,0.2); playTone(400,0.6,'sawtooth',0.15,0,900); }
function soundBoxWin(){ [500,700,900,1200,1500].forEach((f,i)=>setTimeout(()=>playTone(f,0.14,'triangle',0.22), i*80)); }
function soundDropPickup(){ [700,1000,1300].forEach((f,i)=>setTimeout(()=>playTone(f,0.12,'sine',0.25), i*60)); }

// =================================================================
