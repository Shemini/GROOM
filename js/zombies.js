"use strict";
// ZOMBIES
// =================================================================
let billboardGeometry = null;
let blobShadowGeometry = null;
function getBillboardGeometry(){
  if(!billboardGeometry) billboardGeometry = new THREE.PlaneGeometry(1,1);
  return billboardGeometry;
}
function getBlobShadowGeometry(){
  if(!blobShadowGeometry) blobShadowGeometry = new THREE.CircleGeometry(0.5,16);
  return blobShadowGeometry;
}

// A flat plane manually rotated to face the camera around the vertical axis only (unlike
// THREE.Sprite, which always fully faces the camera on all axes and therefore could never
// show a side/back view). This is also what makes shadow casting/receiving possible at all —
// Sprite objects are excluded from three.js's shadow map pass entirely.
function createZombieVisual(heightWorld, widthWorld){
  const group = new THREE.Group();
  // Each zombie needs its own Texture instance (not the shared source) since offset/repeat
  // drive its individual animation frame — cloning is cheap, it references the same
  // already-uploaded image data rather than duplicating it.
  const tex = zombieSpriteTexture.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1/SPRITE_COLS, 1/SPRITE_ROWS);
  tex.offset.set(0, 1-1/SPRITE_ROWS); // row 0 ("walk toward"), frame 0
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent:true, alphaTest:0.5, color:0xffffff, side:THREE.DoubleSide });
  const billboard = new THREE.Mesh(getBillboardGeometry(), mat);
  billboard.scale.set(widthWorld, heightWorld, 1);
  billboard.position.y = heightWorld/2; // group.position tracks feet; billboard is centered above it
  billboard.castShadow = true;
  billboard.frustumCulled = false;
  billboard.receiveShadow = true;
  group.add(billboard);

  const shadowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(settings.contactShadowColor), transparent:true,
    opacity: settings.contactShadowOpacity, depthWrite:false,
  });
  const blob = new THREE.Mesh(getBlobShadowGeometry(), shadowMat);
  blob.rotation.x = -Math.PI/2;
  blob.renderOrder = 1;
  group.add(blob);

  return { group, billboard, blob };
}

function isSpawnPointHidden(x,z){
  const camPos = camera.position;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y=0; forward.normalize();
  const toPoint = new THREE.Vector3(x-camPos.x,0,z-camPos.z);
  const dist = toPoint.length();
  toPoint.normalize();
  const dot = THREE.MathUtils.clamp(forward.dot(toPoint),-1,1);
  const angle = Math.acos(dot);
  if(angle > THREE.MathUtils.degToRad(55)) return true;
  raycaster.set(camPos, toPoint);
  raycaster.far = dist-0.5;
  return raycaster.intersectObjects(environmentMeshes,false).length>0;
}

function findSpawnPosition(){
  const camPos = camera.position;
  const minR=10, maxR=20;
  for(let i=0;i<24;i++){
    const angle = Math.random()*Math.PI*2;
    const r = minR+Math.random()*(maxR-minR);
    const x = camPos.x+Math.cos(angle)*r, z = camPos.z+Math.sin(angle)*r;
    const fy = getFloorY(x,z, levelMaxY);
    if(fy===null) continue;
    if(isSpawnPointHidden(x,z)) return new THREE.Vector3(x,fy,z);
  }
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y=0; forward.normalize();
  const x = camPos.x-forward.x*14, z = camPos.z-forward.z*14;
  const fy = getFloorY(x,z, levelMaxY);
  return new THREE.Vector3(x, fy!==null?fy:camPos.y-EYE_HEIGHT, z);
}

function spawnZombie(){
  const pos = findSpawnPosition();

  const heightMult = 1 + (Math.random()-0.5)*ZOMBIE_HEIGHT_VARIATION;
  const zHeight = AVG_ZOMBIE_HEIGHT*heightMult;
  const spriteAspect = (zombieSpriteTexture && zombieSpriteTexture.image)
    ? (zombieSpriteTexture.image.width/SPRITE_COLS) / (zombieSpriteTexture.image.height/SPRITE_ROWS)
    : 0.5;
  const zWidth = AVG_ZOMBIE_HEIGHT*spriteAspect; // width stays fixed — only height varies per zombie
  const collisionRadius = (zWidth*HITBOX_WIDTH_FRACTION)/2;

  const { group, billboard, blob } = createZombieVisual(zHeight, zWidth);
  group.position.copy(pos);
  scene.add(group);
  const blobRadius = collisionRadius*1.6;
  blob.scale.set(blobRadius, blobRadius, 1);
  blob.position.set(0, 0.02, 0);

  const intensity = statValue('enemyIntensity');
  const hpBase = (55+wave.number*14)*(1+intensity*0.06);
  const speed = (1.5+Math.min(wave.number*0.06,1.5)+Math.random()*0.35)*(1+intensity*0.06)*ZOMBIE_SPEED_MULT;
  const z = {
    group, billboard, blob, hp:hpBase, maxHp:hpBase, speed, dmg:8+Math.min(wave.number,10),
    lastAttack:-999, groanTimer:1+Math.random()*3,
    losTimer:Math.random()*0.3, hasLOS:false, unstickUntil:-999, unstickSign:1,
    flashTimer:0, flashActive:false, staggerTimer:0, dot:null, stain:null, periodicTickTimer:0,
    feetY: pos.y, velY: 0, airborne: 0, height:zHeight, width:zWidth, collisionRadius, facingAngle:0,
    animRow: ANIM_ROW_WALK_TOWARD, animFrame: 0, animTimer: Math.random()*ANIM_FRAME_DURATION,
    attacking: false, movingToward: true, dying: false, deathAnimDone: false,
    calloutLastTime: -999, wasInCalloutRange: false,
    stuckCheckTimer: 1.5+Math.random()*0.4, stuckCheckPos: { x: pos.x, z: pos.z },
  };
  billboard.userData.zombieRef=z;
  zombies.push(z);
  wave.spawned++;
}

// Keeps every zombie's flat billboard facing the camera around the vertical axis only
// (cylindrical billboarding) so it always reads as a proper sprite instead of going edge-on,
// and keeps the ground contact-shadow decal glued to its feet.
// z.group never rotates (only its position tracks feet), so this world-space angle can be
// assigned directly to the billboard's local rotation with no parent-rotation compensation —
// movement facing is tracked separately via z.facingAngle, decoupled from this entirely.
function updateBillboards(){
  for(const z of zombies){
    const dx = camera.position.x - z.group.position.x;
    const dz = camera.position.z - z.group.position.z;
    z.billboard.rotation.y = Math.atan2(dx, dz);
  }
}


// recomputePath() is gone: with a flow field there is no per-zombie route to compute, store
// or expire. Steering is a per-frame lookup of "which neighbouring cell is closer to the
// player", which is why the oscillation / backtracking / stalling failures disappear.

let fellThroughWarnings = 0;
function updateZombies(delta, elapsed){
  updateFlowField(); // one shared solve per frame at most, reused by every zombie below
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(z.flashActive){
      z.flashTimer -= delta;
      if(z.flashTimer<=0){ z.billboard.material.color.setHex(0xffffff); z.flashActive=false; }
    }
    if(z.dying) continue;
    if(z.staggerTimer>0){ z.staggerTimer -= delta; continue; }

    let pulled=false;
    for(const v of vortexFields){
      const vd = Math.hypot(z.group.position.x-v.pos.x, z.group.position.z-v.pos.z);
      if(vd<v.radius && vd>0.05){
        const nx=(v.pos.x-z.group.position.x)/vd, nz=(v.pos.z-z.group.position.z)/vd;
        z.group.position.x += nx*v.pull*delta; z.group.position.z += nz*v.pull*delta;
        z.facingAngle = Math.atan2(nx,nz); // stored for future facing-based texture selection; billboard rotation is independent
        z.attacking = false; z.movingToward = true;
        pulled=true; break;
      }
    }
    if(!pulled){
      for(const b of blackHoles){
        if(b.phase!=='active') continue;
        const dx=b.pos.x-z.group.position.x, dz=b.pos.z-z.group.position.z;
        const dist=Math.hypot(dx,dz);
        if(dist<0.05) continue;
        const dir=new THREE.Vector3(dx,0,dz).normalize();
        raycaster.set(z.group.position.clone().setY(z.feetY+0.9), dir); raycaster.far=dist;
        const blocked = raycaster.intersectObjects(environmentMeshes,false).length>0;
        if(!blocked){
          const nx=dx/dist, nz=dz/dist;
          z.group.position.x += nx*(z.speed*1.3)*delta; z.group.position.z += nz*(z.speed*1.3)*delta;
          z.facingAngle = Math.atan2(nx,nz); // stored for future facing-based texture selection; billboard rotation is independent
          z.attacking = false; z.movingToward = true;
          pulled=true; break;
        }
      }
    }
    if(pulled) continue;

    const distToPlayer = Math.hypot(camera.position.x-z.group.position.x, camera.position.z-z.group.position.z);
    // Melee needs vertical proximity too. Measuring range on the horizontal plane alone meant
    // anything directly below or above the player could still land hits from any depth.
    const vertGap = Math.abs(z.feetY - feetY);
    const inMeleeRange = distToPlayer <= 1.0 && vertGap < 2.0;

    // Direct approach whenever there's a clear straight line to the player. This is what
    // makes the last stretch look natural: the flow field steps cell-to-cell, which reads as
    // slightly indirect up close, and it also means a zombie never walks "past" the player to
    // reach a cell centre. Throttled per zombie since it costs a raycast.
    z.losTimer -= delta;
    if(z.losTimer<=0){
      z.losTimer = 0.3+Math.random()*0.2;
      z.hasLOS = distToPlayer < 30 && canMoveToRadius(
        z.group.position.x, z.group.position.z,
        camera.position.x, camera.position.z,
        z.feetY+0.9, z.collisionRadius||ZOMBIE_RADIUS);
    }

    let targetX, targetZ;
    if(z.hasLOS){
      targetX = camera.position.x; targetZ = camera.position.z;
    } else {
      const step = flowFieldTarget(z.group.position.x, z.group.position.z);
      if(step){ targetX = step.x; targetZ = step.z; }
      else { targetX = camera.position.x; targetZ = camera.position.z; }
    }

    if(!inMeleeRange){
      z.attacking = false;
      const dx=targetX-z.group.position.x, dz=targetZ-z.group.position.z;
      const d=Math.hypot(dx,dz);
      if(d>0.0001){
        let nx=dx/d, nz=dz/d;
        // While unsticking, veer ~60 degrees off the intended heading so the zombie slides
        // out along the surface it's caught on instead of pressing straight into it.
        if(elapsed < z.unstickUntil){
          const a = z.unstickSign * Math.PI/3;
          const ca = Math.cos(a), sa = Math.sin(a);
          const rx = nx*ca - nz*sa, rz = nx*sa + nz*ca;
          nx = rx; nz = rz;
        }
        const chestY = z.feetY+0.9;
        const resolved = resolveSlide(z.group.position.x, z.group.position.z, nx*z.speed*delta, nz*z.speed*delta, chestY, z.collisionRadius||ZOMBIE_RADIUS, z.feetY);
        let px = resolved.x, pz = resolved.z;
        // Floor resolution with fall-through protection. The raycast only looks 2.2m above
        // the zombie's feet, so a single frame where it finds nothing used to begin an
        // unrecoverable fall: once it dropped past that reach, the floor was permanently out
        // of range and it fell forever — invisible beneath the map, yet still chasing and
        // attacking, because range is measured horizontally. The nav grid holds a verified
        // floor height per open cell, so it stands in whenever the ray comes up empty.
        let fy = getFloorY(px,pz, z.feetY+2.2);
        if(fy===null) fy = navFloorAt(px,pz);
        if(fy!==null && (z.feetY-fy) <= STEP_SMOOTH_MAX){
          z.feetY += (fy-z.feetY)*Math.min(1,delta*10);
          z.velY = 0; z.airborne = 0;
        } else {
          z.velY = (z.velY||0) - GRAVITY*delta;
          z.feetY += z.velY*delta;
          if(fy!==null && z.feetY<=fy){ z.feetY = fy; z.velY = 0; z.airborne = 0; }
          else {
            // Legitimate ledge drops land well inside this window (a 4m fall takes ~0.6s),
            // so exceeding it means it has left the world rather than jumped down something.
            z.airborne = (z.airborne||0) + delta;
            if(z.airborne > 1.5){
              const rescue = nearestNavFloor(z.group.position.x, z.group.position.z);
              if(rescue){
                px = rescue.x; pz = rescue.z;
                z.feetY = rescue.y; z.velY = 0; z.airborne = 0;
                if(fellThroughWarnings < 5){
                  fellThroughWarnings++;
                  console.warn('Zombie fell out of the world and was returned to the nav mesh.');
                }
              }
            }
          }
        }
        z.group.position.set(px, z.feetY, pz);
        z.facingAngle = Math.atan2(nx,nz); // stored for future facing-based texture selection; billboard rotation is independent
        // Row selection compares actual movement direction against the direction to the
        // player — a positive dot product means this step is carrying it toward the player
        // (even while routing around an obstacle it's still usually net-toward), negative
        // means it's momentarily moving away.
        const toPlayerX = camera.position.x-z.group.position.x, toPlayerZ = camera.position.z-z.group.position.z;
        const toPlayerLen = Math.hypot(toPlayerX,toPlayerZ);
        if(toPlayerLen>0.0001){
          const dot = nx*(toPlayerX/toPlayerLen) + nz*(toPlayerZ/toPlayerLen);
          z.movingToward = dot>=0;
        }
      }

      // Stuck detection. There's no per-zombie route to rebuild any more, so a zombie that
      // isn't progressing is wedged on local geometry rather than mis-routed. Nudge it
      // sideways for a moment to break the symmetry that's holding it against the surface;
      // the flow field will resume steering it normally straight afterwards.
      z.stuckCheckTimer -= delta;
      if(z.stuckCheckTimer<=0){
        const progressed = Math.hypot(z.group.position.x-z.stuckCheckPos.x, z.group.position.z-z.stuckCheckPos.z);
        if(progressed < 0.5){
          z.unstickUntil = elapsed + 0.5;
          z.unstickSign = Math.random()<0.5 ? -1 : 1;
        }
        z.stuckCheckPos.x = z.group.position.x; z.stuckCheckPos.z = z.group.position.z;
        z.stuckCheckTimer = 1.5+Math.random()*0.4;
      }
    } else {
      z.attacking = true;
      if(elapsed-z.lastAttack>1.0){
        z.lastAttack = elapsed;
        takeDamage(z.dmg);
        if(attackSoundLimiter(elapsed)) playEnemyClip('attack', computePan(z.group.position), 0.6);
      }
    }

    z.groanTimer -= delta;
    if(z.groanTimer<=0 && distToPlayer<24){ playEnemyClip('passive', computePan(z.group.position), 0.4); z.groanTimer=4+Math.random()*5; }

    if(distToPlayer < CALLOUT_RANGE){
      if(!z.wasInCalloutRange){
        if(elapsed - z.calloutLastTime >= CALLOUT_COOLDOWN && calloutSoundLimiter(elapsed)){
          playEnemyClip('callout', computePan(z.group.position), 0.45);
          z.calloutLastTime = elapsed;
        }
        z.wasInCalloutRange = true;
      }
    } else {
      z.wasInCalloutRange = false;
    }
  }

  // Unlike normal movement, this push had no wall awareness at all — in a crowded corner or
  // doorway (exactly where stragglers were getting stuck) it could shove a zombie straight
  // into geometry, and once embedded, ordinary collision-checked movement often couldn't work
  // its way back out. Validated via the precomputed nav grid (a cheap array lookup) rather
  // than a live raycast — a raycast per pair here scales as O(n^2) with zombie count and was
  // very likely the actual cause of movement feeling more sluggish the more enemies were alive.
  for(let i=0;i<zombies.length;i++){
    for(let j=i+1;j<zombies.length;j++){
      const a=zombies[i], b=zombies[j];
      if(a.dying || b.dying) continue;
      const dx=b.group.position.x-a.group.position.x, dz=b.group.position.z-a.group.position.z;
      const dist=Math.hypot(dx,dz);
      const minDist=(a.collisionRadius||ZOMBIE_RADIUS)+(b.collisionRadius||ZOMBIE_RADIUS);
      if(dist<minDist && dist>0.0001){
        const overlap=(minDist-dist)/2, nx=dx/dist, nz=dz/dist;
        const aNewX=a.group.position.x-nx*overlap, aNewZ=a.group.position.z-nz*overlap;
        const bNewX=b.group.position.x+nx*overlap, bNewZ=b.group.position.z+nz*overlap;
        if(!isPositionBlocked(aNewX,aNewZ)){ a.group.position.x=aNewX; a.group.position.z=aNewZ; }
        if(!isPositionBlocked(bNewX,bNewZ)){ b.group.position.x=bNewX; b.group.position.z=bNewZ; }
      }
    }
  }
}

// Advances each zombie's current animation frame and picks which row to show:
// dying > attacking (punch, overrides movement) > walking toward/away from the player.
// Once the (non-looping) death row finishes playing, this performs the actual scene removal —
// killZombie() only marks a zombie as dying, it doesn't remove it, so the death animation
// always gets to play out fully first.
function updateZombieAnimations(delta){
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    const targetRow = z.dying ? ANIM_ROW_DEATH : (z.attacking ? ANIM_ROW_ATTACK : (z.movingToward ? ANIM_ROW_WALK_TOWARD : ANIM_ROW_WALK_AWAY));

    if(targetRow !== z.animRow){
      z.animRow = targetRow;
      z.animFrame = 0;
      z.animTimer = 0;
      const tex = z.billboard.material.map;
      tex.offset.set(z.animFrame/SPRITE_COLS, 1-(z.animRow+1)/SPRITE_ROWS);
    }

    z.animTimer -= delta;
    while(z.animTimer<=0){
      z.animTimer += ANIM_FRAME_DURATION;
      if(z.animRow===ANIM_ROW_DEATH){
        if(z.animFrame<SPRITE_COLS-1) z.animFrame++;
        else { z.deathAnimDone = true; break; }
      } else {
        z.animFrame = (z.animFrame+1) % SPRITE_COLS;
      }
      const tex = z.billboard.material.map;
      tex.offset.set(z.animFrame/SPRITE_COLS, 1-(z.animRow+1)/SPRITE_ROWS);
    }

    if(z.dying && z.deathAnimDone){
      scene.remove(z.group);
      zombies.splice(i,1);
    }
  }
}

function updateStatusEffects(delta, elapsed){
  for(let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if(z.dot && elapsed>=z.dot.endTime) z.dot=null;
    if(z.stain && elapsed>=z.stain.endTime) z.stain=null;
    if(z.stain){
      z.stain.trailTimer -= delta;
      if(z.stain.trailTimer<=0){ spawnPuddle(z.group.position, 1.2, z.stain.dps, 2, false); z.stain.trailTimer=0.3; }
    }
    z.periodicTickTimer -= delta;
    if(z.periodicTickTimer>0) continue;
    let bestDps=0, bestPuddle=null, source=null;
    for(const pd of puddles){
      const d = Math.hypot(z.group.position.x-pd.pos.x, z.group.position.z-pd.pos.z);
      if(d<pd.radius && pd.dps>bestDps){ bestDps=pd.dps; bestPuddle=pd; source='puddle'; }
    }
    if(z.dot && z.dot.dps>bestDps){ bestDps=z.dot.dps; source='dot'; }
    if(z.stain && z.stain.dps>bestDps){ bestDps=z.stain.dps; source='stain'; }
    if(bestDps>0){
      const killed = damageZombie(z, bestDps*0.25, {});
      z.periodicTickTimer=0.25;
      if(source==='puddle' && bestPuddle.stains && !killed){
        z.stain = { dps:bestPuddle.stainDps, endTime:elapsed+bestPuddle.stainDuration, trailTimer:(z.stain?z.stain.trailTimer:0.3) };
      }
    }
  }
}

function triggerZombieFlash(z){
  z.billboard.material.color.setHex(0xff3030);
  z.flashTimer=0.12; z.flashActive=true;
}
function damageZombie(z, amount, opts){
  opts = opts||{};
  if(!z || z.dying) return true; // already dead/dying — treat as handled, no further effects
  if(amount<=0) return false;
  z.hp -= amount;
  triggerZombieFlash(z);
  spawnDamageNumber(z.group.position.clone().add(new THREE.Vector3(0,(z.height||1.7)*0.9,0)), Math.round(amount), !!opts.crit);
  if(opts.stagger){
    z.staggerTimer = STAGGER_DURATION;
    if(opts.knockFrom){
      const dx=z.group.position.x-opts.knockFrom.x, dz=z.group.position.z-opts.knockFrom.z;
      const d=Math.hypot(dx,dz);
      if(d>0.001){
        const nx=dx/d, nz=dz/d;
        const radius = z.collisionRadius||ZOMBIE_RADIUS;
        if(canMoveToRadius(z.group.position.x,z.group.position.z,z.group.position.x+nx*KNOCKBACK_DIST,z.group.position.z+nz*KNOCKBACK_DIST,z.feetY+0.9,radius)){
          z.group.position.x += nx*KNOCKBACK_DIST; z.group.position.z += nz*KNOCKBACK_DIST;
        }
      }
    }
  }
  if(z.hp<=0){ killZombie(z, !!opts.headshot); return true; }
  return false;
}
// Rewards (money/XP/drops) still fire the instant a kill is confirmed, same as before — only
// the actual removal from the scene is deferred, until the death animation has played through.
// updateZombieAnimations() performs the real cleanup once z.deathAnimDone is set.
function killZombie(z, headshot){
  if(z.dying) return; // guard against a second damage source killing the same corpse
  z.dying = true;
  z.deathAnimDone = false;
  soundDeath(computePan(z.group.position));
  if(Math.random()<0.6 && dyingSoundLimiter(clock.getElapsedTime())){
    playEnemyClip('dying', computePan(z.group.position), 0.55);
  }
  const rewardMult = 1+statValue('enemyIntensity')*0.15;
  addMoney((10+Math.floor(Math.random()*8)+(headshot?8:0))*rewardMult);
  addXP((14+wave.number*1.4)*rewardMult);
  player.kills++;
  wave.killedThisWave++;
  const dropIdx = wave.dropSchedule.findIndex(d=>d.killIndex===wave.killedThisWave);
  if(dropIdx!==-1){
    const drop = wave.dropSchedule[dropIdx];
    wave.dropSchedule.splice(dropIdx,1);
    spawnDropPickup(z.group.position.clone(), drop.type);
  }
}

// =================================================================
// ENEMY DROPS
// =================================================================
function scheduleDrops(){
  wave.dropSchedule=[]; wave.killedThisWave=0;
  const dropCount = 1+(Math.random()<0.5?1:0);
  const used = new Set();
  for(let i=0;i<dropCount;i++){
    let idx, tries=0;
    do { idx = 1+Math.floor(Math.random()*Math.max(1,wave.toSpawn)); tries++; } while(used.has(idx)&&tries<10);
    used.add(idx);
    wave.dropSchedule.push({ killIndex:idx, type: DROP_TYPES[Math.floor(Math.random()*DROP_TYPES.length)] });
  }
}
function spawnDropPickup(pos, type){
  const color = DROP_COLORS[type];
  const geo = new THREE.OctahedronGeometry(0.3,0);
  const mat = new THREE.MeshStandardMaterial({ color, emissive:color, emissiveIntensity:1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, pos.y+0.9, pos.z);
  scene.add(mesh);
  const light = new THREE.PointLight(color,1,6);
  mesh.add(light);
  drops.push({ mesh, type, pos:{x:pos.x,z:pos.z}, baseY:pos.y+0.9, phase:Math.random()*10, expiresAt:clock.getElapsedTime()+DROP_LIFETIME });
}
function applyDrop(type){
  switch(type){
    case 'ammo':
      player.slots.forEach(wIdx=>{
        if(wIdx===null) return;
        const mods = player.weaponMods[wIdx];
        if(mods.noReload) player.ammoByWeapon[wIdx].mag = effectiveMag(wIdx);
        else player.ammoByWeapon[wIdx] = { mag:effectiveMag(wIdx), reserve:effectiveReserve(wIdx) };
      });
      showWaveBanner('DROP','Ammo Refilled'); break;
    case 'health': player.health = player.maxHealth; showWaveBanner('DROP','Health Restored'); break;
    case 'double': player.doubleUntil = clock.getElapsedTime()+20; showWaveBanner('DROP','2x Money & XP — 20s'); break;
    case 'instakill':
      for(let i=zombies.length-1;i>=0;i--) damageZombie(zombies[i], 99999, {});
      showWaveBanner('DROP','INSTAKILL!'); break;
  }
  updateHUD();
}
function updateDrops(delta, elapsed){
  for(let i=drops.length-1;i>=0;i--){
    const d = drops[i];
    d.mesh.rotation.y += delta*2;
    d.mesh.position.y = d.baseY + Math.sin(elapsed*3+d.phase)*0.15;
    const timeLeft = d.expiresAt-elapsed;
    d.mesh.visible = timeLeft>3 || Math.floor(elapsed*8)%2===0;
    if(timeLeft<=0){ scene.remove(d.mesh); drops.splice(i,1); continue; }
    const dist = Math.hypot(camera.position.x-d.pos.x, camera.position.z-d.pos.z);
    if(dist<1.3){ applyDrop(d.type); soundDropPickup(); scene.remove(d.mesh); drops.splice(i,1); }
  }
}

// =================================================================
