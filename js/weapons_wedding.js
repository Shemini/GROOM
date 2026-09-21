"use strict";
// =================================================================
// WEDDING WEAPONS
// The mechanics specific to the rethemed roster. Everything here hangs off the same
// weaponMods / effective* helpers the original weapons use, so levelling and evolution work
// the same way; only the firing behaviour differs.
// =================================================================

// ---------- MELEE (fists, cake sword) ----------
// A short arc in front of the player rather than a ray, so it connects with anything within
// reach instead of demanding precise aim at knife distance.
function fireMelee(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const reach = (w.meleeRange||2.6) * mods.radiusMult;
  const halfArc = THREE.MathUtils.degToRad((w.meleeArc||70)/2);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();

  const dmg = effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1);
  let hitAny = false;

  // Spend stamina for the shove. With none left the blade still bites, but nothing is pushed
  // back — which is the moment the weapon stops holding a crowd off you.
  const cost = w.staminaCost || 0;
  let canShove = true;
  if(cost > 0){
    if(playerStamina >= cost){ playerStamina -= cost; }
    else { playerStamina = 0; playerExhausted = true; canShove = false; }
    // Hold regeneration for the swing's cooldown. Recovery (2/s) comfortably outpaced the
    // drain (0.3 per swing at two swings a second), so the bar never actually went down —
    // stamina now only comes back while you're not swinging.
    player.staminaRegenBlockedUntil = gameTime + getShotCooldown(wIdx);
  }

  // Gather everything inside the arc, nearest first.
  const inArc = [];
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(z.dying) continue;
    const to = new THREE.Vector3(z.group.position.x-camera.position.x, 0, z.group.position.z-camera.position.z);
    const d = to.length();
    if(d > reach + (z.collisionRadius||ZOMBIE_RADIUS)) continue;
    to.normalize();
    if(Math.acos(THREE.MathUtils.clamp(forward.dot(to),-1,1)) > halfArc) continue;
    inArc.push({ z, d });
  }
  inArc.sort((a,b)=>a.d-b.d);

  // The fists connect with one guest; the sword sweeps through the whole arc. Keeping the
  // crowd-clearing sweep exclusive to the sword is most of what makes buying it feel like an
  // upgrade rather than a damage bump.
  const targets = w.singleTarget ? inArc.slice(0,1) : inArc;
  for(const t of targets){
    damageZombie(t.z, dmg, {crit:isCrit, stagger:canShove, knockFrom:canShove?camera.position:null});
    hitAny = true;
  }
  spawnMeleeArc(forward, reach);
  // The swing has already resolved, so the hit and miss variants can be chosen correctly.
  weaponMeleeSound(wIdx, hitAny);
  if(hitAny) soundHit(false, isCrit);

  // The evolved sword throws a slash, but only at full health — the Zelda rule.
  if(player.weaponEvolved[wIdx] && player.health >= player.maxHealth - 0.01){
    fireWindSlash(wIdx, dmg*(mods.windDamage||w.windDmg||0.45));
  }
}

function fireWindSlash(wIdx, dmg){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const range = (w.windRange||14) + (mods.windRange||0);
  const geo = new THREE.PlaneGeometry(1.6, 1.1);
  const mat = new THREE.MeshBasicMaterial({ color:0xdff3ff, transparent:true, opacity:0.75, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(camera.position).addScaledVector(forward, 1.0);
  mesh.position.y = feetY + 1.1;
  scene.add(mesh);
  windSlashes.push({ mesh, mat, dir:forward.clone(), speed:w.windSpeed||26, dmg,
    travelled:0, range, hit:new Set() });
  soundShot({type:'chain', name:'WIND'});
}

let windSlashes = [];
function updateWindSlashes(delta){
  for(let i=windSlashes.length-1;i>=0;i--){
    const s = windSlashes[i];
    const step = s.speed*delta;
    s.travelled += step;
    s.mesh.position.addScaledVector(s.dir, step);
    // Fades as it goes, so its reach reads visually rather than vanishing abruptly.
    const life = 1 - s.travelled/s.range;
    s.mat.opacity = Math.max(0, 0.75*life);
    for(const z of zombies){
      if(z.dying || s.hit.has(z)) continue;
      const d = Math.hypot(z.group.position.x-s.mesh.position.x, z.group.position.z-s.mesh.position.z);
      if(d < (z.collisionRadius||ZOMBIE_RADIUS)+0.9){
        s.hit.add(z);
        damageZombie(z, s.dmg*life, {});
      }
    }
    if(s.travelled >= s.range){ scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); windSlashes.splice(i,1); }
  }
}

function spawnMeleeArc(forward, reach){
  const geo = new THREE.RingGeometry(reach*0.55, reach, 12, 1, -Math.PI/4, Math.PI/2);
  const mat = new THREE.MeshBasicMaterial({ color:0xfff0c0, transparent:true, opacity:0.4, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.rotation.z = -Math.atan2(forward.z, forward.x);
  mesh.position.set(camera.position.x, feetY+0.9, camera.position.z);
  scene.add(mesh);
  const t0 = clock.getElapsedTime();
  const anim = ()=>{
    const k = Math.min(1,(clock.getElapsedTime()-t0)/0.18);
    mat.opacity = 0.4*(1-k);
    if(k<1) requestAnimationFrame(anim);
    else { scene.remove(mesh); geo.dispose(); mat.dispose(); }
  };
  anim();
}

// ---------- BUBBLE WAND ----------
// Slow, persistent projectiles that enemies walk into. The soap/breath handling lives in
// tryShoot(); this just launches one bubble.
let bubbles = [];
function fireBubble(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const dir = forward.clone();
  dir.x += (Math.random()-0.5)*0.12; dir.y += (Math.random()-0.5)*0.09; dir.z += (Math.random()-0.5)*0.12;
  dir.normalize();
  const radius = (w.bubbleRadius||0.55)*mods.radiusMult;
  const geo = new THREE.SphereGeometry(radius, 10, 10);
  const mat = new THREE.MeshBasicMaterial({ color:0xbfe9ff, transparent:true, opacity:0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(camera.position).addScaledVector(forward, 0.6);
  scene.add(mesh);
  bubbles.push({
    mesh, mat, geo, radius,
    vel: dir.multiplyScalar(w.bubbleSpeed||11),
    dmg: effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1),
    life: (w.bubbleLife||6)*mods.durationMult,
    age: 0, wobble: Math.random()*10, popped:false, infect: !!player.weaponEvolved[wIdx],
    infectChance: 0.45 + (mods.infectChance||0),
  });
}

function updateBubbles(delta, elapsed){
  for(let i=bubbles.length-1;i>=0;i--){
    const b = bubbles[i];
    b.age += delta;
    // Quick at first, then it slows to a drift and starts bobbing.
    const drag = Math.pow(0.12, delta);
    b.vel.multiplyScalar(drag);
    b.wobble += delta;
    b.mesh.position.addScaledVector(b.vel, delta);
    b.mesh.position.y += Math.sin(b.wobble*2.1)*0.22*delta + 0.12*delta;
    b.mesh.position.x += Math.sin(b.wobble*1.3)*0.3*delta;
    b.mesh.position.z += Math.cos(b.wobble*1.7)*0.3*delta;
    b.mat.opacity = 0.4*Math.max(0, 1-(b.age/b.life)*0.8);

    for(const z of zombies){
      if(z.dying) continue;
      const d = Math.hypot(z.group.position.x-b.mesh.position.x, z.group.position.z-b.mesh.position.z);
      const dy = Math.abs((z.feetY+(z.height||1.8)*0.5) - b.mesh.position.y);
      if(d < b.radius+(z.collisionRadius||ZOMBIE_RADIUS) && dy < (z.height||1.8)*0.7){
        popBubble(b, z, elapsed);
        break;
      }
    }
    if(b.popped || b.age >= b.life){
      if(!b.popped){ popBubble(b, null, elapsed); }
      scene.remove(b.mesh); b.geo.dispose(); b.mat.dispose(); bubbles.splice(i,1);
    }
  }
}

// A burst catches everything in a small radius, not just whoever walked into it. Individually
// still slight, but a stream of them finally means something against a crowd — which was the
// weapon's whole point and the thing it wasn't delivering.
function popBubble(b, directHit, elapsed){
  if(b.popped) return;
  b.popped = true;
  weaponBubblePopSound(b.mesh.position);
  const splash = b.radius * BUBBLE_POP_RADIUS_MULT;
  for(const z of zombies){
    if(z.dying) continue;
    const d = Math.hypot(z.group.position.x-b.mesh.position.x, z.group.position.z-b.mesh.position.z);
    if(d > splash + (z.collisionRadius||ZOMBIE_RADIUS)) continue;
    // The guest actually struck takes it in full; everyone else catches the spray.
    const dmg = (z === directHit) ? b.dmg : b.dmg*BUBBLE_SPLASH_FRACTION;
    damageZombie(z, dmg, {});
    if(b.infect) tryInfect(z, b.infectChance * (z===directHit ? 1 : 0.6), elapsed);
  }
}

// ---------- COVID (bubble wand evolution) ----------
// Deliberately unreliable: infection is a roll, and every cough carries a small chance the
// guest shakes it off and becomes immune. Without that, parking bubbles in a doorway would be
// a risk-free way to clear a whole wave.
function tryInfect(z, chance, elapsed){
  if(z.immune || z.infected) return;
  if(Math.random() > chance) return;
  z.infected = true;
  z.coughTimer = 1.2 + Math.random()*0.8;
}

function updateInfections(delta, elapsed){
  const wIdx = 4;
  const mods = player.weaponMods[wIdx] || createDefaultMods();
  const coughDmg = 16 + (mods.coughDamage||0);
  const spreadChance = 0.25 + (mods.coughSpread||0);
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(!z.infected || z.dying) continue;
    z.coughTimer -= delta;
    if(z.coughTimer > 0) continue;
    z.coughTimer = 1.6 + Math.random()*0.9;

    // Small chance of recovery, which also grants permanent immunity.
    if(Math.random() < 0.08){
      z.infected = false; z.immune = true;
      spawnDamageNumber(z.group.position.clone().add(new THREE.Vector3(0,(z.height||1.8)*0.9,0)), 0, false);
      continue;
    }

    playEnemyClip('coughing', z.group.position, 0.55, z.def.id);
    damageZombie(z, coughDmg, {});
    if(z.dying) continue;
    for(const other of zombies){
      if(other===z || other.dying || other.infected || other.immune) continue;
      const d = Math.hypot(other.group.position.x-z.group.position.x, other.group.position.z-z.group.position.z);
      if(d < 3.5) tryInfect(other, spreadChance, elapsed);
    }
  }
}

// ---------- JAMÓN IBÉRICO (bait) ----------
// A shared distraction budget: `baitSeconds` of ham split between whoever is eating. Rather
// than recomputing every frame, the deadline is recalculated only when a new guest arrives —
// which is the only moment the division changes.
let baits = [];
function fireBait(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const start = camera.position.clone().addScaledVector(forward,0.6);
  // Flies as its own icon. No spin: a tray of ham should stay level, unlike the firecracker
  // and the bottle, which tumble.
  const mesh = createIconProjectile('JamonIcon', 0.7);
  mesh.position.copy(start);
  scene.add(mesh);
  const seconds = (w.baitSeconds||40)*mods.durationMult;
  const radius = (w.baitRadius||16)*mods.radiusMult;
  const evolved = !!player.weaponEvolved[wIdx];
  projectiles.push({
    mesh, spin:0, pos:start.clone(), vel:forward.clone().multiplyScalar(w.launchSpeed||13),
    gravity:true, radius:0.3, groundOnly:true, spawnTime:clock.getElapsedTime(), maxLife:5, landed:false,
    onImpact:(pos)=>{
      weaponImpactSound(wIdx, pos);
      spawnBait(pos, radius, seconds, evolved, wIdx, dmgMult);
    }
  });
}

function spawnBait(pos, radius, seconds, evolved, wIdx, dmgMult){
  // Lies flat on the floor once it lands, so it reads as a plate set down rather than a disc.
  const plate = createIconProjectile('JamonIcon', 1.3);
  plate.rotation.x = -Math.PI/2;
  plate.position.set(pos.x, pos.y+0.06, pos.z);
  scene.add(plate);
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius-0.25, radius, 32),
    new THREE.MeshBasicMaterial({ color:0xc4564f, transparent:true, opacity:0.16, side:THREE.DoubleSide }));
  ring.rotation.x = -Math.PI/2;
  ring.position.set(pos.x, pos.y+0.05, pos.z);
  scene.add(ring);
  soundSplat();
  baits.push({
    plate, ring, pos:{x:pos.x, y:pos.y, z:pos.z}, radius,
    secondsLeft: seconds, eaters:new Set(), deadline:clock.getElapsedTime()+seconds,
    evolved, wIdx, dmgMult,
  });
}

function updateBaits(delta, elapsed){
  for(let i=baits.length-1;i>=0;i--){
    const b = baits[i];
    let arrived = false;
    for(const z of zombies){
      if(z.dying) continue;
      const d = Math.hypot(z.group.position.x-b.pos.x, z.group.position.z-b.pos.z);
      if(d <= b.radius){
        if(!z.luredBy){
          z.luredBy = b;
          // Cholesterol: everything hurts a guest more while they're gorging on ham. This is
          // the reason to use a weapon that deals no damage of its own.
          z.damageTakenMult = ALL_WEAPONS[b.wIdx].cholesterolMult || 1.35;
        }
        if(!b.eaters.has(z) && d <= 2.2){ b.eaters.add(z); arrived = true; }
      } else if(z.luredBy === b && d > b.radius*1.15){
        z.luredBy = null; z.damageTakenMult = 1;
        b.eaters.delete(z);
      }
    }

    // Only recompute when the split actually changes — i.e. when someone new starts eating.
    if(arrived){
      const remaining = Math.max(0, b.deadline - elapsed);
      const eaters = Math.max(1, b.eaters.size);
      b.deadline = elapsed + remaining/eaters;
    }

    b.plate.rotation.z += delta*0.6;   // lying flat, so spin is about its own normal
    const lifeFrac = Math.max(0, (b.deadline-elapsed)/Math.max(0.001, b.radius));
    b.ring.material.opacity = 0.10 + 0.08*Math.sin(elapsed*3);

    if(elapsed >= b.deadline){
      for(const z of zombies){ if(z.luredBy===b){ z.luredBy=null; z.damageTakenMult=1; } }
      if(b.evolved){
        const mods = player.weaponMods[b.wIdx];
        // Deliberately tight: the blast should catch whoever came to eat, not the street.
        const blastRadius = Math.min(2, 1.6*mods.radiusMult);
        const dmg = (45 + (mods.explosionDamage||0)) * b.dmgMult * mods.dmgMult;
        const bp = new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z);
        weaponExplodeSound(b.wIdx, bp);
        spawnJamonBurst(bp.clone().setY(bp.y + 0.4));
        explodeAt(bp, blastRadius, dmg, true);
      }
      scene.remove(b.plate); scene.remove(b.ring);
      baits.splice(i,1);
    }
  }
}

// ---------- CO2 CANNON / FLAMETHROWER (stream) ----------
let streamParticles = [];
function fireStream(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const dir = forward.clone();
  dir.x += (Math.random()-0.5)*0.06; dir.y += (Math.random()-0.5)*0.05; dir.z += (Math.random()-0.5)*0.06;
  dir.normalize();
  const evolved = !!player.weaponEvolved[wIdx];
  const geo = new THREE.SphereGeometry((w.streamRadius||0.5), 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: evolved ? 0xff7a2a : 0xdfe6ee, transparent:true, opacity:0.5, depthWrite:false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(camera.position).addScaledVector(forward, 0.7);
  scene.add(mesh);
  streamParticles.push({
    mesh, mat, geo, vel: dir.multiplyScalar(w.streamSpeed||16),
    age:0, life:(w.streamLife||1.1)*mods.durationMult,
    baseRadius:(w.streamRadius||0.5)*mods.radiusMult,
    grow:(w.streamGrow||2.6),
    dps:(w.streamDps||11)*mods.dpsMult*dmgMult,
    slow:(w.streamSlow||0.55),
    evolved, burnDmg:(mods.burnDamage||14), burnDur:(mods.burnDuration||2.5),
  });
}

function updateStream(delta, elapsed){
  for(let i=streamParticles.length-1;i>=0;i--){
    const p = streamParticles[i];
    p.age += delta;
    const k = p.age/p.life;
    p.vel.multiplyScalar(Math.pow(0.35, delta));
    p.mesh.position.addScaledVector(p.vel, delta);
    p.mesh.position.y += 0.35*delta;
    // Widens and thins out with distance, which is what sells it as a dispersing cloud.
    const scale = 1 + k*p.grow;
    p.mesh.scale.setScalar(scale);
    p.mat.opacity = 0.5*(1-k);
    // Flame cools back to smoke as it travels.
    if(p.evolved && k > 0.45) p.mat.color.setHex(0xb9b9c2);

    const r = p.baseRadius*scale;
    for(const z of zombies){
      if(z.dying) continue;
      const d = Math.hypot(z.group.position.x-p.mesh.position.x, z.group.position.z-p.mesh.position.z);
      if(d < r+(z.collisionRadius||ZOMBIE_RADIUS)){
        // Damage is applied through the shared DoT gate rather than per particle, or a dense
        // stream would delete everything instantly.
        z.streamUntil = elapsed + 0.25;
        z.streamDps = Math.max(z.streamDps||0, p.dps);
        z.slowUntil = elapsed + 0.5;
        z.slowMult = p.slow;
        if(p.evolved && k <= 0.45){
          z.burnUntil = elapsed + p.burnDur;
          z.burnDps = Math.max(z.burnDps||0, p.burnDmg);
        }
      }
    }
    if(p.age >= p.life){ scene.remove(p.mesh); p.geo.dispose(); p.mat.dispose(); streamParticles.splice(i,1); }
  }
}

// ---------- LASER POINTER (beam) ----------
let beamMesh = null, beamLastTick = -999;
// Holding the beam on one guest winds the damage up; looking away, switching target or
// releasing the trigger drops it straight back to the base rate. This is what turns the laser
// from chip damage into something worth committing to a single target for.
let beamRamp = 1, beamRampTarget = null, beamRampLastSeen = -999;
function fireBeam(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const elapsed = clock.getElapsedTime();
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const zombieMeshes=[]; zombies.forEach(z=>zombieMeshes.push(z.billboard));
  raycaster.set(camera.position, forward); raycaster.far = w.beamRange||60;
  const hits = raycaster.intersectObjects([...zombieMeshes, ...guitarristaTargets(), ...environmentMeshes], true);

  let end = camera.position.clone().addScaledVector(forward, w.beamRange||60);
  let hitZ = null, headshot = false;
  if(hits.length>0){
    end = hits[0].point.clone();
    if(hits[0].object.userData.guitarristaRef){ guitarristaOnShot(); }
    hitZ = hits[0].object.userData.zombieRef || null;
    if(hitZ) headshot = isHeadshotHit(hits[0]);
  }
  drawBeam(camera.position, end);

  // Ticks on its own clock so the damage rate doesn't depend on frame rate.
  if(elapsed - beamLastTick < (w.beamTick||0.05)) return;
  const dtTick = Math.min(0.25, elapsed - beamLastTick);
  beamLastTick = elapsed;
  if(!hitZ) return;
  // Ramp only survives if it's the same body, hit continuously.
  if(hitZ === beamRampTarget && (elapsed - beamRampLastSeen) < 0.25){
    beamRamp = Math.min(BEAM_RAMP_MAX, beamRamp + dtTick/BEAM_RAMP_TIME*(BEAM_RAMP_MAX-1));
  } else {
    beamRamp = 1;
    beamRampTarget = hitZ;
  }
  beamRampLastSeen = elapsed;

  const dps = (w.beamDps||52)*mods.dpsMult*dmgMult;
  const dmg = dps*dtTick*(headshot ? (w.beamHeadMult||2) : 1)*beamRamp;
  const before = hitZ.dying;
  damageZombie(hitZ, dmg, {headshot});
  // Evolved: a lethal hit pops the head.
  if(!before && hitZ.dying && player.weaponEvolved[wIdx]){
    explodeAt(hitZ.group.position.clone().add(new THREE.Vector3(0,(hitZ.height||1.8)*0.85,0)),
      2.4 + (mods.explosionRadius||0), 55 + (mods.explosionDamage||0), true);
  }
}

function resetBeamRamp(){ beamRamp = 1; beamRampTarget = null; }

function drawBeam(from, to){
  if(!beamMesh){
    const geo = new THREE.CylinderGeometry(0.02,0.02,1,6);
    const mat = new THREE.MeshBasicMaterial({ color:0xff3040, transparent:true, opacity:0.85 });
    beamMesh = new THREE.Mesh(geo, mat);
    scene.add(beamMesh);
  }
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if(len < 0.001){ beamMesh.visible = false; return; }
  beamMesh.visible = true;
  beamMesh.scale.set(1, len, 1);
  beamMesh.position.copy(from).add(to).multiplyScalar(0.5);
  beamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  // Shifts red -> white-hot as the ramp builds, so the wind-up is legible without a readout.
  const k = (beamRamp-1)/(BEAM_RAMP_MAX-1);
  beamMesh.material.color.setRGB(1, 0.19 + 0.75*k, 0.25 + 0.7*k);
  beamMesh.scale.set(1 + k*1.2, beamMesh.scale.y, 1 + k*1.2);
  beamMesh.userData.hideAt = clock.getElapsedTime() + 0.08;
}

function updateBeamVisual(){
  if(beamMesh && beamMesh.visible && clock.getElapsedTime() > (beamMesh.userData.hideAt||0)) beamMesh.visible = false;
}

// ---------- CAÑÓN DE CONFETTI ----------
// A crowd-control tool rather than a damage one: everything caught in the cone is shoved out
// to its far edge, which buys space in a way nothing else in the roster does. Damage is
// deliberately modest so it isn't simply a better shotgun.
function fireCone(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  const range = (w.coneRange||5) * mods.radiusMult;
  const halfArc = THREE.MathUtils.degToRad((w.coneAngle||42)/2);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const dmg = effectiveDamage(wIdx)*dmgMult*(isCrit?critMultVal:1);

  let hits = 0;
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(z.dying) continue;
    const to = new THREE.Vector3(z.group.position.x-camera.position.x, 0, z.group.position.z-camera.position.z);
    const d = to.length();
    if(d > range + (z.collisionRadius||ZOMBIE_RADIUS)) continue;
    to.normalize();
    if(Math.acos(THREE.MathUtils.clamp(forward.dot(to),-1,1)) > halfArc) continue;
    // Damage falls off across the cone, but the shove doesn't: the point is to clear the space.
    damageZombie(z, dmg*(1 - 0.35*(d/range)), {crit:isCrit, stagger:true, knockFrom:camera.position});
    // Pushed to the cone's far edge rather than by a fixed amount, so the area really empties.
    const push = Math.max(0, range - d) * (mods.knockbackMult||1);
    pushZombie(z, camera.position, push);
    hits++;
  }
  spawnConeBurst(forward, range, halfArc);
  // Fired from just in front of the camera so it reads as coming out of the barrel.
  spawnConfettiBurst(camera.position.clone().addScaledVector(forward, 0.8).setY(feetY+1.25), forward, range);
  return hits;
}

function spawnConeBurst(forward, range, halfArc){
  const base = Math.max(0.4, range*Math.tan(halfArc));
  const geo = new THREE.ConeGeometry(base, range, 14, 1, true);
  geo.translate(0,-range/2,0);
  const mat = new THREE.MeshBasicMaterial({ color:0xffd45c, transparent:true, opacity:0.4, side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(camera.position.x, feetY+1.1, camera.position.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0), forward.clone().normalize());
  scene.add(mesh);
  const t0 = clock.getElapsedTime();
  const anim = ()=>{
    const k = Math.min(1,(clock.getElapsedTime()-t0)/0.28);
    mat.opacity = 0.4*(1-k);
    if(k<1) requestAnimationFrame(anim);
    else { scene.remove(mesh); geo.dispose(); mat.dispose(); }
  };
  anim();
}

// ---------- CONFETTI: FIESTA TOTAL (evolved) ----------
// The evolution reframes the weapon: instead of a forward cone it becomes a panic button that
// clears space in every direction.
function fireNova(wIdx, dmgMult, isCrit, critMultVal){
  const w = ALL_WEAPONS[wIdx], mods = player.weaponMods[wIdx];
  // Evolving trades the cone for full coverage and more reach, not more damage — as a panic
  // button its value is the space it clears, and it was badly overtuned as a damage option.
  const radius = ((w.coneRange||5) + 2.5) * mods.radiusMult;
  const dmg = effectiveDamage(wIdx)*0.45*dmgMult*(isCrit?critMultVal:1);
  const kb = radius*(mods.knockbackMult||1);
  spawnExplosionVisual(camera.position.clone().setY(feetY+0.9), radius);
  // Full circle, so the confetti goes out in every direction rather than down a lane.
  spawnParticles(camera.position.clone().setY(feetY+1.2), {
    count:120, dir:null, speed:[radius*1.1, radius*1.9], upBias:3.5,
    colors:CONFETTI_COLORS, size:[0.085,0.085], drag:0.05, gravity:2.6, flutter:1.5, life:3.4,
  });
  soundExplosion(0);
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(z.dying) continue;
    const d = Math.hypot(z.group.position.x-camera.position.x, z.group.position.z-camera.position.z);
    if(d > radius) continue;
    damageZombie(z, dmg*(1-d/radius*0.5), {crit:isCrit, stagger:true, knockFrom:camera.position});
    pushZombie(z, camera.position, Math.max(0, radius - d)*(mods.knockbackMult||1));
  }
}

function pushZombie(z, fromPos, distance){
  const dx = z.group.position.x-fromPos.x, dz = z.group.position.z-fromPos.z;
  const d = Math.hypot(dx,dz);
  if(d < 0.001) return;
  const nx = dx/d, nz = dz/d;
  const radius = z.collisionRadius||ZOMBIE_RADIUS;
  if(canMoveToRadius(z.group.position.x, z.group.position.z,
                     z.group.position.x+nx*distance, z.group.position.z+nz*distance, z.feetY+0.9, radius)){
    z.group.position.x += nx*distance; z.group.position.z += nz*distance;
  }
}

// ---------- shared per-frame update ----------
function updateWeddingWeapons(delta, elapsed){
  // Anything other than a held beam on a live target unwinds it.
  if(!mouseDown || ALL_WEAPONS[player.currentWeapon].type !== 'beam' ||
     (elapsed - beamRampLastSeen) > 0.25) resetBeamRamp();
  updateWindSlashes(delta);
  updateBubbles(delta, elapsed);
  updateInfections(delta, elapsed);
  updateBaits(delta, elapsed);
  updateStream(delta, elapsed);
  updateBeamVisual();
}
