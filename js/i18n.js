"use strict";
// =================================================================
// LOCALISATION — Spanish and English.
//
// Game data (ALL_WEAPONS, STATS, ...) keeps its original `name` fields untouched: some logic
// still compares against them, so changing the data would quietly break behaviour. Display
// code asks the helpers below for the localised string instead, and falls back to the data
// value when a key is missing — so an untranslated string shows something rather than nothing.
//
// Strings take {placeholders}, filled by t(key, {name:value}).
// =================================================================

const I18N = {
  es: {
    // --- title screen ---
    'ui.play':'JUGAR', 'ui.settings':'AJUSTES', 'ui.language':'IDIOMA: ESPAÑOL',
    'ui.pressEnter':'PULSA ENTER', 'ui.ready':'LISTO', 'ui.loading':'CARGANDO',
    'ui.soundOn':'♪ SÍ', 'ui.soundOff':'♪ NO',
    'ui.pixelOn':'PÍXEL SÍ', 'ui.pixelOff':'PÍXEL NO',
    'ui.depthOn':'8-BIT SÍ', 'ui.depthOff':'8-BIT NO',

    // --- HUD ---
    'hud.ammo':'MUNICIÓN', 'hud.health':'SALUD', 'hud.stam':'VIGOR',
    'hud.down':'CAÍDOS', 'hud.pts':'PTS', 'hud.reloading':'RECARGANDO…',
    'hud.nowPlaying':'SONANDO', 'hud.empty':'VACÍO',
    'hud.level':'NV {n}', 'hud.wave':'OLEADA {n}', 'hud.money':'$ {n}',
    'hud.paused':'EN PAUSA', 'hud.lvSuffix':' NV{n}',
    'hud.double':'2x $/XP — {s}s', 'hud.vermut':'VERMUT x{m} — {s}s',

    // --- level up ---
    'lvl.title':'NUEVO NIVEL', 'lvl.funds':'FONDOS ${n}',
    'lvl.instruction':'ELIGE UNA MEJORA', 'lvl.keys':'1 · 2 · 3   R CAMBIAR',
    'lvl.reroll':'CAMBIAR (${n})', 'lvl.rerollNote':'EL PRECIO SUBE $50 CADA VEZ',
    'lvl.broke':'FONDOS INSUFICIENTES',
    'lvl.kindStat':'ATRIBUTO', 'lvl.kindWeapon':'ARMA', 'lvl.kindEvolve':'EVOLUCIÓN',
    'lvl.kindNew':'ARMA NUEVA', 'lvl.newWeaponDesc':'Se queda contigo toda la partida',
    'lvl.evolveTo':'EVOLUCIÓN: {w}', 'lvl.next':'Siguiente: {s}', 'lvl.step':'Nv{n}: {s}',

    // --- pause ---
    'pause.title':'PAUSA', 'pause.resume':'CONTINUAR', 'pause.settings':'AJUSTES',
    'pause.controls':'CONTROLES', 'pause.statsBtn':'ATRIBUTOS',
    'pause.stats':'ATRIBUTOS', 'pause.weapons':'ARMAS', 'pause.noWeapons':'SIN ARMAS',
    'pause.base':'BASE', 'pause.evolved':'EVOLUCIONADA +{n}', 'pause.level':'NV {n}/5',
    'pause.summary':'NV {lv} · OLEADA {w} · {p} PTS',

    // --- controls ---
    'ctl.move':'Moverse', 'ctl.sprint':'Esprintar (gasta vigor)', 'ctl.look':'Mirar',
    'ctl.fire':'Disparar / golpear', 'ctl.reload':'Recargar', 'ctl.interact':'Comprar / usar / contratar',
    'ctl.slots':'Elegir ranura de arma', 'ctl.wheel':'Cambiar de arma', 'ctl.mute':'Silenciar',
    'ctl.cursor':'Liberar cursor y panel de ajustes', 'ctl.pause':'Pausa',
    'key.mouse':'RATÓN', 'key.click':'CLIC', 'key.wheel':'RUEDA', 'key.shift':'MAYÚS', 'key.esc':'ESC',

    // --- weapon stat labels (pause) ---
    'ws.DAMAGE':'DAÑO', 'ws.DPS':'DPS', 'ws.RATE':'CADENCIA', 'ws.MAGAZINE':'CARGADOR', 'ws.AMMO':'MUNICIÓN',
    'ws.RICOCHETS':'REBOTES', 'ws.BLAST':'EXPLOSIÓN', 'ws.PUDDLE':'CHARCO', 'ws.RANGE':'ALCANCE',
    'ws.BUBBLE':'BURBUJA', 'ws.LURE':'CEBO', 'ws.WIDTH':'ANCHO', 'ws.REACH':'ALCANCE',
    'ws.LASTS':'DURA', 'ws.FEAST':'FESTÍN', 'ws.SHOVE':'EMPUJE', 'ws.PIERCES':'PERFORA',
    'ws.INFECT':'CONTAGIO', 'ws.COUGH':'TOS', 'ws.SPREAD':'PROPAGA', 'ws.BURN':'QUEMA',
    'ws.BURNS':'ARDE', 'ws.SLASH':'TAJO', 'ws.SLASH RNG':'ALC. TAJO', 'ws.BLASTS':'ESTALLIDOS',
    'ws.BOOM':'DAÑO EXPL.', 'ws.BOOM RNG':'RADIO EXPL.',

    // --- banners ---
    'bn.wave':'OLEADA {n}', 'bn.waveSub':'Llegan los invitados',
    'bn.clear':'OLEADA {n} SUPERADA', 'bn.clearSub':'+${b} — se acerca otra oleada',
    'bn.box':'CAJA DE FIESTA', 'bn.boxAll':'¡Ya las tienes todas!',
    'bn.boxGot':'¡{w}!', 'bn.boxSwap':'{w} — elige cuál reemplazar',
    'bn.evolved':'ARMA EVOLUCIONADA', 'bn.evolvedSub':'{a} → {b}',
    'bn.combo':'+{n}% daño y botín',
    'bn.guitar':'GUITARRISTA', 'bn.guitarLeaves':'Se marcha ofendido',
    'bn.drafted':'Arma conseguida — para toda la partida',
    'bn.ammo':'PLATO FUERTE', 'bn.ammoSub':'Munición recargada',
    'bn.health':'ENSALADA', 'bn.healthSub':'Salud restaurada',
    'bn.double':'POSTRE', 'bn.doubleSub':'2x dinero y XP — 20s',
    'bn.vermut':'VERMUT', 'bn.vermutSub':'x{m} daño — {s}s',

    // --- prompts ---
    'pr.buy':'[E] COMPRAR {w} — ${c}', 'pr.equip':'[E] EQUIPAR {w}',
    'pr.ammoFull':'{w} — MUNICIÓN LLENA', 'pr.buyAmmo':'[E] COMPRAR MUNICIÓN — ${c}',
    'pr.boxOpening':'ABRIENDO...', 'pr.boxOpen':'[E] ABRIR CAJA DE FIESTA — ${c}',
    'pr.boxPrice':'CAJA DE FIESTA — ${c}',
    'pr.guitarWith':'GUITARRISTA — ya te acompaña', 'pr.guitarHire':'[E] CONTRATAR GUITARRISTA — ${c}',
    'pr.guitarFree':'[E] CONTRATAR GUITARRISTA — GRATIS', 'pr.notCarried':'{w} — no la llevas',

    // --- swap / game over ---
    'sw.title':'INVENTARIO LLENO', 'sw.sub':'Elige un arma para cambiarla por {w}',
    'go.title':'HAS MUERTO', 'go.restart':'REINTENTAR',
    'go.stats':'Oleada {w} · Nivel {l} · {k} caídos · {p} puntos',

    // --- combo stages ---
    'combo.0':'SERIO', 'combo.1':'CONTENTO', 'combo.2':'EUFÓRICO', 'combo.3':'LOCO',

    // --- weapons (by index) ---
    'w.0':'PUÑOS', 'w.1':'PISTOLA DE PLOMOS', 'w.2':'ESCOPETILLA DE PLOMOS',
    'w.3':'METRALLETA DE BALINES', 'w.4':'VARITA DE BURBUJAS', 'w.5':'JAMÓN IBÉRICO',
    'w.6':'PETARDOS', 'w.7':'TEQUIFRESA', 'w.8':'CAÑÓN DE CONFETTI',
    'w.9':'CAÑÓN DE CO2', 'w.10':'PUNTERO LÁSER', 'w.11':'ESPADA DE TARTA',
    'e.0':'ESPADA DE TARTA', 'e.1':'PISTOLAS GEMELAS', 'e.2':'RIFLE PERFORANTE', 'e.3':'METRALLETA AUTOMÁTICA',
    'e.4':'PACIENTE CERO', 'e.5':'JAMÓN EXPLOSIVO', 'e.6':'TRACA', 'e.7':'GARRAFÓN',
    'e.8':'FIESTA TOTAL', 'e.9':'LANZALLAMAS', 'e.10':'LÁSER QUIRÚRGICO', 'e.11':'ESPADA DEL BANQUETE',

    // --- stats ---
    's.damage':'DAÑO', 's.fireRate':'CADENCIA', 's.moveSpeed':'VELOCIDAD', 's.maxHealth':'VITALIDAD',
    's.reloadSpeed':'RECARGA', 's.ammoCapacity':'MUNICIÓN', 's.moneyMult':'CODICIA',
    's.xpMult':'INTELIGENCIA', 's.critChance':'PRECISIÓN', 's.enemyIntensity':'SED DE SANGRE',
    'sd.damage':'Daño de las armas', 'sd.fireRate':'Velocidad de disparo',
    'sd.moveSpeed':'Velocidad de movimiento', 'sd.maxHealth':'Salud máxima (cura al elegirla)',
    'sd.reloadSpeed':'Tiempo de recarga', 'sd.ammoCapacity':'Cargador y reserva (solo el tope)',
    'sd.moneyMult':'Dinero por muerte', 'sd.xpMult':'XP por muerte',
    'sd.critChance':'Probabilidad de crítico', 'sd.enemyIntensity':'Más y más duros — mayor recompensa',

    // --- level-up step labels, built from the stat and amount ---
    'lv.damage':'+{n}% daño', 'lv.fireRate':'+{n}% cadencia', 'lv.ammo':'+{n}% munición',
    'lv.bounce':'+{n} rebote', 'lv.dot':'+{n}% daño continuo', 'lv.knockback':'+{n}% empuje',
    'lv.radius':'+{n}% radio', 'lv.duration':'+{n}% duración',
    'lv.radius.grenade':'+{n}% radio de explosión', 'lv.radius.puddle':'+{n}% radio del charco',
    'lv.radius.cone':'+{n}% alcance del cono', 'lv.radius.bubble':'+{n}% tamaño de burbuja',
    'lv.radius.bait':'+{n}% radio del cebo', 'lv.radius.stream':'+{n}% anchura del chorro',
    'lv.radius.melee':'+{n}% alcance',
    'lv.duration.puddle':'+{n}% duración del charco', 'lv.duration.bubble':'+{n}% vida de burbuja',
    'lv.duration.bait':'+{n}% jamón (más segundos)', 'lv.duration.stream':'+{n}% alcance del chorro',

    // --- evolution steps ---
    'ev.pierceCount':'+1 enemigo perforado', 'ev.bounce':'+1 rebote', 'ev.knockback':'+empuje',
    'ev.infectChance':'+probabilidad de contagio', 'ev.coughDamage':'+daño de la tos',
    'ev.coughSpread':'+probabilidad de propagación', 'ev.burnDamage':'+daño por quemadura',
    'ev.burnDuration':'+duración de quemadura', 'ev.windDamage':'+daño del tajo',
    'ev.windRange':'+alcance del tajo', 'ev.damage':'+daño', 'ev.ammo':'+munición',
    'ev.spread':'+dispersión', 'ev.fireRate':'+cadencia', 'ev.explosionDamage':'+daño de explosión',
    'ev.explosionRadius':'+radio de explosión', 'ev.radius':'+radio', 'ev.subCount':'+1 petardo',
    'ev.dot':'+daño continuo', 'ev.duration':'+duración',
  },

  en: {
    'ui.play':'PLAY', 'ui.settings':'SETTINGS', 'ui.language':'LANGUAGE: ENGLISH',
    'ui.pressEnter':'PRESS ENTER', 'ui.ready':'READY', 'ui.loading':'LOADING',
    'ui.soundOn':'♪ ON', 'ui.soundOff':'♪ OFF',
    'ui.pixelOn':'PIXEL ON', 'ui.pixelOff':'PIXEL OFF',
    'ui.depthOn':'8-BIT ON', 'ui.depthOff':'8-BIT OFF',

    'hud.ammo':'AMMO', 'hud.health':'HEALTH', 'hud.stam':'STAM',
    'hud.down':'DOWN', 'hud.pts':'PTS', 'hud.reloading':'RELOADING…',
    'hud.nowPlaying':'NOW PLAYING', 'hud.empty':'EMPTY',
    'hud.level':'LV {n}', 'hud.wave':'WAVE {n}', 'hud.money':'$ {n}',
    'hud.paused':'PAUSED', 'hud.lvSuffix':' LV{n}',
    'hud.double':'2x $/XP — {s}s', 'hud.vermut':'VERMOUTH x{m} — {s}s',

    'lvl.title':'LEVEL UP', 'lvl.funds':'FUNDS ${n}',
    'lvl.instruction':'CHOOSE ONE UPGRADE', 'lvl.keys':'1 · 2 · 3   R REROLL',
    'lvl.reroll':'REROLL (${n})', 'lvl.rerollNote':'COST RISES $50 EACH TIME',
    'lvl.broke':'NOT ENOUGH FUNDS',
    'lvl.kindStat':'STAT', 'lvl.kindWeapon':'WEAPON', 'lvl.kindEvolve':'EVOLVE',
    'lvl.kindNew':'NEW WEAPON', 'lvl.newWeaponDesc':'Yours for the rest of the run',
    'lvl.evolveTo':'EVOLVE: {w}', 'lvl.next':'Next: {s}', 'lvl.step':'Lv{n}: {s}',

    'pause.title':'PAUSED', 'pause.resume':'RESUME', 'pause.settings':'SETTINGS',
    'pause.controls':'CONTROLS', 'pause.statsBtn':'STATS',
    'pause.stats':'STATS', 'pause.weapons':'WEAPONS', 'pause.noWeapons':'NO WEAPONS',
    'pause.base':'BASE', 'pause.evolved':'EVOLVED +{n}', 'pause.level':'LV {n}/5',
    'pause.summary':'LV {lv} · WAVE {w} · {p} PTS',

    'ctl.move':'Move', 'ctl.sprint':'Sprint (uses stamina)', 'ctl.look':'Look',
    'ctl.fire':'Fire / swing', 'ctl.reload':'Reload', 'ctl.interact':'Buy / interact / hire',
    'ctl.slots':'Select weapon slot', 'ctl.wheel':'Cycle weapons', 'ctl.mute':'Mute',
    'ctl.cursor':'Release cursor & tuning panel', 'ctl.pause':'Pause',
    'key.mouse':'MOUSE', 'key.click':'CLICK', 'key.wheel':'WHEEL', 'key.shift':'SHIFT', 'key.esc':'ESC',

    'ws.DAMAGE':'DAMAGE', 'ws.DPS':'DPS', 'ws.RATE':'RATE', 'ws.MAGAZINE':'MAGAZINE', 'ws.AMMO':'AMMO',
    'ws.RICOCHETS':'RICOCHETS', 'ws.BLAST':'BLAST', 'ws.PUDDLE':'PUDDLE', 'ws.RANGE':'RANGE',
    'ws.BUBBLE':'BUBBLE', 'ws.LURE':'LURE', 'ws.WIDTH':'WIDTH', 'ws.REACH':'REACH',
    'ws.LASTS':'LASTS', 'ws.FEAST':'FEAST', 'ws.SHOVE':'SHOVE', 'ws.PIERCES':'PIERCES',
    'ws.INFECT':'INFECT', 'ws.COUGH':'COUGH', 'ws.SPREAD':'SPREAD', 'ws.BURN':'BURN',
    'ws.BURNS':'BURNS', 'ws.SLASH':'SLASH', 'ws.SLASH RNG':'SLASH RNG', 'ws.BLASTS':'BLASTS',
    'ws.BOOM':'BOOM', 'ws.BOOM RNG':'BOOM RNG',

    'bn.wave':'WAVE {n}', 'bn.waveSub':'The guests are coming',
    'bn.clear':'WAVE {n} CLEAR', 'bn.clearSub':'+${b} — next wave incoming',
    'bn.box':'PARTY BOX', 'bn.boxAll':'You already own them all!',
    'bn.boxGot':'{w}!', 'bn.boxSwap':'{w} — choose one to replace',
    'bn.evolved':'WEAPON EVOLVED', 'bn.evolvedSub':'{a} → {b}',
    'bn.combo':'+{n}% damage & loot',
    'bn.guitar':'GUITARIST', 'bn.guitarLeaves':'Storms off, offended',
    'bn.drafted':'Weapon acquired — yours for the run',
    'bn.ammo':'MAIN COURSE', 'bn.ammoSub':'Ammo refilled',
    'bn.health':'SALAD', 'bn.healthSub':'Health restored',
    'bn.double':'DESSERT', 'bn.doubleSub':'2x money & XP — 20s',
    'bn.vermut':'VERMOUTH', 'bn.vermutSub':'x{m} damage — {s}s',

    'pr.buy':'[E] BUY {w} — ${c}', 'pr.equip':'[E] EQUIP {w}',
    'pr.ammoFull':'{w} — AMMO FULL', 'pr.buyAmmo':'[E] BUY AMMO — ${c}',
    'pr.boxOpening':'OPENING...', 'pr.boxOpen':'[E] OPEN PARTY BOX — ${c}',
    'pr.boxPrice':'PARTY BOX — ${c}',
    'pr.guitarWith':'GUITARIST — already with you', 'pr.guitarHire':'[E] HIRE GUITARIST — ${c}',
    'pr.guitarFree':'[E] HIRE GUITARIST — FREE', 'pr.notCarried':'{w} — not carried',

    'sw.title':'INVENTORY FULL', 'sw.sub':'Choose a weapon to replace with {w}',
    'go.title':'YOU DIED', 'go.restart':'RESTART',
    'go.stats':'Wave {w} · Level {l} · {k} down · {p} points',

    'combo.0':'SERIOUS', 'combo.1':'HAPPY', 'combo.2':'ECSTATIC', 'combo.3':'CRAZY',

    'w.0':'FISTS', 'w.1':'PELLET PISTOL', 'w.2':'PELLET RIFLE',
    'w.3':'BB SUBMACHINE GUN', 'w.4':'BUBBLE WAND', 'w.5':'IBÉRICO HAM',
    'w.6':'FIRECRACKERS', 'w.7':'TEQUIFRESA', 'w.8':'CONFETTI CANNON',
    'w.9':'CO2 CANNON', 'w.10':'LASER POINTER', 'w.11':'CAKE SWORD',
    'e.0':'CAKE SWORD', 'e.1':'TWIN PISTOLS', 'e.2':'PIERCING RIFLE', 'e.3':'AUTOMATIC BB GUN',
    'e.4':'PATIENT ZERO', 'e.5':'EXPLOSIVE HAM', 'e.6':'FIRECRACKER CHAIN', 'e.7':'BOOTLEG BOOZE',
    'e.8':'TOTAL FIESTA', 'e.9':'FLAMETHROWER', 'e.10':'SURGICAL LASER', 'e.11':'BANQUET BLADE',

    's.damage':'DAMAGE', 's.fireRate':'FIRE RATE', 's.moveSpeed':'SPEED', 's.maxHealth':'VITALITY',
    's.reloadSpeed':'RELOAD', 's.ammoCapacity':'AMMO', 's.moneyMult':'GREED',
    's.xpMult':'INTELLECT', 's.critChance':'PRECISION', 's.enemyIntensity':'BLOODLUST',
    'sd.damage':'Weapon damage', 'sd.fireRate':'Firing speed',
    'sd.moveSpeed':'Movement speed', 'sd.maxHealth':'Max health (heals when taken)',
    'sd.reloadSpeed':'Reload time', 'sd.ammoCapacity':'Magazine and reserve (cap only)',
    'sd.moneyMult':'Money per kill', 'sd.xpMult':'XP per kill',
    'sd.critChance':'Critical hit chance', 'sd.enemyIntensity':'More and tougher — bigger rewards',

    'lv.damage':'+{n}% damage', 'lv.fireRate':'+{n}% fire rate', 'lv.ammo':'+{n}% ammo',
    'lv.bounce':'+{n} ricochet', 'lv.dot':'+{n}% damage over time', 'lv.knockback':'+{n}% knockback',
    'lv.radius':'+{n}% radius', 'lv.duration':'+{n}% duration',
    'lv.radius.grenade':'+{n}% blast radius', 'lv.radius.puddle':'+{n}% puddle radius',
    'lv.radius.cone':'+{n}% cone range', 'lv.radius.bubble':'+{n}% bubble size',
    'lv.radius.bait':'+{n}% lure radius', 'lv.radius.stream':'+{n}% stream width',
    'lv.radius.melee':'+{n}% reach',
    'lv.duration.puddle':'+{n}% puddle duration', 'lv.duration.bubble':'+{n}% bubble life',
    'lv.duration.bait':'+{n}% ham (more seconds)', 'lv.duration.stream':'+{n}% stream reach',

    'ev.pierceCount':'+1 enemy pierced', 'ev.bounce':'+1 ricochet', 'ev.knockback':'+knockback',
    'ev.infectChance':'+infection chance', 'ev.coughDamage':'+cough damage',
    'ev.coughSpread':'+spread chance', 'ev.burnDamage':'+burn damage',
    'ev.burnDuration':'+burn duration', 'ev.windDamage':'+slash damage',
    'ev.windRange':'+slash range', 'ev.damage':'+damage', 'ev.ammo':'+ammo capacity',
    'ev.spread':'+spread', 'ev.fireRate':'+fire rate', 'ev.explosionDamage':'+explosion damage',
    'ev.explosionRadius':'+explosion radius', 'ev.radius':'+radius', 'ev.subCount':'+1 firecracker',
    'ev.dot':'+damage over time', 'ev.duration':'+duration',
  },
};

const LANGUAGES = ['es','en'];
const LANG_STORAGE_KEY = 'groom.lang';

// Remembered between visits; otherwise taken from the browser, defaulting to Spanish.
function detectLanguage(){
  try{
    const saved = window.localStorage && localStorage.getItem(LANG_STORAGE_KEY);
    if(saved && I18N[saved]) return saved;
  }catch(e){}
  const nav = (navigator.language || navigator.userLanguage || 'es').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'es';
}

let currentLang = detectLanguage();

// Missing in the current language -> try the other one -> fall back to the key itself, so a
// gap is visible during testing rather than rendering as a blank.
function t(key, params){
  let s = (I18N[currentLang] && I18N[currentLang][key]);
  if(s === undefined){
    for(const l of LANGUAGES){ if(I18N[l][key] !== undefined){ s = I18N[l][key]; break; } }
  }
  if(s === undefined) return key;
  if(params) s = s.replace(/\{(\w+)\}/g, (m, k)=> (params[k] !== undefined ? params[k] : m));
  return s;
}

// --- display helpers: localised name, falling back to the data value ---
function weaponName(wIdx){
  const k = 'w.'+wIdx;
  const v = t(k);
  return v === k ? ((ALL_WEAPONS[wIdx] && ALL_WEAPONS[wIdx].name) || '') : v;
}
function evolutionName(wIdx){
  const k = 'e.'+wIdx;
  const v = t(k);
  return v === k ? ((EVOLUTIONS[wIdx] && EVOLUTIONS[wIdx].name) || '') : v;
}
function statName(stat){ const k='s.'+stat.key, v=t(k); return v===k ? stat.name : v; }
function statDesc(stat){ const k='sd.'+stat.key, v=t(k); return v===k ? stat.desc : v; }
function comboLabel(stage){ return t('combo.'+stage); }

// Level-up step labels are built from the step itself (stat + amount) rather than stored as
// finished sentences, so they translate without a copy per weapon. Radius and duration pick a
// weapon-specific wording where one exists — "blast radius" rather than a bare "radius".
function levelStepLabel(wIdx, step){
  if(!step) return '';
  const w = ALL_WEAPONS[wIdx] || {};
  const n = (step.stat === 'bounce') ? step.amount : Math.round(step.amount*100);
  if(step.stat === 'radius' || step.stat === 'duration'){
    const specific = 'lv.'+step.stat+'.'+w.type;
    const v = t(specific, {n});
    if(v !== specific) return v;
  }
  const generic = 'lv.'+step.stat;
  const g = t(generic, {n});
  return g === generic ? (step.label || '') : g;
}
function evolutionStepLabel(key){
  const k = 'ev.'+key, v = t(k);
  return v === k ? ((EVO_KEY_LABELS && EVO_KEY_LABELS[key]) || key) : v;
}

// --- static markup ---
// Anything tagged data-i18n="key" in the HTML gets its text replaced on a language change.
function applyStaticTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(node=>{
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  document.documentElement.lang = currentLang;
}

function setLanguage(lang){
  if(!I18N[lang]) return;
  currentLang = lang;
  try{ localStorage.setItem(LANG_STORAGE_KEY, lang); }catch(e){}
  applyStaticTranslations();
  // Dynamic pieces redraw themselves next frame; a few need an explicit nudge.
  if(typeof hudLast !== 'undefined'){ for(const k in hudLast) delete hudLast[k]; }
  if(typeof buildArsenalSlots === 'function' && typeof hudRefs !== 'undefined' && hudRefs) buildArsenalSlots();
  if(typeof refreshLandingText === 'function') refreshLandingText();
  if(typeof updateHUD === 'function') { try{ updateHUD(); }catch(e){} }
}

function cycleLanguage(){
  const i = LANGUAGES.indexOf(currentLang);
  setLanguage(LANGUAGES[(i+1) % LANGUAGES.length]);
}
