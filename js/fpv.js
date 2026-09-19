"use strict";
// =================================================================
// FIRST-PERSON WEAPON VIEW
//
// Drawn into the same low-resolution render target as the world, immediately after the scene
// and before the fullscreen grading pass — so the weapon gets pixelated, colour-graded and
// LUT'd exactly like everything else. Rendered as an HTML overlay it would sit sharp and
// ungraded on top of a pixelated world, which reads as a bug rather than a style.
//
// Motion is code, not frames. Each weapon supplies one or two stills and picks a primitive:
//   kick   — recoil back/down with a spring return (firearms)
//   toss   — dip, rise, swap sprite at the zenith, drop away (thrown weapons)
//   punch  — alternating left/right jab (fists)
//   hold   — slide to an offset and stay there while the trigger is down (bubble wand)
//   toggle — two states, no movement beyond the idle sway (laser)
//   vibrate— continuous jitter while the trigger is held (CO2 cannon)
//   swing  — arc across the screen with a rotation sweep, alternating side (sword)
// Everything additionally gets walk bob and turn sway.
//
// Sprites live in ./Weapons/ and are sized to WEAPON_SCREEN_FRACTION of the viewport width,
// with their base sitting just below the top of the HUD bar so the frame is clipped by it.
// =================================================================

const WEAPON_SCREEN_FRACTION = 0.48;   // 20% smaller than the previous 0.60   // sprite width as a share of viewport width
// How far the sprite's base sits below the top of the HUD bar, as a fraction of the bar's
// height. 0.5 puts the bottom of the art halfway down the banner.
const WEAPON_SINK_FRACTION = 0.5;
const HUD_BAR_DESIGN_HEIGHT = 206;     // matches #hudBar in index.html

// One entry per weapon index in ALL_WEAPONS. `layers` are drawn in order, back to front.
// Weapons with no entry simply draw nothing, so missing art never breaks anything.
const FPV_WEAPONS = {
  0:  { motion:'punch',  layers:[{name:'PuñosLeft', hand:'left'}, {name:'PuñosRight', hand:'right'}],
        punch:130, punchRot:0.10, punchSide:70, settle:0.26 },
  1:  { motion:'kick',   layers:[{name:'Pistola'}],   kick:16, kickRot:0.09 },
  2:  { motion:'kick',   layers:[{name:'Rifle'}],     kick:34, kickRot:0.16, settle:0.55 },
  3:  { motion:'kick',   layers:[{name:'Metralleta'}],kick:9,  kickRot:0.05, settle:0.12 },
  4:  { motion:'hold',   layers:[{name:'BurbujasLeft', hand:'left'}, {name:'BurbujasRight', hand:'right', holdOffset:{x:120, y:70}}] },
  5:  { motion:'toss',   layers:[{name:'JamonA', alt:'JamonB'}] },
  6:  { motion:'toss',   layers:[{name:'PetardoA', alt:'PetardoB'}] },
  7:  { motion:'toss',   layers:[{name:'TequifresaA', alt:'TequifresaB'}] },
  8:  { motion:'kick',   layers:[{name:'Confetti'}],  kick:42, kickRot:0.2, settle:0.6 },
  9:  { motion:'vibrate', layers:[{name:'Megatron'}], shake:5.5, shakeRot:0.016 },
  10: { motion:'toggle', layers:[{name:'LaserA', alt:'LaserB'}] },
  // pivot is in normalised sprite space: x 0=left..1=right, y 0=top..1=bottom. Putting it
  // low and to the right makes the blade sweep from a held grip rather than spinning about
  // the middle of the image.
  11: { motion:'swing',  layers:[{name:'Espada', pivot:{x:0.75, y:0.85}}], swingArc:330, swingRot:1.15, swingLift:70 },
};

// Swing timing, in seconds. Kept just under the sword's 0.5s cadence so a held trigger reads
// as a continuous sequence of strokes rather than a stutter with a pause between them.
const SWING_TIME = 0.34;

// Toss timing, in seconds.
// Weapon-swap timing, in seconds. Long enough to register as a movement rather than a cut.
const SWAP_OUT_TIME = 0.16;
const SWAP_IN_TIME = 0.22;
// Share of a reload spent travelling at each end; the remainder is held off-screen.
const RELOAD_TRAVEL = 0.3;

const TOSS_DIP = 0.12;      // dip down before the throw
const TOSS_RISE = 0.16;     // up to the zenith, where the sprite swaps and the projectile flies
const TOSS_FALL = 0.20;     // back down to rest

let fpvScene = null, fpvCamera = null;
let fpvLayers = [];          // active THREE.Mesh planes for the current weapon
let fpvCurrentIdx = -1;
let fpvTextures = {};        // name -> THREE.Texture
let fpvState = {
  phase:'idle',              // idle | kick | toss | swap
  t:0,                       // seconds into the current phase
  tossStage:'',              // dip | rise | fall
  pendingFire:null,          // deferred projectile launch, released at the toss zenith
  showAlt:false,
  punchHand:0,               // alternates so consecutive jabs differ
  swapOut:false,
  bobPhase:0,
  swayX:0, swayY:0,
  recoil:0, recoilRot:0,
};

function initFPV(){
  fpvScene = new THREE.Scene();
  // Normalised overlay space: x and y both span -1..1 across the viewport.
  fpvCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  fpvCamera.position.z = 5;

  // Preload every sprite named in the table. Missing files warn once and are skipped.
  const wanted = new Set();
  for(const k in FPV_WEAPONS){
    for(const layer of FPV_WEAPONS[k].layers){
      wanted.add(layer.name);
      if(layer.alt) wanted.add(layer.alt);
    }
  }
  const loader = new THREE.TextureLoader();
  wanted.forEach(name=>{
    // Filenames contain ñ and accents, which have to be percent-encoded for the request.
    const url = WEAPON_DIR + encodeURIComponent(name) + '.png';
    loader.load(url, tex=>{
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      fpvTextures[name] = tex;
    }, undefined, ()=>{ console.warn('FPV weapon sprite missing: ' + url); });
  });
}

function fpvBuildLayers(wIdx){
  // Tear down the previous weapon's planes.
  fpvLayers.forEach(l=>{ fpvScene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.material.dispose(); });
  fpvLayers = [];
  fpvCurrentIdx = wIdx;
  const def = FPV_WEAPONS[wIdx];
  if(!def) return;

  def.layers.forEach((layer, i)=>{
    const tex = fpvTextures[layer.name];
    if(!tex) return;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent:true, alphaTest:0.02, depthWrite:true, depthTest:false,
      toneMapped:false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), mat);
    mesh.renderOrder = i;
    mesh.frustumCulled = false;
    fpvScene.add(mesh);
    fpvLayers.push({ mesh, mat, def:layer });
  });
  fpvLayoutLayers();
}

// Positions and scales each plane. Recomputed on resize and whenever the weapon changes.
function fpvLayoutLayers(){
  if(!fpvLayers.length) return;
  const W = window.innerWidth, H = window.innerHeight;
  // The HUD bar is authored at 2100px wide and scaled to the viewport, so its on-screen
  // height scales with it — the sprite has to follow or it would detach at other resolutions.
  const barPx = HUD_BAR_DESIGN_HEIGHT * (W/HUD_DESIGN_WIDTH);
  const basePx = Math.max(0, barPx * (1 - WEAPON_SINK_FRACTION));

  fpvLayers.forEach(l=>{
    const img = l.mat.map.image;
    if(!img) return;
    const spriteAspect = img.height/img.width;
    const widthUnits = WEAPON_SCREEN_FRACTION * 2;                 // x spans 2 units
    const heightUnits = widthUnits * (W/H) * spriteAspect;
    l.mesh.scale.set(widthUnits, heightUnits, 1);
    l.baseY = -1 + (basePx*2/H) + heightUnits/2;                   // bottom edge at basePx
    l.mesh.position.set(0, l.baseY, 0);
    l.heightUnits = heightUnits;
  });
}

// Converts a pixel offset into overlay units, so motion constants can be authored in pixels.
function fpvPx(x, y){
  return { x: x*2/window.innerWidth, y: y*2/window.innerHeight };
}

// Called by tryShoot(). For thrown weapons the actual projectile is withheld and released at
// the top of the arc, so the shot visibly leaves the hand rather than the sprite miming it
// after the fact. Everything else fires immediately.
function fpvOnFire(wIdx, fireFn){
  const def = FPV_WEAPONS[wIdx];
  if(!def){ if(fireFn) fireFn(); return; }

  if(def.motion === 'toss'){
    if(fpvState.phase === 'toss'){ if(fireFn) fireFn(); return; }  // already mid-throw
    fpvState.phase = 'toss';
    fpvState.tossStage = 'dip';
    fpvState.t = 0;
    fpvState.showAlt = false;
    fpvState.pendingFire = fireFn || null;
    return;
  }

  if(fireFn) fireFn();

  if(def.motion === 'kick'){
    fpvState.recoil = def.kick || 14;
    fpvState.recoilRot = def.kickRot || 0.08;
    fpvState.phase = 'kick';
    fpvState.t = 0;
  } else if(def.motion === 'punch'){
    fpvState.punchHand = 1 - fpvState.punchHand;
    fpvState.phase = 'kick';
    fpvState.t = 0;
    fpvState.recoil = def.punch || 130;      // was 40 — the jab barely registered
    fpvState.recoilRot = def.punchRot || 0.10;
  } else if(def.motion === 'swing'){
    // Alternate the stroke direction so repeated swings don't look like one looping clip.
    fpvState.punchHand = 1 - fpvState.punchHand;
    fpvState.phase = 'swing';
    fpvState.t = 0;
  }
}

// Weapon swap: drop the old sprite out of frame, build the new one, raise it.
function fpvOnWeaponChanged(){
  fpvState.swapOut = true;
  fpvState.phase = 'swap';
  fpvState.t = 0;
}

function updateFPV(delta, elapsed){
  if(!fpvScene) return;

  const wIdx = player.currentWeapon;
  const def = FPV_WEAPONS[wIdx];

  // Halfway through a swap, switch to the new weapon's sprites while they're off-screen.
  if(fpvState.phase === 'swap'){
    fpvState.t += delta;
    if(fpvState.swapOut && fpvState.t >= SWAP_OUT_TIME){
      fpvState.swapOut = false;
      fpvBuildLayers(wIdx);
      fpvState.t = 0;
    } else if(!fpvState.swapOut && fpvState.t >= SWAP_IN_TIME){
      fpvState.phase = 'idle';
    }
  } else if(wIdx !== fpvCurrentIdx){
    fpvBuildLayers(wIdx);
  }

  if(!fpvLayers.length) return;

  // --- walk bob -----------------------------------------------------------
  // Tied to actual movement, so standing still leaves the weapon steady.
  const moving = (keys['KeyW']||keys['KeyS']||keys['KeyA']||keys['KeyD']) ? 1 : 0;
  const sprintFactor = (keys['ShiftLeft']||keys['ShiftRight']) ? 1.6 : 1.0;
  fpvState.bobPhase += delta * (moving ? 7.5*sprintFactor : 2.0);
  const bobAmt = moving ? 9 : 2.2;
  const bobX = Math.sin(fpvState.bobPhase) * bobAmt;
  const bobY = -Math.abs(Math.cos(fpvState.bobPhase)) * bobAmt * 0.75;

  // --- turn sway ----------------------------------------------------------
  // The weapon lags behind the camera and catches up, which is what makes turning feel weighty.
  const targetSwayX = THREE.MathUtils.clamp(-fpvMouseDX*2.2, -46, 46);
  const targetSwayY = THREE.MathUtils.clamp(fpvMouseDY*1.8, -34, 34);
  fpvState.swayX += (targetSwayX - fpvState.swayX) * Math.min(1, delta*9);
  fpvState.swayY += (targetSwayY - fpvState.swayY) * Math.min(1, delta*9);
  fpvMouseDX *= Math.pow(0.02, delta);
  fpvMouseDY *= Math.pow(0.02, delta);

  // --- per-motion offsets -------------------------------------------------
  let offX = 0, offY = 0, rot = 0, altNow = false;

  if(def && def.motion === 'toss' && fpvState.phase === 'toss'){
    fpvState.t += delta;
    if(fpvState.tossStage === 'dip'){
      const k = Math.min(1, fpvState.t/TOSS_DIP);
      offY = -34*k;
      if(k >= 1){ fpvState.tossStage = 'rise'; fpvState.t = 0; }
    } else if(fpvState.tossStage === 'rise'){
      const k = Math.min(1, fpvState.t/TOSS_RISE);
      offY = -34 + (34+120)*k;
      if(k >= 1){
        // Zenith: the plate leaves the hand. Swap to the second still and release the shot.
        fpvState.showAlt = true;
        // Right before the projectile leaves the hand.
        if(typeof weaponThrowSound === 'function') weaponThrowSound(wIdx);
        if(fpvState.pendingFire){ fpvState.pendingFire(); fpvState.pendingFire = null; }
        fpvState.tossStage = 'fall'; fpvState.t = 0;
      }
    } else {
      const k = Math.min(1, fpvState.t/TOSS_FALL);
      offY = 120*(1-k);
      if(k >= 1){
        // Out of frame to fetch a fresh one, but only if there's another to fetch.
        const ammo = player.ammoByWeapon[wIdx];
        if(ammo && ammo.mag > 0){ fpvState.showAlt = false; }
        fpvState.phase = 'idle';
      }
    }
    altNow = fpvState.showAlt;
  } else if(def && def.motion === 'toss'){
    // Between throws the hand keeps the spent state. During a reload, showAlt is cleared by
    // the drop handler at the halfway point — so the empty sprite travels down and the
    // restocked one travels back up. Reading showAlt directly (rather than forcing the empty
    // state for the whole reload, as this used to) is what lets that swap happen.
    const ammo = player.ammoByWeapon[wIdx];
    if(player.reloading){
      altNow = fpvState.showAlt;
    } else {
      altNow = fpvState.showAlt && !(ammo && ammo.mag > 0);
      if(ammo && ammo.mag > 0) altNow = false;
    }
  }

  if(fpvState.phase === 'kick'){
    const settle = (def && def.settle) || 0.22;
    fpvState.t += delta;
    const k = Math.min(1, fpvState.t/settle);
    // Sharp out, spring back: a damped sine reads as mechanical rather than linear.
    const env = Math.pow(1-k, 2) * Math.cos(k*Math.PI*1.6);
    if(def && def.motion === 'punch'){
      // Drive the hand up and across rather than nudging it, so the jab reads as a strike.
      fpvState.punchEnv = env;
      offY += fpvState.recoil*env;
      rot  += (fpvState.punchHand===0 ? -1 : 1) * fpvState.recoilRot * env;
    } else {
      offY -= fpvState.recoil*env;
      rot  -= fpvState.recoilRot*env;
    }
    if(k >= 1) fpvState.phase = 'idle';
  }

  if(fpvState.phase === 'swing' && def && def.motion === 'swing'){
    fpvState.t += delta;
    const k = Math.min(1, fpvState.t/SWING_TIME);
    const dir = fpvState.punchHand === 0 ? 1 : -1;
    // A half sine carries the blade across and back in one motion; easing the rotation on a
    // slightly different curve stops the arc feeling like a rigid pendulum.
    const sweep = Math.sin(k*Math.PI);
    const lead  = Math.sin(Math.min(1, k*1.25)*Math.PI);
    offX += dir * (def.swingArc||300) * (k - 0.5) * 2 * (1 - Math.pow(k-0.5,2)*2);
    offY += (def.swingLift||70) * sweep - 24*k;
    rot  -= dir * (def.swingRot||1.1) * lead;
    if(k >= 1) fpvState.phase = 'idle';
  }

  // The CO2 cannon has no discrete shot to recoil from, so it just rattles while venting.
  if(def && def.motion === 'vibrate' && mouseDown && !player.reloading){
    const amp = def.shake || 5;
    offX += (Math.random()-0.5)*amp;
    offY += (Math.random()-0.5)*amp;
    rot  += (Math.random()-0.5)*(def.shakeRot||0.015);
  }

  if(def && def.motion === 'toggle') altNow = mouseDown && !player.reloading;

  // --- reload / swap: drop the whole weapon out of frame -------------------
  // Expressed as a fraction of the travel needed to clear the screen; the exact pixel distance
  // depends on how tall each sprite is, so it's resolved per layer below. A flat pixel amount
  // left the top of taller sprites poking up during reloads.
  let dropK = 0;
  if(player.reloading){
    const start = player.lastReloadStart || (player.reloadUntil - 1.6);
    const total = Math.max(0.15, player.reloadUntil - start);
    const remain = Math.max(0, player.reloadUntil - elapsed);
    const k = 1 - Math.min(1, remain/total);
    // Drop clean out of frame, hold there, then come back up — rather than a single sine that
    // only touches full extension for an instant. RELOAD_TRAVEL is the share of the reload
    // spent moving at each end; the middle is spent fully hidden.
    if(k < RELOAD_TRAVEL)            dropK = k/RELOAD_TRAVEL;
    else if(k > 1-RELOAD_TRAVEL)     dropK = (1-k)/RELOAD_TRAVEL;
    else                             dropK = 1;
    // Thrown weapons come back up already restocked: the empty still goes down, the full one
    // returns. The swap happens while the sprite is out of sight.
    if(def && def.motion === 'toss' && k >= 0.5){
      const ammo = player.ammoByWeapon[wIdx];
      if(ammo && ammo.reserve > 0) fpvState.showAlt = false;
    }
  }
  if(fpvState.phase === 'swap'){
    const dur = fpvState.swapOut ? SWAP_OUT_TIME : SWAP_IN_TIME;
    const k = Math.min(1, fpvState.t/dur);
    // Ease so the weapon accelerates away and decelerates back in, rather than sliding
    // linearly — a linear move at this speed reads as a cut rather than a motion.
    dropK = fpvState.swapOut ? (k*k) : (1-k)*(1-k);
  }

  // --- apply --------------------------------------------------------------
  fpvLayers.forEach((l, i)=>{
    const layerDef = l.def;
    let lx = offX + bobX + fpvState.swayX;
    let ly = offY + bobY + fpvState.swayY;   // the drop is applied per layer below

    // The bubble wand's right hand slides to its holding position while the trigger is down.
    if(def && def.motion === 'hold' && layerDef.holdOffset){
      const want = (mouseDown && !player.reloading) ? 1 : 0;
      l.holdK = (l.holdK===undefined) ? 0 : l.holdK + (want - l.holdK)*Math.min(1, delta*10);
      lx += layerDef.holdOffset.x * l.holdK;
      ly += layerDef.holdOffset.y * l.holdK;
    }

    // Fists: only the punching hand moves, and it alternates each swing.
    if(def && def.motion === 'punch'){
      const isActive = (fpvState.punchHand === 0) ? (layerDef.hand === 'right') : (layerDef.hand === 'left');
      if(!isActive){
        ly -= offY;                 // the idle hand keeps its resting position
      } else {
        // Throw it toward the centre of the screen as it extends.
        const side = (layerDef.hand === 'right') ? -1 : 1;
        lx += side * (def.punchSide||70) * (fpvState.punchEnv||0);
      }
    }

    const p = fpvPx(lx, ly);
    // Enough travel to put the sprite's top edge below the bottom of the screen, whatever its
    // height, plus a small margin so nothing peeks during the hold.
    const clearTravel = (l.baseY||0) + (l.heightUnits||1)/2 + 1 + 0.15;
    let cx = p.x;
    let cy = (l.baseY||0) + p.y - dropK*clearTravel;

    // Rotate about a chosen point on the sprite rather than its centre. three.js always spins
    // a mesh about its own origin, so the mesh is nudged by (P - R·P): the offset that leaves
    // the pivot sitting still while everything around it turns.
    if(rot !== 0 && layerDef.pivot){
      const wu = l.mesh.scale.x, hu = l.mesh.scale.y;
      const px = (layerDef.pivot.x - 0.5) * wu;     // centre -> pivot, in overlay units
      const py = (0.5 - layerDef.pivot.y) * hu;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      cx += px - (px*cos - py*sin);
      cy += py - (px*sin + py*cos);
    }

    l.mesh.position.set(cx, cy, 0);
    l.mesh.rotation.z = rot;

    // Two-state sprites (A/B) swap their texture rather than needing a second plane.
    const wantName = (altNow && layerDef.alt) ? layerDef.alt : layerDef.name;
    const wantTex = fpvTextures[wantName];
    if(wantTex && l.mat.map !== wantTex){ l.mat.map = wantTex; l.mat.needsUpdate = true; }
  });
}

// Drawn into the low-res target after the world, so it shares the pixelation and grading.
//
// autoClear has to be off: three.js clears the colour buffer before every render() by default,
// so drawing this pass straight after the world wiped the world out and left the weapon on
// black. The depth buffer must NOT be cleared either — the grading shader reads it to tell
// scene from sky, and clearing it would make the whole frame register as background and skip
// grading entirely. Instead the weapon's material writes depth without testing it, so weapon
// pixels register as geometry while the world's depth stays intact.
function renderFPV(renderer){
  if(!fpvScene || !fpvLayers.length) return;
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(fpvScene, fpvCamera);
  renderer.autoClear = prevAutoClear;
}

// Accumulated mouse delta, consumed by the sway above.
let fpvMouseDX = 0, fpvMouseDY = 0;
function fpvAddMouseDelta(dx, dy){ fpvMouseDX += dx; fpvMouseDY += dy; }
