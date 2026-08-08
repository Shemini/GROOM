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
  let envDone=false, colDone=false, spriteDone=false, envProgress=0, colProgress=0;

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
    if(!envDone || !colDone || !spriteDone) return;
    loadingLabel.textContent = 'Preparing level...';
    setTimeout(()=>{
      buildNavGrid();
      buildNavNodeGraph();
      configureSunShadow();
      placePlayerAtStart();
      placeStationsAndBox();
      gameState = 'menu';
      loadingLabel.textContent = 'Ready';
      startBtn.classList.remove('hidden');
    }, 10);
  }
}

// =================================================================
// COLLISION / MOVEMENT HELPERS (shared by player and zombies)
// =================================================================
function getFloorY(x, z, fromY){
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
  return !(hits.length>0 && hits[0].distance < dist+radius);
}
// Shared by the player and zombies. Two improvements over a single-bounce version:
// 1) Height-aware hit filtering — a horizontal ray can't tell "a real wall" from "the
//    connecting face where a platform drops off to a lower floor" just from distance; both
//    are directly in its path. We ignore any hit whose point is well below the current foot
//    level, since that's a ledge you should be able to walk off, not something blocking you.
// 2) Two bounce iterations — a single slide-and-recheck gives up entirely in concave corners
//    (two walls meeting near 90°), which is exactly where zombies were getting stuck. This
//    tries a second slide off the second wall's tangent before conceding no movement at all.
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
    const blocking = hits.find(h => h.distance < dist+radius && h.point.y > minWallY);
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
  const finalBlocking = finalHits.find(h => h.distance < finalDist+radius && h.point.y > minWallY);
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
  const nx = kneeResult.x, nz = kneeResult.z;

  const floorY = getFloorY(nx, nz, feetY+2.2);
  if(floorY!==null && (feetY-floorY) <= STEP_SMOOTH_MAX){
    // grounded, or a normal step/slope — smooth snap, no falling physics needed
    feetY += (floorY-feetY)*Math.min(1, delta*12);
    playerVelY = 0;
  } else {
    // airborne (walked off a ledge, or no floor found below at all) — actually fall
    playerVelY -= GRAVITY*delta;
    feetY += playerVelY*delta;
    if(floorY!==null && feetY<=floorY){ feetY = floorY; playerVelY = 0; }
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
  return { cellSize, minX, minZ, maxY, gridW, gridH, navBlocked, navFloorY };
}

function buildNavGrid(){
  const box = new THREE.Box3();
  collisionMeshes.forEach(m=>box.expandByObject(m));
  if(!isFinite(box.min.x) || !isFinite(box.max.x)){
    // Defensive: if the collision mesh failed to load/parse, don't let an Infinity bounding
    // box crash the game with an invalid typed-array length — fall back to a 1x1 empty grid.
    console.error('Collision mesh bounding box is invalid — nav grid skipped (collisionMeshes.length=' + collisionMeshes.length + ').');
    const empty = { cellSize:FINE_CELL, minX:0, minZ:0, maxY:10, gridW:1, gridH:1, navBlocked:new Uint8Array([1]), navFloorY:new Float32Array([0]) };
    navGridFine = empty; navGridCoarse = empty; levelMaxY = 10;
    levelBox = box;
    return;
  }
  levelBox = box;
  levelMaxY = box.max.y+8;
  navGridFine = buildGridAtResolution(FINE_CELL, box);
  navGridCoarse = buildGridAtResolution(COARSE_CELL, box);
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

// Directional: moving FROM (gx1,gz1) TO (gx2,gz2). A drop greater than the normal step
// tolerance but within the safe ledge-drop range is allowed one-way (downhill only) — calling
// this the other direction will naturally see a negative height difference and reject it.
function edgeWalkable(grid, gx1,gz1,gx2,gz2){
  const idx1 = gridIndex(grid,gx1,gz1), idx2 = gridIndex(grid,gx2,gz2);
  if(grid.navBlocked[idx1] || grid.navBlocked[idx2]) return false;
  const h1 = grid.navFloorY[idx1], h2 = grid.navFloorY[idx2];
  const dh = h1-h2; // positive = stepping down from cell1 to cell2
  if(dh > STEP_SMOOTH_MAX) return dh <= LEDGE_DROP_MAX;
  if(-dh > STEP_SMOOTH_MAX) return false;
  const p1 = gridCellToWorld(grid,gx1,gz1), p2 = gridCellToWorld(grid,gx2,gz2);
  const y = Math.max(h1,h2)+1.2;
  return canMoveToRadius(p1.x,p1.z,p2.x,p2.z, y, ZOMBIE_RADIUS);
}

function octileHeuristic(a,b){
  const dx=Math.abs(a.gx-b.gx), dz=Math.abs(a.gz-b.gz);
  return Math.max(dx,dz)+(Math.SQRT2-1)*Math.min(dx,dz);
}
function findPath(fromWorld, toWorld, grid){
  const start = gridWorldToCell(grid, fromWorld.x, fromWorld.z);
  const end = gridWorldToCell(grid, toWorld.x, toWorld.z);
  if(!gridInBounds(grid,start.gx,start.gz) || !gridInBounds(grid,end.gx,end.gz)) return null;
  if(grid.navBlocked[gridIndex(grid,end.gx,end.gz)]) return null;
  const endIdx = gridIndex(grid,end.gx,end.gz);
  const open = new Map();
  const closed = new Set();
  open.set(gridIndex(grid,start.gx,start.gz), { g:0, f:octileHeuristic(start,end), parent:null, gx:start.gx, gz:start.gz });
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let iterations=0;
  while(open.size>0 && iterations<4000){
    iterations++;
    let bestIdx=null, best=null;
    for(const [idx,node] of open){ if(best===null||node.f<best.f){best=node;bestIdx=idx;} }
    if(bestIdx===endIdx){
      const path=[]; let n=best;
      while(n){ path.push(gridCellToWorld(grid,n.gx,n.gz)); n=n.parent; }
      path.reverse();
      return path.length>1 ? path.slice(1) : path;
    }
    open.delete(bestIdx); closed.add(bestIdx);
    for(const [dx,dz] of neighbors){
      const ngx=best.gx+dx, ngz=best.gz+dz;
      if(!gridInBounds(grid,ngx,ngz)) continue;
      const nIdx = gridIndex(grid,ngx,ngz);
      if(closed.has(nIdx) || grid.navBlocked[nIdx]) continue;
      if(dx!==0 && dz!==0){
        // Diagonal step: require BOTH orthogonal cells forming this corner to also be open.
        // Without this, the path can cut through a corner that's clear center-to-center but
        // narrower than the zombie's actual body — a classic grid-pathfinding trap that shows
        // up exactly as "stuck at a bend," since local collision correctly refuses the squeeze
        // even though the grid thought the move was valid.
        const sideAIdx = gridIndex(grid, best.gx+dx, best.gz);
        const sideBIdx = gridIndex(grid, best.gx, best.gz+dz);
        if(!gridInBounds(grid,best.gx+dx,best.gz) || grid.navBlocked[sideAIdx]) continue;
        if(!gridInBounds(grid,best.gx,best.gz+dz) || grid.navBlocked[sideBIdx]) continue;
      }
      if(!edgeWalkable(grid,best.gx,best.gz,ngx,ngz)) continue;
      const stepCost = (dx!==0&&dz!==0)?Math.SQRT2:1;
      const g = best.g+stepCost;
      const existing = open.get(nIdx);
      if(!existing || g<existing.g) open.set(nIdx, { g, f:g+octileHeuristic({gx:ngx,gz:ngz},end), parent:best, gx:ngx, gz:ngz });
    }
    if(closed.size>4000) return null;
  }
  return null;
}

// =================================================================
// NAV NODE GRAPH — hand-placed waypoint routing for long-distance zombie movement.
// Complements (doesn't replace) the grid system above: recomputePath() tries this first when
// the zombie is far from the player, and falls back to the coarse/fine grid if no usable node
// route exists (e.g. NAV_NODES is empty, or doesn't cover this part of the level yet).
// =================================================================
let navNodeGraph = null; // { adjacency: Map(id -> [{id, dist}, ...]) }

// Checks whether a straight line between two points is actually walkable: continuous floor
// the whole way (no gaps, no cliff-sized drops mid-segment) and clear of walls at chest height.
function nodesConnected(ax, az, bx, bz){
  const dist = Math.hypot(bx-ax, bz-az);
  const steps = Math.max(2, Math.ceil(dist/2));
  let prevY = null, firstY = null, lastY = null;
  for(let s=0; s<=steps; s++){
    const t = s/steps;
    const x = ax+(bx-ax)*t, z = az+(bz-az)*t;
    const fy = getFloorY(x, z, levelMaxY);
    if(fy===null) return false;
    if(prevY!==null && Math.abs(fy-prevY) > STEP_SMOOTH_MAX) return false;
    if(firstY===null) firstY = fy;
    lastY = fy;
    prevY = fy;
  }
  const y = Math.max(firstY, lastY) + 1.2;
  return canMoveToRadius(ax, az, bx, bz, y, ZOMBIE_RADIUS);
}

function buildNavNodeGraph(){
  const adjacency = new Map();
  NAV_NODES.forEach(n => adjacency.set(n.id, []));
  const MAX_EDGE_DIST = 45; // meters — skip checking absurdly distant node pairs
  for(let i=0;i<NAV_NODES.length;i++){
    for(let j=i+1;j<NAV_NODES.length;j++){
      const a = NAV_NODES[i], b = NAV_NODES[j];
      const dist = Math.hypot(a.x-b.x, a.z-b.z);
      if(dist > MAX_EDGE_DIST) continue;
      if(nodesConnected(a.x, a.z, b.x, b.z)){
        adjacency.get(a.id).push({ id:b.id, dist });
        adjacency.get(b.id).push({ id:a.id, dist });
      }
    }
  }
  navNodeGraph = { adjacency };
}

// Finds the nearest node actually reachable in a straight line from worldPos — not just
// nearest by distance, since the closest node by straight-line distance could be on the far
// side of a wall (e.g. in an adjacent room).
function nearestReachableNode(worldPos){
  if(NAV_NODES.length===0) return null;
  const candidates = NAV_NODES
    .map(n => ({ n, dist: Math.hypot(n.x-worldPos.x, n.z-worldPos.z) }))
    .sort((a,b)=>a.dist-b.dist);
  for(const c of candidates.slice(0,6)){
    if(nodesConnected(worldPos.x, worldPos.z, c.n.x, c.n.z)) return c.n;
  }
  return candidates[0].n; // fall back to nearest even if unverified, better than nothing
}

function findNodePath(fromWorld, toWorld){
  if(!navNodeGraph || NAV_NODES.length===0) return null;
  const startNode = nearestReachableNode(fromWorld);
  const endNode = nearestReachableNode(toWorld);
  if(!startNode || !endNode) return null;
  if(startNode.id===endNode.id) return [{x:endNode.x, z:endNode.z}, {x:toWorld.x, z:toWorld.z}];

  const nodeById = new Map(NAV_NODES.map(n=>[n.id,n]));
  const h = (n) => Math.hypot(n.x-endNode.x, n.z-endNode.z);
  const open = new Map();
  const closed = new Set();
  open.set(startNode.id, { g:0, f:h(startNode), parent:null, id:startNode.id });

  let iterations=0;
  while(open.size>0 && iterations<2000){
    iterations++;
    let bestId=null, best=null;
    for(const [id,node] of open){ if(best===null||node.f<best.f){best=node;bestId=id;} }
    if(bestId===endNode.id){
      const path=[]; let n=best;
      while(n){ const nd=nodeById.get(n.id); path.push({x:nd.x, z:nd.z}); n=n.parent; }
      path.reverse();
      path.push({x:toWorld.x, z:toWorld.z}); // final hop from the last node to the actual target
      return path;
    }
    open.delete(bestId); closed.add(bestId);
    const neighbors = navNodeGraph.adjacency.get(bestId) || [];
    for(const edge of neighbors){
      if(closed.has(edge.id)) continue;
      const g = best.g + edge.dist;
      const existing = open.get(edge.id);
      if(!existing || g<existing.g){
        const nd = nodeById.get(edge.id);
        open.set(edge.id, { g, f:g+h(nd), parent:best, id:edge.id });
      }
    }
  }
  return null; // graph exists but start/end aren't connected — caller falls back to the grid
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
