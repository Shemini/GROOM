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
// Recitals launched but whose letters are still being drawn. Building the letters is
// asynchronous, and without this there's a gap where the recital is neither scheduled nor
// in flight — long enough for a wave to end and lose that round's Rs entirely.
let bossRecitalsBuilding = 0;

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
  const height = Math.max(BOSS_MIN_HEIGHT, dist*Math.tan(BOSS_VIEW_ANGLE_DEG*Math.PI/180)) * BOSS_SIZE_MULT;
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

  // Yaw first, then tilt about its own width: that's what lets it lie on its back and get up
  // facing the player, rather than tipping about a fixed world axis.
  mesh.rotation.order = 'YXZ';
  mesh.visible = false;

  boss = {
    mesh, home, height, speakUntil: -1, swayPhase: Math.random()*6.28,
    state: 'absent',            // absent | rising | active | falling
    stateAt: 0,                 // game time the current state began
    nextRiseWave: BOSS_FROM_WAVE,
    roundsDone: 0,              // completed rounds, each worth 1/BOSS_ROUNDS of its health
    round: null,                // { id, expected, killed } for the round in progress
    roundCounter: 0,
    barLag: 1,                  // the pale trail behind the health fill
  };
}

// ---------- lifecycle: rising, standing, falling ----------
const BOSS_LYING = -Math.PI/2;   // flat on its back, top pointing away from the arena

function bossBeginRise(){
  boss.state = 'rising';
  boss.stateAt = gameTime;
  boss.roundsDone = 0;
  boss.barLag = 1;
  boss.mesh.visible = true;
  boss.mesh.rotation.x = BOSS_LYING;
  startBossRumble(BOSS_RISE_TIME, false);
  if(typeof guitarristaBeginBossMusic === 'function') guitarristaBeginBossMusic();
  showWaveBanner(t('bn.bossRise'), t('bn.bossRiseSub'));
  setBossBarVisible(true);
}

function bossBeginFall(){
  boss.state = 'falling';
  boss.stateAt = gameTime;
  boss.round = null;
  bossNextSentenceAt = -1;
  boss.nextRiseWave = wave.number + BOSS_RESPAWN_ROUNDS;
  startBossRumble(BOSS_FALL_TIME, true);
  if(typeof guitarristaEndBossMusic === 'function') guitarristaEndBossMusic();
  showWaveBanner(t('bn.bossFall'), t('bn.bossFallSub'));
}

function easeInOutCubic(x){ return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2; }

// Tilt about its base for the current state: 0 is upright, BOSS_LYING is flat on its back.
function bossTiltNow(){
  const st = boss.state;
  if(st === 'rising'){
    const k = Math.min(1, (gameTime - boss.stateAt)/BOSS_RISE_TIME);
    if(k < 0.82){
      // Heaving itself up: eased, with a stagger part way, like something very heavy
      // struggling to its feet.
      const p = k/0.82;
      return BOSS_LYING*(1 - easeInOutCubic(p)) + Math.sin(p*Math.PI*2.5)*0.05*(1-p);
    }
    // ...then it overshoots onto its toes a little and settles back.
    const p = (k-0.82)/0.18;
    return 0.07*Math.sin(p*Math.PI);
  }
  if(st === 'falling'){
    // The rise in reverse: it sways where it stands, then topples backwards, accelerating.
    const k = Math.min(1, (gameTime - boss.stateAt)/BOSS_FALL_TIME);
    if(k < 0.25) return 0.06*Math.sin((k/0.25)*Math.PI*2);
    const p = (k-0.25)/0.75;
    return BOSS_LYING*p*p;
  }
  return 0;
}

// Shake for the moment: builds through the rise, and slams at the end of the fall.
function bossShakeNow(){
  if(boss.state === 'rising'){
    const k = Math.min(1, (gameTime - boss.stateAt)/BOSS_RISE_TIME);
    return BOSS_SHAKE*Math.sin(k*Math.PI);
  }
  if(boss.state === 'falling'){
    const tt = gameTime - boss.stateAt;
    const k = Math.min(1, tt/BOSS_FALL_TIME);
    let s = BOSS_SHAKE*0.6*k*k;
    const since = tt - BOSS_FALL_TIME;            // after it hits the ground
    if(since > 0) s = BOSS_SHAKE*2.2*Math.max(0, 1 - since/1.2);
    return s;
  }
  return 0;
}

function updateBossLifecycle(){
  if(boss.state === 'rising' && gameTime - boss.stateAt >= BOSS_RISE_TIME){
    boss.state = 'active';
    boss.stateAt = gameTime;
  }
  if(boss.state === 'falling'){
    const since = gameTime - boss.stateAt - BOSS_FALL_TIME;
    if(since >= 0 && !boss.impactDone){ boss.impactDone = true; bossImpactThud(); }
    if(since > 1.4){
      boss.state = 'absent';
      boss.impactDone = false;
      boss.mesh.visible = false;
      setBossBarVisible(false);
    }
  }
  // Applied after the player has moved this frame, and overwritten by the next move, so it
  // jolts the view without ever drifting the player's actual position.
  const shake = bossShakeNow();
  if(shake > 0.001){
    camera.position.x += (Math.random()-0.5)*shake*2;
    camera.position.y += (Math.random()-0.5)*shake*2;
    camera.position.z += (Math.random()-0.5)*shake*2;
  }
}

// ---------- the boss itself ----------

function updateBossBody(delta, t){
  if(!boss || boss.state === 'absent') return;
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
  m.rotation.x = bossTiltNow();
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


function launchBossSentence(text){
  if(!boss) initBoss();
  if(!boss || boss.state !== 'active') return;
  const entry = text ? { text } : BOSS_SENTENCES[Math.floor(Math.random()*BOSS_SENTENCES.length)];
  text = entry.text;
  // If there's a recording, it sets the pace: the R shudders for as long as it speaks, and the
  // letters leave its face at the speed of the speech.
  const voiceDur = playBossVoice(entry.voice);
  boss.speakUntil = gameTime + (voiceDur || BOSS_SPEAK_TIME);

  const hard = strongRIndices(text);
  const fontKeys = Object.keys(R_FONTS);
  const chars = [...text];
  let expected = 0;
  const plan = chars.map((ch, i)=>{
    if(ch === ' ') return { ch, space:true };
    if(!hard.has(i)) return { ch, glow:false, glyph:SENTENCE_FONT, body:SENTENCE_TEXT_COLOR, pixel:true };
    // Its case decides what it sends: a capital sends adults, a lowercase r sends children.
    const upper = ch === ch.toUpperCase();
    const pool = fontKeys.filter(k=> upper || !R_FONTS[k].adultOnly);   // Fredericka is capitals only
    const font = pool[Math.floor(Math.random()*pool.length)];
    const def = ENEMY_TYPES[rTypeId(font, upper)];
    // What it will drop: adults one at a time, children in packs — and exactly one elite,
    // in this R's colour, hidden somewhere in that list.
    const drops = upper ? Array.from({length:BOSS_DROPS_UPPER}, ()=>({ count:1 }))
                        : Array.from({length:BOSS_DROPS_LOWER}, ()=>({ count:R_CHILD_PACK }));
    const total = drops.reduce((s,d)=>s+d.count, 0);
    let pick = Math.floor(Math.random()*total);
    for(const d of drops){ if(pick < d.count){ d.elite = pick; break; } pick -= d.count; }
    expected += total;
    return { ch, def, glow:true, glyph:def.glyph, body:'#' + new THREE.Color(def.eliteTint).getHexString(),
             pixel:false, drops };
  });
  // Every R this recital will send is known now, which sets what each one is worth.
  if(boss.round) boss.round.expected += expected;
  bossRecitalsBuilding++;
  Promise.all(plan.map(p=> p.space ? null : buildSentenceLetter(p.glyph, p.ch, p.body, p.glow ? 1 : 0, p.pixel)))
    .then(glyphs=>{ if(boss) startSentenceFlight(plan, glyphs, voiceDur); })
    .catch(e=>console.warn('Boss sentence could not be built', e))
    .finally(()=>{ bossRecitalsBuilding = Math.max(0, bossRecitalsBuilding - 1); });
}

function startSentenceFlight(plan, glyphs, voiceDur){
  const H = SENTENCE_LETTER_HEIGHT;
  const letters = [];
  let cursor = 0;
  plan.forEach((p, i)=>{
    if(p.space){ cursor += H*SENTENCE_SPACE_ADVANCE; return; }
    const g = glyphs[i];
    const scale = p.glow ? SENTENCE_R_SCALE : 1;
    const adv = g.advance*H*scale;
    // Colour is in the texture. Depth-tested, so a building between you and the line hides
    // it like anything else in the world would.
    const mat = new THREE.MeshBasicMaterial({
      map: g.tex, transparent: true, depthWrite: false, depthTest: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), mat);
    mesh.scale.set(g.aspect*H*scale, H*scale, 1);
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    letters.push({
      mesh, offset: cursor + adv/2, h: H*scale, w: g.aspect*H*scale,
      hard: !!p.glow, def: p.def, drops: p.drops || [], dropsLeft: p.drops ? p.drops.length : 0, nextDrop: 0,
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
    // With a recording, the whole line takes as long as the voice to leave the R.
    emitSpeed: voiceDur ? length/voiceDur : 0,
    // Reading pace in characters, converted to metres for this line's actual letter widths.
    readSpeed: SENTENCE_READ_CPS * (length / Math.max(1, letters.length)),
  });
}

function updateSentences(delta, t){
  for(let si=bossSentences.length-1; si>=0; si--){
    const S = bossSentences[si];
    const tail = S.head - S.length;
    // Fast while it's on its way in or out; slow while any of it is over the arena, so the
    // line has time to be read.
    const reading = S.head > S.sweepStart - 20 && tail < S.sweepEnd + 20;
    const emerging = S.emitSpeed > 0 && tail < 0;     // still coming out of its mouth
    // Reading wins over the voice sync. A long line can't finish leaving the R before its
    // first words reach the arena, and racing them past at speech pace would make them
    // unreadable — so once it's overhead it slows, even if the tail is still emerging.
    const speed = reading ? S.readSpeed : (emerging ? S.emitSpeed : SENTENCE_SPEED_TRAVEL);
    S.head += speed * delta;

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
          dropMinion(L);
          L.dropsLeft--;
          L.nextDrop = t + BOSS_DROP_INTERVAL*(0.75 + Math.random()*0.5);
        }
        // Leaving the arena with Rs still owed: send the rest now. Each one is already
        // counted toward the round, so skipping any would leave the boss unkillable.
        if(L.dropsLeft > 0 && s >= S.sweepEnd + 40){
          while(L.dropsLeft > 0){ dropMinion(L); L.dropsLeft--; }
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
  // Called before the counter drops, so this is the next entry still owed.
  const entry = L.drops[L.drops.length - L.dropsLeft] || { count:1 };
  const def = L.def;
  const tex = enemyTextures[def.id];
  const anchor = tex ? findSpawnPosition() : null;
  if(!tex || !anchor){
    // Can't be sent after all: take it off the round's tally so the boss stays killable.
    if(boss && boss.round) boss.round.expected = Math.max(0, boss.round.expected - entry.count);
    return;
  }
  for(let i=0; i<entry.count; i++){
    // A pack lands together, scattered around one spawn point like any other swarm.
    const to = i === 0 ? anchor : clusterPointNear(anchor, SWARM_SPREAD);
    launchMinion(L, def, tex, to, entry.elite === i);
  }
}

// One R falling from the sentence to its spawn point. Lowercase rs and elites look the part
// on the way down, so what's landing is readable before it lands.
function launchMinion(L, def, tex, to, elite){
  const img = tex.image;
  const h = AVG_ZOMBIE_HEIGHT*def.heightMult*(elite ? R_ELITE_SCALE : 1);
  const w = h*(img.width/img.height);
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent:true, alphaTest:0.5,
    side: THREE.DoubleSide, color: elite ? def.eliteTint : def.tint });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1), mat);
  mesh.scale.set(w, h, 1);
  const from = L.mesh.position.clone();
  mesh.position.copy(from);
  scene.add(mesh);
  const dist = from.distanceTo(to);
  bossMinions.push({
    mesh, def, from, to, h, t: 0, elite, roundId: boss && boss.round ? boss.round.id : -1,
    dur: Math.min(2.4, Math.max(1.0, dist/BOSS_MINION_SPEED)) * (0.9 + Math.random()*0.25),
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
  const z = spawnOneEnemy(M.def, M.to.clone(), { noCount:true });
  if(z){ z.fromBoss = true; z.bossRoundId = M.roundId; if(M.elite) applyEliteR(z); }
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

// ---------- the voice ----------
// Comes from the R itself: no distance falloff, but always panned to where it stands relative
// to the camera, and re-panned every frame so turning your head moves the voice. A low-pass
// filter closes down as the R moves behind you, since panning alone can't tell front from back.
let bossVoice = null;   // { source, filter, panner, gain, name, startedAt, offset, duration, paused }

function bossVoicePosition(){
  const p = boss.mesh.position.clone();
  p.y += boss.height*0.6;
  return p;
}

function playBossVoice(name, offset){
  if(!name || !audioCtx || typeof wsndBuffers === 'undefined') return 0;
  const buf = wsndBuffers[name];
  if(!buf){ console.warn('Boss voice "' + name + '" not loaded (Audio/Boss/' + name + '.ogg).'); return 0; }
  stopBossVoice();
  const source = audioCtx.createBufferSource();
  source.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  const panner = audioCtx.createStereoPanner();
  const gain = audioCtx.createGain();
  gain.gain.value = BOSS_VOICE_VOLUME;
  source.connect(filter).connect(panner).connect(gain).connect(masterGain);
  const from = Math.max(0, offset || 0);
  source.start(0, from);
  bossVoice = { source, filter, panner, gain, name, startedAt: audioCtx.currentTime - from,
                duration: buf.duration, paused: false, offset: 0 };
  source.onended = ()=>{ if(bossVoice && bossVoice.source === source && !bossVoice.paused) bossVoice = null; };
  updateBossVoiceDirection();
  return buf.duration - from;
}

function updateBossVoiceDirection(){
  if(!bossVoice || bossVoice.paused || !boss) return;
  const pos = bossVoicePosition();
  bossVoice.panner.pan.value = computePan(pos);
  // 1 straight ahead, -1 directly behind.
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const rel = pos.sub(camera.position).normalize();
  const facing = fwd.dot(rel);
  const behind = Math.max(0, -facing);                 // 0 in front, up to 1 behind
  const cutoff = 20000 - (20000 - BOSS_VOICE_BEHIND_CUTOFF)*behind;
  bossVoice.filter.frequency.setTargetAtTime(cutoff, audioCtx.currentTime, 0.05);
}

function stopBossVoice(){
  if(!bossVoice) return;
  try{ bossVoice.source.onended = null; bossVoice.source.stop(); }catch(e){}
  bossVoice = null;
}

// Pausing freezes the sentence mid-air, so the voice has to stop with it and pick up from
// the same word — otherwise it keeps talking over a frozen sky and finishes out of sync.
function syncBossVoicePause(playing){
  if(!playing && bossRumble) bossRumble.gain.gain.value = 0;   // restored by the next update
  // Lit kamikaze fuses go quiet too; their next update restores the hiss.
  if(!playing) zombies.forEach(z=>{ if(z.fuseSound) z.fuseSound.gain.gain.value = 0; });
  if(!bossVoice || !audioCtx) return;
  if(!playing && !bossVoice.paused){
    bossVoice.offset = audioCtx.currentTime - bossVoice.startedAt;
    bossVoice.paused = true;
    try{ bossVoice.source.onended = null; bossVoice.source.stop(); }catch(e){}
  } else if(playing && bossVoice.paused){
    const at = bossVoice.offset, name = bossVoice.name;
    bossVoice = null;
    if(at < (wsndBuffers[name] ? wsndBuffers[name].duration : 0)) playBossVoice(name, at);
  }
}

// ---------- health and rounds ----------
// The bar is split into BOSS_ROUNDS equal shares. In a round, every R the boss sends is
// worth an equal slice of that round's share, so the bar always empties by exactly one share
// per round however many Rs it took.
function bossHealth(){
  if(!boss) return 1;
  let done = boss.roundsDone;
  const r = boss.round;
  if(r && r.expected > 0) done += Math.min(1, r.killed / r.expected);
  return Math.max(0, 1 - done/BOSS_ROUNDS);
}

function startBossRound(){
  boss.roundCounter++;
  boss.round = { id: boss.roundCounter, expected: 0, killed: 0 };
}

// Called by killZombie for every enemy; only the Rs this round sent count against it.
function bossOnEnemyKilled(z){
  if(!boss || !boss.round || z.bossRoundId !== boss.round.id) return;
  boss.round.killed++;
  if(bossHealth() <= 1e-6 && boss.state === 'active') bossBeginFall();
}

// A wave can't end while the boss still has Rs to send or in the air — otherwise a fast
// player could clear the wave before the recital and skip that round's share of damage.
function bossBlocksWaveEnd(){
  if(!boss || (boss.state !== 'rising' && boss.state !== 'active')) return false;
  return bossNextSentenceAt >= 0 || bossRecitalsBuilding > 0 ||
         bossSentences.length > 0 || bossMinions.length > 0;
}

function bossOnWaveClear(){
  if(!boss || !boss.round) return;
  const r = boss.round;
  if(r.expected > 0) boss.roundsDone += Math.min(1, r.killed / r.expected);
  boss.round = null;
}

// ---------- scheduling ----------

function bossOnWaveStart(){
  if(!BOSS_ENABLED) return;
  if(!boss) initBoss();
  if(!boss) return;
  if(boss.state === 'absent' && wave.number >= boss.nextRiseWave){
    bossBeginRise();
    startBossRound();
    // It speaks once it's on its feet, not while it's still getting up.
    bossNextSentenceAt = gameTime + BOSS_RISE_TIME + BOSS_FIRST_DELAY;
  } else if(boss.state === 'active'){
    startBossRound();
    bossNextSentenceAt = gameTime + BOSS_FIRST_DELAY;
  }
}

function updateBoss(delta, t){
  if(!BOSS_ENABLED) return;
  if(!boss) initBoss();
  if(!boss) return;
  updateBossLifecycle();
  updateBossBody(delta, gameTime);
  updateBossRumble();
  if(boss.state === 'active' && bossNextSentenceAt >= 0 && gameTime >= bossNextSentenceAt){
    bossNextSentenceAt = -1;
    launchBossSentence();
  }
  updateBossVoiceDirection();
  updateSentences(delta, gameTime);
  updateMinions(delta);
  updateBossBar(delta);
}

// Test keys while tuning the fight.
function bossDebugRecite(){
  if(!boss) initBoss();
  if(!boss) return;
  if(boss.state === 'absent'){ bossBeginRise(); startBossRound(); bossNextSentenceAt = gameTime + BOSS_RISE_TIME + 1; return; }
  if(boss.state === 'active'){ if(!boss.round) startBossRound(); launchBossSentence(); }
}
function bossDebugTakeRound(){
  if(!boss || boss.state !== 'active') return;
  boss.roundsDone = Math.min(BOSS_ROUNDS, boss.roundsDone + 1);
  if(bossHealth() <= 1e-6) bossBeginFall();
}

// ---------- health bar ----------
function setBossBarVisible(on){
  const el2 = document.getElementById('bossBar');
  if(el2) el2.classList.toggle('on', on);
}
function updateBossBar(delta){
  const el2 = document.getElementById('bossBar');
  if(!el2 || !boss) return;
  // Fills up as it rises, like a boss intro; drains as it's beaten.
  let hp = bossHealth();
  if(boss.state === 'rising') hp = Math.min(1, (gameTime - boss.stateAt)/BOSS_RISE_TIME);
  if(boss.state === 'falling') hp = 0;
  // The pale trail lingers a moment before catching up, so each hit's size is readable.
  if(boss.barLag < hp) boss.barLag = hp;
  else boss.barLag += (hp - boss.barLag)*Math.min(1, delta*2.2);
  const fill = document.getElementById('bossBarFill');
  const lag = document.getElementById('bossBarLag');
  if(fill) fill.style.width = (hp*100).toFixed(2) + '%';
  if(lag) lag.style.width = (boss.barLag*100).toFixed(2) + '%';
  const name = document.getElementById('bossBarName');
  if(name && name.textContent !== t('boss.name')) name.textContent = t('boss.name');
}

// ---------- rumble ----------
// Synthesised: brown noise through a low-pass, plus a slow sub tone, swelling with the
// motion. If a recorded rumble is added later, set BOSS_RUMBLE_FILE and it's used instead.
let bossRumble = null;   // { nodes..., dur, at, falling }

function startBossRumble(duration, falling){
  stopBossRumble();
  if(!audioCtx) return;
  const ctx = audioCtx;
  const gain = ctx.createGain(); gain.gain.value = 0;
  const panner = ctx.createStereoPanner();
  gain.connect(panner).connect(masterGain);
  const sources = [];
  const sample = (BOSS_RUMBLE_FILE && typeof wsndBuffers !== 'undefined') ? wsndBuffers[BOSS_RUMBLE_FILE] : null;
  if(sample){
    const s = ctx.createBufferSource(); s.buffer = sample; s.loop = true;
    s.connect(gain); s.start(); sources.push(s);
  } else {
    const len = ctx.sampleRate*2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for(let i=0;i<len;i++){ last = (last + 0.02*(Math.random()*2-1))/1.02; d[i] = last*3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
    noise.connect(lp).connect(gain); noise.start(); sources.push(noise);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38;
    const subGain = ctx.createGain(); subGain.gain.value = 0.55;
    sub.connect(subGain).connect(gain); sub.start(); sources.push(sub);
    // A slow wobble in the sub, so it groans rather than hums.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(sub.frequency); lfo.start(); sources.push(lfo);
  }
  bossRumble = { gain, panner, sources, dur: duration, at: gameTime, falling };
}

// Loudness follows the motion: swelling through the rise; building through the fall.
function updateBossRumble(){
  if(!bossRumble) return;
  const k = (gameTime - bossRumble.at)/bossRumble.dur;
  if(k >= 1.05){ stopBossRumble(); return; }
  let env = bossRumble.falling ? Math.min(1, k*1.2) : Math.sin(Math.min(1,k)*Math.PI);
  env = Math.max(0, Math.min(1, env)) * (k > 1 ? Math.max(0, 1-(k-1)*20) : 1);
  bossRumble.gain.gain.value = env * BOSS_RUMBLE_VOLUME;
  if(boss) bossRumble.panner.pan.value = computePan(bossVoicePosition());
}

function stopBossRumble(){
  if(!bossRumble) return;
  bossRumble.sources.forEach(s=>{ try{ s.stop(); }catch(e){} });
  try{ bossRumble.gain.disconnect(); }catch(e){}
  bossRumble = null;
}

// The ground-shaking moment it lands on its back.
function bossImpactThud(){
  if(!audioCtx) return;
  const ctx = audioCtx, now = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate*1.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for(let i=0;i<len;i++){ last = (last + 0.04*(Math.random()*2-1))/1.04; d[i] = last*4*Math.pow(1 - i/len, 2.2); }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
  const g = ctx.createGain(); g.gain.value = BOSS_RUMBLE_VOLUME*1.6;
  const pan = ctx.createStereoPanner(); if(boss) pan.pan.value = computePan(bossVoicePosition());
  src.connect(lp).connect(g).connect(pan).connect(masterGain);
  src.start(now);
}

// Clears everything in flight and puts the boss back down, as at the start of a run.
function resetBoss(){
  bossSentences.forEach(S=>S.letters.forEach(L=>{ scene.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); }));
  bossSentences = [];
  bossMinions.forEach(M=>{ scene.remove(M.mesh); M.mesh.geometry.dispose(); M.mesh.material.dispose(); });
  bossMinions = [];
  bossNextSentenceAt = -1;
  bossRecitalsBuilding = 0;
  stopBossVoice();
  stopBossRumble();
  if(boss){
    boss.speakUntil = -1;
    boss.state = 'absent';
    boss.mesh.visible = false;
    boss.nextRiseWave = BOSS_FROM_WAVE;
    boss.roundsDone = 0; boss.round = null; boss.roundCounter = 0;
    boss.impactDone = false;
  }
  setBossBarVisible(false);
  if(typeof guitarristaEndBossMusic === 'function') guitarristaEndBossMusic();
}
