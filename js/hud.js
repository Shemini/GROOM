"use strict";
// =================================================================
// STONE HUD
// Drives the bottom status bar from game state. It owns no gameplay state of its own — every
// value here is read from `player`, `wave` and friends.
//
// Two things worth knowing:
//  - The bar is authored at a fixed 2100px width and scaled to the viewport, so proportions and
//    the masonry pattern stay exactly as designed at any resolution rather than reflowing.
//  - Text nodes are only written when their value actually changes. Writing every field every
//    frame is what makes DOM HUDs expensive, and most of these change rarely.
// =================================================================

const HUD_DESIGN_WIDTH = 2100;

// Weapon icons, keyed by index in ALL_WEAPONS. They live alongside the first-person art in
// Weapons/ and are referenced by URL — the browser decodes the PNG alpha for us, so no
// rasterising or palette work is needed here any more.
const HUD_ICON_FILES = {
  0:'PuñosIcon', 1:'PistolaIcon', 2:'RifleIcon', 3:'MetralletaIcon',
  4:'BurbujaIcon', 5:'JamonIcon', 6:'PetardoIcon', 7:'TequifresaIcon',
  8:'ConfettiIcon', 9:'MegatronIcon', 10:'LaserIcon', 11:'EspadaIcon',
};
// ñ and accents have to be percent-encoded or the request 404s on a strict server.
function hudIconFor(wIdx){
  const file = HUD_ICON_FILES[wIdx];
  return file ? (WEAPON_DIR + encodeURIComponent(file) + '.png') : '';
}

let hudRefs = null;
const hudLast = {};   // last written value per field, so we only touch the DOM on change

function hudSet(key, el, value){
  if(!el || hudLast[key] === value) return;
  hudLast[key] = value;
  el.textContent = value;
}

function initHUD(){
  try {
  hudRefs = {
    bar: el('hudBar'),
    ammoWeaponName: el('ammoWeaponName'), ammoMag: el('ammoMag'),
    ammoReserve: el('ammoReserve'), ammoReloading: el('ammoReloading'),
    arsenalGrid: el('arsenalGrid'),
    healthValue: el('healthValue'), healthMax: el('healthMax'), healthPips: el('healthPips'),
    stamTrack: el('stamTrack'),
    tallyKills: el('tallyKills'), tallyScore: el('tallyScore'),
    nowPlaying: el('nowPlaying'), trackTitle: el('trackTitle'),
    minimapViewport: el('minimapViewport'),
  };

  // Pips are static elements whose colour changes; building them once avoids rebuilding
  // DOM every frame.
  if(hudRefs.healthPips){
    hudRefs.healthPips.innerHTML = '';
    for(let i=0;i<10;i++){ const d=document.createElement('div'); d.className='pip'; hudRefs.healthPips.appendChild(d); }
  }
  if(hudRefs.stamTrack){
    hudRefs.stamTrack.innerHTML = '';
    for(let i=0;i<8;i++){ const d=document.createElement('div'); d.className='pip'; hudRefs.stamTrack.appendChild(d); }
  }

  buildArsenalSlots();
  hudResize();
  window.addEventListener('resize', hudResize);
  // Web fonts and the canvas both settle after first paint, so re-measure once things have.
  window.addEventListener('load', hudResize);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(hudResize).catch(()=>{});
  setTimeout(hudResize, 0);
  if(window.ResizeObserver){
    // The game canvas can resize without a window resize event firing, so observe directly.
    try { new ResizeObserver(hudResize).observe(document.documentElement); } catch(e){}
  }
  } catch(e){
    console.error('initHUD failed — the status bar will be blank but the game will still run.', e);
  }
}

// Uniform scale from the 2100px design width. Rounded to 3 decimals: sub-pixel scale values
// make the repeating masonry gradients shimmer as they resample.
function hudResize(){
  if(!hudRefs || !hudRefs.bar) return;
  const w = document.documentElement.clientWidth || window.innerWidth;
  // Round UP so the scaled bar can never fall short of the viewport and leave a sliver of
  // empty space on the right; overshooting by a fraction of a pixel is invisible, a gap isn't.
  const scale = Math.ceil((w/HUD_DESIGN_WIDTH)*1000)/1000;
  hudRefs.bar.style.transform = 'scale('+scale+')';
}

// One cell per inventory slot. The game carries four, so the grid follows player.slots rather
// than the design's fixed three.
function buildArsenalSlots(){
  if(!hudRefs.arsenalGrid) return;
  hudRefs.arsenalGrid.style.gridTemplateColumns = 'repeat('+player.slots.length+',1fr)';
  hudRefs.arsenalGrid.innerHTML = '';
  for(let i=0;i<player.slots.length;i++){
    const slot = document.createElement('div');
    slot.className = 'slot empty';
    // The icon is the backdrop; the key, ammo and name are overlaid on it.
    slot.innerHTML =
      '<img class="icon" alt="">' +
      '<span class="key"></span>' +
      '<span class="ammo"></span>' +
      '<div class="name"></div>' +
      '<div class="emptyTxt">EMPTY</div>';
    hudRefs.arsenalGrid.appendChild(slot);
  }
}

function updateArsenal(){
  if(!hudRefs.arsenalGrid) return;
  const cells = hudRefs.arsenalGrid.children;
  let carried = 0;
  for(let i=0;i<player.slots.length && i<cells.length;i++){
    const wIdx = player.slots[i];
    const cell = cells[i];
    const key = cell.querySelector('.key'), ammoEl = cell.querySelector('.ammo');
    const icon = cell.querySelector('.icon'), nameEl = cell.querySelector('.name');
    const emptyTxt = cell.querySelector('.emptyTxt');

    if(wIdx === null || wIdx === undefined){
      cell.className = 'slot empty';
      key.style.display = ammoEl.style.display = icon.style.display = nameEl.style.display = 'none';
      emptyTxt.style.display = '';
      continue;
    }

    carried++;
    const isActive = (wIdx === player.currentWeapon);
    cell.className = 'slot ' + (isActive ? 'active' : 'filled');
    key.style.display = ammoEl.style.display = icon.style.display = nameEl.style.display = '';
    emptyTxt.style.display = 'none';

    const weapon = ALL_WEAPONS[wIdx];
    const mods = player.weaponMods[wIdx];
    const ammo = player.ammoByWeapon[wIdx];
    const label = player.weaponEvolved[wIdx] ? EVOLUTIONS[wIdx].name : weapon.name;

    hudSet('slotKey'+i, key, String(i+1));
    hudSet('slotAmmo'+i, ammoEl, weapon.noAmmo ? '—' : (ammo ? (mods.noReload ? String(ammo.mag) : ammo.mag+'/'+ammo.reserve) : ''));
    hudSet('slotName'+i, nameEl, label);
    const src = hudIconFor(wIdx);
    if(icon.getAttribute('src') !== src) icon.src = src;
  }
}

function updateStoneHUD(){
  if(!hudRefs) return;

  // --- ammo ---
  const wIdx = player.currentWeapon;
  const weapon = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx], ammo = player.ammoByWeapon[wIdx];
  const label = player.weaponEvolved[wIdx] ? EVOLUTIONS[wIdx].name
              : (weapon.noLevel ? weapon.name : weapon.name+' LV'+(player.weaponLevel[wIdx]||1));
  hudSet('wname', hudRefs.ammoWeaponName, label);
  // Melee carries no ammo, so show a dash instead of a count — and never assume the record
  // exists, since a weapon without one used to throw here every frame and stall the loop.
  if(weapon.noAmmo || !ammo){
    hudSet('mag', hudRefs.ammoMag, '—');
    hudSet('reserve', hudRefs.ammoReserve, '');
    if(hudRefs.ammoMag) hudRefs.ammoMag.classList.remove('low');
  } else {
    hudSet('mag', hudRefs.ammoMag, String(ammo.mag));
    hudSet('reserve', hudRefs.ammoReserve, mods.noReload ? '/ —' : '/ '+ammo.reserve);
    const magSize = effectiveMag(wIdx);
    if(hudRefs.ammoMag) hudRefs.ammoMag.classList.toggle('low', ammo.mag <= Math.ceil(magSize*0.25));
  }
  if(hudRefs.ammoReloading) hudRefs.ammoReloading.style.visibility = player.reloading ? 'visible' : 'hidden';

  updateArsenal();

  // --- health ---
  const hp = Math.max(0, Math.ceil(player.health));
  hudSet('hp', hudRefs.healthValue, String(hp));
  hudSet('hpmax', hudRefs.healthMax, '/ '+Math.round(player.maxHealth));
  const frac = player.maxHealth>0 ? player.health/player.maxHealth : 0;
  const hpColor = frac>0.6 ? '#e5c68b' : (frac>0.3 ? '#e8a33d' : '#c8402c');
  if(hudRefs.healthValue && hudLast.hpColor !== hpColor){
    hudLast.hpColor = hpColor;
    hudRefs.healthValue.style.color = hpColor;
  }
  if(hudRefs.healthPips){
    const lit = Math.ceil(frac*10);
    const pips = hudRefs.healthPips.children;
    for(let i=0;i<pips.length;i++){
      const on = i < lit;
      const want = on ? hpColor : '#161007';
      if(pips[i].style.background !== want) pips[i].style.background = want;
    }
  }

  // --- stamina ---
  if(hudRefs.stamTrack){
    const sFrac = playerStamina/PLAYER_STAMINA_MAX;
    const lit = Math.ceil(sFrac*8);
    const col = (playerExhausted || playerStamina < 2.5) ? '#c8621e' : '#6fc7ef';
    const pips = hudRefs.stamTrack.children;
    for(let i=0;i<pips.length;i++){
      const want = (i < lit) ? col : '#161007';
      if(pips[i].style.background !== want) pips[i].style.background = want;
    }
  }

  // --- tally ---
  hudSet('kills', hudRefs.tallyKills, String(player.kills));
  hudSet('score', hudRefs.tallyScore, player.money.toLocaleString());

  // --- now playing ---
  const title = (typeof musicCurrentTitle === 'string') ? musicCurrentTitle : '';
  if(hudLast.track !== title){
    hudLast.track = title;
    if(hudRefs.trackTitle) hudRefs.trackTitle.textContent = title;
    if(hudRefs.nowPlaying) hudRefs.nowPlaying.classList.toggle('hidden', !title);
  }
}

// The minimap draws its own art on its canvas now (see js/minimap.js), so the HUD no longer
// needs to push a CSS background into the cell.

// The HUD deliberately does NOT follow the colour-depth setting: the banner reads better at
// full depth, and an SVG filter over it forces an extra compositing layer for no real gain.
// The world's depth is handled entirely in the grading shader (see syncColorDepthUniform).
