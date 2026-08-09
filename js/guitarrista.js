"use strict";
// =================================================================
// GUITARRISTA — a hireable NPC musician.
//
// States:
//   'home_playing'  at his spot, playing, audible only nearby (the starting state)
//   'following'     hired: trails the player, keeping within GUITARRISTA_FOLLOW_RADIUS
//   'returning'     dismissed: walking back home, silent
//   'home_silent'   back home after a dismissal, silent until hired again
//
// He is not an enemy: he never appears in `zombies`, so explosions, puddles, chain jumps and
// every other area or secondary effect ignore him automatically. Only the primary ray of a
// shot can touch him, which is what makes "shoot him to skip the song" work without letting
// a stray grenade do it.
// =================================================================

let guitarrista = null;
let guitarristaHomeField = null;   // coarse flow field toward his home spot
let guitarristaHitThisShot = false; // one registered hit per trigger pull (shotgun pellets etc.)

// --- music playback -------------------------------------------------------
let musicEl = null, musicGain = null, musicPan = null;
let musicBag = [];                  // shuffle bag: no repeats until every track has played
let musicCurrentTitle = '';

function initMusicChain(){
  if(musicEl || !audioCtx) return;
  musicEl = new Audio();
  try{
    const src = audioCtx.createMediaElementSource(musicEl);
    musicGain = audioCtx.createGain(); musicGain.gain.value = 0;
    musicPan = audioCtx.createStereoPanner();
    src.connect(musicGain).connect(musicPan).connect(masterGain);
  } catch(e){
    console.error('Guitarrista: could not build the music audio chain', e);
    musicEl = null; return;
  }
  musicEl.addEventListener('ended', ()=>{ startNextTrack(); });
}

function startNextTrack(){
  if(!guitarrista) return;
  if(guitarrista.state!=='home_playing' && guitarrista.state!=='following') return;
  if(GUITARRISTA_TRACKS.length===0) return; // nothing declared in GUITARRISTA_TRACKS yet
  initMusicChain();
  if(!musicEl) return;
  if(musicBag.length===0) musicBag = shuffle(GUITARRISTA_TRACKS.slice());
  const track = musicBag.pop();
  musicCurrentTitle = track.title || track.file;
  musicEl.src = `./Audio/${GUITARRISTA_ACTOR}/Canciones/${track.file}.${AUDIO_EXT}`;
  musicEl.play().catch(()=>{
    console.warn('Guitarrista: could not play track ' + track.file);
    musicCurrentTitle = '';
  });
  updateMusicHUD();
}

function stopMusic(){
  if(musicEl){ try{ musicEl.pause(); }catch(e){} }
  musicCurrentTitle = '';
  updateMusicHUD();
}

function updateMusicHUD(){
  const el2 = document.getElementById('musicTitle');
  if(!el2) return;
  if(musicCurrentTitle){ el2.textContent = '\u266a ' + musicCurrentTitle; el2.classList.remove('hidden'); }
  else el2.classList.add('hidden');
}

// Volume falls off with distance so he's only audible in his vicinity, loudest alongside him.
function updateMusicVolume(){
  if(!musicGain || !guitarrista) return;
  const dx = camera.position.x - guitarrista.group.position.x;
  const dz = camera.position.z - guitarrista.group.position.z;
  const dist = Math.hypot(dx, dz);
  const falloff = THREE.MathUtils.clamp(1 - dist/GUITARRISTA_HEAR_RADIUS, 0, 1);
  musicGain.gain.value = falloff * falloff * GUITARRISTA_MUSIC_VOLUME; // squared = more natural rolloff
  if(musicPan) musicPan.pan.value = computePan(guitarrista.group.position);
}

// --- spawning -------------------------------------------------------------
const GUITARRISTA_ACTOR = 'Guitarrista';

function spawnGuitarrista(){
  if(!zombieSpriteTexture) return;
  let home = GUITARRISTA_HOME;
  if(!home){
    const p = randomFloorPoint([{x:playerStart.x, z:playerStart.z}], 12);
    if(!p){ console.warn('Guitarrista: no valid floor point found; not placed.'); return; }
    home = { x:p.x, z:p.z };
  }
  const floorY = getFloorY(home.x, home.z, levelMaxY);
  const feetY = floorY!==null ? floorY : 0;

  const height = AVG_ZOMBIE_HEIGHT * 1.02;
  const aspect = (zombieSpriteTexture.image.width/SPRITE_COLS) / (zombieSpriteTexture.image.height/SPRITE_ROWS);
  const width = AVG_ZOMBIE_HEIGHT * aspect;

  const group = new THREE.Group();
  const tex = zombieSpriteTexture.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1/SPRITE_COLS, 1/SPRITE_ROWS);
  tex.offset.set(0, 1-1/SPRITE_ROWS);
  // Borrows the TrajeA walk rows for now, mirrored and warm-tinted so he reads as a different
  // character at a glance until he has art of his own.
  const mat = new THREE.MeshLambertMaterial({ map:tex, transparent:true, alphaTest:0.5,
    color:0xffc46b, side:THREE.DoubleSide });
  const billboard = new THREE.Mesh(getBillboardGeometry(), mat);
  billboard.scale.set(-width, height, 1); // negative X mirrors him
  billboard.position.y = height/2;
  billboard.castShadow = true;
  billboard.frustumCulled = false;
  billboard.receiveShadow = true;
  group.add(billboard);

  const shadowMat = new THREE.MeshBasicMaterial({ color:new THREE.Color(settings.contactShadowColor),
    transparent:true, opacity:settings.contactShadowOpacity, depthWrite:false });
  const blob = new THREE.Mesh(getBlobShadowGeometry(), shadowMat);
  blob.rotation.x = -Math.PI/2;
  blob.renderOrder = 1;
  const blobR = (width*HITBOX_WIDTH_FRACTION)/2*1.6;
  blob.scale.set(blobR, blobR, 1);
  blob.position.set(0, 0.02, 0);
  group.add(blob);

  group.position.set(home.x, feetY, home.z);
  scene.add(group);

  guitarrista = {
    group, billboard, blob, home, feetY, velY:0, airborne:0,
    height, width, collisionRadius:(width*HITBOX_WIDTH_FRACTION)/2,
    state:'home_playing',
    animRow: ANIM_ROW_WALK_TOWARD, animFrame:0, animTimer:0,
    hitTimes:[], resumeAt:-999,
  };
  billboard.userData.guitarristaRef = guitarrista;

  guitarristaHomeField = buildFixedTargetField(home.x, home.z);
  console.log('Guitarrista placed at x=' + home.x.toFixed(1) + ', z=' + home.z.toFixed(1));
  startNextTrack();
}

// --- being shot -----------------------------------------------------------
// Called only from the primary ray of a hitscan shot. Never from explosions, chain jumps,
// pierce follow-throughs, damage-over-time or extra shotgun pellets.
function guitarristaOnShot(){
  if(!guitarrista) return;
  if(guitarrista.state!=='home_playing' && guitarrista.state!=='following') return;
  if(guitarristaHitThisShot) return;
  guitarristaHitThisShot = true;

  const now = clock.getElapsedTime();
  guitarrista.hitTimes = guitarrista.hitTimes.filter(t => now - t <= GUITARRISTA_DISMISS_WINDOW);
  guitarrista.hitTimes.push(now);

  stopMusic();
  const pan = computePan(guitarrista.group.position);
  playNamedClip(GUITARRISTA_ACTOR, 'Quejas', GUITARRISTA_BREAK_CLIP, pan, 0.7);

  if(guitarrista.hitTimes.length >= GUITARRISTA_DISMISS_HITS){ dismissGuitarrista(); return; }

  // complaint just after the broken-chord sting, then the next song a moment later
  setTimeout(()=>{
    if(!guitarrista || (guitarrista.state!=='home_playing' && guitarrista.state!=='following')) return;
    playNumberedClip(GUITARRISTA_ACTOR, 'Quejas', GUITARRISTA_QUEJAS_COUNT,
                     computePan(guitarrista.group.position), 0.6, 0);
  }, 600);
  guitarrista.resumeAt = now + GUITARRISTA_SKIP_DELAY;
}

function dismissGuitarrista(){
  if(!guitarrista) return;
  stopMusic();
  guitarrista.state = 'returning';
  guitarrista.hitTimes = [];
  playNumberedClip(GUITARRISTA_ACTOR, 'Insultos', GUITARRISTA_INSULTOS_COUNT,
                   computePan(guitarrista.group.position), 0.75, 0);
  showWaveBanner('GUITARRISTA', 'Se marcha ofendido');
}

function hireGuitarrista(){
  if(!guitarrista) return;
  if(guitarrista.state==='following') return;
  if(player.money < GUITARRISTA_HIRE_COST){ soundDenied(); flashDenied(); return; }
  player.money -= GUITARRISTA_HIRE_COST;
  guitarrista.state = 'following';
  guitarrista.hitTimes = [];
  soundPurchase();
  updateHUD();
  startNextTrack();
}

// Congratulations when a wave is cleared — only while he's actually around and playing.
function guitarristaOnWaveClear(){
  if(!guitarrista) return;
  if(guitarrista.state!=='following' && guitarrista.state!=='home_playing') return;
  playNumberedClip(GUITARRISTA_ACTOR, 'Felicitaciones', GUITARRISTA_FELICITACIONES_COUNT,
                   computePan(guitarrista.group.position), 0.7, 0);
}

// --- per-frame update -----------------------------------------------------
function updateGuitarrista(delta, elapsed){
  if(!guitarrista) return;
  const g = guitarrista;

  // resume playing after a skip
  if(g.resumeAt > -900 && elapsed >= g.resumeAt &&
     (g.state==='following' || g.state==='home_playing')){
    g.resumeAt = -999;
    startNextTrack();
  }

  // Lazy start: the level finishes loading before the player clicks, and browsers won't let
  // us create an AudioContext until that gesture happens — so the first play attempt has to
  // wait until audio actually exists rather than firing at spawn time.
  if(audioCtx && g.resumeAt < -900 &&
     (g.state==='home_playing' || g.state==='following') &&
     GUITARRISTA_TRACKS.length>0 && (!musicEl || musicEl.paused)){
    startNextTrack();
  }

  const distToPlayer = Math.hypot(camera.position.x-g.group.position.x, camera.position.z-g.group.position.z);

  // decide where he wants to be
  let targetX = null, targetZ = null;
  if(g.state==='following'){
    if(distToPlayer > GUITARRISTA_FOLLOW_RADIUS){
      const step = flowFieldTarget(g.group.position.x, g.group.position.z);
      if(step){ targetX = step.x; targetZ = step.z; }
      else { targetX = camera.position.x; targetZ = camera.position.z; }
    }
  } else if(g.state==='returning'){
    const distHome = Math.hypot(g.home.x-g.group.position.x, g.home.z-g.group.position.z);
    if(distHome < 1.5){
      g.state = 'home_silent';
      g.group.position.set(g.home.x, g.feetY, g.home.z);
    } else if(guitarristaHomeField){
      const step = sampleField(navGridCoarse, guitarristaHomeField, g.group.position.x, g.group.position.z);
      if(step){ targetX = step.x; targetZ = step.z; }
      else { targetX = g.home.x; targetZ = g.home.z; }
    } else { targetX = g.home.x; targetZ = g.home.z; }
  }

  let moving = false;
  if(targetX!==null){
    const dx = targetX-g.group.position.x, dz = targetZ-g.group.position.z;
    const d = Math.hypot(dx,dz);
    if(d > 0.0001){
      moving = true;
      const nx = dx/d, nz = dz/d;
      const chestY = g.feetY+0.9;
      const resolved = resolveSlide(g.group.position.x, g.group.position.z,
        nx*GUITARRISTA_SPEED*delta, nz*GUITARRISTA_SPEED*delta, chestY, g.collisionRadius, g.feetY);
      let px = resolved.x, pz = resolved.z;

      // same fall-through protection the zombies use
      let fy = getFloorY(px,pz, g.feetY+2.2);
      if(fy===null) fy = navFloorAt(px,pz);
      if(fy!==null && (g.feetY-fy) <= STEP_SMOOTH_MAX){
        g.feetY += (fy-g.feetY)*Math.min(1,delta*10);
        g.velY = 0; g.airborne = 0;
      } else {
        g.velY -= GRAVITY*delta;
        g.feetY += g.velY*delta;
        if(fy!==null && g.feetY<=fy){ g.feetY = fy; g.velY = 0; g.airborne = 0; }
        else {
          g.airborne += delta;
          if(g.airborne > 1.5){
            const rescue = nearestNavFloor(g.group.position.x, g.group.position.z);
            if(rescue){ px = rescue.x; pz = rescue.z; g.feetY = rescue.y; g.velY = 0; g.airborne = 0; }
          }
        }
      }
      g.group.position.set(px, g.feetY, pz);
    }
  }

  // billboard faces the camera on the vertical axis only, same as the enemies
  const bdx = camera.position.x - g.group.position.x;
  const bdz = camera.position.z - g.group.position.z;
  g.billboard.rotation.y = Math.atan2(bdx, bdz);

  // walk-toward while approaching, walk-away otherwise, so he reads as animated when idle too
  const row = moving ? ANIM_ROW_WALK_TOWARD : ANIM_ROW_WALK_AWAY;
  if(row !== g.animRow){ g.animRow = row; g.animFrame = 0; g.animTimer = 0; }
  g.animTimer -= delta;
  while(g.animTimer <= 0){
    g.animTimer += ANIM_FRAME_DURATION;
    g.animFrame = (g.animFrame+1) % SPRITE_COLS;
    g.billboard.material.map.offset.set(g.animFrame/SPRITE_COLS, 1-(g.animRow+1)/SPRITE_ROWS);
  }

  updateMusicVolume();
}

// --- interaction ----------------------------------------------------------
function guitarristaInteractLabel(){
  if(!guitarrista) return null;
  if(guitarrista.state==='following') return 'GUITARRISTA — ya te acompaña';
  return '[E] CONTRATAR GUITARRISTA — $' + GUITARRISTA_HIRE_COST;
}

// Raycast targets for the primary ray. Empty while he's away so shots pass straight through.
function guitarristaTargets(){
  return guitarrista ? [guitarrista.billboard] : [];
}
