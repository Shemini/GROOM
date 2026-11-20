"use strict";
// =================================================================
// MYSTERY BOXES
//
// One appears every MYSTERY_BOX_EVERY seconds of game time, somewhere on the map, and stays
// for MYSTERY_BOX_LIFETIME. Walking into it grants a random skill at a random rarity (see
// MYSTERY_BOX_RARITY_WEIGHTS) — any skill, without using a skill slot.
//
// Where it appears: a point is drawn uniformly over the whole level, then moved to the nearest
// spot that's valid for a box, then scattered a little around there. Valid means:
//   - reachable on foot from where the run starts (no climbing; rooftops don't count), and
//   - at least MYSTERY_BOX_WALL_CLEARANCE from any wall or drop, so it never clips into one.
// Drawing over the whole map, rather than only over valid ground, is what keeps the wide
// plazas from getting all of them: a narrow street next to a big block of buildings collects
// every point that lands on those buildings.
// =================================================================

let mysteryBoxes = [];             // { group, pos, born, expires }
let mysteryBoxNextAt = MYSTERY_BOX_EVERY;
let boxSpots = null;               // built once: { grid, valid:Uint8Array, nearest:Int32Array, count }

// ---------- where boxes can go ----------
function buildBoxSpots(){
  const grid = (typeof navGridFine !== 'undefined') ? navGridFine : null;
  if(!grid || grid.gridW < 2 || !playerStart) return null;
  const W = grid.gridW, H = grid.gridH, N = W*H;
  const blocked = grid.navBlocked, floorY = grid.navFloorY;
  const stepTol = (typeof STEP_SMOOTH_MAX !== 'undefined' ? STEP_SMOOTH_MAX : 0.5);

  // 1) Reachable from the start: flood fill, only across steps a player can take both ways.
  const reach = new Uint8Array(N);
  const queue = new Int32Array(N);
  const sc = gridWorldToCell(grid, playerStart.x, playerStart.z);
  const s0 = nearestOpenCell(grid, sc.gx, sc.gz);
  if(!s0) return null;
  let head = 0, tail = 0;
  const startIdx = gridIndex(grid, s0.gx, s0.gz);
  reach[startIdx] = 1; queue[tail++] = startIdx;
  while(head < tail){
    const c = queue[head++], cx = c % W, cz = (c / W) | 0, ch = floorY[c];
    for(let k=0;k<4;k++){
      const nx = cx + (k===0?1:k===1?-1:0), nz = cz + (k===2?1:k===3?-1:0);
      if(nx<0||nx>=W||nz<0||nz>=H) continue;
      const n = nz*W+nx;
      if(reach[n] || blocked[n]) continue;
      if(Math.abs(floorY[n] - ch) > stepTol) continue;
      reach[n] = 1; queue[tail++] = n;
    }
  }

  // 2) Clearance: distance, in cells, to the nearest cell that isn't reachable ground. Walls,
  //    drops and the edges of the walkable area all count, since all of them are "the edge".
  const dist = new Int32Array(N).fill(-1);
  head = 0; tail = 0;
  for(let i=0;i<N;i++) if(!reach[i]){ dist[i] = 0; queue[tail++] = i; }
  while(head < tail){
    const c = queue[head++], cx = c % W, cz = (c / W) | 0;
    for(let dz=-1; dz<=1; dz++) for(let dx=-1; dx<=1; dx++){
      if(!dx && !dz) continue;
      const nx = cx+dx, nz = cz+dz;
      if(nx<0||nx>=W||nz<0||nz>=H) continue;
      const n = nz*W+nx;
      if(dist[n] !== -1) continue;
      dist[n] = dist[c] + 1; queue[tail++] = n;
    }
  }
  const needCells = Math.ceil(MYSTERY_BOX_WALL_CLEARANCE / grid.cellSize);
  const valid = new Uint8Array(N);
  let count = 0;
  for(let i=0;i<N;i++) if(reach[i] && dist[i] > needCells){ valid[i] = 1; count++; }
  if(!count) return null;

  // 3) For every cell on the map, the nearest valid one: one multi-source flood from all of
  //    them, so placing a box later is a single lookup.
  const nearest = new Int32Array(N).fill(-1);
  head = 0; tail = 0;
  for(let i=0;i<N;i++) if(valid[i]){ nearest[i] = i; queue[tail++] = i; }
  while(head < tail){
    const c = queue[head++], cx = c % W, cz = (c / W) | 0;
    for(let k=0;k<4;k++){
      const nx = cx + (k===0?1:k===1?-1:0), nz = cz + (k===2?1:k===3?-1:0);
      if(nx<0||nx>=W||nz<0||nz>=H) continue;
      const n = nz*W+nx;
      if(nearest[n] !== -1) continue;
      nearest[n] = nearest[c]; queue[tail++] = n;
    }
  }
  return { grid, valid, nearest, count };
}

// A spot for a new box, or null if none could be found.
function pickBoxSpot(){
  if(!boxSpots) boxSpots = buildBoxSpots();
  if(!boxSpots) return null;
  const { grid, valid, nearest } = boxSpots;
  const W = grid.gridW, H = grid.gridH;
  const scatter = Math.max(1, Math.round(MYSTERY_BOX_SCATTER / grid.cellSize));
  for(let tries=0; tries<60; tries++){
    // Anywhere on the map...
    const gx = Math.floor(Math.random()*W), gz = Math.floor(Math.random()*H);
    const snapped = nearest[gz*W+gx];
    if(snapped < 0) continue;
    // ...moved to the nearest valid spot, then nudged around it, so boxes don't all line up
    // along the same edge of the valid area.
    let cell = snapped;
    for(let k=0;k<8;k++){
      const sx = (snapped % W) + Math.round((Math.random()*2-1)*scatter);
      const sz = ((snapped / W) | 0) + Math.round((Math.random()*2-1)*scatter);
      if(sx<0||sx>=W||sz<0||sz>=H) continue;
      if(valid[sz*W+sx]){ cell = sz*W+sx; break; }
    }
    const w = gridCellToWorld(grid, cell % W, (cell / W) | 0);
    const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z);
    if(d < MYSTERY_BOX_MIN_DIST || d > MYSTERY_BOX_MAX_DIST) continue;
    const fy = getFloorY(w.x, w.z, grid.navFloorY[cell] + 3);
    return new THREE.Vector3(w.x, fy !== null ? fy : grid.navFloorY[cell], w.z);
  }
  return null;
}

// ---------- the box itself ----------
// A placeholder until there's art: a wrapped present with a glowing ribbon, bobbing and turning,
// and a faint column of light above it so it can be spotted from down the street.
function buildMysteryBoxMesh(){
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75),
    new THREE.MeshLambertMaterial({ color:0x6a2bb8, emissive:0x2a0c52 }));
  const ribbonMat = new THREE.MeshBasicMaterial({ color:0xffd76a });
  const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.16), ribbonMat);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.78), ribbonMat);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), ribbonMat);
  bow.position.y = 0.45; bow.rotation.x = Math.PI/2;
  const spin = new THREE.Group();
  spin.add(body, r1, r2, bow);
  spin.position.y = 0.7;
  body.castShadow = true;
  group.add(spin);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 14, 12, 1, true),
    new THREE.MeshBasicMaterial({ color:0xc58cff, transparent:true, opacity:0.18,
      blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  beam.position.y = 7.5;
  group.add(beam);
  group.userData = { spin, beam };
  return group;
}

function spawnMysteryBox(pos){
  pos = pos || pickBoxSpot();
  if(!pos) return null;
  const group = buildMysteryBoxMesh();
  group.position.copy(pos);
  scene.add(group);
  const box = { group, pos: pos.clone(), born: gameTime, expires: gameTime + MYSTERY_BOX_LIFETIME };
  mysteryBoxes.push(box);
  soundMysteryBoxAppear();
  return box;
}

function removeMysteryBox(i){
  const b = mysteryBoxes[i];
  scene.remove(b.group);
  b.group.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
  mysteryBoxes.splice(i, 1);
}

function resetMysteryBoxes(){
  for(let i=mysteryBoxes.length-1;i>=0;i--) removeMysteryBox(i);
  mysteryBoxNextAt = MYSTERY_BOX_EVERY;
}

function updateMysteryBoxes(delta){
  if(typeof director !== 'undefined' && !director.started) return;
  if(gameTime >= mysteryBoxNextAt){
    mysteryBoxNextAt += MYSTERY_BOX_EVERY;
    spawnMysteryBox();
  }
  for(let i=mysteryBoxes.length-1;i>=0;i--){
    const b = mysteryBoxes[i];
    if(gameTime >= b.expires){ removeMysteryBox(i); continue; }
    const age = gameTime - b.born;
    const u = b.group.userData;
    u.spin.rotation.y += delta*1.4;
    u.spin.position.y = 0.7 + Math.sin(age*2.6)*0.12;
    u.beam.material.opacity = 0.12 + 0.08*Math.sin(age*3.1);
    // Picked up by walking into it.
    const dx = camera.position.x - b.pos.x, dz = camera.position.z - b.pos.z;
    if(dx*dx + dz*dz < MYSTERY_BOX_PICKUP_RADIUS*MYSTERY_BOX_PICKUP_RADIUS &&
       Math.abs(feetY - b.pos.y) < 2.5){
      openMysteryBox(b);
      removeMysteryBox(i);
    }
  }
}

// ---------- the reward ----------
function rollBoxRarity(){
  const pool = SKILL_RARITIES.map(r=>({ r, w: MYSTERY_BOX_RARITY_WEIGHTS[r.key] || 0 }));
  const total = pool.reduce((a,p)=>a+p.w, 0);
  let x = Math.random()*total;
  for(const p of pool){ x -= p.w; if(x <= 0 && p.w > 0) return p.r; }
  return pool.filter(p=>p.w>0).pop().r;
}

function openMysteryBox(b){
  const stat = STATS[Math.floor(Math.random()*STATS.length)];
  const rar = rollBoxRarity();
  applyStatLevel(stat.key, rar.mult, true);   // an extra: no skill slot used
  const effect = formatStatDelta(stat, stat.perLevel*rar.mult);
  const col = rar.color || '#fff0c0';
  showWaveBanner(t('box.opened'),
    '<b style="color:' + col + '">' + statName(stat) + ' ' + effect + '</b> · ' + t('rar.' + rar.key));
  soundBoxWin();
  if(typeof spawnParticles === 'function'){
    spawnParticles(b.pos.clone().setY(b.pos.y + 0.8), {
      count: 40, dir: new THREE.Vector3(0,1,0), spread: 1.8, speed:[2, 5],
      colors:[0xc58cff, 0xffd76a, 0xffffff], size:[0.06, 0.12], drag:1.6, gravity:6, life:1.1, groundY: b.pos.y,
    });
  }
  return { stat: stat.key, rarity: rar.key };
}

// A bright rising chime: something good just turned up.
function soundMysteryBoxAppear(){
  if(typeof playTone !== 'function') return;
  [784, 988, 1175, 1568].forEach((f,i)=>setTimeout(()=>playTone(f, 0.22, 'triangle', 0.2), i*95));
  setTimeout(()=>playTone(2093, 0.5, 'sine', 0.12), 4*95);
}

// ---------- test key ----------
// N drops a box right away, somewhere on the map as usual.
function mysteryBoxDebugKey(code){
  if(!DIRECTOR_DEBUG_KEYS || gameState !== 'playing' || code !== 'KeyN') return false;
  spawnMysteryBox();
  return true;
}
