"use strict";
// ASSET LOADING
// =================================================================
function flattenMaterials(root){
  root.traverse(o=>{
    if(!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const flat = mats.map(m=>new THREE.MeshBasicMaterial({
      map: m.map||null, color: m.color?m.color.clone():new THREE.Color(0xffffff),
      transparent:false, opacity:1, depthWrite:true, depthTest:true, side:THREE.FrontSide,
    }));
    o.material = Array.isArray(o.material) ? flat : flat[0];
  });
}

function loadModel(name, onDone, onProgress, onFail){
  const fbxLoader = new THREE.FBXLoader();
  fbxLoader.load('./'+name+'.fbx',
    object => onDone(object),
    xhr => { if(xhr.total) onProgress(xhr.loaded/xhr.total); },
    () => {
      const gltfLoader = new THREE.GLTFLoader();
      gltfLoader.load('./'+name+'.glb',
        gltf => onDone(gltf.scene),
        xhr => { if(xhr.total) onProgress(xhr.loaded/xhr.total); },
        err => onFail(err)
      );
    }
  );
}

// =================================================================
function loadAssets(){
  let envDone=false, colDone=false, spriteDone=false, guitarSpriteDone=false, envProgress=0, colProgress=0;

  function updateBar(){
    const pct = Math.round(((envProgress+colProgress)/2)*100);
    loadingFill.style.width = pct+'%';
    loadingLabel.textContent = pct+'%' + (envDone && !colDone ? ' — collision mesh' : (!envDone ? ' — environment' : ''));
  }

  new THREE.TextureLoader().load('./TrajeA.png', tex=>{
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false; // mipmaps would blur in neighboring spritesheet frames at a distance
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    zombieSpriteTexture = tex;
    spriteDone = true;
    tryFinishLoading();
  }, undefined, err=>{ console.error('Enemy sprite load failed', err); loadingLabel.textContent='Failed to load enemy sprite (TrajeA.png) — see console.'; });

  new THREE.TextureLoader().load('./Guitarrista.png', tex=>{
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false; // mipmaps blur neighbouring spritesheet frames at a distance
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    guitarristaSpriteTexture = tex;
    guitarSpriteDone = true;
    tryFinishLoading();
  }, undefined, err=>{
    console.warn('Guitarrista.png not found — falling back to the TrajeA sheet for him.', err);
    guitarristaSpriteTexture = null;
    guitarSpriteDone = true;
    tryFinishLoading();
  });

  loadMinimap(); // doesn't gate game start — the minimap just stays blank until it's ready
  loadMinimapImage();

  loadModel('Collision', root=>{
    root.scale.set(SCALE_CORRECTION, SCALE_CORRECTION, SCALE_CORRECTION);
    root.updateMatrixWorld(true);
    root.traverse(o=>{ if(o.isMesh){ o.visible=false; o.frustumCulled=false; collisionMeshes.push(o); } });
    scene.add(root);
    colDone=true; colProgress=1; updateBar();
    tryFinishLoading();
  }, p=>{ colProgress=p; updateBar(); },
  err=>{ console.error('Collision load failed', err); loadingLabel.textContent='Failed to load collision mesh — see console.'; });

  loadModel('Environment', root=>{
    root.scale.set(SCALE_CORRECTION, SCALE_CORRECTION, SCALE_CORRECTION);
    root.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.castShadow=true; environmentMeshes.push(o); } });
    flattenMaterials(root);
    scene.add(root);
    envDone=true; envProgress=1; updateBar();
    tryFinishLoading();
  }, p=>{ envProgress=p; updateBar(); },
  err=>{ console.error('Environment load failed', err); loadingLabel.textContent='Failed to load environment — see console.'; });

  function tryFinishLoading(){
    if(!envDone || !colDone || !spriteDone || !guitarSpriteDone) return;
    loadingLabel.textContent = 'Preparing level...';
    setTimeout(()=>{
      buildCollisionAccel();
      buildNavGrid();
      configureSunShadow();
      placePlayerAtStart();
      placeStationsAndBox();
      spawnGuitarrista();
      gameState = 'menu';
      loadingLabel.textContent = 'Ready';
      startBtn.classList.remove('hidden');
    }, 10);
  }
}

// =================================================================
// COLLISION / MOVEMENT HELPERS (shared by player and zombies)
// =================================================================
// =================================================================
// COLLISION ACCELERATION
// three.js has no spatial index, so every raycast tests every triangle in the collision mesh.
// Floor queries are by far the most frequent thing we do (one per nav-grid cell at load, then
// one per zombie per frame at runtime), so the triangles get bucketed by XZ once up front.
// A query then only tests the handful of triangles in its own bucket instead of all of them.
// =================================================================
let triVerts = null;        // Float32Array, 9 floats per triangle (3 verts x xyz), world space
let triBuckets = null;      // array of arrays of triangle indices
let accelMinX = 0, accelMinZ = 0, accelCell = 4, accelW = 0, accelH = 0;

function buildCollisionAccel(){
  console.log('buildCollisionAccel: starting, collisionMeshes.length=' + collisionMeshes.length);
  const box = new THREE.Box3();
  collisionMeshes.forEach(m=>box.expandByObject(m));
  if(!isFinite(box.min.x)){ console.error('buildCollisionAccel: aborted, bounding box is not finite.'); return; }

  const tris = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  collisionMeshes.forEach(mesh=>{
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if(!pos) return;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    for(let i=0;i<count;i+=3){
      const i0 = index ? index.getX(i)   : i;
      const i1 = index ? index.getX(i+1) : i+1;
      const i2 = index ? index.getX(i+2) : i+2;
      a.fromBufferAttribute(pos,i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos,i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos,i2).applyMatrix4(mesh.matrixWorld);
      tris.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    }
  });
  triVerts = new Float32Array(tris);
  const triCount = triVerts.length/9;

  accelMinX = box.min.x-2; accelMinZ = box.min.z-2;
  accelW = Math.max(1, Math.ceil((box.max.x-box.min.x+4)/accelCell));
  accelH = Math.max(1, Math.ceil((box.max.z-box.min.z+4)/accelCell));
  triBuckets = new Array(accelW*accelH);
  for(let i=0;i<triBuckets.length;i++) triBuckets[i] = null;

  for(let t=0;t<triCount;t++){
    const o = t*9;
    const x0=triVerts[o],   z0=triVerts[o+2];
    const x1=triVerts[o+3], z1=triVerts[o+5];
    const x2=triVerts[o+6], z2=triVerts[o+8];
    const minX=Math.min(x0,x1,x2), maxX=Math.max(x0,x1,x2);
    const minZ=Math.min(z0,z1,z2), maxZ=Math.max(z0,z1,z2);
    let gx0=Math.floor((minX-accelMinX)/accelCell), gx1=Math.floor((maxX-accelMinX)/accelCell);
    let gz0=Math.floor((minZ-accelMinZ)/accelCell), gz1=Math.floor((maxZ-accelMinZ)/accelCell);
    gx0=Math.max(0,gx0); gz0=Math.max(0,gz0);
    gx1=Math.min(accelW-1,gx1); gz1=Math.min(accelH-1,gz1);
    for(let gz=gz0; gz<=gz1; gz++){
      for(let gx=gx0; gx<=gx1; gx++){
        const bi = gz*accelW+gx;
        if(!triBuckets[bi]) triBuckets[bi] = [];
        triBuckets[bi].push(t);
      }
    }
  }
  console.log('Collision acceleration built: '+triCount+' triangles in '+accelW+'x'+accelH+' buckets.');
}

function getFloorY(x, z, fromY){
  if(triBuckets){
    const gx = Math.floor((x-accelMinX)/accelCell);
    const gz = Math.floor((z-accelMinZ)/accelCell);
    if(gx<0||gx>=accelW||gz<0||gz>=accelH) return null;
    const bucket = triBuckets[gz*accelW+gx];
    if(!bucket) return null;
    let best = null;
    for(let n=0;n<bucket.length;n++){
      const o = bucket[n]*9;
      const ax=triVerts[o],   ay=triVerts[o+1], az=triVerts[o+2];
      const bx=triVerts[o+3], by=triVerts[o+4], bz=triVerts[o+5];
      const cx=triVerts[o+6], cy=triVerts[o+7], cz=triVerts[o+8];
      // 2D barycentric containment test in the XZ plane
      const v0x=cx-ax, v0z=cz-az, v1x=bx-ax, v1z=bz-az, v2x=x-ax, v2z=z-az;
      const d00=v0x*v0x+v0z*v0z, d01=v0x*v1x+v0z*v1z, d02=v0x*v2x+v0z*v2z;
      const d11=v1x*v1x+v1z*v1z, d12=v1x*v2x+v1z*v2z;
      const denom = d00*d11 - d01*d01;
      if(Math.abs(denom) < 1e-12) continue; // degenerate / edge-on triangle
      const inv = 1/denom;
      const u = (d11*d02 - d01*d12)*inv;
      const v = (d00*d12 - d01*d02)*inv;
      if(u < -1e-6 || v < -1e-6 || u+v > 1+1e-6) continue;
      const y = ay + u*(cy-ay) + v*(by-ay);
      if(y <= fromY && (best===null || y > best)) best = y;
    }
    return best;
  }
  // Fallback if the acceleration structure isn't available for some reason.
  raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0,-1,0));
  raycaster.far = 40;
  const hits = raycaster.intersectObjects(collisionMeshes, false);
  return hits.length>0 ? hits[0].point.y : null;
}
// Used only for short validation checks (nav-grid edges, spawn/box placement) where we just
// need a yes/no, not a slide response.
function canMoveToRadius(fromX, fromZ, toX, toZ, height, radius){
  const dx=toX-fromX, dz=toZ-fromZ;
  const dist = Math.hypot(dx,dz);
  if(dist<0.0001) return true;
  const dir = new THREE.Vector3(dx,0,dz).normalize();
  raycaster.set(new THREE.Vector3(fromX,height,fromZ), dir);
  raycaster.far = dist + radius;
  const hits = raycaster.intersectObjects(collisionMeshes, false);
  const minWallY = height - 1.3 - STEP_SMOOTH_MAX;
  const blocking = hits.find(h => h.distance < dist+radius && isBlockingHit(h, minWallY));
  return !blocking;
}
// Shared by the player and zombies. Two improvements over a single-bounce version:
// 1) Height-aware hit filtering — a horizontal ray can't tell "a real wall" from "the
//    connecting face where a platform drops off to a lower floor" just from distance; both
//    are directly in its path. We ignore any hit whose point is well below the current foot
//    level, since that's a ledge you should be able to walk off, not something blocking you.
// 2) Two bounce iterations — a single slide-and-recheck gives up entirely in concave corners
//    (two walls meeting near 90°), which is exactly where zombies were getting stuck. This
//    tries a second slide off the second wall's tangent before conceding no movement at all.
// Decides whether a horizontal ray hit should stop movement. Height alone can't tell a wall
// from a slope: a horizontal ray hits both at roughly its own height. What separates them is
// the surface NORMAL — a walkable slope faces upward, a wall faces sideways. Testing only the
// hit height (as this used to) meant a slope rising even a few centimetres ahead registered
// as a wall, which is why gentle slopes behaved like solid barriers.
function isBlockingHit(h, minWallY){
  if(h.point.y <= minWallY) return false;                 // below foot level: a ledge to walk off
  if(!h.face) return true;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  if(n.y > WALKABLE_NORMAL_Y) return false;                // ground or a walkable slope
  return true;
}

function resolveSlide(fromX, fromZ, dx, dz, height, radius, feetYRef){
  const minWallY = (feetYRef===undefined ? height-1.3 : feetYRef) - STEP_SMOOTH_MAX;
  let moveX = dx, moveZ = dz;

  for(let bounce=0; bounce<2; bounce++){
    const dist = Math.hypot(moveX, moveZ);
    if(dist<0.0001) return { x:fromX, z:fromZ };
    const dirX = moveX/dist, dirZ = moveZ/dist;
    raycaster.set(new THREE.Vector3(fromX,height,fromZ), new THREE.Vector3(dirX,0,dirZ));
    raycaster.far = dist+radius;
    const hits = raycaster.intersectObjects(collisionMeshes, false);
    const blocking = hits.find(h => h.distance < dist+radius && isBlockingHit(h, minWallY));
    if(!blocking){
      return { x: fromX+moveX, z: fromZ+moveZ };
    }
    if(!blocking.face) return { x:fromX, z:fromZ };
    let normal = blocking.face.normal.clone().transformDirection(blocking.object.matrixWorld);
    normal.y = 0;
    if(normal.lengthSq()<0.0001) return { x:fromX, z:fromZ };
    normal.normalize();
    const into = moveX*normal.x + moveZ*normal.z;
    if(into>=0) return { x:fromX, z:fromZ };
    moveX -= normal.x*into; moveZ -= normal.z*into; // remove into-wall component, keep tangential (slide)
  }

  // Final validity check on the twice-deflected vector before committing to it.
  const finalDist = Math.hypot(moveX, moveZ);
  if(finalDist<0.0001) return { x:fromX, z:fromZ };
  const fdirX=moveX/finalDist, fdirZ=moveZ/finalDist;
  raycaster.set(new THREE.Vector3(fromX,height,fromZ), new THREE.Vector3(fdirX,0,fdirZ));
  raycaster.far = finalDist+radius;
  const finalHits = raycaster.intersectObjects(collisionMeshes, false);
  const finalBlocking = finalHits.find(h => h.distance < finalDist+radius && isBlockingHit(h, minWallY));
  if(finalBlocking) return { x:fromX, z:fromZ };
  return { x: fromX+moveX, z: fromZ+moveZ };
}

function placePlayerAtStart(){
  const box = new THREE.Box3();
  collisionMeshes.forEach(m=>box.expandByObject(m));
  const center = box.getCenter(new THREE.Vector3());

  let bestPoint = null, bestDist = Infinity;
  const v = new THREE.Vector3();
  collisionMeshes.forEach(m=>{
    const posAttr = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(posAttr.count/800));
    for(let i=0;i<posAttr.count;i+=step){
      v.fromBufferAttribute(posAttr, i).applyMatrix4(m.matrixWorld);
      const d = (v.x-center.x)*(v.x-center.x) + (v.z-center.z)*(v.z-center.z);
      if(d<bestDist){ bestDist=d; bestPoint=v.clone(); }
    }
  });

  const startXZ = bestPoint || center;
  const floorY = getFloorY(startXZ.x, startXZ.z, box.max.y+5);
  camera.position.set(startXZ.x, (floorY!==null?floorY:startXZ.y)+EYE_HEIGHT, startXZ.z);
  feetY = camera.position.y - EYE_HEIGHT;
  playerStart = { x: startXZ.x, z: startXZ.z };
}

function updateMovement(delta){
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  right.y = 0; right.normalize();

  let mx=0, mz=0;
  if(keys['KeyW']) mz += 1;
  if(keys['KeyS']) mz -= 1;
  if(keys['KeyD']) mx += 1;
  if(keys['KeyA']) mx -= 1;

  const move = new THREE.Vector3();
  move.addScaledVector(forward, mz);
  move.addScaledVector(right, mx);
  if(move.lengthSq()>0) move.normalize();

  const speed = ((keys['ShiftLeft']||keys['ShiftRight']) ? RUN_SPEED : WALK_SPEED) * (1+statValue('moveSpeed'));
  const dx = move.x*speed*delta, dz = move.z*speed*delta;
  const chestY = feetY+1.3, kneeY = feetY+0.4;

  const chestResult = resolveSlide(camera.position.x, camera.position.z, dx, dz, chestY, PLAYER_RADIUS, feetY);
  const kneeResult = resolveSlide(camera.position.x, camera.position.z,
    chestResult.x-camera.position.x, chestResult.z-camera.position.z, kneeY, PLAYER_RADIUS, feetY);
  let nx = kneeResult.x, nz = kneeResult.z;

  // Same fall-through protection as the zombies: a single frame where the downward ray finds
  // nothing would otherwise start an unrecoverable fall, since the ray only reaches 2.2m above
  // the player's feet.
  let floorY = getFloorY(nx, nz, feetY+2.2);
  if(floorY===null) floorY = navFloorAt(nx, nz);
  if(floorY!==null && (feetY-floorY) <= STEP_SMOOTH_MAX){
    // grounded, or a normal step/slope — smooth snap, no falling physics needed
    const rate = (floorY > feetY) ? Math.min(1, delta*40) : Math.min(1, delta*12);
    feetY += (floorY-feetY)*rate;
    playerVelY = 0;
    playerAirborne = 0;
  } else {
    // airborne (walked off a ledge, or no floor found below at all) — actually fall
    playerVelY -= GRAVITY*delta;
    feetY += playerVelY*delta;
    if(floorY!==null && feetY<=floorY){ feetY = floorY; playerVelY = 0; playerAirborne = 0; }
    else {
      playerAirborne += delta;
      if(playerAirborne > 2.5){
        const rescue = nearestNavFloor(nx, nz);
        if(rescue){
          nx = rescue.x; nz = rescue.z;
          feetY = rescue.y; playerVelY = 0; playerAirborne = 0;
          console.warn('Player fell out of the world and was returned to the nav mesh.');
        }
      }
    }
  }

  camera.position.set(nx, feetY+EYE_HEIGHT, nz);
}

// =================================================================
// NAV GRID (A* over the collision mesh footprint, floor + wall sampled)
// Two resolutions: a coarse grid for long-distance routing and a fine grid for precision
// close to the player. Edges are directional so a steep one-way ledge drop is representable
// (allowed going down, not going back up) without needing a separate system.
// =================================================================
function buildGridAtResolution(cellSize, box){
  const minX = box.min.x-2, minZ = box.min.z-2, maxY = box.max.y+8;
  const gridW = Math.max(1, Math.ceil((box.max.x-box.min.x+4)/cellSize));
  const gridH = Math.max(1, Math.ceil((box.max.z-box.min.z+4)/cellSize));
  const navBlocked = new Uint8Array(gridW*gridH);
  const navFloorY = new Float32Array(gridW*gridH);
  for(let gz=0; gz<gridH; gz++){
    for(let gx=0; gx<gridW; gx++){
      const x = minX+gx*cellSize+cellSize/2, z = minZ+gz*cellSize+cellSize/2;
      const fy = getFloorY(x, z, maxY);
      const idx = gz*gridW+gx;
      if(fy===null){ navBlocked[idx]=1; navFloorY[idx]=0; }
      else { navBlocked[idx]=0; navFloorY[idx]=fy; }
    }
  }
  // Wall-proximity penalty: cells with blocked neighbours cost more to travel through, so
  // routes naturally favour the middle of a corridor rather than scraping along the walls —
  // which is where local collision tends to snag. It's a soft cost, not a hard block, so
  // genuinely tight gaps (doorways) stay passable when there's no better option.
  // Kernel radius covering ~1.5m of real clearance, whatever the cell size happens to be.
  const penR = Math.max(1, Math.round(1.5/cellSize));
  const wallPenalty = new Float32Array(gridW*gridH);
  for(let gz=0; gz<gridH; gz++){
    for(let gx=0; gx<gridW; gx++){
      const idx = gz*gridW+gx;
      if(navBlocked[idx]) continue;
      let blockedNeighbours = 0, sampled = 0;
      for(let dz=-penR; dz<=penR; dz++){
        for(let dx=-penR; dx<=penR; dx++){
          if(dx===0 && dz===0) continue;
          sampled++;
          const nx=gx+dx, nz=gz+dz;
          if(nx<0||nx>=gridW||nz<0||nz>=gridH){ blockedNeighbours++; continue; }
          if(navBlocked[nz*gridW+nx]) blockedNeighbours++;
        }
      }
      // Normalised so the penalty means the same thing regardless of resolution.
      wallPenalty[idx] = sampled>0 ? (blockedNeighbours/sampled) * 1.6 : 0;
    }
  }
  return { cellSize, minX, minZ, maxY, gridW, gridH, navBlocked, navFloorY, wallPenalty };
}

function buildNavGrid(){
  const box = new THREE.Box3();
  collisionMeshes.forEach(m=>box.expandByObject(m));
  if(!isFinite(box.min.x) || !isFinite(box.max.x)){
    // Defensive: if the collision mesh failed to load/parse, don't let an Infinity bounding
    // box crash the game with an invalid typed-array length — fall back to a 1x1 empty grid.
    console.error('Collision mesh bounding box is invalid — nav grid skipped (collisionMeshes.length=' + collisionMeshes.length + ').');
    navGridFine = { cellSize:FINE_CELL, minX:0, minZ:0, maxY:10, gridW:1, gridH:1,
      navBlocked:new Uint8Array([1]), navFloorY:new Float32Array([0]), wallPenalty:new Float32Array([0]) };
    levelMaxY = 10;
    levelBox = box;
    return;
  }
  levelBox = box;
  levelMaxY = box.max.y+8;
  navGridFine = buildGridAtResolution(FINE_CELL, box);
  navGridCoarse = downsampleGrid(navGridFine, COARSE_FACTOR);
  console.log('Nav grids built: fine '+navGridFine.gridW+'x'+navGridFine.gridH+
              ' @'+FINE_CELL+'m, coarse '+navGridCoarse.gridW+'x'+navGridCoarse.gridH+
              ' @'+navGridCoarse.cellSize.toFixed(1)+'m');
}

// Builds the coarse grid from the fine one instead of re-sampling the geometry. A coarse cell
// is open when ANY fine cell inside it is open, so narrow streets survive the downsample —
// sampling coarse cell centres directly (as the old coarse grid did) made them disappear and
// broke long-distance routes, which is exactly the failure we're trying not to repeat.
function downsampleGrid(fine, factor){
  const cellSize = fine.cellSize*factor;
  const gridW = Math.max(1, Math.ceil(fine.gridW/factor));
  const gridH = Math.max(1, Math.ceil(fine.gridH/factor));
  const navBlocked = new Uint8Array(gridW*gridH);
  const navFloorY = new Float32Array(gridW*gridH);
  const wallPenalty = new Float32Array(gridW*gridH);

  for(let gz=0; gz<gridH; gz++){
    for(let gx=0; gx<gridW; gx++){
      let open=0, sumY=0;
      const fz1 = Math.min((gz+1)*factor, fine.gridH), fx1 = Math.min((gx+1)*factor, fine.gridW);
      for(let fz=gz*factor; fz<fz1; fz++){
        for(let fx=gx*factor; fx<fx1; fx++){
          const fi = fz*fine.gridW+fx;
          if(!fine.navBlocked[fi]){ open++; sumY += fine.navFloorY[fi]; }
        }
      }
      const idx = gz*gridW+gx;
      if(open===0){ navBlocked[idx]=1; navFloorY[idx]=0; }
      else { navBlocked[idx]=0; navFloorY[idx]=sumY/open; }
    }
  }

  for(let gz=0; gz<gridH; gz++){
    for(let gx=0; gx<gridW; gx++){
      const idx = gz*gridW+gx;
      if(navBlocked[idx]) continue;
      let blocked=0, sampled=0;
      for(let dz=-1; dz<=1; dz++){
        for(let dx=-1; dx<=1; dx++){
          if(dx===0&&dz===0) continue;
          sampled++;
          const nx=gx+dx, nz=gz+dz;
          if(nx<0||nx>=gridW||nz<0||nz>=gridH){ blocked++; continue; }
          if(navBlocked[nz*gridW+nx]) blocked++;
        }
      }
      wallPenalty[idx] = sampled>0 ? (blocked/sampled)*1.6 : 0;
    }
  }
  return { cellSize, minX: fine.minX, minZ: fine.minZ, maxY: fine.maxY, gridW, gridH, navBlocked, navFloorY, wallPenalty };
}

// Positions the sun along -SUN_DIRECTION from the level's center, aimed back at it, and fits
// the shadow camera's orthographic frustum to the level's actual footprint — without this,
// DirectionalLight defaults to a tiny shadow frustum useless at building scale.
// Fits the sun's orthographic shadow frustum to the level by projecting the bounding box's
// 8 corners into the light's OWN view-aligned basis (right/up/forward relative to
// SUN_DIRECTION), not world X/Z. A frustum sized from world-axis extents only lines up with
// geometry when the light points straight down — with real horizontal tilt (as here), that
// mismatch misaligns the whole shadow frustum, which is what was causing shadows to look
// disconnected from the geometry. This also tightens near/far to the true depth range for
// better shadow-map precision, instead of a loose worst-case guess.
function configureSunShadow(){
  if(!levelBox || !isFinite(levelBox.min.x)) return;
  const center = levelBox.getCenter(new THREE.Vector3());
  const size = levelBox.getSize(new THREE.Vector3());
  const diag = size.length();
  const dist = diag*0.6 + 20;

  const viewDir = SUN_DIRECTION.clone().normalize();
  const lightPos = center.clone().addScaledVector(viewDir, -dist);
  sunLight.position.copy(lightPos);
  sunLight.target.position.copy(center);
  sunLight.target.updateMatrixWorld();

  const worldUp = Math.abs(viewDir.y) > 0.99 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
  const right = new THREE.Vector3().crossVectors(viewDir, worldUp).normalize();
  const camUp = new THREE.Vector3().crossVectors(right, viewDir).normalize();

  let minR=Infinity, maxR=-Infinity, minU=Infinity, maxU=-Infinity, minD=Infinity, maxD=-Infinity;
  const rel = new THREE.Vector3();
  for(let ix=0; ix<2; ix++) for(let iy=0; iy<2; iy++) for(let iz=0; iz<2; iz++){
    rel.set(
      ix?levelBox.max.x:levelBox.min.x,
      iy?levelBox.max.y:levelBox.min.y,
      iz?levelBox.max.z:levelBox.min.z
    ).sub(lightPos);
    const r=rel.dot(right), u=rel.dot(camUp), d=rel.dot(viewDir);
    if(r<minR)minR=r; if(r>maxR)maxR=r;
    if(u<minU)minU=u; if(u>maxU)maxU=u;
    if(d<minD)minD=d; if(d>maxD)maxD=d;
  }

  const margin = 2;
  const cam = sunLight.shadow.camera;
  cam.left = minR-margin; cam.right = maxR+margin;
  cam.bottom = minU-margin; cam.top = maxU+margin;
  cam.near = Math.max(0.5, minD-margin);
  cam.far = maxD+margin;
  cam.updateProjectionMatrix();
}

function gridWorldToCell(grid,x,z){ return { gx: Math.floor((x-grid.minX)/grid.cellSize), gz: Math.floor((z-grid.minZ)/grid.cellSize) }; }
function gridCellToWorld(grid,gx,gz){ return { x: grid.minX+gx*grid.cellSize+grid.cellSize/2, z: grid.minZ+gz*grid.cellSize+grid.cellSize/2 }; }
function gridIndex(grid,gx,gz){ return gz*grid.gridW+gx; }
function gridInBounds(grid,gx,gz){ return gx>=0 && gx<grid.gridW && gz>=0 && gz<grid.gridH; }

// Cheap approximate wall check using the precomputed nav grid (an array lookup) instead of a
// live raycast — used for high-frequency checks like zombie-zombie separation, where doing a
// full raycast per pair scales as O(n^2) with zombie count and was a real performance
// regression (this is likely what caused movement to feel sluggish as enemy count grew).
function isPositionBlocked(x, z){
  if(!navGridFine) return false;
  const c = gridWorldToCell(navGridFine, x, z);
  if(!gridInBounds(navGridFine, c.gx, c.gz)) return true;
  return !!navGridFine.navBlocked[gridIndex(navGridFine, c.gx, c.gz)];
}

// Two fields are maintained. Both are gradients toward the same target, which is why the
// hand-off between them is safe — unlike the old grid/waypoint hybrid, where the two halves
// disagreed about where to go and the seam between them caused the oscillation and
// backtracking. Here a zombie always walks downhill on whichever field covers it, and both
// slopes lead to the player.
//
//  - FINE (FINE_CELL): solved outward from the player to a bounded path distance. Faithful
//    enough to represent real doorways and pillars, used for everything nearby.
//  - COARSE (FINE_CELL * COARSE_FACTOR): solved over the ENTIRE level with no distance cap.
//    Cheap because the walkable area of a street network is a small fraction of the map.
//    Used by anything too far out to be covered by the fine field.
//
// The coarse grid is DOWNSAMPLED from the fine one rather than re-sampled from the geometry:
// a coarse cell counts as open when any fine cell inside it is open. That preserves
// connectivity by construction, which is what the previous coarse grid got wrong — sampling
// coarse cell centres directly made narrow streets vanish and broke long-distance routes.
let flowFieldFine = null, flowFieldCoarse = null;
let flowValid = false;
let flowCell = { gx:-1, gz:-1 };
let flowTime = -999;
const FLOW_FIELD_FINE_RADIUS = 120;   // metres of PATH distance (not straight-line) for the fine field
const FLOW_FIELD_MIN_INTERVAL = 0.25; // seconds — floor on rebuild rate

const NEIGH_DX = [1,-1,0,0,1,1,-1,-1];
const NEIGH_DZ = [0,0,1,-1,1,-1,1,-1];

// --- minimal binary min-heap over (cellIndex, cost) pairs ---
const heapCell = [];
const heapCost = [];
function heapClear(){ heapCell.length = 0; heapCost.length = 0; }
function heapPush(cell, cost){
  let i = heapCell.length;
  heapCell.push(cell); heapCost.push(cost);
  while(i>0){
    const p = (i-1)>>1;
    if(heapCost[p] <= heapCost[i]) break;
    const tc=heapCell[p]; heapCell[p]=heapCell[i]; heapCell[i]=tc;
    const tk=heapCost[p]; heapCost[p]=heapCost[i]; heapCost[i]=tk;
    i = p;
  }
}
function heapPop(){
  const topCell = heapCell[0], topCost = heapCost[0];
  const lastCell = heapCell.pop(), lastCost = heapCost.pop();
  if(heapCell.length>0){
    heapCell[0]=lastCell; heapCost[0]=lastCost;
    let i=0;
    for(;;){
      const l=2*i+1, r=l+1;
      let s=i;
      if(l<heapCost.length && heapCost[l]<heapCost[s]) s=l;
      if(r<heapCost.length && heapCost[r]<heapCost[s]) s=r;
      if(s===i) break;
      const tc=heapCell[s]; heapCell[s]=heapCell[i]; heapCell[i]=tc;
      const tk=heapCost[s]; heapCost[s]=heapCost[i]; heapCost[i]=tk;
      i=s;
    }
  }
  return { cell: topCell, cost: topCost };
}

// If the player is standing on a cell the grid considers blocked (sampling gaps do happen on
// a scanned mesh), spiral outward for the nearest open one so the field still has a source.
function nearestOpenCell(grid, gx, gz){
  if(gridInBounds(grid,gx,gz) && !grid.navBlocked[gridIndex(grid,gx,gz)]) return {gx,gz};
  for(let r=1;r<=8;r++){
    for(let dz=-r; dz<=r; dz++){
      for(let dx=-r; dx<=r; dx++){
        if(Math.max(Math.abs(dx),Math.abs(dz))!==r) continue;
        const nx=gx+dx, nz=gz+dz;
        if(!gridInBounds(grid,nx,nz)) continue;
        if(!grid.navBlocked[gridIndex(grid,nx,nz)]) return {gx:nx, gz:nz};
      }
    }
  }
  return null;
}

// Dijkstra outward from the player over `grid`, writing costs into `field`.
// stepTol scales with resolution: a coarse cell averages the heights inside it, so it needs a
// more forgiving step rule than the fine grid or legitimate slopes read as walls.
function computeFieldInto(grid, field, maxCost, stepTol, ledgeMax, srcX, srcZ){
  if(!grid || grid.gridW<2) return false;
  field.fill(Infinity);

  const sx = (srcX===undefined) ? camera.position.x : srcX;
  const sz = (srcZ===undefined) ? camera.position.z : srcZ;
  const raw = gridWorldToCell(grid, sx, sz);
  const start = nearestOpenCell(grid, raw.gx, raw.gz);
  if(!start) return false;

  const W = grid.gridW, H = grid.gridH;
  const startIdx = gridIndex(grid, start.gx, start.gz);
  field[startIdx] = 0;
  heapClear();
  heapPush(startIdx, 0);

  while(heapCell.length>0){
    const top = heapPop();
    const cIdx = top.cell, cCost = top.cost;
    if(cCost > field[cIdx]) continue;   // stale heap entry, already improved
    if(cCost > maxCost) break;          // far enough out; the rest is beyond interest
    const cgx = cIdx % W, cgz = (cIdx / W) | 0;
    const cH = grid.navFloorY[cIdx];
    for(let k=0;k<8;k++){
      const dx = NEIGH_DX[k], dz = NEIGH_DZ[k];
      const ngx = cgx+dx, ngz = cgz+dz;
      if(ngx<0||ngx>=W||ngz<0||ngz>=H) continue;
      const nIdx = ngz*W+ngx;
      if(grid.navBlocked[nIdx]) continue;
      if(dx!==0 && dz!==0){
        // don't let a diagonal cut through a corner that isn't genuinely open
        if(grid.navBlocked[cgz*W + (cgx+dx)]) continue;
        if(grid.navBlocked[(cgz+dz)*W + cgx]) continue;
      }
      // A zombie travels neighbour -> current (i.e. toward the player), so the height rule is
      // evaluated in that direction: dropping off a ledge is allowed, climbing it is not.
      const drop = grid.navFloorY[nIdx] - cH;
      if(drop > stepTol){ if(drop > ledgeMax) continue; }
      else if(-drop > stepTol) continue;
      const stepLen = ((dx!==0&&dz!==0) ? Math.SQRT2 : 1) * grid.cellSize;
      const cost = cCost + stepLen * (1 + grid.wallPenalty[nIdx]);
      // Push the value as it is actually stored: field is a Float32Array, so writing a double
      // rounds it slightly. Pushing the unrounded double would make the stale-entry check
      // above reject this node when popped, leaving the field only partially filled — which
      // looks exactly like zombies freezing beyond some distance for no visible reason.
      if(cost < field[nIdx]){ field[nIdx] = cost; heapPush(nIdx, field[nIdx]); }
    }
  }
  return true;
}

// Rebuilt only when the player has actually moved to a different fine cell, and never more
// often than the interval — so it costs nothing while the player is standing still.
function updateFlowField(){
  if(!navGridFine || !navGridCoarse) return;
  const now = clock.getElapsedTime();
  if(flowValid && (now - flowTime) < FLOW_FIELD_MIN_INTERVAL) return;
  const c = gridWorldToCell(navGridFine, camera.position.x, camera.position.z);
  if(flowValid && c.gx===flowCell.gx && c.gz===flowCell.gz) return;

  const n1 = navGridFine.gridW*navGridFine.gridH;
  if(!flowFieldFine || flowFieldFine.length!==n1) flowFieldFine = new Float32Array(n1);
  const n2 = navGridCoarse.gridW*navGridCoarse.gridH;
  if(!flowFieldCoarse || flowFieldCoarse.length!==n2) flowFieldCoarse = new Float32Array(n2);

  const okFine = computeFieldInto(navGridFine, flowFieldFine, FLOW_FIELD_FINE_RADIUS, STEP_SMOOTH_MAX, LEDGE_DROP_MAX);
  const okCoarse = computeFieldInto(navGridCoarse, flowFieldCoarse, Infinity, STEP_SMOOTH_MAX*COARSE_FACTOR*0.7, LEDGE_DROP_MAX*1.5);

  flowValid = okFine || okCoarse;
  flowCell = { gx:c.gx, gz:c.gz };
  flowTime = now;
}

// Best next cell centre on a given grid/field pair, or null if this position has no usable
// value there.
function sampleField(grid, field, worldX, worldZ){
  if(!grid || !field) return null;
  const c = gridWorldToCell(grid, worldX, worldZ);
  if(!gridInBounds(grid, c.gx, c.gz)) return null;
  const W = grid.gridW, H = grid.gridH;
  const here = field[gridIndex(grid, c.gx, c.gz)];

  if(!isFinite(here)){
    // On a cell the field never reached: aim for the best finite neighbour so it can rejoin.
    let bestVal=Infinity, bgx=-1, bgz=-1;
    for(let k=0;k<8;k++){
      const ngx=c.gx+NEIGH_DX[k], ngz=c.gz+NEIGH_DZ[k];
      if(ngx<0||ngx>=W||ngz<0||ngz>=H) continue;
      const v = field[ngz*W+ngx];
      if(v < bestVal){ bestVal=v; bgx=ngx; bgz=ngz; }
    }
    if(bgx<0) return null;
    return gridCellToWorld(grid, bgx, bgz);
  }

  let bestVal = here, bgx=-1, bgz=-1;
  for(let k=0;k<8;k++){
    const dx=NEIGH_DX[k], dz=NEIGH_DZ[k];
    const ngx=c.gx+dx, ngz=c.gz+dz;
    if(ngx<0||ngx>=W||ngz<0||ngz>=H) continue;
    const nIdx=ngz*W+ngx;
    if(grid.navBlocked[nIdx]) continue;
    if(dx!==0 && dz!==0){
      if(grid.navBlocked[c.gz*W + ngx]) continue;
      if(grid.navBlocked[ngz*W + c.gx]) continue;
    }
    if(field[nIdx] < bestVal){ bestVal = field[nIdx]; bgx=ngx; bgz=ngz; }
  }
  if(bgx<0) return null; // nothing lower nearby — effectively already at the player
  return gridCellToWorld(grid, bgx, bgz);
}

// Prefer the fine field; fall back to the coarse one for anything beyond its range.
function flowFieldTarget(worldX, worldZ){
  if(!flowValid) return null;
  const fine = sampleField(navGridFine, flowFieldFine, worldX, worldZ);
  if(fine) return fine;
  return sampleField(navGridCoarse, flowFieldCoarse, worldX, worldZ);
}


// The nav grid already stores a verified floor height for every open cell, which makes it a
// reliable fallback whenever a live downward raycast comes up empty (a gap in the scanned
// mesh, a numerical miss at a triangle seam, or a genuine hole such as a building interior).
function navFloorAt(x, z){
  if(!navGridFine) return null;
  const c = gridWorldToCell(navGridFine, x, z);
  if(!gridInBounds(navGridFine, c.gx, c.gz)) return null;
  const idx = gridIndex(navGridFine, c.gx, c.gz);
  if(navGridFine.navBlocked[idx]) return null;
  return navGridFine.navFloorY[idx];
}

// Nearest walkable spot to (x,z), for recovering anything that has fallen out of the world.
// Returns the cell centre as well as its height, since the position it fell through may itself
// be a hole — putting it back at the same x/z would just drop it through again.
function nearestNavFloor(x, z){
  if(!navGridFine) return null;
  const c = gridWorldToCell(navGridFine, x, z);
  const open = nearestOpenCell(navGridFine, c.gx, c.gz);
  if(!open) return null;
  const w = gridCellToWorld(navGridFine, open.gx, open.gz);
  return { x:w.x, z:w.z, y: navGridFine.navFloorY[gridIndex(navGridFine, open.gx, open.gz)] };
}

// =================================================================
// STATIONS + BOX — randomly placed on the collision mesh
// =================================================================
function randomFloorPoint(existingPoints, minSep){
  const box = new THREE.Box3();
  collisionMeshes.forEach(m=>box.expandByObject(m));
  for(let tries=0; tries<300; tries++){
    const x = box.min.x + Math.random()*(box.max.x-box.min.x);
    const z = box.min.z + Math.random()*(box.max.z-box.min.z);
    const fy = getFloorY(x,z, box.max.y+5);
    if(fy===null) continue;
    let ok = true;
    for(const p of existingPoints){ if(Math.hypot(x-p.x, z-p.z) < minSep){ ok=false; break; } }
    if(ok) return { x, y:fy, z };
  }
  return null;
}

function buildStationVisual(pos, color){
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color:0x1c1c20, roughness:0.7, metalness:0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.6,0.8,10), baseMat);
  base.position.y = 0.4;
  const coreMat = new THREE.MeshStandardMaterial({ color, emissive:color, emissiveIntensity:0.9, roughness:0.35 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3,0), coreMat);
  core.position.y = 1.3;
  const glow = new THREE.PointLight(color, 1.1, 8, 2);
  glow.position.y = 1.3;
  group.add(base, core, glow);
  group.position.set(pos.x, pos.y, pos.z);
  scene.add(group);
  return { core, group };
}

function placeStationsAndBox(){
  const placed = [{x:playerStart.x, z:playerStart.z}];
  const colors = [0xffb347, 0x66d9ff, 0xff6666];
  [1,2,3].forEach((weaponIndex,i)=>{
    const p = randomFloorPoint(placed, 6);
    if(!p) return;
    placed.push({x:p.x,z:p.z});
    const { core, group } = buildStationVisual(p, colors[i]);
    stationMarkers.push({ core, group, weaponIndex, pos:{x:p.x,z:p.z}, spinPhase:Math.random()*10 });
  });

  const bp = randomFloorPoint(placed, 6) || { x: playerStart.x+5, y: playerStart.y||0, z: playerStart.z+5 };
  boxPos = { x:bp.x, z:bp.z };
  const canvas = document.createElement('canvas');
  canvas.width=canvas.height=128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#2a1f10'; ctx.fillRect(0,0,128,128);
  ctx.strokeStyle='#e8b24d'; ctx.lineWidth=4; ctx.strokeRect(6,6,116,116);
  ctx.fillStyle='#e8b24d'; ctx.font='bold 84px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('?',64,70);
  const tex = new THREE.CanvasTexture(canvas);
  const group = new THREE.Group();
  const crateMat = new THREE.MeshBasicMaterial({ map:tex });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1,0.9,1), crateMat);
  crate.position.y = 0.45;
  const coreMat = new THREE.MeshStandardMaterial({ color:0xb266ff, emissive:0xb266ff, emissiveIntensity:1 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25,0), coreMat);
  core.position.y = 1.3;
  const glow = new THREE.PointLight(0xb266ff, 1.4, 10, 2);
  glow.position.y = 1.3;
  group.add(crate, core, glow);
  group.position.set(bp.x, bp.y, bp.z);
  scene.add(group);
  boxCore = core;
}

function buildTrajectoryMarker(){
  const geo = new THREE.RingGeometry(0.3,0.45,20);
  const mat = new THREE.MeshBasicMaterial({ color:0xffaa44, transparent:true, opacity:0.7, side:THREE.DoubleSide });
  trajectoryMarker = new THREE.Mesh(geo, mat);
  trajectoryMarker.rotation.x = -Math.PI/2;
  trajectoryMarker.visible = false;
  scene.add(trajectoryMarker);
}

// =================================================================

// A one-off coarse field toward a FIXED point (not the player). Used so the Guitarrista can
// actually walk home when dismissed instead of teleporting — the target never moves, so this
// is computed once and reused for the rest of the session.
function buildFixedTargetField(x, z){
  if(!navGridCoarse) return null;
  const field = new Float32Array(navGridCoarse.gridW*navGridCoarse.gridH);
  const ok = computeFieldInto(navGridCoarse, field, Infinity,
                              STEP_SMOOTH_MAX*COARSE_FACTOR*0.7, LEDGE_DROP_MAX*1.5, x, z);
  return ok ? field : null;
}
