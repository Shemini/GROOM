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
// Below this, the panting cue plays — a warning that a sword swing is about to lose its shove
// and that sprinting is about to be unavailable.
const PLAYER_STAMINA_LOW = 2.5;
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
// Pickup spritesheet: 1024x1024, an 8x8 grid of 128px frames. Each pickup owns two rows, so
// its 16 frames run left-to-right along the first row and continue onto the second.
const WEAPON_DIR = './Weapons/';   // first-person sprites and HUD icons
const DROP_TEXTURE = './Pickups1024.png';
const DROP_SHEET_COLS = 8, DROP_SHEET_ROWS = 8;
const DROP_ANIM_FRAMES = 16;
const DROP_ANIM_FPS = 12;
const DROP_SPRITE_SIZE = 1.0;      // world height of the billboard, in metres
const DROP_DEFS = {
  double:    { startRow:0, light:0xffd54a, label:'Postre — 2x dinero y XP' },   // dessert, yellow
  ammo:      { startRow:2, light:0xff8c26, label:'Plato fuerte — munición' },   // main course, orange
  health:    { startRow:4, light:0x5ce85c, label:'Ensalada — salud' },          // salad, green
  instakill: { startRow:6, light:0xe83030, label:'Vermut — x3 daño' },// vermouth, red
};
// Kept for anything still asking for a flat colour (the HUD badge, particles).
const DROP_COLORS = { ammo:0xff8c26, health:0x5ce85c, double:0xffd54a, instakill:0xe83030 };
// Vermut used to make every hit lethal, which trivialised anything with area damage or a
// high tick rate (laser, bubbles, the stream weapons). A flat multiplier scales with what the
// weapon actually does instead of flattening the difference between them.
const VERMUT_DURATION = 15;        // seconds
const VERMUT_DAMAGE_MULT = 3;
const BOX_COST = 1500;

// Laser wind-up: held on one target, damage climbs to this multiple over this many seconds.
const BEAM_RAMP_MAX = 2.5;
const BEAM_RAMP_TIME = 2.2;
// Bubbles burst for a small area hit rather than only striking whoever touched them.
const BUBBLE_POP_RADIUS_MULT = 2.6;      // of the bubble's own radius
const BUBBLE_SPLASH_FRACTION = 0.55;     // damage to everyone but the guest actually hit

// =================================================================
// COMBO
// Timers shorten sharply with each stage: Mad is meant to be barely holdable, which is what
// makes its payout defensible.
// =================================================================
// Shorter than the original 6s: a long lull between waves makes combos nearly impossible to
// carry, and the wait wasn't doing anything for pacing either.
const WAVE_GAP = 2.5;
// =================================================================
// DRAFT MODE  —  set to false to restore the original shop/box progression.
//
// Weapons are chosen from the level-up screen instead of bought, and a choice is permanent
// for the run. That removes the worst trade in the old system (swapping a levelled weapon for
// a fresh Lv1 one) while keeping the randomness, since a wanted weapon still has to be
// offered. Everything it changes is applied in the patch block further down, so flipping this
// single flag reverts the lot.
// =================================================================
const DRAFT_MODE = true;
const DRAFT_XP_MULT = 0.7;        // level up ~30% more often
// Cards reserved for not-yet-owned weapons while a slot is still open, out of the three on
// offer. Higher means a wanted weapon turns up sooner, at the cost of fewer stat choices.
const DRAFT_GUARANTEED_OFFERS = 2;
const DRAFT_WEAPON_POOL = [1,2,3,4,5,6,7,8,9,10];   // draftable weapons (11 is gone: see below)
let DRAFT_STATION_AMMO_ONLY = false, DRAFT_DISABLE_BOX = false;

// Enemy health: base and per-wave growth, both lowered to soften the difficulty curve.
const ENEMY_HP_BASE = 44;        // was 55 (-20%)
const ENEMY_HP_PER_WAVE = 11.9;  // was 14 (-15%)

const SWARM_SPREAD = 2.4;   // metres around a pack's anchor that its members appear within
const COMBO_KILLS_PER_STAGE = 10;
const COMBO_STAGES = [
  { label:'SERIO',     mood:'serious', timer:10.0 },
  { label:'CONTENTO',  mood:'happy',   timer:7.5  },
  { label:'EUFÓRICO',  mood:'excited', timer:5.0  },
  { label:'LOCO',      mood:'mad',     timer:2.5  },   // 'mad' as in crazy, not angry
];
const COMBO_DAMAGE_BONUS = 0.15;           // per stage, additive -> +45% at Mad
const COMBO_REWARD_BONUS = 0.15;           // gold and XP, same scale
const COMBO_DAMAGE_TAKEN_PENALTY = 0.10;   // per stage -> +30% incoming at Mad
// Weapon stations and the party box are placed in this ring around the spawn point, so
// everything is quick to reach when testing.
// A tray split between a crowd used to vanish almost instantly, and one with a single eater
// sat there far too long. The shared budget is still computed the same way; the result is just
// clamped to something playable.
const BAIT_MIN_SECONDS = 5;
const BAIT_MAX_SECONDS = 15;

const SHOP_MIN_DIST = 6;
const SHOP_MAX_DIST = 22;

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

// Optional per-type fields beyond the basics:
//   tint          multiplies the sprite's colours — lets several enemies share one sheet
//                 until each has art of its own
//   attackRange   distance at which it starts attacking (default 1.0, i.e. melee)
//   rangedAttack  { aoeRadius, fallTime, particles } — throws instead of striking; the damage
//                 lands where the player WAS, so it can be dodged
//   swarmSize     [min,max] spawned together as a group rather than one at a time
//   wander        sideways drift on its approach, in radians of heading noise
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

  // --- Borrowing TrajeA's sheet until each has its own; `tint` keeps them distinguishable. ---
  MujerA: {
    id:'MujerA',
    texture:'./TrajeA.png',
    cols:8, rows:4,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:1.0 },
      walkAway:  { startRow:1, frames:8,  duration:1.0 },
      attack:    { startRow:2, frames:8,  duration:1.2 },
      death:     { startRow:3, frames:8,  duration:1.0 },
    },
    tint:0xff9ec4,              // placeholder dress colour
    heightMult:0.96,
    widthStretch:1.0,
    hitboxWidthFraction:100/256,
    headHeightFraction:80/512,
    hpMult:0.7, speedMult:1.0, damageMult:0.5, rewardMult:1.1,
    attackRange:4.5,
    // Thrown at the two-thirds mark of a 8-frame swing.
    attackDamageFrame:6,
    attackSpeedMult:0.0,        // plants her feet to throw
    rangedAttack:{ aoeRadius:1.9, fallTime:0.45, particles:34 },
    minWave:2,
    spawnWeight:0.55,
    slowField:null,
    deathExplosion:null,
  },
  MujerB: {
    id:'MujerB',
    texture:'./TrajeA.png',
    cols:8, rows:4,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:1.1 },
      walkAway:  { startRow:1, frames:8,  duration:1.1 },
      attack:    { startRow:2, frames:8,  duration:1.0 },
      death:     { startRow:3, frames:8,  duration:1.0 },
    },
    tint:0xb58cd8,              // placeholder dress colour
    heightMult:0.98,
    widthStretch:1.12,          // a little broader
    hitboxWidthFraction:115/256,
    headHeightFraction:80/512,
    hpMult:0.9, speedMult:0.9, damageMult:1.25, rewardMult:1.2,
    attackDamageFrame:5,
    attackSpeedMult:1.0,
    minWave:3,
    spawnWeight:0.45,
    slowField:null,
    deathExplosion:null,
  },
  NinoA: {
    id:'NinoA',
    texture:'./TrajeA.png',
    cols:8, rows:4,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:0.65 },   // quicker legs
      walkAway:  { startRow:1, frames:8,  duration:0.65 },
      attack:    { startRow:2, frames:8,  duration:0.7 },
      death:     { startRow:3, frames:8,  duration:0.9 },
    },
    tint:0x7fc4ff,              // boy
    heightMult:0.62,
    widthStretch:1.0,
    hitboxWidthFraction:100/256,
    headHeightFraction:110/512, // proportionally bigger head
    hpMult:0.33, speedMult:1.25, damageMult:0.25, rewardMult:0.45,
    attackDamageFrame:4,
    attackSpeedMult:1.0,
    swarmSize:[3,6],
    wander:0.55,
    minWave:5,
    spawnWeight:0.30,
    slowField:null,
    deathExplosion:null,
  },
  NinaA: {
    id:'NinaA',
    texture:'./TrajeA.png',
    cols:8, rows:4,
    anims:{
      walkToward:{ startRow:0, frames:8,  duration:0.65 },
      walkAway:  { startRow:1, frames:8,  duration:0.65 },
      attack:    { startRow:2, frames:8,  duration:0.7 },
      death:     { startRow:3, frames:8,  duration:0.9 },
    },
    tint:0xffe07f,              // girl
    heightMult:0.62,
    widthStretch:1.0,
    hitboxWidthFraction:100/256,
    headHeightFraction:110/512,
    hpMult:0.33, speedMult:1.25, damageMult:0.25, rewardMult:0.45,
    attackDamageFrame:4,
    attackSpeedMult:1.0,
    swarmSize:[3,6],
    wander:0.55,
    minWave:5,
    spawnWeight:0.30,
    slowField:null,
    deathExplosion:null,
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
  // 0 — melee, permanently occupies slot 0 and cannot be levelled or dropped.
  { name:'PUÑOS', type:'melee', dmg:34, fireRate:0.45, mag:1, reserveMax:0, cost:0, ammoCost:0,
    meleeRange:2.6, meleeArc:70, noAmmo:true, noLevel:true, singleTarget:true },
  // 1 — the starting firearm, unchanged from the old pistol.
  { name:'PISTOLA DE PLOMOS', type:'hitscan', dmg:26, fireRate:0.35, mag:12, reserveMax:72, cost:0, ammoCost:0,
    spread:0.010, pellets:1 },
  // 2 — the hunter cousin's stock: slow, precise, heavy.
  { name:'ESCOPETILLA DE PLOMOS', type:'hitscan', dmg:88, fireRate:1.24, mag:5, reserveMax:40, cost:1400, ammoCost:250,
    spread:0.004, pellets:1 },
  // 3 — fast, weak, ricochets between guests.
  { name:'METRALLETA DE BALINES', type:'chain', dmg:8, fireRate:0.14, mag:30, reserveMax:180, cost:900, ammoCost:180,
    // chainCount is the TOTAL number of guests a pellet touches, not the number of bounces:
    // 3 here means the primary hit plus 2 ricochets.
    chainCount:3, chainRadius:6.5 },
  // 4 — held to blow a stream; see the soap/breath handling in tryShoot().
  // Homing gives it a role as a low-skill, low-aim option; the base damage is up but its
  // per-level growth is down, since COVID already makes the evolved version very strong.
  { name:'VARITA DE BURBUJAS', type:'bubble', dmg:7, fireRate:0.12, mag:60, reserveMax:240,
    bubbleSpeed:11, bubbleLife:6, bubbleRadius:0.55, soapLimit:1.6, soapRecover:1.2,
    homingRange:3.0, homingStrength:3.4 },
  // 5 — bait. Shared distraction budget, drains faster the bigger the crowd.
  { name:'JAMÓN IBÉRICO', type:'bait', dmg:0, fireRate:1.4, mag:1, reserveMax:5,
    launchSpeed:13, baitRadius:16, baitSeconds:40, cholesterolMult:1.35 },
  // 6 — the old grenade launcher, rethemed.
  { name:'PETARDOS', type:'grenade', dmg:55, fireRate:1.1, mag:2, reserveMax:10,
    launchSpeed:16, blastRadius:4.5, fuseDelay:0.35 },
  // 7 — puddle DoT.
  { name:'TEQUIFRESA', type:'puddle', dmg:0, fireRate:1.0, mag:2, reserveMax:16,
    launchSpeed:14, puddleRadius:3.4, puddleDuration:5, dps:31 },
  // 8 — single heavy spread with hard knockback.
  // Crowd control first, damage second: everything inside the cone is shoved to its far edge.
  { name:'CAÑÓN DE CONFETTI', type:'cone', dmg:57, fireRate:1.15, mag:2, reserveMax:20,
    coneRange:5, coneAngle:42, knockback:1.1, knockbackBonus:2.0 },   // +2m beyond the cone's edge
  // 9 — continuous cone of particles: light DoT plus a slow.
  { name:'CAÑÓN DE CO2', type:'stream', dmg:0, fireRate:0.05, mag:120, reserveMax:480,
    streamSpeed:16, streamLife:1.1, streamRadius:0.5, streamGrow:2.6, streamDps:30, streamSlow:0.55 },
  // 10 — constant beam, ticks fast, doubles on the eyes.
  { name:'PUNTERO LÁSER', type:'beam', dmg:0, fireRate:0.05, mag:100, reserveMax:400,
    beamTick:0.05, beamDps:57, beamHeadMult:2.0, beamRange:60 },
  // 11 — melee upgrade from the party box; replaces the fists in slot 0.
  // Swinging costs stamina: with an arc, knockback and no ammo it otherwise kept every guest
  // permanently out of reach for free. Run dry and it still cuts, but nothing gets pushed —
  // and you can't sprint away either.
  { name:'ESPADA DE TARTA', type:'melee', dmg:72, fireRate:0.5, mag:1, reserveMax:0,
    meleeRange:3.2, meleeArc:85, noAmmo:true, windDmg:0.45, windSpeed:26, windRange:14,
    staminaCost:0.3 },
];
// Weapons that live in the melee slot (slot 0) rather than the three carry slots.
const MELEE_INDICES = [0, 11];
const FISTS_INDEX = 0;
const STARTER_INDEX = 1;
const SPECIAL_INDICES = [4,5,6,7,8,9,10,11];  // party-box pool (11 is the melee upgrade)
// The confetti cannon was here too, but it has no `cost`, so the station priced it as NaN and
// buying it turned the player's money into NaN — which then compared as "enough" for anything.
const STATION_INDICES = [2,3];                 // wall-buy stock: the cousin's rifle, the BB gun

// Stat icons live in Stats/ alongside the weapon icons; `icon` is the filename without the
// extension. Names are Spanish to match the art.
const STATS_DIR = './Stats/';
const STATS = [
  { key:'damage',        name:'DAÑO',                   icon:'DañoIcon',                desc:'Daño de las armas',                     perLevel:0.10, maxLevel:5 },
  { key:'fireRate',      name:'CADENCIA',               icon:'CadenciaIcon',            desc:'Velocidad de disparo',                  perLevel:0.08, maxLevel:5 },
  { key:'moveSpeed',     name:'VELOCIDAD',              icon:'VelocidadMovimientoIcon', desc:'Velocidad de movimiento',               perLevel:0.06, maxLevel:5 },
  { key:'maxHealth',     name:'VITALIDAD',              icon:'VitalidadIcon',           desc:'Salud máxima (cura al elegirla)',       perLevel:20,   maxLevel:5 },
  { key:'reloadSpeed',   name:'RECARGA',                icon:'VelocidadRecargaIcon',    desc:'Tiempo de recarga',                     perLevel:0.06, maxLevel:5 },
  { key:'ammoCapacity',  name:'MUNICIÓN',               icon:'CapacidadMunicionIcon',   desc:'Cargador y reserva (solo el tope)',     perLevel:0.15, maxLevel:5 },
  { key:'moneyMult',     name:'CODICIA',                icon:'CodiciaIcon',             desc:'Dinero por muerte',                     perLevel:0.12, maxLevel:5 },
  { key:'xpMult',        name:'INTELIGENCIA',           icon:'InteligenciaIcon',        desc:'XP por muerte',                         perLevel:0.12, maxLevel:5 },
  { key:'critChance',    name:'PRECISIÓN',              icon:'PrecisionIcon',           desc:'Probabilidad de crítico',               perLevel:0.05, maxLevel:5 },
  { key:'enemyIntensity',name:'SED DE SANGRE',          icon:'SedSangreIcon',           desc:'Más y más duros — mayor recompensa',    perLevel:1,    maxLevel:5 },
];
// Critical hits are a flat multiplier now: the old BRUTALITY stat only paid off once
// PRECISIÓN had been taken, which made it a trap pick most of the time.
const CRIT_MULTIPLIER = 1.5;

const BASE_LEVEL_TABLES = {
  // Index 0 (fists) has no table: it never levels.
  1: [ {stat:'damage',amount:0.15,label:'+15% damage'}, {stat:'damage',amount:0.15,label:'+15% damage'},
       {stat:'ammo',amount:0.25,label:'+25% ammo capacity'}, {stat:'damage',amount:0.15,label:'+15% damage'} ],
  2: [ {stat:'damage',amount:0.18,label:'+18% damage'}, {stat:'fireRate',amount:0.10,label:'+10% fire rate'},
       {stat:'ammo',amount:0.25,label:'+25% ammo capacity'}, {stat:'damage',amount:0.18,label:'+18% damage'} ],
  3: [ {stat:'fireRate',amount:0.10,label:'+10% fire rate'}, {stat:'bounce',amount:1,label:'+1 ricochet'},
       {stat:'ammo',amount:0.30,label:'+30% ammo capacity'}, {stat:'damage',amount:0.15,label:'+15% damage'} ],
  4: [ {stat:'damage',amount:0.10,label:'+10% bubble damage'}, {stat:'duration',amount:0.20,label:'+20% bubble life'},
       {stat:'ammo',amount:0.25,label:'+25% soap'}, {stat:'radius',amount:0.15,label:'+15% bubble size'} ],
  5: [ {stat:'duration',amount:0.20,label:'+20% jamón (more seconds)'}, {stat:'radius',amount:0.15,label:'+15% lure radius'},
       {stat:'ammo',amount:0.25,label:'+1 tray capacity'}, {stat:'duration',amount:0.20,label:'+20% jamón' } ],
  6: [ {stat:'damage',amount:0.20,label:'+20% damage'}, {stat:'radius',amount:0.15,label:'+15% blast radius'},
       {stat:'damage',amount:0.20,label:'+20% damage'}, {stat:'radius',amount:0.15,label:'+15% blast radius'} ],
  7: [ {stat:'dot',amount:0.20,label:'+20% puddle damage'}, {stat:'radius',amount:0.15,label:'+15% puddle radius'},
       {stat:'duration',amount:0.20,label:'+20% puddle duration'}, {stat:'dot',amount:0.20,label:'+20% puddle damage'} ],
  8: [ {stat:'radius',amount:0.14,label:'+14% cone range'}, {stat:'knockback',amount:0.25,label:'+25% knockback'},
       {stat:'ammo',amount:0.25,label:'+25% ammo capacity'}, {stat:'radius',amount:0.14,label:'+14% cone range'} ],
  9: [ {stat:'dot',amount:0.20,label:'+20% stream damage'}, {stat:'radius',amount:0.15,label:'+15% cone width'},
       {stat:'duration',amount:0.18,label:'+18% reach'}, {stat:'dot',amount:0.20,label:'+20% stream damage'} ],
  10:[ {stat:'dot',amount:0.20,label:'+20% laser damage'}, {stat:'ammo',amount:0.25,label:'+25% charge'},
       {stat:'dot',amount:0.20,label:'+20% laser damage'}, {stat:'ammo',amount:0.25,label:'+25% charge'} ],
  11:[ {stat:'damage',amount:0.18,label:'+18% damage'}, {stat:'fireRate',amount:0.12,label:'+12% swing speed'},
       {stat:'damage',amount:0.18,label:'+18% damage'}, {stat:'radius',amount:0.15,label:'+15% reach'} ],
};

const EVOLUTIONS = {
  1:  { name:'PISTOLAS GEMELAS', rotation:['damage','fireRate','ammo'] },   // dual wield
  2:  { name:'RIFLE PERFORANTE',  rotation:['damage','pierceCount','ammo'] },
  3:  { name:'METRALLETA AUTOMÁTICA', rotation:['damage','bounce','fireRate','ammo'] },
  4:  { name:'PACIENTE CERO',     rotation:['infectChance','coughDamage','coughSpread'] },
  5:  { name:'JAMÓN EXPLOSIVO',   rotation:['radius','damage','duration'] },
  6:  { name:'TRACA',             rotation:['subCount','damage','radius'] },
  7:  { name:'GARRAFÓN',          rotation:['dot','radius','duration'] },
  8:  { name:'FIESTA TOTAL',      rotation:['radius','knockback','radius'] },
  9:  { name:'LANZALLAMAS',       rotation:['burnDamage','burnDuration','radius'] },
  10: { name:'LÁSER QUIRÚRGICO',  rotation:['damage','explosionDamage','explosionRadius'] },
  11: { name:'ESPADA DEL BANQUETE', rotation:['damage','windDamage','windRange'] },
};
const EVO_KEY_LABELS = {
  pierceCount:'+1 enemy pierced', bounce:'+1 ricochet', knockback:'+knockback',
  infectChance:'+infection chance', coughDamage:'+cough damage', coughSpread:'+spread chance',
  burnDamage:'+burn damage', burnDuration:'+burn duration',
  windDamage:'+wind slash damage', windRange:'+wind slash range',
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
let dropTexture = null;          // TrajeA's sheet; kept for the Guitarrista fallback
const enemyTextures = {};               // enemy type id -> THREE.Texture
let guitarristaSpriteTexture = null;
let navGridFine = null, navGridCoarse = null, levelMaxY = 10;
let sunLight = null, ambientLight = null, levelBox = null;
let minimapTransform = null, minimapCanvasEl = null, minimapCtx = null, minimapBgCanvas = null;
// The map is drawn this many times the size of its HUD cell and clipped to it, with the
// player pinned at the centre — raising this zooms in without losing your bearings.
const MINIMAP_ZOOM = 2.5;
// Olive against the map's ochres; the blue used elsewhere disappeared into them.
const MINIMAP_PLAYER_COLOR = '#8fae3a';
const MINIMAP_PLAYER_OUTLINE = '#20180c';
const MINIMAP_PLAYER_RADIUS = 4;     // player dot, in canvas pixels
const MINIMAP_ENEMY_COLOR = '#e8434a';
const MINIMAP_ENEMY_EDGE_COLOR = '#a82f34';   // pinned to the rim: dimmer, so it reads as distant
const MINIMAP_ENEMY_SIZE = 5;        // enemy square, in canvas pixels
// Vision cone: matches the camera's horizontal field of view.
const MINIMAP_CONE_RADIUS = 46;
const MINIMAP_CONE_BLOCK = 3;        // block size of the cone, matching the map's pixel feel
// The player's own green at a flat alpha — same hue as the marker, so the two read as one
// piece of UI rather than a marker plus a separate glow.
const MINIMAP_CONE_COLOR = 'rgba(143,174,58,0.30)';
const MINIMAP_GUITAR_COLOR = '#ffc46b';
const MINIMAP_V_FLIP = false; // flip if markers end up vertically mirrored vs. the real map
let currentInteractable = null;
let pendingSwapTarget = null;
let boxState = 'idle';
let feetY = 0;
let playerVelY = 0;
let playerAirborne = 0;
// Game time: advances only while actually playing. Pickup lifetimes and buffs are measured
// against this rather than the wall clock, which kept running through pause, level-up and the
// B menu — so a 20s buff could expire while you were reading upgrade cards.
let gameTime = 0;
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
// Low-res columns to aim for when pixel size is automatic. ~440 reproduces 6px at 2540 wide
// and gives 4px at 1920, keeping the look consistent between the two.
const PIXEL_TARGET_COLUMNS = 440;

const DEFAULT_SETTINGS = {
  mouseSensitivity:0.0022,
  faceAnimSpeed:1.0,   // global multiplier for tuning the portrait's animation speed live
  brightness:0, contrast:0, hue:0, saturation:1, tintR:1, tintG:1, tintB:1, pixelSize:6, lutStrength:1,
  autoPixel:true,    // derive pixel size from screen width (see PIXEL_TARGET_COLUMNS)
  colorDepth:8,   // 4 / 8 / 16 / 24 — note the renderer itself is 24-bit, so 24 = no quantisation
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
    // wedding roster
    pierceCount:0, knockbackMult:1, infectChance:0, coughDamage:0, coughSpread:0,
    burnDamage:0, burnDuration:0, windDamage:0, windRange:0, novaRadius:0,
  };
}

const player = {
  health: 100, maxHealth: 100, money: 0, kills: 0,
  slots: [FISTS_INDEX, STARTER_INDEX, null, null],   // slot 0 is the melee slot and is never empty
  ammoByWeapon: { 0: {mag:1, reserve:0}, 1: {mag:12, reserve:72} },  // slot 0 is melee: a placeholder record keeps every ammo lookup valid
  currentWeapon: STARTER_INDEX,
  reloading: false, reloadUntil: 0, lastReloadStart: 0, lastShotTime: -999,
  stats: {}, level: 1, xp: 0, xpToNext: 0, pendingLevelUps: 0, rerollCost: 50,
  weaponLevel: { 1:1 }, weaponEvolved: { 1:false }, weaponEvoLevel: {}, weaponMods: { 0: createDefaultMods(), 1: createDefaultMods() },
  burstState: {}, doubleUntil: 0, instakillUntil: 0,
  points: 0,   // score: unlike money, never spent, so it stands as a record of the run
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
// `file` must match the filename on disk EXACTLY (minus the .ogg). Spaces and accents are
// fine — the URL is percent-encoded before the request. `title` is what the HUD shows.
// `file` must match the filename on disk EXACTLY (minus the .ogg). Spaces and accents are
// fine — the URL is percent-encoded before the request. `title` is what the HUD shows.
const GUITARRISTA_TRACKS = [
  { file:'Sombras de Jaén',       title:'Sombras de Jaén' },
  { file:'Tango Down',            title:'Tango Down' },
  { file:'Caricias de Arena',     title:'Caricias de Arena' },
  { file:'Taranta Allegra',       title:'Taranta Allegra' },
  { file:'Novalbos y Nogales',    title:'Novalbos y Nogales' },
  { file:'Bossa en Okinawa',      title:'Bossa en Okinawa' },
  { file:'Y después Japón',       title:'Y después Japón' },
  { file:'Helmántica',            title:'Helmántica' },
  { file:'Tarumba',               title:'Tarumba' },
  { file:'Corazón de Hormigón',   title:'Corazón de Hormigón' },
  { file:'Alhambra Roja',         title:'Alhambra Roja' },
  { file:'Veinticuatro de Abril', title:'Veinticuatro de Abril' },
];
// Folder names are case-sensitive once deployed (Linux servers) even though Windows treats
// them as interchangeable — a folder called 'canciones' will 404 when the code asks for
// 'Canciones'. Set these to match exactly what is on disk.
const GUITARRISTA_FOLDER_CANCIONES = 'Canciones';
const GUITARRISTA_QUEJAS_COUNT = 5;          // numbered complaint files (the sting below is separate)
const GUITARRISTA_BREAK_CLIP = 'Guitarrista_Quejas_Quiebrodeguitarra';
const GUITARRISTA_FELICITACIONES_COUNT = 4;   // four files on disk
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
let GUITARRISTA_HIRE_COST = 50;
const GUITARRISTA_FOLLOW_RADIUS = 10;        // metres — hangs back once this close
// Metres at which the music fades to nothing. Wider once he's hired, since he's meant to be
// your travelling companion rather than a landmark you stumble across.
// His speaking voice carries less far than his guitar, which is the point of having him
// follow you at all.
const GUITARRISTA_VOICE_FALLOFF = 35;
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
// Edge treatment for the portrait sheet. 'outline' turns the feathered band into a solid dark
// edge; 'cut' simply discards it. Either removes the white halo that partial alpha produces.
const FACE_EDGE_MODE = 'cut';
const FACE_ALPHA_CUTOFF = 0.6;      // at or above this, a pixel is fully opaque
const FACE_OUTLINE_MIN = 0.15;      // below this, a pixel is discarded entirely
const FACE_OUTLINE_COLOR = [42, 26, 14];   // dark brown

// =================================================================
// DRAFT MODE PATCH
// Applied over the tables above rather than written into them, so turning DRAFT_MODE off
// restores the original game exactly.
// =================================================================
if(DRAFT_MODE){
  // --- the fists become a real build path, evolving into the cake sword ---
  delete ALL_WEAPONS[FISTS_INDEX].noLevel;
  // What the fists become once evolved. No wind slash: the sword itself is already the payoff.
  ALL_WEAPONS[FISTS_INDEX].evolvedMelee = { meleeRange:3.2, meleeArc:85, singleTarget:false, staminaCost:0.3 };
  BASE_LEVEL_TABLES[FISTS_INDEX] = [
    {stat:'damage',  amount:0.18, label:'+18% damage'},
    {stat:'fireRate',amount:0.10, label:'+10% swing speed'},
    {stat:'damage',  amount:0.18, label:'+18% damage'},
    {stat:'radius',  amount:0.12, label:'+12% reach'},
  ];
  EVOLUTIONS[FISTS_INDEX] = { name:'ESPADA DE TARTA', rotation:['damage','fireRate','radius'] };

  // --- start with nothing but your hands; everything else is drafted ---
  player.slots = [FISTS_INDEX, null, null, null];
  player.weaponLevel = { [FISTS_INDEX]:1 };
  player.weaponEvolved = { [FISTS_INDEX]:false };
  player.weaponMods = { [FISTS_INDEX]: createDefaultMods() };
  player.ammoByWeapon = { [FISTS_INDEX]: {mag:1, reserve:0} };
  player.currentWeapon = FISTS_INDEX;

  // --- the guitarist plays for free; gold has little else to do now ---
  GUITARRISTA_HIRE_COST = 0;

  // The stations stay as ammo resupply (a real gold sink); the party box no longer hands out
  // weapons, so it isn't placed.
  DRAFT_STATION_AMMO_ONLY = true;
  DRAFT_DISABLE_BOX = true;
}
