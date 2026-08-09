"use strict";
// WALL-BUY STATIONS + MYSTERY BOX
// =================================================================
function updateInteractables(delta, elapsed){
  stationMarkers.forEach(s=>{
    s.core.rotation.y += delta*1.2; s.core.rotation.x += delta*0.6;
    s.core.position.y = 1.3 + Math.sin(elapsed*1.5+s.spinPhase)*0.1;
  });
  if(boxCore){
    boxCore.rotation.y += delta*(boxState==='spinning'?9:1.2);
    boxCore.position.y = 1.3 + Math.sin(elapsed*1.5)*0.08;
  }

  let best=null, bestDist=INTERACT_RADIUS;
  stationMarkers.forEach(s=>{
    const d = Math.hypot(camera.position.x-s.pos.x, camera.position.z-s.pos.z);
    if(d<bestDist){ bestDist=d; best={type:'station', station:s}; }
  });
  if(boxPos){
    const dBox = Math.hypot(camera.position.x-boxPos.x, camera.position.z-boxPos.z);
    if(dBox<bestDist){ bestDist=dBox; best={type:'box'}; }
  }
  if(guitarrista && guitarrista.state!=='returning'){
    const dG = Math.hypot(camera.position.x-guitarrista.group.position.x, camera.position.z-guitarrista.group.position.z);
    if(dG<bestDist){ bestDist=dG; best={type:'guitarrista'}; }
  }
  currentInteractable = best;
  if(!best){ interactPromptEl.style.visibility='hidden'; return; }
  if(best.type==='guitarrista'){
    interactPromptEl.textContent = guitarristaInteractLabel();
    interactPromptEl.style.visibility='visible';
    return;
  }

  if(best.type==='station'){
    const idx = best.station.weaponIndex, w = ALL_WEAPONS[idx], owned = ownsWeapon(idx);
    if(!owned) interactPromptEl.textContent = '[E] BUY '+w.name+' — $'+w.cost;
    else if(idx!==player.currentWeapon) interactPromptEl.textContent = '[E] EQUIP '+w.name;
    else {
      const ammo = player.ammoByWeapon[idx];
      const full = ammo.mag>=effectiveMag(idx) && ammo.reserve>=effectiveReserve(idx);
      interactPromptEl.textContent = full ? w.name+' — AMMO FULL' : '[E] BUY AMMO — $'+w.ammoCost;
    }
  } else {
    if(boxState==='spinning') interactPromptEl.textContent='OPENING...';
    else interactPromptEl.textContent = player.money>=BOX_COST ? '[E] OPEN MYSTERY BOX — $'+BOX_COST : 'MYSTERY BOX — $'+BOX_COST;
  }
  interactPromptEl.style.visibility='visible';
}
function flashDenied(){ interactPromptEl.classList.add('denied'); setTimeout(()=>interactPromptEl.classList.remove('denied'),300); }

function interactStation(station){
  const idx = station.weaponIndex, w = ALL_WEAPONS[idx], owned = ownsWeapon(idx);
  if(!owned){
    if(player.money<w.cost){ soundDenied(); flashDenied(); return; }
    const slot = findEmptySlot();
    if(slot===-1){ openSwapMenu(idx); return; }
    player.money -= w.cost; player.slots[slot]=idx; initWeaponAcquired(idx); switchWeapon(idx);
    soundPurchase(); updateHUD(); return;
  }
  if(idx!==player.currentWeapon){ switchWeapon(idx); return; }
  const ammo = player.ammoByWeapon[idx];
  const full = ammo.mag>=effectiveMag(idx) && ammo.reserve>=effectiveReserve(idx);
  if(full) return;
  if(player.money<w.ammoCost){ soundDenied(); flashDenied(); return; }
  player.money -= w.ammoCost; ammo.mag=effectiveMag(idx); ammo.reserve=effectiveReserve(idx);
  soundReloadDone(); updateHUD();
}
function interactBox(){
  if(boxState!=='idle') return;
  if(player.money<BOX_COST){ soundDenied(); flashDenied(); return; }
  player.money -= BOX_COST; boxState='spinning'; soundBoxSpin(); updateHUD();
  setTimeout(resolveBoxRoll, 1200);
}
function resolveBoxRoll(){
  const available = SPECIAL_INDICES.filter(idx=>!ownsWeapon(idx));
  if(available.length===0){ showWaveBanner('MYSTERY BOX','Already own them all!'); boxState='idle'; updateHUD(); return; }
  const idx = available[Math.floor(Math.random()*available.length)];
  const w = ALL_WEAPONS[idx];
  const slot = findEmptySlot();
  if(slot!==-1){
    player.slots[slot]=idx; initWeaponAcquired(idx); switchWeapon(idx);
    showWaveBanner('MYSTERY BOX', w.name+'!');
  } else {
    showWaveBanner('MYSTERY BOX', w.name+' — choose a weapon to replace');
    openSwapMenu(idx);
  }
  soundBoxWin(); boxState='idle'; updateHUD();
}

// =================================================================
// SWAP MENU
// =================================================================
function openSwapMenu(newIdx){
  pendingSwapTarget=newIdx; gameState='swap'; document.exitPointerLock();
  el('swapSub').textContent = 'Choose a weapon to replace with '+ALL_WEAPONS[newIdx].name;
  renderSwapCards(); swapMenuEl.classList.remove('hidden');
}
function renderSwapCards(){
  swapCardsEl.innerHTML='';
  player.slots.forEach((wIdx,slotIdx)=>{
    if(wIdx===null) return;
    const w = ALL_WEAPONS[wIdx];
    const card = document.createElement('div');
    card.className='lvlCard'; card.dataset.slot=slotIdx;
    card.innerHTML = '<div class="name">'+(player.weaponEvolved[wIdx]?EVOLUTIONS[wIdx].name:w.name)+'</div>'+
      '<div class="desc">DMG '+Math.round(effectiveDamage(wIdx))+' · MAG '+w.mag+'</div>';
    swapCardsEl.appendChild(card);
  });
}
function confirmSwap(slotIdx){
  const newIdx = pendingSwapTarget; if(newIdx===null) return;
  const w = ALL_WEAPONS[newIdx];
  player.money -= (w.cost||0);
  const oldIdx = player.slots[slotIdx];
  delete player.ammoByWeapon[oldIdx]; delete player.weaponLevel[oldIdx]; delete player.weaponEvolved[oldIdx];
  delete player.weaponEvoLevel[oldIdx]; delete player.weaponMods[oldIdx];
  player.slots[slotIdx]=newIdx; initWeaponAcquired(newIdx); switchWeapon(newIdx);
  soundPurchase(); pendingSwapTarget=null; swapMenuEl.classList.add('hidden');
  gameState='playing'; requestLock(); updateHUD();
}

// =================================================================
