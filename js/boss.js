"use strict";
// =================================================================
// THE R — the boss.
//
// A colossal extruded R stands on the horizon, hazed blue by distance. It recites a sentence
// that flies across the sky one letter at a time, each letter in a random font. The hard Rs in
// it glow, and as they pass over the arena they shed R enemies in their own font, which arc
// down to ordinary spawn points and join the fight at normal size.
//
// The sentence is built so that every letter is its own billboard. That lets the line be
// large enough to read through the pixel filter while the enemies it sheds stay normal-sized,
// and lets each glowing R be tracked individually as it flies.
// =================================================================

// The R from Cinzel Decorative Black, converted to three.js's text format from the real font
// file. Only this one glyph is kept, so it's embedded here rather than loaded separately.
const BOSS_R_FONT = {"glyphs":{"R":{"ha":783,"x_min":35,"x_max":1174,"o":"m 721 504 q 692 404 721 450 q 620 340 662 359 q 537 322 578 322 q 514 323 525 322 q 629 245 577 310 q 683 170 653 216 q 725 108 713 125 q 845 -32 785 22 q 1174 -160 973 -148 l 1174 -170 q 1036 -226 1119 -209 q 938 -236 987 -236 q 836 -222 890 -236 q 730 -180 782 -208 q 624 -99 678 -152 q 537 10 571 -46 q 478 116 503 65 q 430 215 453 166 q 403 275 408 264 q 351 342 374 335 l 351 352 l 367 352 q 474 403 432 352 q 502 464 498 432 q 506 504 506 495 q 462 614 506 579 q 362 648 418 648 l 318 648 l 318 73 q 337 28 318 47 q 382 10 356 10 l 394 10 l 394 0 l 35 0 l 35 10 l 48 10 q 92 28 74 10 q 112 72 111 46 l 112 627 q 80 682 111 664 q 48 690 65 690 l 36 690 l 36 700 l 426 700 q 652 648 575 700 q 721 504 721 601"}},"familyName":"Cinzel Decorative","ascender":976,"descender":-372,"underlinePosition":-75,"underlineThickness":50,"boundingBox":{"yMin":-373,"xMin":-340,"yMax":977,"xMax":1580},"resolution":1000,"original_font_information":{"format":0,"fontFamily":"Cinzel Decorative"},"cssFontWeight":"900","cssFontStyle":"normal"};

let boss = null;                 // { mesh, home, height, speakUntil }
let bossSentences = [];          // letters in flight
let bossMinions = [];            // Rs falling from the sky toward a spawn point
let bossNextSentenceAt = -1;     // game time of the next scheduled recital

// ---------- construction ----------

function initBoss(){
  if(boss || !BOSS_ENABLED || !levelBox || !isFinite(levelBox.min.x)) return;

  const font = new THREE.Font(BOSS_R_FONT);
  const geo = new THREE.TextGeometry('R', {
    font, size: 1, height: BOSS_DEPTH_FRACTION,
    curveSegments: 10, bevelEnabled: true,
    bevelThickness: 0.02, bevelSize: 0.012, bevelSegments: 2,
  });
  // Centre it horizontally and in depth, and stand it on its baseline, so it scales and
  // turns about its own foot rather than the font's origin.
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x+bb.max.x)/2, -bb.min.y, -(bb.min.z+bb.max.z)/2);
  geo.computeBoundingBox();
  const unitH = geo.boundingBox.max.y - geo.boundingBox.min.y;

  // Aerial perspective: a far object picks up the colour of the air between it and you, and
  // its shadows lift because that air is lit. So the colour is pulled toward the haze, and
  // the haze is added back as emissive light so the unlit side doesn't go black.
  const haze = new THREE.Color(BOSS_HAZE_COLOR);
  const col = new THREE.Color(BOSS_COLOR).lerp(haze, BOSS_HAZE_AMOUNT);
  const mat = new THREE.MeshLambertMaterial({
    color: col,
    emissive: haze.clone().multiplyScalar(BOSS_HAZE_AMOUNT*0.45),
  });
  const mesh = new THREE.Mesh(geo, mat);
  // Too far away to cast a sensible shadow, and far outside the shadow map anyway.
  mesh.castShadow = false; mesh.receiveShadow = false;

  // On the horizon in the direction the player first looks, well beyond the level's edge.
  const center = new THREE.Vector3(); levelBox.getCenter(center);
  const size = new THREE.Vector3(); levelBox.getSize(size);
  const radius = Math.hypot(size.x, size.z)/2;
  const look = new THREE.Vector3(); camera.getWorldDirection(look); look.y = 0;
  if(look.lengthSq() < 1e-6) look.set(0,0,-1);
  look.normalize();
  const dist = radius + BOSS_EXTRA_DISTANCE;
  const height = Math.max(BOSS_MIN_HEIGHT, dist*Math.tan(BOSS_VIEW_ANGLE_DEG*Math.PI/180));
  const home = center.clone().addScaledVector(look, dist);
  // Its foot sits below the lowest point of the level, so it rises from beyond the horizon
  // instead of standing on ground that isn't there.
  home.y = levelBox.min.y - height*0.12;

  const scale = height/unitH;
  mesh.scale.setScalar(scale);
  mesh.position.copy(home);
  scene.add(mesh);

  // The camera's draw distance has to reach it from the far side of the level.
  const needed = dist + radius + height*1.2;
  if(camera.far < needed){ camera.far = needed; camera.updateProjectionMatrix(); }

  boss = { mesh, home, height, speakUntil: -1, swayPhase: Math.random()*6.28 };
}

// ---------- the boss itself ----------

function updateBossBody(delta, t){
  if(!boss) return;
  const m = boss.mesh;
  // Slowly turns its face toward the player, so the R reads from anywhere in the level.
  const want = Math.atan2(camera.position.x - boss.home.x, camera.position.z - boss.home.z);
  let d = want - m.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  m.rotation.y += d * Math.min(1, delta*0.35);

  // Breathes and sways while idle; shudders while it's speaking.
  const speaking = t < boss.speakUntil;
  const bob = Math.sin(t*0.55 + boss.swayPhase) * boss.height*0.012;
  let roll = Math.sin(t*0.37 + boss.swayPhase) * 0.025;
  let pulse = 1;
  if(speaking){
    roll += Math.sin(t*23) * 0.012;
    pulse = 1 + Math.abs(Math.sin(t*7)) * 0.025;
  }
  m.position.y = boss.home.y + bob;
  m.rotation.z = roll;
  const base = boss.height / (m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y);
  m.scale.set(base*pulse, base*pulse, base*pulse);
}

// Where letters leave the boss: high on its face, nudged toward the arena.
function bossMouth(){
  const p = boss.mesh.position.clone();
  p.y += boss.height*0.72;
  const toArena = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  return p.addScaledVector(toArena, boss.height*0.15);
}

// ---------- the sentence ----------

// The Rs a Spanish speaker trills: at the start of a word, doubled, or after n, l or s. Those
// are the ones that glow and drop enemies — the joke is about pronunciation, not the letter.
function strongRIndices(text){
  const s = text.toLowerCase(), out = new Set();
  const isLetter = c => /[a-záéíóúüñ]/.test(c);
  for(let i=0;i<s.length;i++){
    if(s[i] !== 'r') continue;
    const prev = i>0 ? s[i-1] : ' ', next = i+1<s.length ? s[i+1] : ' ';
    if(!BOSS_ONLY_STRONG_R || !isLetter(prev) || prev==='r' || next==='r' || 'nls'.indexOf(prev) !== -1){
      out.add(i);
    }
  }
  return out;
}

function letterFonts(){
  return Object.values(ENEMY_TYPES).filter(d=>d.glyph);
}

function launchBossSentence(text){
  if(!boss) initBoss();
  if(!boss) return;
  text = text || BOSS_SENTENCES[Math.floor(Math.random()*BOSS_SENTENCES.length)];
  boss.speakUntil = gameTime + BOSS_SPEAK_TIME;

  const fonts = letterFonts();
  const hard = strongRIndices(text);
  const chars = [...text];
  // Each letter gets a random font. A highlighted R drops enemies of the font it's drawn in.
  const plan = chars.map((ch, i)=>{
    if(ch === ' ') return { ch, space:true };
    const def = fonts[Math.floor(Math.random()*fonts.length)];
    const glow = hard.has(i) ? '#' + new THREE.Color(def.tint).getHexString() : null;
    return { ch, def, glow };
  });
  Promise.all(plan.map(p=> p.space ? null : buildSentenceLetter(p.def.glyph, p.ch, p.glow)))
    .then(glyphs=>{ if(boss) startSentenceFlight(plan, glyphs); });
}

function startSentenceFlight(plan, glyphs){
  const H = SENTENCE_LETTER_HEIGHT;
  const letters = [];
  let cursor = 0;
  plan.forEach((p, i)=>{
    if(p.space){ cursor += H*SENTENCE_SPACE_ADVANCE; return; }
    const g = glyphs[i];
    const scale = p.glow ? SENTENCE_R_SCALE : 1;
    const adv = g.advance*H*scale;
    const mat = new THREE.MeshBasicMaterial({
      map: g.tex, transparent: true, depthWrite: false,
      // Plain letters are dark ink against the sky; the hard Rs are pale with a halo in
      // their own font's colour, so each glowing R already hints at what it'll drop.
      color: p.glow ? SENTENCE_R_BODY : SENTENCE_INK,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), mat);
    mesh.scale.set(g.aspect*H*scale, H*scale, 1);
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    letters.push({
      mesh, offset: cursor + adv/2, h: H*scale, w: g.aspect*H*scale,
      hard: !!p.glow, def: p.def, dropsLeft: p.glow ? BOSS_DROPS_PER_R : 0, nextDrop: 0,
      pulse: Math.random()*6.28,
    });
    cursor += adv;
  });
  const length = cursor;
  // Each offset already measures back from the first letter, so the first letter leads and
  // the rest trail behind it. (Flipping these is what made the line read backwards.)

  // The route: out of the boss's face, down toward the arena, then a slow sweep from the
  // player's front-right to front-left. Right-to-left matters — a moving line of text only
  // reads correctly when the first letter leads from the right, like a news ticker.
  const P = camera.position.clone();
  const toBoss = new THREE.Vector3(boss.home.x - P.x, 0, boss.home.z - P.z).normalize();
  const right = new THREE.Vector3(-toBoss.z, 0, toBoss.x);
  const A = P.y + SENTENCE_ALTITUDE;
  const D = SENTENCE_SWEEP_DISTANCE, W = SENTENCE_SWEEP_HALFWIDTH;
  const distBoss = Math.hypot(boss.home.x - P.x, boss.home.z - P.z);
  const at = (f, r, y)=> P.clone().addScaledVector(toBoss, f).addScaledVector(right, r).setY(y);
  const pts = [
    bossMouth(),
    at(distBoss*0.45, W*1.4, A + 30),
    at(D, W, A),
    at(D*1.05, 0, A + 3),
    at(D, -W, A),
    at(D*0.5, -W*2.6, A + 25),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  // Arc length at the start and end of the sweep, so speed and drops can be keyed to it.
  const DIV = 400, lens = curve.getLengths(DIV), total = lens[DIV];
  const sAt = k => lens[Math.round(k/(pts.length-1)*DIV)];

  bossSentences.push({
    letters, curve, total, length,
    head: 0,                                 // arc position of the first letter
    sweepStart: sAt(2), sweepEnd: sAt(4),
  });
}

function updateSentences(delta, t){
  for(let si=bossSentences.length-1; si>=0; si--){
    const S = bossSentences[si];
    const tail = S.head - S.length;
    // Fast while it's on its way in or out; slow while any of it is over the arena, so the
    // line has time to be read.
    const reading = S.head > S.sweepStart - 20 && tail < S.sweepEnd + 20;
    S.head += (reading ? SENTENCE_SPEED_READ : SENTENCE_SPEED_TRAVEL) * delta;

    for(const L of S.letters){
      const s = S.head - L.offset;
      if(s < 0 || s > S.total){ L.mesh.visible = false; continue; }
      L.mesh.visible = true;
      L.mesh.position.copy(S.curve.getPointAt(s/S.total));
      // Square to the screen, so the line reads no matter where it is in the sky.
      L.mesh.quaternion.copy(camera.quaternion);
      if(L.hard){
        const k = 1 + Math.sin(t*5 + L.pulse)*0.06;
        L.mesh.scale.set(L.w*k, L.h*k, 1);
        // Shed enemies while passing over the arena.
        if(L.dropsLeft > 0 && s > S.sweepStart - 40 && s < S.sweepEnd + 40 && t >= L.nextDrop){
          L.dropsLeft--;
          L.nextDrop = t + BOSS_DROP_INTERVAL*(0.75 + Math.random()*0.5);
          dropMinion(L);
        }
      }
    }
    if(tail > S.total){
      S.letters.forEach(L=>{ scene.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); });
      bossSentences.splice(si, 1);
    }
  }
}

// ---------- falling Rs ----------

// A glowing R lets go of a normal-sized R of its own font. It arcs down to an ordinary spawn
// point chosen for the player's position — exactly where any other enemy would appear — so
// it never lands on a roof or out of bounds, and the fight stays fair.
function dropMinion(L){
  const def = L.def;
  const tex = enemyTextures[def.id];
  if(!tex) return;
  const to = findSpawnPosition();
  if(!to) return;
  const img = tex.image;
  const h = AVG_ZOMBIE_HEIGHT*def.heightMult;
  const w = h*(img.width/img.height);
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent:true, alphaTest:0.5,
    side: THREE.DoubleSide, color: def.tint });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), mat);
  mesh.scale.set(w, h, 1);
  const from = L.mesh.position.clone();
  mesh.position.copy(from);
  scene.add(mesh);
  const dist = from.distanceTo(to);
  bossMinions.push({
    mesh, def, from, to, h, t: 0,
    dur: Math.min(2.4, Math.max(1.0, dist/BOSS_MINION_SPEED)),
    arc: Math.min(14, dist*0.12),
    spin: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random()*2),
  });
}

function updateMinions(delta){
  for(let i=bossMinions.length-1; i>=0; i--){
    const M = bossMinions[i];
    M.t += delta / M.dur;
    const k = Math.min(1, M.t);
    // Eased in, so it drops away from the sentence and accelerates toward the ground.
    const e = k*k*(3-2*k);
    M.mesh.position.lerpVectors(M.from, M.to, e);
    M.mesh.position.y += Math.sin(k*Math.PI)*M.arc + M.h*0.5*e;
    M.mesh.rotation.set(0, Math.atan2(camera.position.x - M.mesh.position.x, camera.position.z - M.mesh.position.z), M.spin*k*Math.PI*2*(1-k));
    if(k >= 1){
      scene.remove(M.mesh); M.mesh.geometry.dispose(); M.mesh.material.dispose();
      bossMinions.splice(i, 1);
      landMinion(M);
    }
  }
}

function landMinion(M){
  spawnOneEnemy(M.def, M.to.clone(), { noCount:true });
  if(typeof spawnParticles === 'function'){
    spawnParticles(M.to.clone().setY(M.to.y + 0.1), {
      count: 18, dir: new THREE.Vector3(0,1,0), spread: 1.4,
      speed:[1.5, 3.5], colors:[0xd8ccb0, 0xb9ab8e, M.def.tint],
      size:[0.08, 0.14], drag:2.2, gravity:7, life:0.9, groundY: M.to.y,
    });
  }
  // No impact sample yet; a heavy footstep stands in for the thud.
  if(typeof wsndPlayAt === 'function' && typeof FOOTSTEP_SOUNDS !== 'undefined' && audioCtx){
    wsndPlayAt(FOOTSTEP_SOUNDS[Math.floor(Math.random()*FOOTSTEP_SOUNDS.length)], M.to, 0.9, { falloff: 40 });
  }
}

// ---------- scheduling ----------

function bossOnWaveStart(){
  if(!BOSS_ENABLED || wave.number < BOSS_FROM_WAVE) return;
  bossNextSentenceAt = gameTime + BOSS_FIRST_DELAY;
}

function updateBoss(delta, t){
  if(!BOSS_ENABLED) return;
  if(!boss) initBoss();
  if(!boss) return;
  updateBossBody(delta, gameTime);
  if(bossNextSentenceAt >= 0 && gameTime >= bossNextSentenceAt){
    bossNextSentenceAt = -1;
    launchBossSentence();
  }
  updateSentences(delta, gameTime);
  updateMinions(delta);
}

// Clears everything the boss has in flight; the boss itself stays on the horizon.
function resetBoss(){
  bossSentences.forEach(S=>S.letters.forEach(L=>{ scene.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); }));
  bossSentences = [];
  bossMinions.forEach(M=>{ scene.remove(M.mesh); M.mesh.geometry.dispose(); M.mesh.material.dispose(); });
  bossMinions = [];
  bossNextSentenceAt = -1;
  if(boss) boss.speakUntil = -1;
}
