"use strict";
// =================================================================
// THE DIRECTOR — continuous spawning, replacing waves.
//
// A spawn budget, in "cost", comes in at a rate that climbs with the run clock. It's spent on
// enemies while what's alive adds up to less than a cap, which also climbs. Each enemy type
// has a cost (a TrajeA is 1) and an unlock minute; among the unlocked types, the chance of
// picking one is proportional to 1/cost, so the weak ones are the common ones.
//
// On top of that, timed events (all in minutes of game time, which stops while paused):
//   - a horde every HORDE_EVERY_MIN: 30 s of triple spawn rate, weak types only
//   - a boss guest from MINIBOSS_FIRST_MIN, every MINIBOSS_EVERY_MIN: one big, tough enemy
//     with a floating health bar, worth a pickup and a lot of XP
//   - the R at BOSS_SUMMON_MIN (see boss.js)
//
// Spawn positions are taken around where the player was SPAWN_ANCHOR_DELAY seconds ago
// (see spawnAnchor / findSpawnPosition in zombies.js).
// =================================================================

const director = {
  started: false,
  budget: 0,
  hordeUntil: -1,          // game time a running horde ends
  nextHordeAt: 0,
  nextMiniBossAt: 0,
  nextShieldAt: 0,
  history: [],             // [{t, x, z}] player positions, newest last
  historyTimer: 0,
  pick: null,              // the type chosen for the next spawn, waiting for budget
};

function runMinutes(){ return gameTime/60; }
// Stands in for the old wave number in every enemy formula: 1 at the start, climbing steadily.
function difficultyLevel(){ return 1 + runMinutes()*DIFFICULTY_PER_MINUTE; }
function hordeActive(){ return gameTime < director.hordeUntil; }

function directorIntensityMult(){ return 1 + statValue('enemyIntensity')*SPAWN_INTENSITY_BONUS; }
function directorSpawnRate(){
  const r = (SPAWN_RATE_BASE + SPAWN_RATE_PER_MINUTE*runMinutes()) * directorIntensityMult();
  return hordeActive() ? r*HORDE_RATE_MULT : r;
}
function directorAliveCap(){
  const c = Math.min(SPAWN_CAP_MAX, SPAWN_CAP_BASE + SPAWN_CAP_PER_MINUTE*runMinutes()) * directorIntensityMult();
  return hordeActive() ? c*HORDE_CAP_MULT : c;
}
// What the living enemies add up to. Boss Rs carry their own cost, so while a sentence's Rs
// are out there, fewer ordinary guests come.
function directorAliveCost(){
  let sum = 0;
  for(const z of zombies) if(!z.dying) sum += (z.spawnCost !== undefined ? z.spawnCost : (z.def.spawnCost || 0));
  return sum;
}

// ---------- choosing what to send ----------
function directorEligibleTypes(){
  const m = runMinutes(), horde = hordeActive();
  const out = [];
  for(const id in ENEMY_TYPES){
    const def = ENEMY_TYPES[id];
    if(!(def.spawnCost > 0)) continue;              // R types: only the boss sends them
    if((def.unlockMin || 0) > m) continue;
    if(!enemyTextures[id]) continue;                // missing art: that enemy just never shows up
    if(horde && def.spawnCost > HORDE_MAX_COST) continue;
    out.push(def);
  }
  return out;
}
// One spawn: a type, how many (a swarm comes as a pack), and what it costs in total.
function directorPick(){
  const types = directorEligibleTypes();
  if(!types.length) return null;
  const packSize = def => def.swarmSize ? (def.swarmSize[0] + def.swarmSize[1])/2 : 1;
  // Weighted by 1/(cost of what actually arrives), so a pack of cheap children is weighed as
  // the pack, not as one child.
  let total = 0;
  const w = types.map(def=>{ const v = 1/(def.spawnCost*packSize(def)); total += v; return v; });
  let r = Math.random()*total, def = types[types.length-1];
  for(let i=0;i<types.length;i++){ r -= w[i]; if(r <= 0){ def = types[i]; break; } }
  let count = 1;
  if(def.swarmSize){ const [lo,hi] = def.swarmSize; count = lo + Math.floor(Math.random()*(hi-lo+1)); }
  return { def, count, cost: def.spawnCost*count };
}

// ---------- the per-frame update ----------
function directorStart(){
  director.started = true;
  director.budget = SPAWN_RATE_BASE*2;   // the first guest arrives within a couple of seconds
  director.hordeUntil = -1;
  director.nextHordeAt = HORDE_EVERY_MIN*60;
  director.nextMiniBossAt = MINIBOSS_FIRST_MIN*60;
  director.nextShieldAt = SHIELD_REFILL_SECONDS;
  director.history = [];
  director.historyTimer = 0;
  director.pick = null;
  recordPlayerPosition();
  refillShield();
  soundWaveStart();
}

function resetDirector(){
  director.started = false;
  director.budget = 0;
  director.hordeUntil = -1;
  director.history = [];
  director.pick = null;
  clearMiniBossBars();
}

function updateDirector(delta){
  if(!director.started) return;
  updatePositionHistory(delta);
  updateDirectorEvents();

  director.budget = Math.min(director.budget + directorSpawnRate()*delta, Math.max(SPAWN_BUDGET_MAX, directorSpawnRate()*2));
  // Spend: the pick is kept until it can be afforded, so an expensive enemy isn't skipped
  // forever in favour of cheap ones that always fit.
  for(let guard=0; guard<8; guard++){
    if(!director.pick) director.pick = directorPick();
    const p = director.pick;
    if(!p) break;
    // A horde that ended while a strong type was queued for it... or the reverse: re-pick if
    // the queued type isn't allowed right now.
    if(hordeActive() && p.def.spawnCost > HORDE_MAX_COST){ director.pick = null; continue; }
    if(director.budget < p.cost) break;
    if(directorAliveCost() + p.cost > directorAliveCap()) break;
    director.budget -= p.cost;
    director.pick = null;
    spawnZombie(p.def, p.count);
  }
  updateMiniBossBars();
}

function updateDirectorEvents(){
  // Horde
  if(gameTime >= director.nextHordeAt){
    director.nextHordeAt += HORDE_EVERY_MIN*60;
    startHorde();
  }
  if(director.hordeUntil > 0 && gameTime >= director.hordeUntil){
    director.hordeUntil = -1;
    // Survived it: the guitarist congratulates you, as he used to at the end of a wave.
    if(typeof guitarristaOnWaveClear === 'function') guitarristaOnWaveClear();
    soundWaveClear();
    showWaveBanner(t('bn.hordeEnd'), t('bn.hordeEndSub'));
  }
  // Boss guest
  if(gameTime >= director.nextMiniBossAt){
    director.nextMiniBossAt += MINIBOSS_EVERY_MIN*60;
    spawnMiniBoss();
  }
  // Pecholata
  if(gameTime >= director.nextShieldAt){
    director.nextShieldAt += SHIELD_REFILL_SECONDS;
    refillShield();
  }
}

function startHorde(){
  director.hordeUntil = gameTime + HORDE_DURATION;
  director.pick = null;                   // drop a queued strong type: hordes are weak types only
  director.budget = Math.max(director.budget, SPAWN_BUDGET_MAX);   // it arrives as a surge
  showWaveBanner(t('bn.horde'), t('bn.hordeSub'));
  soundWaveStart();
}

// ---------- remembering where the player has been ----------
function recordPlayerPosition(){
  director.history.push({ t: gameTime, x: camera.position.x, z: camera.position.z });
}
function updatePositionHistory(delta){
  director.historyTimer -= delta;
  if(director.historyTimer <= 0){
    director.historyTimer = SPAWN_ANCHOR_SAMPLE;
    recordPlayerPosition();
    // Keep a little more than the delay, so there's always a sample at or before it.
    const keep = Math.ceil(SPAWN_ANCHOR_DELAY/SPAWN_ANCHOR_SAMPLE) + 4;
    if(director.history.length > keep) director.history.splice(0, director.history.length - keep);
  }
}
// Where the player was SPAWN_ANCHOR_DELAY seconds ago (or as far back as we have, early on).
function spawnAnchor(){
  const h = director.history;
  if(!h.length) return { x: camera.position.x, z: camera.position.z };
  const want = gameTime - SPAWN_ANCHOR_DELAY;
  for(let i=h.length-1;i>=0;i--) if(h[i].t <= want) return h[i];
  return h[0];
}

// ---------- boss guests ----------
function spawnMiniBoss(def){
  if(!def){
    const types = directorEligibleTypes().filter(d=>!d.static);
    if(!types.length) return null;
    def = types[Math.floor(Math.random()*types.length)];
  }
  if(!enemyTextures[def.id]) return null;
  const z = spawnOneEnemy(def);
  if(!z) return null;
  applyMiniBoss(z);
  showWaveBanner(t('bn.miniBoss'), t('bn.miniBossSub'));
  if(typeof soundWaveStart === 'function') soundWaveStart();
  return z;
}

function applyMiniBoss(z){
  z.miniBoss = true;
  z.spawnCost = 0;                        // an extra: doesn't crowd out the ordinary spawns
  z.hp *= MINIBOSS_HP; z.maxHp *= MINIBOSS_HP;
  // Children stay at their own speed: they're already the fastest thing in the game.
  if(!z.def.swarmSize) z.speed *= MINIBOSS_SPEED;
  z.height *= MINIBOSS_SCALE; z.width *= MINIBOSS_SCALE;
  z.collisionRadius = (z.collisionRadius || ZOMBIE_RADIUS) * MINIBOSS_SCALE;
  z.billboard.scale.set(z.width, z.height, 1);
  z.billboard.position.y = z.height/2;
  if(z.blob) z.blob.scale.multiplyScalar(MINIBOSS_SCALE);
  z.wander = 0;
  createMiniBossBar(z);
}

// ---------- the floating health bar ----------
// Styled like the HUD's own bars (dark recess, square segments), in red. It's a DOM element
// placed over the enemy's head each frame, so it stays crisp under the pixel filter.
const MINIBOSS_BAR_SEGMENTS = 12;
function miniBossBarLayer(){
  let layer = document.getElementById('miniBossBars');
  if(!layer){
    layer = document.createElement('div');
    layer.id = 'miniBossBars';
    document.body.appendChild(layer);
  }
  return layer;
}
function createMiniBossBar(z){
  const bar = document.createElement('div');
  bar.className = 'mbBar';
  let segs = '';
  for(let i=0;i<MINIBOSS_BAR_SEGMENTS;i++) segs += '<i></i>';
  bar.innerHTML = '<div class="mbName">' + t('mb.name', { n: enemyDisplayName(z.def.id) }) + '</div><div class="mbTrack">' + segs + '</div>';
  miniBossBarLayer().appendChild(bar);
  z.hpBar = bar;
}
function removeMiniBossBar(z){
  if(z && z.hpBar){ z.hpBar.remove(); z.hpBar = null; }
}
function clearMiniBossBars(){
  const layer = document.getElementById('miniBossBars');
  if(layer) layer.innerHTML = '';
}
const _mbV = new THREE.Vector3();
function updateMiniBossBars(){
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for(const z of zombies){
    if(!z.hpBar) continue;
    if(z.dying){ removeMiniBossBar(z); continue; }
    _mbV.copy(z.group.position); _mbV.y += z.height*1.08;
    const dist = _mbV.distanceTo(camera.position);
    _mbV.project(camera);
    const onScreen = _mbV.z < 1 && Math.abs(_mbV.x) < 1.1 && Math.abs(_mbV.y) < 1.1 && dist < MINIBOSS_BAR_RANGE;
    if(!onScreen){ if(z.hpBar.style.display !== 'none') z.hpBar.style.display = 'none'; continue; }
    z.hpBar.style.display = '';
    const x = (_mbV.x*0.5 + 0.5)*w, y = (-_mbV.y*0.5 + 0.5)*h;
    z.hpBar.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-100%)';
    const k = Math.max(0, z.hp/z.maxHp);
    const lit = Math.ceil(k*MINIBOSS_BAR_SEGMENTS - 1e-6);
    if(z.hpBarLit !== lit){
      z.hpBarLit = lit;
      const segs = z.hpBar.querySelectorAll('.mbTrack i');
      segs.forEach((s,i)=>s.classList.toggle('on', i < lit));
    }
  }
}

// A readable name for the bar: the enemy's id, tidied (MujerA -> MUJER A).
function enemyDisplayName(id){
  const key = 'en.' + id, v = t(key);
  return v !== key ? v : id.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

// ---------- test keys ----------
function directorDebugKey(code){
  if(!DIRECTOR_DEBUG_KEYS || gameState !== 'playing' || !director.started) return false;
  if(code === 'KeyH'){ startHorde(); return true; }
  if(code === 'KeyG'){ spawnMiniBoss(); return true; }
  if(code === 'KeyT'){
    // Skip a minute: the clock jumps and everything keyed to it catches up.
    gameTime += 60;
    director.history.forEach(p=>p.t += 60);
    showWaveBanner(formatRunClock(gameTime), '+1:00');
    return true;
  }
  return false;
}

function formatRunClock(sec){
  const s = Math.max(0, Math.floor(sec)), m = Math.floor(s/60);
  return m + ':' + String(s%60).padStart(2,'0');
}
