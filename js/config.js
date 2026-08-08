"use strict";
// =================================================================
// CONFIG
// =================================================================
const EYE_HEIGHT = 1.68;
const SCALE_CORRECTION = 1; // confirmed correct at 1:1 against the reference box
const PLAYER_RADIUS = 0.35;
const ZOMBIE_RADIUS = 0.4;
const WALK_SPEED = 5.0;
const RUN_SPEED = 10.0;
const ZOMBIE_SPEED_MULT = 2.5;
const GRAVITY = 22;
const FINE_CELL = 2;      // nav grid cell size (meters) used once close to the player
const COARSE_CELL = 3;    // nav grid cell size (meters) used for long-distance routing — was 5, too coarse for doorway-scale passages
const FAR_THRESHOLD = 18; // meters — beyond this, zombies path on the coarse grid
const STEP_SMOOTH_MAX = 1.2; // meters — normal walkable step/slope tolerance
const LEDGE_DROP_MAX = 4.0;  // meters — max one-way drop zombies/paths will take off a ledge
const INTERACT_RADIUS = 2.6;
const STAGGER_DURATION = 0.35;
const KNOCKBACK_DIST = 0.3;
const DROP_LIFETIME = 15;
const DROP_TYPES = ['ammo','health','double','instakill'];
const DROP_COLORS = { ammo:0xe8b24d, health:0x6fef7d, double:0xfff2b0, instakill:0xc81e2c };
const BOX_COST = 1500;

// Sprite-based enemy sizing. Fractions are relative to the 128x256 reference sheet, so they
// carry over unchanged once the real (animated) spritesheet replaces this static test image.
const AVG_ZOMBIE_HEIGHT = EYE_HEIGHT + 0.30; // tested value
const ZOMBIE_HEIGHT_VARIATION = 0.10;        // total spread across the population, as a fraction of the average
const HITBOX_WIDTH_FRACTION = 50/128;        // central width counted as the collidable body
const HEAD_HEIGHT_FRACTION = 40/256;         // top portion counted as the head, for headshots

// "TrajeA" enemy spritesheet: 2048x2048, 8 columns x 4 rows, each cell the same 1:2 aspect
// as the original static reference image. Row order top-to-bottom in the source PNG:
// 0 = walk toward player (looping), 1 = walk away from player (looping),
// 2 = attack/punch (looping, overrides walk while in range), 3 = death (plays once).
const SPRITE_COLS = 8, SPRITE_ROWS = 4;
const ANIM_FRAME_DURATION = 1/8; // 8 frames per second -> a full 8-frame cycle takes 1s
const ANIM_ROW_WALK_TOWARD = 0, ANIM_ROW_WALK_AWAY = 1, ANIM_ROW_ATTACK = 2, ANIM_ROW_DEATH = 3;

// Sun light-travel direction, converted from the 3ds Max (-0.29, 0.222, -0.916) Z-up vector
// to three.js's Y-up convention via the same (x,y,z) -> (x,z,-y) mapping used for the
// FBX/glTF export pipeline elsewhere in this project.
const SUN_DIRECTION = new THREE.Vector3(-0.29, -0.916, -0.222).normalize();

// =================================================================
// NAV NODES — hand-placed waypoint graph for long-distance zombie routing.
// Replace/extend this list with real spots: open the settings panel in-game, walk to each
// corner/intersection/junction (especially anywhere pathfinding struggles, like a corridor
// bend), and use the "COPY POSITION" button to grab exact coordinates. Only x/z matter here.
// Connections between nodes are computed automatically at load time — you don't need to
// specify which nodes link to which, just drop in positions.
// This is used for routing beyond FAR_THRESHOLD; close-range movement still uses the fine
// grid, so this only needs to cover the big, obvious junctions, not every nook.
// =================================================================
const NAV_NODES = [
  { id:'node1', x:-47.65, z:-9.52 },
  { id:'node2', x:-59.4, z:-13.85 },
  { id:'node3', x:-92.57, z:-33.51 },
  { id:'node4', x:-124.56, z:-56.6 },
  { id:'node5', x:-95.94, z:-89.75 },
  { id:'node6', x:-67.17, z:-70.69 },
  { id:'node7', x:-40.85, z:-56.42 },
  { id:'node8', x:-27.44, z:-97.52 },
  { id:'node9', x:-11.12, z:-90.03 },
  { id:'node10', x:-18.78, z:-70.51 },
  { id:'node11', x:-46.6, z:-106.3 },
  { id:'node12', x:-75.44, z:-115.22 },
  { id:'node13', x:-58.96, z:-133.03 },
  { id:'node14', x:-36.39, z:-125.29 },
  { id:'node15', x:-0.38, z:-112.09 },
  { id:'node16', x:12.87, z:-146.75 },
  { id:'node17', x:65.03, z:-132.94 },
  { id:'node18', x:74.21, z:-177.54 },
  { id:'node19', x:-20.48, z:-196.06 },
  { id:'node20', x:-44.85, z:-152.98 },
  { id:'node21', x:101.66, z:-124.21 },
  { id:'node22', x:138.58, z:-112.57 },
  { id:'node23', x:160.07, z:-194.01 },
  { id:'node24', x:127.92, z:-197.67 },
  { id:'node25', x:81.29, z:-196.03 },
  { id:'node26', x:74.87, z:-177.31 },
  { id:'node27', x:-3.97, z:-227.91 },
  { id:'node28', x:127.08, z:-92.95 },
  { id:'node29', x:112.6, z:-55.91 },
  { id:'node30', x:107.2, z:-32.89 },
  { id:'node31', x:128.02, z:-25.23 },
  { id:'node32', x:139.84, z:-39.47 },
  { id:'node33', x:182.17, z:-81.03 },
  { id:'node34', x:205.13, z:-108.69 },
  { id:'node35', x:146.46, z:-11.86 },
  { id:'node36', x:187.95, z:12.54 },
  { id:'node37', x:202.53, z:41.19 },
  { id:'node38', x:200.39, z:79.06 },
  { id:'node39', x:191.41, z:121.78 },
  { id:'node40', x:207.08, z:151.44 },
  { id:'node41', x:194.85, z:179.41 },
  { id:'node42', x:232.32, z:169.87 },
  { id:'node43', x:178.53, z:109.12 },
  { id:'node44', x:164.05, z:95.32 },
  { id:'node45', x:146.88, z:83.98 },
  { id:'node46', x:122.66, z:75.43 },
  { id:'node47', x:107.64, z:71.47 },
  { id:'node48', x:77.81, z:87.76 },
  { id:'node49', x:81.01, z:115.5 },
  { id:'node50', x:64.72, z:147.37 },
  { id:'node51', x:70.23, z:90.83 },
  { id:'node52', x:29.48, z:84.15 },
  { id:'node53', x:16.76, z:100.55 },
  { id:'node54', x:6.47, z:123.22 },
  { id:'node55', x:4.22, z:72.57 },
  { id:'node56', x:-21.61, z:112.98 },
  { id:'node57', x:5.77, z:68.45 },
  { id:'node58', x:-10.8, z:58.69 },
  { id:'node59', x:-47.81, z:26.35 },
  { id:'node60', x:-74.88, z:24.03 },
  { id:'node61', x:-111.55, z:0.84 },
  { id:'node62', x:-152.73, z:-18.9 },
  { id:'node63', x:-163.51, z:8.91 },
  { id:'node64', x:-59, z:13.74 },
  { id:'node65', x:-48.41, z:25.06 },
];

const ALL_WEAPONS = [
  { name:'PISTOL',  type:'hitscan', dmg:26, fireRate:0.35, mag:12, reserveMax:72,  cost:0,    ammoCost:0,   spread:0.010, pellets:1 },
  { name:'SHOTGUN', type:'hitscan', dmg:17, fireRate:0.85, mag:6,  reserveMax:36,  cost:500,  ammoCost:100, spread:0.10,  pellets:6 },
  { name:'SMG',     type:'hitscan', dmg:14, fireRate:0.11, mag:30, reserveMax:150, cost:750,  ammoCost:150, spread:0.035, pellets:1 },
  { name:'RIFLE',   type:'hitscan', dmg:46, fireRate:0.17, mag:20, reserveMax:120, cost:1300, ammoCost:250, spread:0.015, pellets:1 },
  { name:'FRAG LAUNCHER', type:'grenade', dmg:55, fireRate:1.1, mag:2, reserveMax:10, launchSpeed:16, blastRadius:4.5, fuseDelay:0.35 },
  { name:'ARC RIFLE', type:'chain', dmg:26, fireRate:0.3, mag:20, reserveMax:120, chainCount:3, chainRadius:7 },
  { name:'ACID VIAL', type:'puddle', dmg:0, fireRate:1.0, mag:2, reserveMax:16, launchSpeed:14, puddleRadius:3.4, puddleDuration:5, dps:22 },
  { name:'RAILGUN', type:'pierce', dmg:64, fireRate:1.3, mag:6, reserveMax:24, pierceFalloff:0.5, maxPierces:6 },
  { name:'VORTEX CANNON', type:'vortex', dmg:0, fireRate:1.2, mag:2, reserveMax:6, launchSpeed:26, vortexRadius:6, vortexDuration:3, vortexPull:3.2, vortexDps:9, vortexBurst:55 },
];
const SPECIAL_INDICES = [4,5,6,7,8];

const STATS = [
  { key:'damage',        name:'DAMAGE',       desc:'Weapon damage',                     perLevel:0.10, maxLevel:5 },
  { key:'fireRate',      name:'FIRE RATE',    desc:'Fire rate',                         perLevel:0.08, maxLevel:5 },
  { key:'moveSpeed',     name:'MOVE SPEED',   desc:'Move speed',                        perLevel:0.06, maxLevel:5 },
  { key:'maxHealth',     name:'VITALITY',     desc:'Max health (full heal on pick)',    perLevel:20,   maxLevel:5 },
  { key:'reloadSpeed',   name:'RELOAD SPEED', desc:'Reload time',                       perLevel:0.06, maxLevel:5 },
  { key:'ammoCapacity',  name:'AMMO CAPACITY',desc:'Magazine & reserve size (cap only)',perLevel:0.15, maxLevel:5 },
  { key:'moneyMult',     name:'GREED',        desc:'Money from kills',                  perLevel:0.12, maxLevel:5 },
  { key:'xpMult',        name:'INSIGHT',      desc:'XP from kills',                     perLevel:0.12, maxLevel:5 },
  { key:'critChance',    name:'PRECISION',    desc:'Critical hit chance',               perLevel:0.05, maxLevel:5 },
  { key:'critMult',      name:'BRUTALITY',    desc:'Critical hit damage',               perLevel:0.25, maxLevel:5 },
  { key:'enemyIntensity',name:'BLOODLUST',    desc:'More & tougher — bigger payout',    perLevel:1,    maxLevel:5 },
];

const BASE_LEVEL_TABLES = {
  0: [ {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'damage', amount:0.15, label:'+15% damage'},
       {stat:'ammo',   amount:0.25, label:'+25% ammo capacity'}, {stat:'damage', amount:0.15, label:'+15% damage'} ],
  1: [ {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'spread', amount:-0.15,label:'-15% spread (tighter)'},
       {stat:'ammo',   amount:0.25, label:'+25% ammo capacity'}, {stat:'damage', amount:0.15, label:'+15% damage'} ],
  2: [ {stat:'fireRate', amount:0.10, label:'+10% fire rate'}, {stat:'damage', amount:0.15, label:'+15% damage'},
       {stat:'ammo',     amount:0.25, label:'+25% ammo capacity'}, {stat:'fireRate', amount:0.10, label:'+10% fire rate'} ],
  3: [ {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'ammo', amount:0.20, label:'+20% ammo capacity'},
       {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'fireRate',amount:0.10,label:'+10% fire rate'} ],
  4: [ {stat:'damage', amount:0.20, label:'+20% damage'}, {stat:'radius', amount:0.15, label:'+15% blast radius'},
       {stat:'damage', amount:0.20, label:'+20% damage'}, {stat:'radius', amount:0.15, label:'+15% blast radius'} ],
  5: [ {stat:'damage', amount:0.20, label:'+20% damage'}, {stat:'bounce', amount:1,    label:'+1 bounce target'},
       {stat:'ammo',   amount:0.30, label:'+30% ammo capacity'}, {stat:'damage', amount:0.20, label:'+20% damage'} ],
  6: [ {stat:'dot',      amount:0.20, label:'+20% puddle damage'}, {stat:'radius',   amount:0.15, label:'+15% puddle radius'},
       {stat:'duration', amount:0.20, label:'+20% puddle duration'}, {stat:'dot',      amount:0.20, label:'+20% puddle damage'} ],
  7: [ {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'ammo', amount:0.20, label:'+20% ammo capacity'},
       {stat:'damage', amount:0.15, label:'+15% damage'}, {stat:'ammo', amount:0.20, label:'+20% ammo capacity'} ],
  8: [ {stat:'duration', amount:0.20, label:'+20% vortex duration'}, {stat:'radius',   amount:0.15, label:'+15% vortex radius'},
       {stat:'duration', amount:0.20, label:'+20% vortex duration'}, {stat:'radius',   amount:0.15, label:'+15% vortex radius'} ],
};

const EVOLUTIONS = {
  0: { name:'HELLGUN',      rotation:['coneDamage','coneDot','coneDuration','coneRadius'] },
  1: { name:'DOUBLE-ACTION',rotation:['damage','ammo','spread'] },
  2: { name:'GATLING GUN',  rotation:['damage','fireRate','ammo'] },
  3: { name:'HEADHUNTER',   rotation:['critBonus','explosionDamage','explosionRadius'] },
  4: { name:'CLUSTER BOMB', rotation:['damage','radius','damage','radius','subCount'] },
  5: { name:'PLASMA RIFLE', rotation:['damage','ammo','damage','ammo','initialSpread'] },
  6: { name:'TOXIC SLUDGE', rotation:['dot','radius','duration'] },
  7: { name:'LIARGUN',      rotation:['ammo','incrementPercent'] },
  8: { name:'BLACK HOLE',   rotation:['duration','radius'] },
};
const EVO_KEY_LABELS = {
  coneDamage:'+cone damage', coneDot:'+cone DoT', coneDuration:'+cone duration', coneRadius:'+cone radius',
  damage:'+damage', ammo:'+ammo capacity', spread:'+spread', fireRate:'+fire rate',
  critBonus:'+headshot crit chance', explosionDamage:'+headshot explosion damage', explosionRadius:'+explosion radius',
  radius:'+radius', subCount:'+1 sub-bomb', initialSpread:'+1 initial branch',
  dot:'+damage', duration:'+duration', incrementPercent:'+per-hit damage bonus',
};

// =================================================================
// STATE
// =================================================================
let scene, camera, renderer, clock;
let renderTarget, quadScene, quadCamera, quadMesh, quadMaterial;
let skyMesh, skyMaterial;
let collisionMeshes = [];
let environmentMeshes = [];
let stationMarkers = []; // { core, group, weaponIndex, pos, spinPhase }
let boxCore = null, boxPos = null;
let trajectoryMarker = null;
let zombies = [];
let projectiles = [];
let puddles = [];
let vortexFields = [];
let blackHoles = [];
let damageNumbers = [];
let drops = [];
let flashLight;
let zombieSpriteTexture = null;
let navGridFine = null, navGridCoarse = null, levelMaxY = 10;
let sunLight = null, ambientLight = null, levelBox = null;
let minimapTransform = null, minimapCanvasEl = null, minimapCtx = null, minimapBgCanvas = null;
const MINIMAP_V_FLIP = false; // flip if markers end up vertically mirrored vs. the real map
let currentInteractable = null;
let pendingSwapTarget = null;
let boxState = 'idle';
let feetY = 0;
let playerVelY = 0;
let playerStart = null;

let audioCtx = null, masterGain = null, muted = false;
let isLocked = false;
let euler = new THREE.Euler(0,0,0,'YXZ');
let gameState = 'loading'; // loading | menu | playing | paused | settings | levelup | swap | gameover
const keys = {};
let mouseDown = false;
const raycaster = new THREE.Raycaster();

const settings = {
  brightness:0, contrast:0, hue:0, saturation:1, tintR:1, tintG:1, tintB:1, pixelSize:4, lutStrength:1,
  skyColor:'#3a5f8a', horizonColor:'#e8c9a0', horizonSharpness:2.0,
  sunColor:'#fff2df', sunIntensity:1.1, ambientColor:'#4a5a78', ambientIntensity:0.7,
  contactShadowColor:'#000000', contactShadowOpacity:0.45,
};

function createDefaultMods(){
  return {
    dmgMult:1, ammoMult:1, fireRateMult:1, spreadMult:1, bounceBonus:0,
    radiusMult:1, durationMult:1, dpsMult:1, pierceFalloffAdd:0, pelletBonus:0, noReload:false,
    coneDamage:0, coneDot:0, coneDuration:0, coneRadius:0,
    critBonus:0, explosionDamage:0, explosionRadius:0,
    subCount:0, initialSpread:0, evoDamage:0, evolvedBaseDamage:0, incrementPercent:0,
  };
}

const player = {
  health: 100, maxHealth: 100, money: 0, kills: 0,
  slots: [0, null, null, null],
  ammoByWeapon: { 0: {mag:12, reserve:72} },
  currentWeapon: 0,
  reloading: false, reloadUntil: 0, lastShotTime: -999,
  stats: {}, level: 1, xp: 0, xpToNext: 0, pendingLevelUps: 0, rerollCost: 50,
  weaponLevel: { 0:1 }, weaponEvolved: { 0:false }, weaponEvoLevel: {}, weaponMods: { 0: createDefaultMods() },
  burstState: {}, doubleUntil: 0,
};

const wave = {
  number: 1, toSpawn: 0, spawned: 0, spawnInterval: 1.2, spawnTimer: 0,
  betweenWaves: true, betweenTimer: 3, dropSchedule: [], killedThisWave: 0,
};

const el = id => document.getElementById(id);
const healthBarInner = el('healthBarInner'), healthNum = el('healthNum');
const weaponNameEl = el('weaponName'), ammoNumEl = el('ammoNum'), reloadTagEl = el('reloadTag');
const waveNumEl = el('waveNum'), moneyNumEl = el('moneyNum'), levelNumEl = el('levelNum');
const xpBarInnerEl = el('xpBarInner'), statRowsEl = el('statRows'), waveBannerEl = el('waveBanner');
const damageFlashEl = el('damageFlash'), lowHealthPulseEl = el('lowHealthPulse');
const interactPromptEl = el('interactPrompt'), spreadRingEl = el('spreadRing'), doubleBadgeEl = el('doubleBadge');
const startOverlay = el('startOverlay'), pauseOverlay = el('pauseOverlay'), gameOverOverlay = el('gameOverOverlay');
const loadingFill = el('loadingFill'), loadingLabel = el('loadingLabel'), startBtn = el('startBtn');
const levelUpEl = el('levelUp'), levelUpCardsEl = el('levelUpCards'), rerollBtnEl = el('rerollBtn');
const swapMenuEl = el('swapMenu'), swapCardsEl = el('swapCards'), debugPanelEl = el('debugPanel');

// =================================================================
