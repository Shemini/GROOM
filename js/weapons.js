"use strict";
// STAT / WEAPON HELPERS
// =================================================================
function statLevel(key){ return player.stats[key] || 0; }
function statValue(key){
  const def = STATS.find(s=>s.key===key);
  if(!def) return 0;
  return Math.min(statLevel(key), def.maxLevel) * def.perLevel;
}
function formatStatValue(stat){
  const total = statValue(stat.key);
  if(stat.key==='maxHealth') return '+' + Math.round(total);
  if(stat.key==='critChance') return Math.round(total*100) + '%';
  if(stat.key==='reloadSpeed') return '-' + Math.round(total*100) + '%';
  return '+' + Math.round(total*100) + '%';
}
function xpForLevel(level){ return Math.round(70 + level*35 + level*level*2); }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

function ownsWeapon(idx){ return player.slots.includes(idx); }
// Slot 0 is the melee slot and is never empty, so only the three carry slots can be filled.
function findEmptySlot(){
  for(let i=1;i<player.slots.length;i++) if(player.slots[i]===null) return i;
  return -1;
}
function isMeleeWeapon(idx){ return MELEE_INDICES.indexOf(idx) !== -1; }
function effectiveDamage(wIdx){ return ALL_WEAPONS[wIdx].dmg * player.weaponMods[wIdx].dmgMult; }
function effectiveMag(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return Math.round(w.mag*m.ammoMult*(1+statValue('ammoCapacity'))); }
function effectiveReserve(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return Math.round(w.reserveMax*m.ammoMult*(1+statValue('ammoCapacity'))); }
function effectiveFireRate(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.fireRate/m.fireRateMult; }
function effectiveSpread(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.spread*m.spreadMult; }
function effectivePellets(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.pellets+m.pelletBonus; }
function effectiveBlastRadius(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.blastRadius*m.radiusMult; }
function effectivePuddleRadius(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.puddleRadius*m.radiusMult; }
function effectivePuddleDuration(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.puddleDuration*m.durationMult; }
function effectivePuddleDps(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.dps*m.dpsMult; }
function effectiveVortexRadius(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.vortexRadius*m.radiusMult; }
function effectiveVortexDuration(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.vortexDuration*m.durationMult; }
function effectiveChainCount(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.chainCount+m.bounceBonus; }
function effectivePierceFalloff(wIdx){ const w=ALL_WEAPONS[wIdx], m=player.weaponMods[wIdx]; return w.pierceFalloff+m.pierceFalloffAdd; }

function initWeaponAcquired(idx){
  player.weaponLevel[idx] = 1;
  player.weaponEvolved[idx] = false;
  player.weaponMods[idx] = createDefaultMods();
  player.ammoByWeapon[idx] = { mag: effectiveMag(idx), reserve: effectiveReserve(idx) };
}

function applyWeaponStatStep(wIdx, step){
  const mods = player.weaponMods[wIdx];
  switch(step.stat){
    case 'damage': mods.dmgMult *= (1+step.amount); break;
    case 'ammo': mods.ammoMult *= (1+step.amount); break;
    case 'fireRate': mods.fireRateMult *= (1+step.amount); break;
    case 'spread': mods.spreadMult *= (1+step.amount); break;
    case 'bounce': mods.bounceBonus += step.amount; break;
    case 'radius': mods.radiusMult *= (1+step.amount); break;
    case 'duration': mods.durationMult *= (1+step.amount); break;
    case 'dot': mods.dpsMult *= (1+step.amount); break;
  }
}
function applyWeaponLevel(wIdx){
  if(player.weaponEvolved[wIdx]){
    const evoLevel = (player.weaponEvoLevel[wIdx]||0)+1;
    player.weaponEvoLevel[wIdx] = evoLevel;
    applyEvolutionRotationStep(wIdx, evoLevel);
  } else {
    const lvl = player.weaponLevel[wIdx]||1;
    if(lvl>=5) return;
    applyWeaponStatStep(wIdx, BASE_LEVEL_TABLES[wIdx][lvl-1]);
    player.weaponLevel[wIdx] = lvl+1;
  }
  updateHUD();
}
function applyEvolutionRotationStep(wIdx, evoLevel){
  const rotation = EVOLUTIONS[wIdx].rotation;
  const key = rotation[(evoLevel-1)%rotation.length];
  const mods = player.weaponMods[wIdx];
  switch(key){
    case 'damage':          mods.dmgMult *= 1.15; break;
    case 'fireRate':        mods.fireRateMult *= 1.12; break;
    case 'ammo':            mods.ammoMult *= 1.20; break;
    case 'radius':          mods.radiusMult *= 1.15; break;
    case 'duration':        mods.durationMult *= 1.18; break;
    case 'dot':             mods.dpsMult *= 1.18; break;
    case 'bounce':          mods.bounceBonus += 1; break;
    case 'pierceCount':     mods.pierceCount += 1; break;
    case 'knockback':       mods.knockbackMult *= 1.25; break;
    case 'infectChance':    mods.infectChance += 0.12; break;
    case 'coughDamage':     mods.coughDamage += 7; break;
    case 'coughSpread':     mods.coughSpread += 0.08; break;
    case 'burnDamage':      mods.burnDamage += 6; break;
    case 'burnDuration':    mods.burnDuration += 0.8; break;
    case 'windDamage':      mods.windDamage += 0.12; break;
    case 'windRange':       mods.windRange += 3; break;
    case 'subCount':        mods.subCount += 1; break;
    case 'explosionDamage': mods.explosionDamage += 12; break;
    case 'explosionRadius': mods.explosionRadius += 0.4; break;
    case 'spread':          mods.spreadMult *= 1.12; break;
  }
  updateHUD();
}
function applyEvolution(wIdx){
  player.weaponEvolved[wIdx] = true;
  player.weaponEvoLevel[wIdx] = 0;
  const mods = player.weaponMods[wIdx];
  const w = ALL_WEAPONS[wIdx];
  switch(wIdx){
    case 1:  mods.fireRateMult*=1.25; mods.dmgMult*=1.15; break;                 // pistola de feria
    case 2:  mods.pierceCount=0; break;                                          // rifle perforante: 1 pierce, +1/level
    case 3:  mods.bounceBonus+=2; mods.fireRateMult*=1.15; break;                // metralleta de balines
    case 4:  mods.infectChance=0; mods.coughDamage=0; mods.coughSpread=0; break; // paciente cero
    case 5:  mods.explosionDamage=0; break;                                      // jamón explosivo
    case 6:  mods.subCount=4; break;                                             // traca
    case 7:  break;                                                              // garrafón
    case 8:  mods.novaRadius=9; mods.knockbackMult*=1.4; break;                  // fiesta total
    case 9:  mods.burnDamage=14; mods.burnDuration=2.5; break;                   // lanzallamas
    case 10: mods.explosionDamage=55; mods.explosionRadius=2.4; break;           // láser quirúrgico
    case 11: mods.windDamage=0.45; mods.windRange=0; break;                      // espada del banquete
  }
  if(mods.noReload) player.ammoByWeapon[wIdx] = { mag: effectiveMag(wIdx), reserve: 0 };
  else player.ammoByWeapon[wIdx] = { mag: effectiveMag(wIdx), reserve: effectiveReserve(wIdx) };
  showWaveBanner('WEAPON EVOLVED', w.name + ' -> ' + EVOLUTIONS[wIdx].name);
  soundLevelUp();
  updateHUD();
}
function describeWeaponCard(wIdx){
  const w = ALL_WEAPONS[wIdx];
  if(player.weaponEvolved[wIdx]){
    const evoLevel = (player.weaponEvoLevel[wIdx]||0)+1;
    const rotation = EVOLUTIONS[wIdx].rotation;
    const key = rotation[(evoLevel-1)%rotation.length];
    return { name: EVOLUTIONS[wIdx].name, desc: 'Next: ' + (EVO_KEY_LABELS[key]||key), maxDots:0, curDots:0 };
  }
  const lvl = player.weaponLevel[wIdx]||1;
  const step = BASE_LEVEL_TABLES[wIdx][lvl-1];
  return { name: w.name, desc: 'Lv'+(lvl+1)+': '+step.label, maxDots:5, curDots:lvl };
}

// =================================================================
// SHOOTING
// =================================================================
function getShotCooldown(wIdx){
  const base = effectiveFireRate(wIdx)/(1+statValue('fireRate'));
  if(wIdx===1 && player.weaponEvolved[1]){
    const st = player.burstState[1] || (player.burstState[1]={phase:0});
    return st.phase===0 ? 0.18 : Math.max(0.4, base*2);
  }
  return base;
}
// Called every frame from the main loop so the soap film recovers while the trigger is up.
function updateSoap(delta, elapsed){
  if(!mouseDown && player.soapStrain > 0){
    const w = ALL_WEAPONS[player.currentWeapon];
    player.soapStrain = Math.max(0, player.soapStrain - (w.soapRecover||1.2)*delta);
  }
}

function tryShoot(elapsed){
  const wIdx = player.currentWeapon, weapon = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx], ammo = player.ammoByWeapon[wIdx];
  if(player.reloading) return;
  if(elapsed-player.lastShotTime < getShotCooldown(wIdx)) return;
  if(!ammo && !weapon.noAmmo) return;   // defensive: a weapon with no ammo record can't fire
  if(weapon.noAmmo){
    // Melee never runs dry, so skip the magazine bookkeeping entirely.
    player.lastShotTime = elapsed;
    const dm = 1+statValue('damage'), crit = Math.random()<statValue('critChance'), cm = CRIT_MULTIPLIER;
    fpvOnFire(wIdx, ()=>fireMelee(wIdx, dm, crit, cm));
    return;
  }
  if(ammo.mag<=0){
    // Dry click before the automatic reload kicks in.
    if(!player.dryFired){ player.dryFired = true; weaponDryFireSound(); }
    if(!mods.noReload && ammo.reserve>0) startReload();
    return;
  }
  player.dryFired = false;
  // Bubble wand: holding the trigger is "blowing". Sustained pressure tears the film and
  // forces a quick re-dip; feathering the trigger lets the soap recover, so a controlled
  // rhythm gets far more out of one charge than holding it down.
  if(weapon.type === 'bubble'){
    player.soapStrain = (player.soapStrain||0) + (elapsed - (player.lastBubbleTime||0) < 0.25
      ? (elapsed - (player.lastBubbleTime||elapsed)) + 0.1 : 0);
    player.lastBubbleTime = elapsed;
    if(player.soapStrain > (weapon.soapLimit||1.6)){
      player.soapStrain = 0;
      player.soapBroke = true;
      startReload();
      return;
    }
  }

  player.lastShotTime = elapsed; ammo.mag--;
  guitarristaHitThisShot = false; // one Guitarrista hit per trigger pull, not per pellet
  if(wIdx===1 && player.weaponEvolved[1]){ const st=player.burstState[1]; st.phase = st.phase===0?1:0; }

  const dmgMult = 1+statValue('damage');
  const isCrit = Math.random()<statValue('critChance');
  const critMultVal = CRIT_MULTIPLIER;

  // Handed to the first-person view rather than called directly: thrown weapons hold the
  // projectile back until the sprite reaches the top of its arc, so the shot leaves the hand
  // at the moment the animation shows it leaving.
  const launch = ()=>{
    switch(weapon.type){
      case 'melee':   fireMelee(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'grenade': fireGrenade(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'puddle':  firePuddleVial(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'chain':   fireChain(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'bubble':  fireBubble(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'bait':    fireBait(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'stream':  fireStream(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'beam':    fireBeam(wIdx,dmgMult,isCrit,critMultVal); break;
      case 'cone':
        // Evolving swaps the forward cone for a full-circle shove.
        if(player.weaponEvolved[wIdx]) fireNova(wIdx,dmgMult,isCrit,critMultVal);
        else fireCone(wIdx,dmgMult,isCrit,critMultVal);
        break;
      default:        fireHitscan(wIdx,dmgMult,isCrit,critMultVal); break;
    }
  };
  fpvOnFire(wIdx, launch);
  weaponFireSound(wIdx); flashMuzzle(); updateHUD();
}

function fireHitscan(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  const pellets=effectivePellets(wIdx), spread=effectiveSpread(wIdx);
  const stagger = weapon.name==='SHOTGUN';
  let anyHit=false, anyHeadshot=false;
  for(let p=0;p<pellets;p++){
    const dir = forward.clone();
    dir.x+=(Math.random()-0.5)*spread; dir.y+=(Math.random()-0.5)*spread; dir.z+=(Math.random()-0.5)*spread;
    dir.normalize();
    raycaster.set(camera.position, dir); raycaster.far=60;
    const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
    let tracerEnd = camera.position.clone().addScaledVector(dir,40);
    if(hits.length>0){
      const hit=hits[0]; tracerEnd=hit.point;
      const ref = hit.object.userData.zombieRef;
      if(ref){
        const headshot = isHeadshotHit(hit);
        const dmg = effectiveDamage(wIdx)*dmgMult*(headshot?2:1)*(isCrit?critMultVal:1);
        damageZombie(ref, dmg, {headshot, crit:isCrit, stagger, knockFrom:camera.position});
        anyHit=true; if(headshot) anyHeadshot=true;
      }
    }
    spawnTracer(camera.position, tracerEnd, 0xfff2b0);
  }
  if(anyHit) soundHit(anyHeadshot, isCrit);
}

function fireChain(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=60;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  if(hits.length===0){ spawnBolt(camera.position, camera.position.clone().addScaledVector(forward,40), 0x8fe8ff); return; }
  const first = hits[0];
  spawnBolt(camera.position, first.point, 0x8fe8ff);
  const ref = first.object.userData.zombieRef;
  if(!ref) return;
  const headshot = isHeadshotHit(first);
  const dmg = effectiveDamage(wIdx)*dmgMult*(headshot?2:1)*(isCrit?critMultVal:1);
  const hitSet = new Set([ref]);
  damageZombie(ref, dmg, {headshot, crit:isCrit});
  // One impact per body struck, staggered a few milliseconds apart so a long ricochet chain
  // reads as a burst rather than a single stacked click.
  let impactIndex = 0;
  weaponBulletImpactSound(ref.group.position);
  let currentPos = ref.group.position.clone();
  let currentHeight = ref.height||AVG_ZOMBIE_HEIGHT;
  const chainCount = effectiveChainCount(wIdx), chainRadius = weapon.chainRadius;
  for(let jump=1; jump<chainCount; jump++){
    let nearest=null, nearestDist=chainRadius;
    for(const z of zombies){ if(hitSet.has(z)) continue; const d=currentPos.distanceTo(z.group.position); if(d<nearestDist){nearestDist=d;nearest=z;} }
    if(!nearest) break;
    const targetPos = nearest.group.position.clone().add(new THREE.Vector3(0,(nearest.height||AVG_ZOMBIE_HEIGHT)*0.55,0));
    spawnBolt(currentPos.clone().add(new THREE.Vector3(0,currentHeight*0.55,0)), targetPos, 0x8fe8ff);
    const dmg2 = effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1);
    damageZombie(nearest, dmg2, {crit:isCrit});
    impactIndex++;
    wsndPlayAt(SOUND_BULLET_IMPACT, nearest.group.position, 0.45, { delay: impactIndex*0.035 });
    currentPos = nearest.group.position.clone(); currentHeight = nearest.height||AVG_ZOMBIE_HEIGHT; hitSet.add(nearest);
  }
}

function fireBranchingChain(wIdx, dmgMult, isCrit, critMultVal){
  const mods = player.weaponMods[wIdx], weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=60;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  if(hits.length===0){ spawnBolt(camera.position, camera.position.clone().addScaledVector(forward,40), 0xd9a3ff); return; }
  const first = hits[0];
  spawnBolt(camera.position, first.point, 0xd9a3ff);
  const ref = first.object.userData.zombieRef;
  if(!ref) return;
  const headshot = isHeadshotHit(first);
  const dmg = mods.evoDamage*dmgMult*(headshot?2:1)*(isCrit?critMultVal:1);
  const hitSet = new Set([ref]); const chainOrder=[ref];
  damageZombie(ref, dmg, {headshot, crit:isCrit});
  weaponBulletImpactSound(ref.group.position);

  function findNearestUnhit(anchor){
    let nearest=null, nearestDist=weapon.chainRadius;
    for(const z of zombies){ if(hitSet.has(z)) continue; const d=anchor.group.position.distanceTo(z.group.position); if(d<nearestDist){nearestDist=d;nearest=z;} }
    return nearest;
  }
  function strike(anchor, target){
    const targetPos = target.group.position.clone().add(new THREE.Vector3(0,(target.height||AVG_ZOMBIE_HEIGHT)*0.55,0));
    spawnBolt(anchor.group.position.clone().add(new THREE.Vector3(0,(anchor.height||AVG_ZOMBIE_HEIGHT)*0.55,0)), targetPos, 0xd9a3ff);
    const dmg2 = mods.evoDamage*dmgMult*(isCrit?critMultVal:1);
    damageZombie(target, dmg2, {crit:isCrit});
    hitSet.add(target); chainOrder.push(target);
  }

  let remaining = effectiveChainCount(wIdx)-1;
  const gen1Targets=[]; let branchesNeeded=mods.initialSpread; let anchorPointer=0;
  while(branchesNeeded>0 && remaining>0 && anchorPointer<chainOrder.length){
    const anchor = chainOrder[anchorPointer];
    const nearest = findNearestUnhit(anchor);
    remaining--;
    if(nearest){ strike(anchor,nearest); gen1Targets.push(nearest); branchesNeeded--; }
    else anchorPointer++;
  }
  let frontier = gen1Targets;
  while(remaining>0 && frontier.length>0){
    const nextFrontier=[];
    for(const source of frontier){
      if(remaining<=0) break;
      const nearest = findNearestUnhit(source);
      remaining--;
      if(!nearest) continue;
      strike(source,nearest); nextFrontier.push(nearest);
    }
    frontier = nextFrontier;
  }
}

function firePierce(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=80;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  let dmg = effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1);
  const falloff = effectivePierceFalloff(wIdx);
  let pierces=0, anyHit=false, anyHeadshot=false;
  let tracerEnd = camera.position.clone().addScaledVector(forward,80);
  for(const hit of hits){
    const ref = hit.object.userData.zombieRef;
    if(!ref){ tracerEnd=hit.point; break; }
    const headshot = isHeadshotHit(hit);
    const hitDmg = dmg*(headshot?2:1);
    damageZombie(ref, hitDmg, {headshot, crit:isCrit, stagger:true, knockFrom:camera.position});
    anyHit=true; if(headshot) anyHeadshot=true;
    tracerEnd=hit.point; dmg*=falloff; pierces++;
    if(pierces>=weapon.maxPierces || dmg<2) break;
  }
  spawnTracer(camera.position, tracerEnd, 0xffe27a);
  if(anyHit) soundHit(anyHeadshot, isCrit);
}

function firePierceLiar(wIdx, dmgMult, isCrit, critMultVal){
  const mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=100;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  const baseDmg = mods.evolvedBaseDamage*dmgMult*(isCrit?critMultVal:1);
  let hitIndex=0, anyHit=false, anyHeadshot=false;
  let tracerEnd = camera.position.clone().addScaledVector(forward,100);
  for(const hit of hits){
    const ref = hit.object.userData.zombieRef;
    if(!ref){ tracerEnd=hit.point; break; }
    const headshot = isHeadshotHit(hit);
    const hitDmg = (baseDmg*(1+hitIndex*mods.incrementPercent))*(headshot?2:1);
    damageZombie(ref, hitDmg, {headshot, crit:isCrit, stagger:true, knockFrom:camera.position});
    anyHit=true; if(headshot) anyHeadshot=true;
    tracerEnd=hit.point; hitIndex++;
  }
  spawnTracer(camera.position, tracerEnd, 0xff66ff);
  if(anyHit) soundHit(anyHeadshot, isCrit);
}

function fireHeadhunter(wIdx, dmgMult, critMultVal){
  const mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=60;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  let tracerEnd = camera.position.clone().addScaledVector(forward,40);
  if(hits.length>0){
    const hit=hits[0]; tracerEnd=hit.point;
    const ref = hit.object.userData.zombieRef;
    if(ref){
      const headshot = isHeadshotHit(hit);
      const effCrit = statValue('critChance')+(headshot?mods.critBonus:0);
      const isCrit = Math.random()<effCrit;
      const dmg = effectiveDamage(wIdx)*dmgMult*(headshot?2:1)*(isCrit?critMultVal:1);
      damageZombie(ref, dmg, {headshot, crit:isCrit});
      soundHit(headshot, isCrit);
      if(headshot && isCrit) explodeAt(hit.point, mods.explosionRadius, mods.explosionDamage*dmgMult, true);
    }
  }
  spawnTracer(camera.position, tracerEnd, 0xfff2b0);
}

function fireHellgun(wIdx, dmgMult, isCrit, critMultVal){
  const mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far=60;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);
  // Primary ray only: shooting the Guitarrista skips his song rather than doing damage,
  // and absorbs the shot. Explosions, chain jumps, pierce follow-throughs and DoT never
  // reach this path, so they can't trigger it.
  if(hits.length>0 && hits[0].object.userData.guitarristaRef){
    spawnTracer(camera.position, hits[0].point, 0xfff2b0);
    guitarristaOnShot();
    return;
  }
  let tracerEnd = camera.position.clone().addScaledVector(forward,40);
  if(hits.length===0){ spawnTracer(camera.position, tracerEnd, 0xff5050); return; }
  const hit=hits[0]; tracerEnd=hit.point;
  spawnTracer(camera.position, tracerEnd, 0xff5050);
  const ref = hit.object.userData.zombieRef;
  if(!ref) return;
  const headshot = isHeadshotHit(hit);
  const dmg = effectiveDamage(wIdx)*dmgMult*(headshot?2:1)*(isCrit?critMultVal:1);
  const primaryKilled = damageZombie(ref, dmg, {headshot, crit:isCrit});
  soundHit(headshot, isCrit);
  if(!primaryKilled) ref.dot = { dps: mods.coneDot*dmgMult, endTime: clock.getElapsedTime()+mods.coneDuration };
  const coneOrigin = hit.point.clone();
  for(const z of zombies){
    if(z===ref) continue;
    const toZ = new THREE.Vector3().subVectors(z.group.position, coneOrigin);
    const dist = toZ.length();
    if(dist>mods.coneRadius || dist<0.01) continue;
    toZ.normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(toZ),-1,1));
    if(angle < THREE.MathUtils.degToRad(55)){
      const killed = damageZombie(z, mods.coneDamage*dmgMult, {});
      if(!killed) z.dot = { dps: mods.coneDot*dmgMult, endTime: clock.getElapsedTime()+mods.coneDuration };
    }
  }
  spawnHellfireCone(coneOrigin, forward, mods.coneRadius);
  soundExplosion(computePan(coneOrigin));
}

function createProjectileMesh(color, size){
  const mat = new THREE.MeshStandardMaterial({ color, emissive:color, emissiveIntensity:0.8 });
  return new THREE.Mesh(new THREE.SphereGeometry(size,8,8), mat);
}

// Some thrown weapons fly as their own HUD icon rather than an abstract blob. The plane is
// turned to face the camera every frame (see updateProjectiles), and `spin` rotates it about
// the view axis so tumbling reads clearly against any background.
const projectileIconCache = {};
function createIconProjectile(iconFile, size){
  let tex = projectileIconCache[iconFile];
  if(!tex){
    tex = new THREE.TextureLoader().load(WEAPON_DIR + encodeURIComponent(iconFile) + '.png');
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    projectileIconCache[iconFile] = tex;
  }
  // Blended rather than alpha-tested: these icons have soft edges, and a hard cutout would
  // leave them visibly jagged in flight. depthWrite off so the clear border doesn't punch
  // a hole through whatever is behind it.
  const mat = new THREE.MeshBasicMaterial({
    map:tex, transparent:true, alphaTest:0.02, depthWrite:false,
    side:THREE.DoubleSide, toneMapped:false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.frustumCulled = false;
  return mesh;
}

function fireGrenade(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const startPos = camera.position.clone().addScaledVector(forward,0.6);
  const vel = forward.clone().multiplyScalar(weapon.launchSpeed);
  const dmg = effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1);
  const radius = effectiveBlastRadius(wIdx);
  const mesh = createIconProjectile('PetardoIcon', 0.55);
  mesh.position.copy(startPos); scene.add(mesh);
  const evolved = player.weaponEvolved[wIdx];
  const fuse = weaponStartFuse(wIdx);
  projectiles.push({
    mesh, spin:9.0, pos:startPos.clone(), vel, gravity:true, radius:0.3, groundOnly:true, fuseDelay:weapon.fuseDelay,
    spawnTime:clock.getElapsedTime(), maxLife:5, landed:false,
    onImpact:(pos)=>{
      weaponStopFuse(fuse);
      weaponExplodeSound(wIdx, pos);
      if(evolved){
        // Sub-blasts land every 140ms, so the sample runs until just past the final one.
        const tail = 0.14*(mods.subCount||0) + 0.35;
        weaponEvolvedExtraSound(wIdx, pos, 0.14, tail);
      }
      explodeAt(pos, radius, dmg, true, true);
      if(evolved){
        // Traca: a running string of blasts that wanders away from the first, rather than a
        // tidy ring of sub-munitions.
        let last = pos.clone();
        for(let i=0;i<mods.subCount;i++){
          const p = last.clone();
          p.x += (Math.random()-0.5)*5.5; p.z += (Math.random()-0.5)*5.5;
          last = p;
          setTimeout(()=>{
            const fy = getFloorY(p.x,p.z,p.y+4);
            explodeAt(new THREE.Vector3(p.x, fy!==null?fy:p.y, p.z), radius*0.7, dmg*0.5, true, true);
          }, 140*(i+1));
        }
      }
      if(false){
        for(let i=0;i<mods.subCount;i++){
          const angle=(i/mods.subCount)*Math.PI*2;
          const subVel = new THREE.Vector3(Math.cos(angle)*6,7,Math.sin(angle)*6);
          const subMesh = createProjectileMesh(0xffb066,0.12);
          subMesh.position.copy(pos); scene.add(subMesh);
          const subDmg = dmg*0.4, subRadius = radius*0.6;
          projectiles.push({
            mesh:subMesh, pos:pos.clone(), vel:subVel, gravity:true, radius:0.25, groundOnly:true, fuseDelay:0.35,
            spawnTime:clock.getElapsedTime(), maxLife:2, landed:false,
            onImpact:(subPos)=>{ explodeAt(subPos, subRadius, subDmg, true); }
          });
        }
      }
    }
  });
}

function firePuddleVial(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const startPos = camera.position.clone().addScaledVector(forward,0.6);
  const vel = forward.clone().multiplyScalar(weapon.launchSpeed);
  const mesh = createIconProjectile('TequifresaIcon', 0.55);
  mesh.position.copy(startPos); scene.add(mesh);
  const radius=effectivePuddleRadius(wIdx), duration=effectivePuddleDuration(wIdx), dps=effectivePuddleDps(wIdx);
  const evolved = player.weaponEvolved[wIdx];
  const stainDps=dps*0.5, stainDuration=duration*0.6;
  projectiles.push({
    mesh, spin:6.5, pos:startPos.clone(), vel, gravity:true, radius:0.3, groundOnly:true,
    spawnTime:clock.getElapsedTime(), maxLife:5, landed:false,
    onImpact:(pos)=>{
      weaponImpactSound(wIdx, pos);
      spawnPuddle(pos, radius, dps, duration, evolved, stainDps, stainDuration, 'booze');
      // Garrafón: rough spirits make guests sick, and what comes back up burns too.
      if(evolved){
        const until = clock.getElapsedTime()+duration*1.4;
        for(const z of zombies){
          const d = Math.hypot(z.group.position.x-pos.x, z.group.position.z-pos.z);
          if(d<=radius){ z.drunkUntil = until; z.drunkPukeDps = dps*0.4; z.pukeTimer = 0.6; }
        }
      }
    }
  });
}

function fireVortex(wIdx, dmgMult, isCrit, critMultVal){
  const weapon = ALL_WEAPONS[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const startPos = camera.position.clone().addScaledVector(forward,0.6);
  const vel = forward.clone().multiplyScalar(weapon.launchSpeed);
  const mesh = createProjectileMesh(0xb266ff,0.2);
  mesh.position.copy(startPos); scene.add(mesh);
  const radius=effectiveVortexRadius(wIdx), duration=effectiveVortexDuration(wIdx);
  const evolved = player.weaponEvolved[wIdx];
  projectiles.push({
    mesh, pos:startPos.clone(), vel, gravity:false, radius:0.3, groundOnly:false,
    spawnTime:clock.getElapsedTime(), maxLife:1.2, landed:false,
    onImpact:(pos)=>{
      if(evolved) spawnBlackHole(pos, radius, duration);
      else spawnVortex(pos, radius, duration, weapon.vortexPull, weapon.vortexDps, weapon.vortexBurst);
    }
  });
}

function updateProjectiles(delta, elapsed){
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    if(p.landed){
      p.fuseTimer -= delta;
      p.mesh.material.emissiveIntensity = 0.8+0.6*Math.sin(elapsed*20);
      if(p.fuseTimer<=0){ scene.remove(p.mesh); projectiles.splice(i,1); p.onImpact(p.pos.clone()); }
      continue;
    }
    if(p.gravity) p.vel.y -= GRAVITY*delta;
    p.pos.addScaledVector(p.vel, delta);
    p.mesh.position.copy(p.pos);
    // Icon projectiles are flat planes, so keep them turned toward the camera and spin them
    // about the view axis; without the billboarding they'd vanish edge-on.
    if(p.spin !== undefined){
      p.mesh.quaternion.copy(camera.quaternion);
      p.spinAngle = (p.spinAngle||0) + p.spin*delta;
      p.mesh.rotateZ(p.spinAngle);
    }

    let hitPos=null, impacted=false;
    const fy = getFloorY(p.pos.x, p.pos.z, p.pos.y+3);
    if(fy!==null && p.pos.y<=fy+0.15){ hitPos=p.pos.clone(); hitPos.y=fy; impacted=true; }
    if(!impacted){
      raycaster.set(p.pos.clone(), p.vel.clone().normalize()); raycaster.far = Math.max(0.15, p.vel.length()*delta+p.radius);
      const hits = raycaster.intersectObjects(environmentMeshes,false);
      if(hits.length>0 && hits[0].distance < p.radius+0.2){ hitPos=hits[0].point.clone(); impacted=true; }
    }
    if(!impacted && !p.groundOnly){
      for(const z of zombies){
        const zc = z.group.position.clone(); zc.y += (z.height||1.7)*0.45;
        if(p.pos.distanceTo(zc) < (z.collisionRadius||ZOMBIE_RADIUS)+p.radius){ hitPos=p.pos.clone(); impacted=true; break; }
      }
    }
    if(!impacted && elapsed-p.spawnTime>p.maxLife){ hitPos=p.pos.clone(); impacted=true; }

    if(impacted){
      if(p.fuseDelay){ p.pos.copy(hitPos); p.mesh.position.copy(hitPos); p.vel.set(0,0,0); p.landed=true; p.fuseTimer=p.fuseDelay; }
      else { scene.remove(p.mesh); projectiles.splice(i,1); p.onImpact(hitPos); }
    }
  }
}

function explodeAt(pos, radius, dmg, stagger, silent){
  // `silent` is used by chained explosions (the traca), which have their own sampled audio —
  // otherwise every link in the chain stacked the old procedural boom on top of it.
  if(!silent) soundExplosion(computePan(pos));
  spawnExplosionVisual(pos, radius);
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    const d = Math.hypot(z.group.position.x-pos.x, z.group.position.z-pos.z);
    if(d<=radius) damageZombie(z, dmg, {stagger:!!stagger, knockFrom:pos});
  }
}
function spawnExplosionVisual(pos, radius){
  const geo = new THREE.SphereGeometry(0.3,10,10);
  const mat = new THREE.MeshBasicMaterial({ color:0xffaa44, transparent:true, opacity:0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos); mesh.position.y += 0.3;
  scene.add(mesh);
  const start = clock.getElapsedTime();
  const anim = ()=>{
    const t = clock.getElapsedTime()-start, k = Math.min(1,t/0.3);
    mesh.scale.setScalar(1+k*radius*2.2); mesh.material.opacity=0.8*(1-k);
    if(k<1) requestAnimationFrame(anim); else { scene.remove(mesh); geo.dispose(); mat.dispose(); }
  };
  anim();
  const light = new THREE.PointLight(0xffaa44,3,radius*3);
  light.position.copy(pos); light.position.y += 0.5;
  scene.add(light);
  setTimeout(()=>scene.remove(light),200);
}
function spawnHellfireCone(origin, dir, radius){
  const halfAngleRad = THREE.MathUtils.degToRad(55);
  const baseRadius = Math.max(0.3, radius*Math.tan(halfAngleRad));
  const geo = new THREE.ConeGeometry(baseRadius, radius, 16, 1, true);
  geo.translate(0,-radius/2,0);
  const mat = new THREE.MeshBasicMaterial({ color:0xff3030, transparent:true, opacity:0.55, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0), dir.clone().normalize());
  scene.add(mesh);
  const start = clock.getElapsedTime();
  const anim = ()=>{
    const t = clock.getElapsedTime()-start, k = Math.min(1,t/0.35);
    mesh.material.opacity = 0.55*(1-k);
    if(k<1) requestAnimationFrame(anim); else { scene.remove(mesh); geo.dispose(); mat.dispose(); }
  };
  anim();
  const light = new THREE.PointLight(0xff3030,2.5,radius*2.5);
  light.position.copy(origin).add(dir.clone().multiplyScalar(radius*0.4));
  scene.add(light);
  setTimeout(()=>scene.remove(light),220);
}
// `kind` tags the puddle so the damage gate can stack different liquids but not two of the
// same: strongest per kind, summed across kinds. Without a tag every pool counted separately.
const PUDDLE_COLORS = { booze:0xff4fa3, puke:0xc8d84a, default:0x7fff6a };
function spawnPuddle(pos, radius, dps, duration, stains, stainDps, stainDuration, kind){
  const k = kind || 'default';
  const geo = new THREE.CircleGeometry(radius,20);
  const color = PUDDLE_COLORS[k] !== undefined ? PUDDLE_COLORS[k] : (stains?0xb8ff5a:0x7fff6a);
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.4, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.position.set(pos.x, pos.y+0.06, pos.z);
  scene.add(mesh);
  soundSplat();
  puddles.push({ mesh, pos:{x:pos.x,z:pos.z}, radius, dps, expiresAt:clock.getElapsedTime()+duration,
    stains:!!stains, stainDps:stainDps||0, stainDuration:stainDuration||1, kind:k });
}
function updatePuddles(delta, elapsed){
  for(let i=puddles.length-1;i>=0;i--){
    const pd = puddles[i];
    if(elapsed>=pd.expiresAt){ scene.remove(pd.mesh); puddles.splice(i,1); continue; }
    pd.mesh.material.opacity = 0.3+0.15*Math.sin(elapsed*4);
  }
}
function spawnVortex(pos, radius, duration, pull, dps, burst){
  const geo = new THREE.TorusGeometry(radius*0.5,0.15,8,24);
  const mat = new THREE.MeshStandardMaterial({ color:0xb266ff, emissive:0xb266ff, emissiveIntensity:1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI/2;
  mesh.position.set(pos.x, pos.y+0.6, pos.z);
  scene.add(mesh);
  soundVortexSpawn(computePan(pos));
  vortexFields.push({ mesh, pos:{x:pos.x,z:pos.z}, radius, pull, dps, burst, tickTimer:0.25, expiresAt:clock.getElapsedTime()+duration });
}
function updateVortexFields(delta, elapsed){
  for(let i=vortexFields.length-1;i>=0;i--){
    const v = vortexFields[i];
    v.mesh.rotation.z += delta*2;
    if(elapsed>=v.expiresAt){
      for(let j=zombies.length-1;j>=0;j--){
        const z = zombies[j];
        const d = Math.hypot(z.group.position.x-v.pos.x, z.group.position.z-v.pos.z);
        if(d<v.radius) damageZombie(z, v.burst, {stagger:true, knockFrom:v.pos});
      }
      scene.remove(v.mesh); vortexFields.splice(i,1); continue;
    }
    v.tickTimer -= delta;
    if(v.tickTimer<=0){
      for(let j=zombies.length-1;j>=0;j--){
        const z = zombies[j];
        const d = Math.hypot(z.group.position.x-v.pos.x, z.group.position.z-v.pos.z);
        if(d<v.radius) damageZombie(z, v.dps, {});
      }
      v.tickTimer=0.25;
    }
  }
}
function spawnBlackHole(pos, radius, duration){
  const geo = new THREE.SphereGeometry(0.6,12,12);
  const mat = new THREE.MeshStandardMaterial({ color:0x0a0014, emissive:0x6a2fbf, emissiveIntensity:1.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, pos.y+1.2, pos.z);
  scene.add(mesh);
  const ringGeo = new THREE.TorusGeometry(radius*0.4,0.1,8,24);
  const ringMat = new THREE.MeshStandardMaterial({ color:0xb266ff, emissive:0xb266ff, emissiveIntensity:1 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI/2;
  ring.position.copy(mesh.position);
  scene.add(ring);
  soundVortexSpawn(computePan(pos));
  blackHoles.push({ mesh, ring, pos:{x:pos.x,z:pos.z}, radius, duration, spawnTime:clock.getElapsedTime(), phase:'active', implodeStart:0 });
}
function updateBlackHoles(delta, elapsed){
  for(let i=blackHoles.length-1;i>=0;i--){
    const b = blackHoles[i];
    b.mesh.rotation.y += delta*2; b.ring.rotation.z += delta*3;
    if(b.phase==='active'){
      if(elapsed-b.spawnTime>=b.duration){
        b.phase='imploding'; b.implodeStart=elapsed;
        for(let j=zombies.length-1;j>=0;j--){
          const z = zombies[j];
          const d = Math.hypot(z.group.position.x-b.pos.x, z.group.position.z-b.pos.z);
          if(d<=b.radius) damageZombie(z, 55, {stagger:true, knockFrom:b.pos});
        }
      }
    } else {
      const t = elapsed-b.implodeStart;
      for(const z of zombies){
        const d = Math.hypot(z.group.position.x-b.pos.x, z.group.position.z-b.pos.z);
        if(d>b.radius*0.3 && d<=b.radius*2){
          const nx=(b.pos.x-z.group.position.x)/d, nz=(b.pos.z-z.group.position.z)/d;
          z.group.position.x += nx*9*delta; z.group.position.z += nz*9*delta;
        }
      }
      for(let a=0;a<zombies.length;a++){
        for(let c=a+1;c<zombies.length;c++){
          const za=zombies[a], zc=zombies[c];
          const dd = Math.hypot(za.group.position.x-zc.group.position.x, za.group.position.z-zc.group.position.z);
          if(dd<0.7){ damageZombie(za,6,{}); damageZombie(zc,6,{}); }
        }
      }
      if(t>0.6){ scene.remove(b.mesh); scene.remove(b.ring); blackHoles.splice(i,1); }
    }
  }
}
function spawnDamageNumber(pos, amount, crit){
  const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=64;
  const ctx = canvas.getContext('2d');
  ctx.font = crit?'bold 40px sans-serif':'bold 30px sans-serif';
  ctx.fillStyle = crit?'#ff5050':'#ffe27a';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(amount), 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(crit?1.1:0.8, crit?0.55:0.4, 1);
  sprite.position.copy(pos); sprite.position.x += (Math.random()-0.5)*0.3;
  scene.add(sprite);
  damageNumbers.push({ sprite, mat, tex, life:0, maxLife:0.7 });
}
function updateDamageNumbers(delta){
  for(let i=damageNumbers.length-1;i>=0;i--){
    const d = damageNumbers[i];
    d.life += delta; d.sprite.position.y += delta*1.1;
    d.mat.opacity = Math.max(0, 1-d.life/d.maxLife);
    if(d.life>=d.maxLife){ scene.remove(d.sprite); d.mat.dispose(); d.tex.dispose(); damageNumbers.splice(i,1); }
  }
}
function spawnTracer(from, to, color){
  const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mat = new THREE.LineBasicMaterial({ color:color||0xfff2b0, transparent:true, opacity:0.85 });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  setTimeout(()=>{ scene.remove(line); geom.dispose(); mat.dispose(); }, 45);
}
function spawnBolt(from, to, color){
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if(len<0.001) return;
  const geo = new THREE.CylinderGeometry(0.03,0.03,len,6);
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  scene.add(mesh);
  const light = new THREE.PointLight(color,1.2,6);
  light.position.copy(mid); scene.add(light);
  setTimeout(()=>{ scene.remove(mesh); geo.dispose(); mat.dispose(); scene.remove(light); }, 100);
}
function predictLandingPoint(launchSpeed){
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  let pos = camera.position.clone().addScaledVector(dir,0.6);
  let vel = dir.clone().multiplyScalar(launchSpeed);
  const dt=0.04;
  for(let i=0;i<150;i++){
    vel.y -= GRAVITY*dt; pos.addScaledVector(vel,dt);
    const fy = getFloorY(pos.x,pos.z,pos.y+3);
    if(fy!==null && pos.y<=fy+0.15){ pos.y=fy; return pos; }
  }
  return pos;
}
function updateTrajectoryMarker(){
  const wIdx = player.currentWeapon, weapon = ALL_WEAPONS[wIdx];
  if(weapon.type==='grenade' || weapon.type==='puddle'){
    const landing = predictLandingPoint(weapon.launchSpeed);
    trajectoryMarker.position.set(landing.x, landing.y+0.06, landing.z);
    trajectoryMarker.material.color.setHex(weapon.type==='grenade'?0xffaa44:0x7fff6a);
    trajectoryMarker.visible = true;
  } else trajectoryMarker.visible = false;
}
function updateSpreadRing(){
  const wIdx = player.currentWeapon, pellets = effectivePellets(wIdx);
  if(pellets>1){
    const spread = effectiveSpread(wIdx);
    const px = Math.min(150, 22+spread*900);
    spreadRingEl.style.width=px+'px'; spreadRingEl.style.height=px+'px'; spreadRingEl.style.visibility='visible';
  } else spreadRingEl.style.visibility='hidden';
}
function flashMuzzle(){ flashLight.intensity=2.4; setTimeout(()=>{ flashLight.intensity=0; },40); }

function startReload(){
  const wIdx = player.currentWeapon, mods = player.weaponMods[wIdx];
  if(mods.noReload || ALL_WEAPONS[wIdx].noAmmo) return;   // nothing to reload on a melee weapon
  const ammo = player.ammoByWeapon[wIdx];
  if(!ammo || player.reloading || ammo.reserve<=0 || ammo.mag>=effectiveMag(wIdx)) return;
  player.reloading = true;
  let baseTime = Math.max(0.5, 1.6*(1-statValue('reloadSpeed')));
  if(player.soapBroke){ baseTime *= 0.45; player.soapBroke = false; }  // a snapped film re-dips quickly
  // The first-person view needs the start time as well as the end, or it can't work out how
  // far through the reload it is — without this the drop animation barely moved, because the
  // progress fraction was measured against the whole session rather than this reload.
  player.lastReloadStart = clock.getElapsedTime();
  player.reloadUntil = player.lastReloadStart+baseTime;
  // Parts are scheduled across baseTime, so they stay in step as reload speed changes.
  weaponReloadSequence(wIdx, baseTime);
}
function finishReloadIfDue(elapsed){
  if(!player.reloading) return;
  if(elapsed>=player.reloadUntil){
    const wIdx = player.currentWeapon, ammo = player.ammoByWeapon[wIdx];
    if(!ammo){ player.reloading=false; return; }
    const capacity = effectiveMag(wIdx);
    const transfer = Math.min(capacity-ammo.mag, ammo.reserve);
    ammo.mag += transfer; ammo.reserve -= transfer;
    player.reloading=false;
    soundReloadDone(); updateHUD();
  }
}

// =================================================================
