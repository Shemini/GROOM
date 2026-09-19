"use strict";
// =================================================================
// PARTICLES
//
// Small flat quads — no textures needed for either effect. Everything comes from one fixed
// pool: a burst borrows what it needs and returns it, so however fast the player fires, the
// object count and draw calls stay flat instead of growing without limit.
//
// Particles land on the floor and settle rather than falling forever. They deliberately don't
// test against walls: that would be a raycast per particle per frame, and at these sizes and
// speeds nobody notices a stray piece of confetti clipping a doorway.
//
// They're added to the main scene, so they go through the same pixelation and colour grading
// as everything else.
// =================================================================

const PARTICLE_POOL_SIZE = 420;
let particlePool = [];
let particleGeo = null;

function initParticles(){
  if(particlePool.length) return;
  particleGeo = new THREE.PlaneGeometry(1, 1);
  for(let i=0;i<PARTICLE_POOL_SIZE;i++){
    // A material each so colours can differ per piece; the geometry is shared.
    const mat = new THREE.MeshBasicMaterial({
      color:0xffffff, side:THREE.DoubleSide, transparent:true, opacity:1, depthWrite:false,
    });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    particlePool.push({ mesh, mat, active:false, vel:new THREE.Vector3(),
      age:0, life:1, spin:new THREE.Vector3(), drag:1, flutter:0, landed:false, groundY:0 });
  }
}

function takeParticle(){
  for(let i=0;i<particlePool.length;i++) if(!particlePool[i].active) return particlePool[i];
  return null;   // pool exhausted: drop the piece rather than allocating
}

// origin      THREE.Vector3
// opts.count  how many to try for (silently fewer if the pool is busy)
// opts.dir    cone axis, or null for an even sphere
// opts.spread cone half-angle in radians
// opts.speed  [min,max] initial speed
// opts.colors array to pick from
// opts.size   [w,h] of each quad
// opts.drag   per-second velocity retention (1 = none)
// opts.flutter sideways drift, for things that catch the air
function spawnParticles(origin, opts){
  initParticles();
  const count = opts.count || 20;
  const colors = opts.colors || [0xffffff];
  const size = opts.size || [0.09, 0.09];
  const speed = opts.speed || [4, 9];
  const groundY = (opts.groundY !== undefined) ? opts.groundY
                : (getFloorY(origin.x, origin.z, origin.y + 2) ?? (origin.y - 2));

  for(let i=0;i<count;i++){
    const p = takeParticle();
    if(!p) break;

    let dir;
    if(opts.dir){
      // Random direction inside a cone about `dir`.
      const axis = opts.dir.clone().normalize();
      const spread = opts.spread || 0.4;
      const a = Math.acos(1 - Math.random()*(1-Math.cos(spread)));
      const b = Math.random()*Math.PI*2;
      const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const right = new THREE.Vector3().crossVectors(axis, ref).normalize();
      const up = new THREE.Vector3().crossVectors(right, axis).normalize();
      dir = axis.clone().multiplyScalar(Math.cos(a))
        .addScaledVector(right, Math.sin(a)*Math.cos(b))
        .addScaledVector(up, Math.sin(a)*Math.sin(b)).normalize();
    } else {
      // Even spread over a sphere — using acos here avoids the clustering at the poles that
      // naive random angles produce.
      const z = Math.random()*2 - 1, t = Math.random()*Math.PI*2, r = Math.sqrt(1-z*z);
      dir = new THREE.Vector3(r*Math.cos(t), z, r*Math.sin(t));
    }

    const spd = speed[0] + Math.random()*(speed[1]-speed[0]);
    p.vel.copy(dir).multiplyScalar(spd);
    if(opts.upBias) p.vel.y += opts.upBias;

    p.mesh.scale.set(size[0]*(0.7+Math.random()*0.6), size[1]*(0.7+Math.random()*0.6), 1);
    p.mesh.position.copy(origin);
    p.mesh.rotation.set(Math.random()*6.28, Math.random()*6.28, Math.random()*6.28);
    p.mat.color.setHex(colors[Math.floor(Math.random()*colors.length)]);
    p.mat.opacity = 1;
    p.mesh.visible = true;

    p.spin.set((Math.random()-0.5)*14, (Math.random()-0.5)*14, (Math.random()-0.5)*14);
    p.drag = (opts.drag !== undefined) ? opts.drag : 1;
    p.flutter = opts.flutter || 0;
    p.gravity = (opts.gravity !== undefined) ? opts.gravity : GRAVITY;
    p.life = (opts.life || 3) * (0.8 + Math.random()*0.4);
    p.age = 0;
    p.landed = false;
    p.groundY = groundY;
    p.phase = Math.random()*6.28;
    p.active = true;
  }
}

function updateParticles(delta, elapsed){
  if(!particlePool.length) return;
  for(let i=0;i<particlePool.length;i++){
    const p = particlePool[i];
    if(!p.active) continue;
    p.age += delta;

    if(!p.landed){
      if(p.drag !== 1) p.vel.multiplyScalar(Math.pow(p.drag, delta));
      p.vel.y -= p.gravity*delta;
      // Flutter makes light pieces drift sideways as they settle, instead of dropping like
      // stones — it's what separates confetti from debris.
      if(p.flutter){
        p.mesh.position.x += Math.sin(elapsed*3 + p.phase)*p.flutter*delta;
        p.mesh.position.z += Math.cos(elapsed*2.4 + p.phase)*p.flutter*delta;
      }
      p.mesh.position.addScaledVector(p.vel, delta);
      p.mesh.rotation.x += p.spin.x*delta;
      p.mesh.rotation.y += p.spin.y*delta;
      p.mesh.rotation.z += p.spin.z*delta;

      if(p.mesh.position.y <= p.groundY + 0.02){
        // Settle flat on the floor and stop simulating.
        p.mesh.position.y = p.groundY + 0.02;
        p.mesh.rotation.set(-Math.PI/2, 0, Math.random()*6.28);
        p.landed = true;
      }
    }

    // Fade over the last third of its life, whether airborne or settled.
    const fadeFrom = p.life*0.66;
    p.mat.opacity = (p.age < fadeFrom) ? 1 : Math.max(0, 1 - (p.age-fadeFrom)/(p.life-fadeFrom));

    if(p.age >= p.life){
      p.active = false;
      p.mesh.visible = false;
    }
  }
}

// ---------- presets ----------
const CONFETTI_COLORS = [0xff4d6d, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388ff, 0xff9f1c, 0xffffff];
const JAMON_COLORS    = [0x7a1220, 0x8e1b28, 0x5e0d18, 0xa02a33, 0x6b1018];

// Fired forward from the muzzle: fast out, heavy drag, then a slow fluttering fall.
function spawnConfettiBurst(origin, dir, range){
  spawnParticles(origin, {
    count: 90,
    dir, spread: 0.38,
    speed: [range*2.2, range*3.4],
    colors: CONFETTI_COLORS,
    size: [0.085, 0.085],
    drag: 0.02,          // sheds nearly all its speed within a metre or so
    gravity: 2.6,        // light: it drifts down rather than dropping
    flutter: 1.5,
    life: 3.2,
  });
}

// Thrown out in every direction and dropping properly, like wet debris.
function spawnJamonBurst(origin){
  spawnParticles(origin, {
    count: 46,
    dir: null,           // full sphere
    speed: [3.5, 8.5],
    upBias: 2.2,
    colors: JAMON_COLORS,
    size: [0.14, 0.075], // rectangular slices rather than squares
    drag: 0.55,
    gravity: GRAVITY,
    life: 2.6,
  });
}
