"use strict";
// =================================================================
// CONFIG
// =================================================================
const EYE_HEIGHT = 1.68;
const SCALE_CORRECTION = 1; // confirmed correct at 1:1 against the reference box
const PLAYER_RADIUS = 0.35;
const ZOMBIE_RADIUS = 0.4;
const WALK_SPEED = 7.5;    // 1.5x the original 5.0
const RUN_SPEED = 15.0;    // 1.5x the original 10.0
const ZOMBIE_SPEED_MULT = 3.75; // 1.5x the original 2.5

// Sprint stamina. Drain is 1 unit/sec so STAMINA_MAX reads directly as "seconds of sprinting".
const PLAYER_STAMINA_MAX = 10;      // seconds of continuous sprinting
const PLAYER_STAMINA_DRAIN = 1;     // units per second while sprinting
const PLAYER_STAMINA_RECOVER = 2;   // units per second while not sprinting (full refill in 5s)
// Once fully drained, sprinting stays locked until this much has come back. Without it, the
// bar would flicker between empty and one frame's worth of recovery, letting you stutter-sprint
// indefinitely at zero stamina.
const PLAYER_STAMINA_RESUME = 2;
const GRAVITY = 22;
// Nav grid cell size in metres. Finer = more faithful to real doorways and pillars (a zombie
// is only ~0.4m wide, so 2m cells were very coarse). Build cost is no longer the constraint
// thanks to the collision acceleration structure; see FLOW_FIELD_FINE_RADIUS in world.js.
const FINE_CELL = 0.6;
// The coarse nav grid is this many fine cells across (0.6 * 4 = 2.4m). It's downsampled from
// the fine grid, and its flow field covers the WHOLE level with no distance cap — cheap,
// because a street network's walkable area is only a small share of the map's footprint.
const COARSE_FACTOR = 4;
// Minimum upward component of a surface normal for it to count as walkable ground rather than
// a wall. 0.5 allows slopes up to ~60 degrees; lower it if steep ramps should still block.
const WALKABLE_NORMAL_Y = 0.5;
const STEP_SMOOTH_MAX = 1.2; // meters — normal walkable step/slope tolerance
const LEDGE_DROP_MAX = 4.0;  // meters — max one-way drop zombies/paths will take off a ledge
const INTERACT_RADIUS = 2.6;
const STAGGER_DURATION = 0.35;
const KNOCKBACK_DIST = 0.3;
const DROP_LIFETIME = 15;
const DROP_TYPES = ['ammo','health','double','instakill'];
const DROP_COLORS = { ammo:0xe8b24d, health:0x6fef7d, double:0xfff2b0, instakill:0xc81e2c };
const BOX_COST = 1500;

// Enemy spawning. Points come from an optional SpawnZones model (see below); without it the
// game falls back to sampling rings around the player as before.
const SPAWN_MIN_DIST = 20;      // metres — never closer than this to the player
const SPAWN_MAX_DIST = 100;     // metres — never further than this
const SPAWN_POINT_DENSITY = 4;  // roughly one candidate point per this many square metres

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
const ANIM_WALK_TOWARD = 'walkToward', ANIM_WALK_AWAY = 'walkAway', ANIM_ATTACK = 'attack', ANIM_DEATH = 'death';

// =================================================================
// ENEMY TYPES
// Everything that varies between enemies lives here, so adding a new one means adding a table
// entry rather than editing the spawning, animation, combat and reward code in turn.
//
// Animations are declared as {startRow, frames, duration} and may span several rows: frames
// run left-to-right along a row and continue onto the next, so a 16-frame attack on an 8-wide
// sheet occupies two rows. `duration` is the length of one full cycle in seconds.
//
// Sizing fractions are relative to a single frame's pixel dimensions, so they stay correct
// whatever the sheet's overall size.
//
// Rewards are expressed as a multiplier on the shared base values below, so the whole economy
// can be retuned from one place while keeping each enemy's relative worth intact.
// =================================================================
const BASE_MONEY_REWARD = 10;      // plus a small random spread, see killZombie()
const BASE_MONEY_HEADSHOT_BONUS = 8;
const BASE_XP_REWARD = 14;         // plus a per-wave increment, see killZombie()

const ENEMY_TYPES = {
  TrajeA: {
    id:'TrajeA',
    texture:'./TrajeA.png',
    cols:8, rows:4,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:1.0 },
      walkAway:  { startRow:1, frames:8,  duration:1.0 },
      attack:    { startRow:2, frames:8,  duration:1.0 },
      death:     { startRow:3, frames:8,  duration:1.0 },
    },
    heightMult:1.0,          // relative to AVG_ZOMBIE_HEIGHT
    widthStretch:1.0,        // render wider than the frame's true aspect
    hitboxWidthFraction:100/256,
    headHeightFraction:80/512,
    hpMult:1.0, speedMult:1.0, damageMult:1.0, rewardMult:1.0,
    // Frame numbers below are 1-based, matching how the frames are counted in the art.
    attackDamageFrame:5,     // damage lands on this frame of the attack animation
    attackSpeedMult:1.0,     // movement speed while the attack animation is playing
    minWave:1,
    spawnWeight:1.0,         // relative share of each wave's spawns
    slowField:null,
    deathExplosion:null,
  },
  TrajeB: {
    id:'TrajeB',
    texture:'./TrajeB.png',
    cols:8, rows:6,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:1.0 },
      walkAway:  { startRow:1, frames:8,  duration:1.0 },
      attack:    { startRow:2, frames:16, duration:1.5 },  // rows 2-3
      death:     { startRow:4, frames:16, duration:1.25 }, // rows 4-5
    },
    heightMult:1.05,
    widthStretch:1.25,
    hitboxWidthFraction:150/256,
    headHeightFraction:80/512,
    hpMult:4.0, speedMult:1.0, damageMult:2.0, rewardMult:3.0,
    attackDamageFrame:11,    // his swing is long, so the hit lands well into it
    attackSpeedMult:0.5,     // he lumbers while winding up
    minWave:4,               // "after round 3"
    spawnWeight:0.22,        // markedly rarer than TrajeA
    // Drags the player down while close: full speed beyond `radius`, easing to `minMult` at
    // `innerRadius` and no worse below that.
    slowField:{ radius:15, innerRadius:4, minMult:0.75 },
    // On death, damages every OTHER enemy nearby for a share of his own maximum health.
    deathExplosion:{ radius:4.5, healthFraction:0.10, frame:13 },
  },
};
const DEFAULT_ENEMY_TYPE = 'TrajeA';

// Sun light-travel direction, converted from the 3ds Max (-0.29, 0.222, -0.916) Z-up vector
// to three.js's Y-up convention via the same (x,y,z) -> (x,z,-y) mapping used for the
// FBX/glTF export pipeline elsewhere in this project.
const SUN_DIRECTION = new THREE.Vector3(-0.29, -0.916, -0.222).normalize();

// =================================================================
// NAV NODES — no longer used by pathfinding. The flow field solves routing directly from the
// collision mesh, so hand-placed waypoints aren't needed. Kept only because the capture UI
// still writes here and the coordinates are handy reference points; safe to empty out.
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
let zombieSpriteTexture = null;          // TrajeA's sheet; kept for the Guitarrista fallback
const enemyTextures = {};               // enemy type id -> THREE.Texture
let guitarristaSpriteTexture = null;
let navGridFine = null, navGridCoarse = null, levelMaxY = 10;
let sunLight = null, ambientLight = null, levelBox = null;
let minimapTransform = null, minimapCanvasEl = null, minimapCtx = null, minimapBgCanvas = null;
const MINIMAP_V_FLIP = false; // flip if markers end up vertically mirrored vs. the real map
let currentInteractable = null;
let pendingSwapTarget = null;
let boxState = 'idle';
let feetY = 0;
let playerVelY = 0;
let playerAirborne = 0;
let playerStamina = 10;      // set from PLAYER_STAMINA_MAX at init
let playerExhausted = false;
let playerStart = null;

let audioCtx = null, masterGain = null, muted = false;
let isLocked = false;
let euler = new THREE.Euler(0,0,0,'YXZ');
let gameState = 'loading'; // loading | menu | playing | paused | settings | levelup | swap | gameover
const keys = {};
let mouseDown = false;
const raycaster = new THREE.Raycaster();

// Single source of truth for the look. The panel's controls, the RESET button and the values
// the game boots with all read from here — previously these were duplicated across config,
// the reset handler and the HTML input attributes, which is how they drifted out of sync.
// Largest per-event mouse delta we'll act on, in raw movement units. Normal movement is well
// under this; only coalesced bursts after a stall exceed it.
const MOUSE_DELTA_CAP = 120;

const DEFAULT_SETTINGS = {
  mouseSensitivity:0.0022,
  faceAnimSpeed:1.0,   // global multiplier for tuning the portrait's animation speed live
  brightness:0, contrast:0, hue:0, saturation:1, tintR:1, tintG:1, tintB:1, pixelSize:6, lutStrength:1,
  colorDepth:16,   // 4 / 8 / 16 / 24 — note the renderer itself is 24-bit, so 24 = no quantisation
  skyColor:'#3a5f8a', horizonColor:'#ccf0ff', horizonSharpness:2.0,
  sunColor:'#fff2df', sunIntensity:1.1, ambientColor:'#4a5a78', ambientIntensity:0.7,
  contactShadowColor:'#000000', contactShadowOpacity:0.45,
};
const settings = Object.assign({}, DEFAULT_SETTINGS);

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
const waveNumEl = el('waveNum'), moneyNumEl = el('moneyNum'), levelNumEl = el('levelNum');
const xpBarInnerEl = el('xpBarInner'), statRowsEl = el('statRows'), waveBannerEl = el('waveBanner');
const damageFlashEl = el('damageFlash'), lowHealthPulseEl = el('lowHealthPulse');
const interactPromptEl = el('interactPrompt'), spreadRingEl = el('spreadRing'), doubleBadgeEl = el('doubleBadge');
const startOverlay = el('startOverlay'), pauseOverlay = el('pauseOverlay'), gameOverOverlay = el('gameOverOverlay');
const loadingFill = el('loadingFill'), loadingLabel = el('loadingLabel'), startBtn = el('startBtn');
const levelUpEl = el('levelUp'), levelUpCardsEl = el('levelUpCards'), rerollBtnEl = el('rerollBtn');
const swapMenuEl = el('swapMenu'), swapCardsEl = el('swapCards'), debugPanelEl = el('debugPanel');

// =================================================================

// =================================================================
// AUDIO / GUITARRISTA
// =================================================================
const AUDIO_EXT = 'ogg';

// The Guitarrista: a hireable NPC musician. Folder layout mirrors the enemies:
//   ./Audio/Guitarrista/Canciones/<file>.ogg      music tracks
//   ./Audio/Guitarrista/Quejas/Guitarrista_Quejas_<N>.ogg      complaints when shot
//   ./Audio/Guitarrista/Quejas/Guitarrista_Quejas_Quiebrodeguitarra.ogg   the broken-chord sting
//   ./Audio/Guitarrista/Felicitaciones/Guitarrista_Felicitaciones_<N>.ogg  after a wave clear
//   ./Audio/Guitarrista/Insultos/Guitarrista_Insultos_<N>.ogg   when dismissed
//
// A browser can't list a directory, so the tracklist has to be declared here rather than
// discovered automatically. Add one line per song: `file` is the filename without extension,
// `title` is what shows in the HUD while it plays.
// `file` must match the filename on disk EXACTLY (minus the extension). These use spaces, not
// underscores — the code percent-encodes them for the URL, so spaces and accents are fine.
const GUITARRISTA_TRACKS = [
  { file:'Sombras de Jaén',   title:'Sombras de Jaén' },
  { file:'Tango Down',        title:'Tango Down' },
  { file:'Caricias de Arena', title:'Caricias de Arena' },
  { file:'Taranta Allegra',   title:'Taranta Allegra' },
];
// Folder names are case-sensitive once deployed (Linux servers) even though Windows treats
// them as interchangeable — a folder called 'canciones' will 404 when the code asks for
// 'Canciones'. Set these to match exactly what is on disk.
const GUITARRISTA_FOLDER_CANCIONES = 'Canciones';
const GUITARRISTA_QUEJAS_COUNT = 5;          // numbered complaint files (excludes the sting below)
const GUITARRISTA_BREAK_CLIP = 'Guitarrista_Quejas_Quiebrodeguitarra';
const GUITARRISTA_FELICITACIONES_COUNT = 5;
const GUITARRISTA_INSULTOS_COUNT = 5;

// Guitarrista spritesheet: 2048x2048, 8 columns x 4 rows, each frame 256x512.
// Unlike TrajeA's one-row-per-animation layout, each of his animations is 16 frames spanning
// TWO rows: rows 0-1 walk toward the camera, rows 2-3 walk away.
const GUITARRISTA_SPRITE_COLS = 8;
const GUITARRISTA_SPRITE_ROWS = 4;
const GUITARRISTA_ANIM_FRAMES = 16;          // frames per animation (two rows of eight)
const GUITARRISTA_ANIM_DURATION = 1.5;       // seconds for one full loop
// The art was squeezed to fit the cell, so widen it back out. A 256x512 frame is 1:2; at 1.1
// this renders it as roughly 1:1.8. (Note 1:2.2 would be *narrower* than the source, not wider.)
const GUITARRISTA_WIDTH_STRETCH = 1.1;
const GUITARRISTA_HIRE_COST = 50;
const GUITARRISTA_FOLLOW_RADIUS = 10;        // metres — hangs back once this close
// Metres at which the music fades to nothing. Wider once he's hired, since he's meant to be
// your travelling companion rather than a landmark you stumble across.
const GUITARRISTA_HEAR_RADIUS_IDLE = 60;     // not hired (2x the original 30m)
const GUITARRISTA_HEAR_RADIUS_HIRED = 90;    // hired (3x the original 30m)
// Exponent on the distance falloff. 1 = linear. The previous value was effectively 2, which
// meant half the radius gave only a quarter of the volume — a large part of why he sounded
// audible only up close. Raise it above 1 if you want the fade to bite sooner.
const GUITARRISTA_MUSIC_FALLOFF_EXP = 1.0;
const GUITARRISTA_MUSIC_VOLUME = 0.55;       // gain when standing right next to him
const GUITARRISTA_SKIP_DELAY = 2.0;          // seconds between being shot and the next song
const GUITARRISTA_DISMISS_HITS = 3;          // hits within the window below to send him home
const GUITARRISTA_DISMISS_WINDOW = 2.0;      // seconds
const GUITARRISTA_SPEED = 10.5;              // metres/sec while following (1.5x, so he keeps up)
// Fixed home spot. Leave null to have him placed on a random valid floor point at load; set
// to {x:.., z:..} (use COPY POSITION in the settings panel) to pin him somewhere specific.
const GUITARRISTA_HOME = { x: 106.58, z: 61.34 };

// =================================================================
// FACE HUD
// The sheet is 2048x1664: a 16x13 grid of 128x128 frames, 200 used and 8 spare.
// FACE_LAYOUT is the sheet's contents in order — [name, frameCount, fps]. Start indices are
// derived from it at load, so the numbers below are the only thing to edit when the art
// changes. fps values are first guesses; tune them live with the Face Anim Speed slider in
// the settings panel, then bake the ones you like back in here.
// =================================================================
const FACE_TEXTURE = './SabasHealthy.png';
const FACE_COLS = 16, FACE_ROWS = 13;
const FACE_DEFAULT_FPS = 12;

const FACE_LAYOUT = [
  // name              frames  fps
  ['serious.blink',        2,  10],
  ['serious.idle1',       10,  12],
  ['serious.idle2',       18,  12],
  ['serious.idle3',        4,  10],

  ['hit1',                16,  14],
  ['hit2',                 8,  14],
  ['hit3',                 6,  14],
  ['hit4',                 6,  14],

  ['happy.blink',          2,  10],
  ['happy.idle1',          4,  12],
  ['happy.idle2',         12,  12],

  ['excited.blink',        2,  10],
  ['excited.idle1',       24,  15],
  ['excited.idle2',       12,  15],

  ['mad.blink',            2,  10],
  ['mad.idle1',           46,  18],
  ['mad.idle2',           26,  18],
];
const FACE_HIT_ANIMS = ['hit1','hit2','hit3','hit4'];

// Blink pacing, in seconds. Humans blink roughly every 2-8 seconds.
const FACE_BLINK_MIN = 2.5, FACE_BLINK_MAX = 6.0;
// Idle pacing, in seconds — averages the ~20s asked for.
const FACE_IDLE_MIN = 12, FACE_IDLE_MAX = 28;
// Breathing rate per mood, in cycles per second. 0.25Hz is 15 breaths a minute, i.e. resting.
const FACE_BOB_HZ = { serious:0.25, happy:0.40, excited:0.70, mad:0.95 };
const FACE_BOB_PIXELS = 5;   // vertical travel of the portrait, in canvas pixels
