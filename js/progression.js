"use strict";
// DAMAGE / HEALTH / XP
// =================================================================
function takeDamage(amount){
  if(gameState!=='playing') return;
  // Higher combo, harder hits: the reward for pushing is paid for with real risk.
  player.health -= amount * comboDamageTakenMult();
  soundHurt();
  faceOnHit();
  damageFlashEl.style.opacity=0.55;
  setTimeout(()=>{ damageFlashEl.style.opacity=0; },150);
  if(player.health<=0){ player.health=0; triggerGameOver(); }
  updateHUD();
}
function addMoney(amount){
  const doubleMult = clock.getElapsedTime()<player.doubleUntil ? 2:1;
  player.money += Math.round(amount*(1+statValue('moneyMult'))*doubleMult);
  updateHUD();
}
function addXP(amount){
  const doubleMult = clock.getElapsedTime()<player.doubleUntil ? 2:1;
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
  return pool;
}
function pickThreeStats(){ const pool=buildUpgradePool(); shuffle(pool); return pool.slice(0,3); }

function renderLevelUpCards(picks){
  levelUpCardsEl.innerHTML='';
  picks.forEach(item=>{
    const card = document.createElement('div');
    card.className='lvlCard';
    if(item.ctype==='stat'){
      const stat=item.stat, lvl=statLevel(stat.key);
      card.dataset.ctype='stat'; card.dataset.key=stat.key;
      let dots=''; for(let i=0;i<stat.maxLevel;i++) dots+='<div class="dot '+(i<lvl?'filled':'')+'"></div>';
      const icon = stat.icon ? '<img class="cardIcon" src="'+STATS_DIR+encodeURIComponent(stat.icon)+'.png" alt="">' : '';
      card.innerHTML=icon+'<div class="name">'+stat.name+'</div><div class="desc">'+stat.desc+'</div><div class="dots">'+dots+'</div>';
    } else if(item.ctype==='weapon'){
      const info = describeWeaponCard(item.weaponIdx);
      card.dataset.ctype='weapon'; card.dataset.widx=item.weaponIdx;
      let dots=''; if(info.maxDots>0){ for(let i=0;i<info.maxDots;i++) dots+='<div class="dot '+(i<info.curDots?'filled':'')+'"></div>'; }
      const src = hudIconFor(item.weaponIdx);
      const icon = src ? '<img class="cardIcon" src="'+src+'" alt="">' : '';
      card.innerHTML=icon+'<div class="name">'+info.name+'</div><div class="desc">'+info.desc+'</div><div class="dots">'+dots+'</div>';
    } else {
      const w = ALL_WEAPONS[item.weaponIdx];
      card.className='lvlCard evolveCard';
      card.dataset.ctype='evolve'; card.dataset.widx=item.weaponIdx;
      const src = hudIconFor(item.weaponIdx);
      const icon = src ? '<img class="cardIcon" src="'+src+'" alt="">' : '';
      card.innerHTML=icon+'<div class="name">EVOLUCIÓN: '+w.name+'</div><div class="desc">-&gt; '+EVOLUTIONS[item.weaponIdx].name+'</div><div class="dots"></div>';
    }
    levelUpCardsEl.appendChild(card);
  });
  updateRerollButton();
}
function updateRerollButton(){
  rerollBtnEl.textContent = 'REROLL ($'+player.rerollCost+')';
  rerollBtnEl.disabled = player.money<player.rerollCost;
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
  showWaveBanner('WAVE '+wave.number, 'Zombies incoming');
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
    showWaveBanner('WAVE '+wave.number+' CLEAR', '+$'+bonus+' — next wave incoming');
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

  if(waveNumEl) waveNumEl.textContent = 'WAVE '+wave.number;
  if(moneyNumEl) moneyNumEl.textContent = '$ '+player.money;
  if(levelNumEl) levelNumEl.textContent = 'LV '+player.level;
  if(xpBarInnerEl) xpBarInnerEl.style.width = Math.min(100,(player.xp/player.xpToNext)*100)+'%';

  const remaining = player.doubleUntil - (clock?clock.getElapsedTime():0);
  if(doubleBadgeEl){
    const now = clock?clock.getElapsedTime():0;
    const kill = (player.instakillUntil||0) - now;
    const parts = [];
    if(remaining>0) parts.push('2x $/XP — '+Math.ceil(remaining)+'s');
    if(kill>0) parts.push('VERMUT x'+VERMUT_DAMAGE_MULT+' — '+Math.ceil(kill)+'s');
    if(parts.length){ doubleBadgeEl.textContent = parts.join('   |   '); doubleBadgeEl.classList.remove('hidden'); }
    else doubleBadgeEl.classList.add('hidden');
  }

  updateStatPanel();
}
function triggerGameOver(){
  gameState='gameover';
  document.exitPointerLock();
  el('gameOverStats').textContent = 'Reached wave '+wave.number+' · level '+player.level+' · '+player.kills+' kills · $'+player.money+' earned';
  gameOverOverlay.classList.remove('hidden');
}

// =================================================================
