"use strict";
// DAMAGE / HEALTH / XP
// =================================================================
function takeDamage(amount){
  if(gameState!=='playing') return;
  // Higher combo, harder hits: the reward for pushing is paid for with real risk.
  // Armour is flat damage reduction, capped so it can never make the player untouchable.
  const armour = Math.min(0.8, statValue('armor'));
  player.health -= amount * comboDamageTakenMult() * (1 - armour);
  soundHurt();
  faceOnHit();
  damageFlashEl.style.opacity=0.55;
  setTimeout(()=>{ damageFlashEl.style.opacity=0; },150);
  if(player.health<=0){ player.health=0; triggerGameOver(); }
  updateHUD();
}
function addMoney(amount){
  const doubleMult = gameTime<player.doubleUntil ? 2:1;
  player.money += Math.round(amount*doubleMult);
  updateHUD();
}
function addXP(amount){
  const doubleMult = gameTime<player.doubleUntil ? 2:1;
  player.xp += amount*(1+statValue('xpMult'))*doubleMult;
  while(player.xp>=player.xpToNext){
    player.xp -= player.xpToNext; player.level++;
    player.xpToNext = xpForLevel(player.level); player.pendingLevelUps++;
  }
  updateHUD(); maybeShowLevelUp();
}

// =================================================================
// LEVEL UP
// =================================================================
function buildUpgradePool(){
  const pool=[];
  STATS.forEach(s=>{ if(statLevel(s.key)<s.maxLevel) pool.push({ctype:'stat', stat:s}); });
  player.slots.forEach(wIdx=>{
    if(wIdx===null) return;
    const w = ALL_WEAPONS[wIdx];
    // The fists are a fallback, not a build path: no level table, no evolution, so they must
    // never reach the card builder — reading a table that doesn't exist threw mid-render,
    // which left the level-up screen with too few cards or none at all.
    if(!w || w.noLevel) return;
    if(!BASE_LEVEL_TABLES[wIdx] && !player.weaponEvolved[wIdx]) return;
    if(player.weaponEvolved[wIdx]) pool.push({ctype:'weapon', weaponIdx:wIdx});
    else if((player.weaponLevel[wIdx]||1)<5) pool.push({ctype:'weapon', weaponIdx:wIdx});
    else if(EVOLUTIONS[wIdx]) pool.push({ctype:'evolve', weaponIdx:wIdx});
  });

  // Weapons not yet owned are offered here instead of being bought. Taking one is permanent
  // for the run, so there's never a choice between a levelled weapon and a fresh Lv1 one.
  // They're weighted up while slots are empty, or the first pick can take a long time to
  // appear among ten-odd stat cards.
  if(DRAFT_MODE && findEmptySlot() !== -1){
    DRAFT_WEAPON_POOL.forEach(wIdx=>{
      if(!ownsWeapon(wIdx)) pool.push({ctype:'newWeapon', weaponIdx:wIdx});
    });
  }
  return pool;
}
function pickThreeStats(){
  const pool = buildUpgradePool();
  shuffle(pool);
  const picks = [], seen = new Set();
  const key = it => it.ctype + ':' + (it.stat ? it.stat.key : it.weaponIdx);
  const take = it => { const k = key(it); if(seen.has(k)) return false; seen.add(k); picks.push(it); return true; };

  // While a slot is open, reserve cards for weapons not yet owned. Leaving it to chance meant
  // a player holding out for one particular weapon waited ~20 levels, by which point their
  // slots were long since full of whatever had turned up first — the exact trap this system
  // exists to avoid. Guaranteed offers mean every level-up presents a real weapon choice, so
  // waiting for the one you want costs a few levels rather than the run.
  if(DRAFT_MODE && findEmptySlot() !== -1){
    const news = pool.filter(x => x.ctype === 'newWeapon');
    for(const n of news){
      if(picks.length >= DRAFT_GUARANTEED_OFFERS) break;
      take(n);
    }
  }
  // Fill the rest, without letting weapon cards crowd out the stats.
  for(const item of pool){
    if(picks.length >= 3) break;
    if(item.ctype === 'newWeapon') continue;
    take(item);
  }
  // Only if there genuinely isn't anything else left.
  for(const item of pool){ if(picks.length >= 3) break; take(item); }
  return picks;
}

function renderLevelUpCards(picks){
  levelUpCardsEl.innerHTML='';
  picks.forEach((item, i)=>{
    const card = document.createElement('button');
    card.className='lvlCard';
    card.type = 'button';
    const hotkey = '<span class="hotkey">'+(i+1)+'</span>';

    if(item.ctype==='stat'){
      const stat=item.stat, lvl=statLevel(stat.key);
      card.dataset.ctype='stat'; card.dataset.key=stat.key;
      let dots=''; for(let d=0;d<stat.maxLevel;d++) dots+='<div class="dot '+(d<lvl?'filled':'')+'"></div>';
      // The design called for a hatch swatch here; the real stat icons exist now, so they're
      // used instead and the swatch is only a fallback for a stat without art.
      const art = stat.icon
        ? '<img src="'+STATS_DIR+encodeURIComponent(stat.icon)+'.png" alt="">'
        : '<div class="swatch"></div>';
      card.innerHTML =
        '<div class="cardHead"><span class="kindChip">'+t('lvl.kindStat')+'</span>'+hotkey+'</div>'+
        '<div class="art">'+art+'</div>'+
        '<div class="name">'+statName(stat)+'</div>'+
        '<div class="desc">'+statDesc(stat)+'</div>'+
        '<div class="dots">'+dots+'</div>';

    } else if(item.ctype==='weapon'){
      const info = describeWeaponCard(item.weaponIdx);
      card.dataset.ctype='weapon'; card.dataset.widx=item.weaponIdx;
      let dots='';
      const total = info.maxDots>0 ? info.maxDots : 5;
      for(let d=0;d<total;d++) dots+='<div class="dot '+(d<info.curDots?'filled':'')+'"></div>';
      const src = hudIconFor(item.weaponIdx);
      card.innerHTML =
        '<div class="cardHead"><span class="kindChip">'+t('lvl.kindWeapon')+'</span>'+hotkey+'</div>'+
        '<div class="art">'+(src?'<img src="'+src+'" alt="">':'<div class="swatch"></div>')+'</div>'+
        '<div class="name">'+info.name+'</div>'+
        '<div class="desc">'+info.desc+'</div>'+
        '<div class="dots">'+dots+'</div>';

    } else if(item.ctype==='newWeapon'){
      card.className='lvlCard newWeaponCard';
      card.dataset.ctype='newWeapon'; card.dataset.widx=item.weaponIdx;
      const src = hudIconFor(item.weaponIdx);
      card.innerHTML =
        '<div class="cardHead"><span class="kindChip">'+t('lvl.kindNew')+'</span>'+hotkey+'</div>'+
        '<div class="art">'+(src?'<img src="'+src+'" alt="">':'<div class="swatch"></div>')+'</div>'+
        '<div class="name">'+weaponName(item.weaponIdx)+'</div>'+
        '<div class="desc">'+t('lvl.newWeaponDesc')+'</div>'+
        '<div class="dots"></div>';

    } else {
      const w = ALL_WEAPONS[item.weaponIdx];
      card.className='lvlCard evolveCard';
      card.dataset.ctype='evolve'; card.dataset.widx=item.weaponIdx;
      const src = hudIconFor(item.weaponIdx);
      let dots=''; for(let d=0;d<5;d++) dots+='<div class="dot filled"></div>';
      card.innerHTML =
        '<div class="cardHead"><span class="kindChip">'+t('lvl.kindEvolve')+'</span>'+hotkey+'</div>'+
        '<div class="art">'+(src?'<img src="'+src+'" alt="">':'<div class="swatch"></div>')+'</div>'+
        '<div class="name">'+t('lvl.evolveTo',{w:weaponName(item.weaponIdx)})+'</div>'+
        '<div class="desc">→ '+evolutionName(item.weaponIdx)+'</div>'+
        '<div class="dots">'+dots+'</div>';
    }
    levelUpCardsEl.appendChild(card);
  });
  updateLevelUpChrome();
  updateRerollButton();
  scaleLevelUpPanel();
  armLevelUpCards();
}

// The level-up screen appears mid-fight, usually while the player is holding the trigger or
// reaching for a weapon key — so for a moment it ignores input. An accidental pick here is
// permanent, which makes it much worse than a moment's delay.
let levelUpArmedAt = 0;
function armLevelUpCards(){
  levelUpArmedAt = performance.now() + LEVELUP_ARM_DELAY*1000;
  const box = levelUpCardsEl;
  if(!box) return;
  box.classList.add('arming');
  clearTimeout(armLevelUpCards._t);
  armLevelUpCards._t = setTimeout(()=>box.classList.remove('arming'), LEVELUP_ARM_DELAY*1000);
}
function levelUpArmed(){ return performance.now() >= levelUpArmedAt; }

// Header and instruction bar, refreshed whenever the cards are.
function updateLevelUpChrome(){
  const lvl = document.getElementById('lvlNumber');
  if(lvl) lvl.textContent = t('hud.level',{n:player.level});
  const funds = document.getElementById('lvlFunds');
  if(funds) funds.textContent = t('lvl.funds',{n:player.money});
}

// The panel is authored at 1240px and never scales ABOVE 1 — on a wide screen it simply stays
// its natural size rather than stretching.
function scaleLevelUpPanel(){
  const panel = document.getElementById('levelUpPanel');
  if(!panel) return;
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  // Height is considered too, or the panel overflows on a short window.
  const scale = Math.min(1, w/1290, h/700);
  panel.style.transform = 'scale(' + (Math.round(scale*1000)/1000) + ')';
}
function updateRerollButton(){
  rerollBtnEl.textContent = t('lvl.reroll',{n:player.rerollCost});
  const broke = player.money < player.rerollCost;
  rerollBtnEl.disabled = broke;
  const note = document.getElementById('lvlRerollNote');
  if(note){
    note.textContent = broke ? t('lvl.broke') : t('lvl.rerollNote');
    note.classList.toggle('broke', broke);
  }
}
function doReroll(){
  if(player.money<player.rerollCost) return;
  player.money -= player.rerollCost; player.rerollCost += 50;
  soundPurchase(); updateHUD();
  const picks = pickThreeStats();
  if(picks.length===0 || !safeRenderLevelUpCards(picks)){
    levelUpEl.classList.add('hidden'); gameState='playing'; requestLock(); return;
  }
}
// Wrapped so a card that fails to build can't leave the game stuck: the level-up screen is
// shown with gameState already switched, so an exception between the two used to freeze the
// game with no overlay and no pointer lock to recover from.
function safeRenderLevelUpCards(picks){
  try { renderLevelUpCards(picks); return true; }
  catch(e){ console.error('Level-up card render failed', e); return false; }
}

function maybeShowLevelUp(){
  if(gameState==='playing' && player.pendingLevelUps>0){
    player.pendingLevelUps--;
    gameState='levelup'; document.exitPointerLock(); soundLevelUp();
    const picks = pickThreeStats();
    if(picks.length===0){ gameState='playing'; requestLock(); return; }
    if(!safeRenderLevelUpCards(picks)){ gameState='playing'; requestLock(); return; }
    levelUpEl.classList.remove('hidden');
  }
}
function applyStatLevel(key){
  player.stats[key] = (player.stats[key]||0)+1;
  if(key==='maxHealth'){ player.maxHealth+=20; player.health+=20; }
  updateHUD();
}
function chooseLevelUpCard(sel){
  if(sel.ctype==='stat') applyStatLevel(sel.key);
  else if(sel.ctype==='weapon') applyWeaponLevel(sel.widx);
  else if(sel.ctype==='newWeapon') draftWeapon(sel.widx);
  else applyEvolution(sel.widx);
  if(player.pendingLevelUps>0){
    player.pendingLevelUps--; soundLevelUp();
    const picks = pickThreeStats();
    if(picks.length===0 || !safeRenderLevelUpCards(picks)){
      levelUpEl.classList.add('hidden'); gameState='playing'; requestLock(); return;
    }
    return;
  }
  levelUpEl.classList.add('hidden'); gameState='playing'; requestLock();
}

// =================================================================
// WAVES
// =================================================================
function startWave(){
  wave.betweenWaves=false;
  const intensity = statValue('enemyIntensity');
  wave.toSpawn = Math.round((5+wave.number*2)*(1+intensity*0.10));
  wave.spawned=0; wave.spawnTimer=0;
  wave.spawnInterval = Math.max(0.25, 0.8-wave.number*0.04);   // quicker, so a combo has a chance to build
  scheduleDrops();
  comboSetFrozen(false);
  showWaveBanner(t('bn.wave',{n:wave.number}), t('bn.waveSub'));
  soundWaveStart();
}
function showWaveBanner(main, sub){
  waveBannerEl.innerHTML = main+'<span class="sub">'+sub+'</span>';
  waveBannerEl.style.opacity=1;
  setTimeout(()=>{ waveBannerEl.style.opacity=0; },2400);
}
function updateWave(delta, elapsed){
  if(wave.betweenWaves){
    // Nothing to kill, so the combo is held rather than decaying through dead time. Without
    // this the gap between waves would quietly eat a stage every single time.
    comboSetFrozen(true);
    wave.betweenTimer -= delta;
    if(wave.betweenTimer<=0){ wave.number++; wave.betweenTimer=WAVE_GAP; startWave(); }
    return;
  }
  if(wave.spawned<wave.toSpawn){
    // Released as soon as the first enemy is actually out there to be killed.
    comboSetFrozen(wave.spawned === 0);
    wave.spawnTimer -= delta;
    if(wave.spawnTimer<=0){ spawnZombie(); wave.spawnTimer=wave.spawnInterval; }
  } else if(zombies.length===0){
    const bonus = 100+wave.number*25;
    addMoney(bonus);
    showWaveBanner(t('bn.clear',{n:wave.number}), t('bn.clearSub',{b:bonus}));
    soundWaveClear();
    guitarristaOnWaveClear();
    wave.betweenWaves=true; wave.betweenTimer=WAVE_GAP;
  } else {
    comboSetFrozen(false);
  }
}

// =================================================================
// HUD
// =================================================================
function updateStatPanel(){
  // The panel was removed from the HUD; bail before building markup nothing will read. The
  // function stays so the pause-menu version can reuse it when that lands.
  if(!statRowsEl) return;
  let html='';
  STATS.forEach(s=>{
    const icon = s.icon ? '<img class="statIcon" src="'+STATS_DIR+encodeURIComponent(s.icon)+'.png" alt="">' : '';
    html += '<div class="row"><span>'+icon+s.name+'</span><span class="lvl">'+formatStatValue(s)+'</span></div>';
  });
  if(statRowsEl) statRowsEl.innerHTML = html;
}
function updateHUD(){
  // Guarded throughout: a HUD element going missing (a partially-deployed index.html, say)
  // should degrade to a blank readout, not throw every frame and take the whole game down
  // with it — this runs inside init() and from the render loop.
  if(lowHealthPulseEl) lowHealthPulseEl.style.opacity = player.health<player.maxHealth*0.3 ? 0.7:0;

  // The stone status bar (ammo, arsenal, health, stamina, tally, now-playing) is owned by
  // js/hud.js; everything below is the overlay furniture that sits outside the bar.
  if(typeof updateStoneHUD === 'function') updateStoneHUD();

  if(waveNumEl) waveNumEl.textContent = t('hud.wave',{n:wave.number});
  if(moneyNumEl) moneyNumEl.textContent = t('hud.money',{n:player.money});
  if(levelNumEl) levelNumEl.textContent = t('hud.level',{n:player.level});
  if(xpBarInnerEl) xpBarInnerEl.style.width = Math.min(100,(player.xp/player.xpToNext)*100)+'%';

  const remaining = player.doubleUntil - gameTime;
  if(doubleBadgeEl){
    const kill = (player.instakillUntil||0) - gameTime;
    const parts = [];
    if(remaining>0) parts.push(t('hud.double',{s:Math.ceil(remaining)}));
    if(kill>0) parts.push(t('hud.vermut',{m:VERMUT_DAMAGE_MULT, s:Math.ceil(kill)}));
    if(parts.length){ doubleBadgeEl.textContent = parts.join('   |   '); doubleBadgeEl.classList.remove('hidden'); }
    else doubleBadgeEl.classList.add('hidden');
  }

  updateStatPanel();
}
function triggerGameOver(){
  gameState='gameover';
  document.exitPointerLock();
  el('gameOverStats').textContent = t('go.stats',{w:wave.number, l:player.level, k:player.kills, p:(player.points||0).toLocaleString()});
  gameOverOverlay.classList.remove('hidden');
}

// =================================================================

// Takes a drafted weapon into the first free slot. Permanent for the run: there's no swap
// path, which is the whole point — a weapon you invest in can never be traded away for a
// fresh Lv1 one.
function draftWeapon(wIdx){
  if(ownsWeapon(wIdx)) return;
  const slot = findEmptySlot();
  if(slot === -1) return;
  player.slots[slot] = wIdx;
  initWeaponAcquired(wIdx);
  switchWeapon(wIdx);
  showWaveBanner(weaponName(wIdx), t('bn.drafted'));
  soundPurchase();
  updateHUD();
}

// Test helper: applies a pick without touching the level-up screen.
function chooseLevelUpCardSim(item){
  if(item.ctype==='stat') applyStatLevel(item.stat.key);
  else if(item.ctype==='weapon') applyWeaponLevel(item.weaponIdx);
  else if(item.ctype==='newWeapon') draftWeapon(item.weaponIdx);
  else applyEvolution(item.weaponIdx);
}

// Test helper: draft without banners or audio.
function draftWeaponQuiet(wIdx){
  if(ownsWeapon(wIdx)) return;
  const slot = findEmptySlot(); if(slot===-1) return;
  player.slots[slot]=wIdx; initWeaponAcquired(wIdx);
}

// =================================================================
// RESTART
// Puts the run back to its opening state without touching the page. Reloading meant fetching
// the environment again — well over a hundred megabytes — and sitting through the title
// sequence, for something the game already has everything it needs to do in place.
// =================================================================
// Frees the GPU resources an object owns. Geometry is deliberately left alone: enemies and
// pickups share one billboard geometry, and disposing it would break everything spawned
// afterwards. Materials and their textures ARE per-instance — every enemy clones its sheet,
// and three.js uploads each clone separately — so those are the ones worth releasing.
// A page reload used to do this for free; an in-place restart has to do it itself.
function releaseObject(obj){
  if(!obj) return;
  obj.traverse(n=>{
    if(!n.material) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    mats.forEach(m=>{
      if(m.map && m.map.dispose && !isSharedTexture(m.map)) m.map.dispose();
      if(m.dispose) m.dispose();
    });
  });
}
// The source sheets are shared by every instance and must survive a restart.
function isSharedTexture(tex){
  if(typeof enemyTextures !== 'undefined'){
    for(const id in enemyTextures){ if(enemyTextures[id] === tex) return true; }
  }
  if(typeof zombieSpriteTexture !== 'undefined' && tex === zombieSpriteTexture) return true;
  if(typeof guitarristaSpriteTexture !== 'undefined' && tex === guitarristaSpriteTexture) return true;
  if(typeof dropTexture !== 'undefined' && tex === dropTexture) return true;
  return false;
}

function restartRun(){
  // --- everything the player accumulated ---
  Object.keys(player).forEach(k=>{ delete player[k]; });
  Object.assign(player, JSON.parse(JSON.stringify(INITIAL_PLAYER)));
  player.xpToNext = xpForLevel(player.level);

  // --- wave progress ---
  Object.assign(wave, JSON.parse(JSON.stringify(INITIAL_WAVE)));

  // --- anything spawned into the scene ---
  zombies.forEach(z=>{ scene.remove(z.group); releaseObject(z.group); });   zombies.length = 0;
  drops.forEach(d=>{ scene.remove(d.mesh); releaseObject(d.mesh); });       drops.length = 0;
  projectiles.forEach(p2=>scene.remove(p2.mesh));      projectiles.length = 0;
  puddles.forEach(pd=>scene.remove(pd.mesh));          puddles.length = 0;
  vortexFields.forEach(v=>scene.remove(v.mesh));       vortexFields.length = 0;
  blackHoles.forEach(h=>scene.remove(h.mesh));         blackHoles.length = 0;
  damageNumbers.forEach(d=>scene.remove(d.sprite||d.mesh)); damageNumbers.length = 0;
  if(typeof bubbles !== 'undefined'){ bubbles.forEach(b=>scene.remove(b.mesh)); bubbles.length = 0; }
  if(typeof baits !== 'undefined'){ baits.forEach(b=>{ scene.remove(b.plate); scene.remove(b.ring); }); baits.length = 0; }
  if(typeof streamParticles !== 'undefined'){ streamParticles.forEach(s=>scene.remove(s.mesh)); streamParticles.length = 0; }
  if(typeof windSlashes !== 'undefined'){ windSlashes.forEach(s=>scene.remove(s.mesh)); windSlashes.length = 0; }
  if(typeof particlePool !== 'undefined'){ particlePool.forEach(p2=>{ p2.active = false; p2.mesh.visible = false; }); }

  // --- timers and meters that live outside the player object ---
  gameTime = 0;
  playerStamina = PLAYER_STAMINA_MAX;
  playerExhausted = false;
  playerVelY = 0;
  playerAirborne = 0;
  if(typeof comboReset === 'function') comboReset();
  if(typeof weaponCancelReload === 'function') weaponCancelReload();
  boxState = 'idle';

  // --- the guitarist goes back to his corner and starts over ---
  if(typeof guitarrista !== 'undefined' && guitarrista){
    guitarrista.state = 'home_playing';
    guitarrista.group.position.set(guitarrista.home.x, guitarrista.feetY, guitarrista.home.z);
    guitarrista.hitTimes = [];
    guitarrista.resumeAt = -999;
    if(typeof stopMusic === 'function') stopMusic();
  }

  // --- put the player back at the start and clear the screen furniture ---
  placePlayerAtStart();
  gameOverOverlay.classList.add('hidden');
  levelUpEl.classList.add('hidden');
  el('swapMenu').classList.add('hidden');
  if(damageFlashEl) damageFlashEl.style.opacity = 0;
  if(lowHealthPulseEl) lowHealthPulseEl.style.opacity = 0;
  if(waveBannerEl) waveBannerEl.style.opacity = 0;

  updateHUD();
  gameState = 'menu';   // the pointer-lock handler starts the first wave, as it does at launch
  requestLock();
}
