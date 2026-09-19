"use strict";
// MINIMAP — calibrated from the reference plane's own world-space vertices and UVs, rather
// than assuming it's axis-aligned. This solves a proper affine transform (handles any
// rotation/scale the plane was placed with) from 3 well-spread sample points, so world (x,z)
// maps to the same UV space the plane's texture would be sampled at.
// =================================================================
function det3(m){
  return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
       - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
       + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
}
function pickSpreadPoints(pts){
  let p0 = pts[0];
  let p1 = pts[0], maxD=-1;
  for(const p of pts){ const d=(p.x-p0.x)*(p.x-p0.x)+(p.z-p0.z)*(p.z-p0.z); if(d>maxD){maxD=d;p1=p;} }
  let p2 = pts[0], maxArea=-1;
  for(const p of pts){
    const area = Math.abs((p1.x-p0.x)*(p.z-p0.z) - (p1.z-p0.z)*(p.x-p0.x));
    if(area>maxArea){ maxArea=area; p2=p; }
  }
  return [p0,p1,p2];
}
function solveAffineFromPoints(pts){
  const [p0,p1,p2] = pickSpreadPoints(pts);
  const M = [[p0.x,p0.z,1],[p1.x,p1.z,1],[p2.x,p2.z,1]];
  const detM = det3(M);
  if(Math.abs(detM) < 1e-6) return null; // degenerate (collinear) sample points
  function solveFor(vals){
    const Mx=[[vals[0],M[0][1],M[0][2]],[vals[1],M[1][1],M[1][2]],[vals[2],M[2][1],M[2][2]]];
    const My=[[M[0][0],vals[0],M[0][2]],[M[1][0],vals[1],M[1][2]],[M[2][0],vals[2],M[2][2]]];
    const Mc=[[M[0][0],M[0][1],vals[0]],[M[1][0],M[1][1],vals[1]],[M[2][0],M[2][1],vals[2]]];
    return { A: det3(Mx)/detM, B: det3(My)/detM, C: det3(Mc)/detM };
  }
  return { uCoef: solveFor([p0.u,p1.u,p2.u]), vCoef: solveFor([p0.v,p1.v,p2.v]) };
}
function worldToMinimapUV(x,z){
  if(!minimapTransform) return null;
  const { uCoef, vCoef } = minimapTransform;
  return { u: uCoef.A*x+uCoef.B*z+uCoef.C, v: vCoef.A*x+vCoef.B*z+vCoef.C };
}
function loadMinimap(){
  loadModel('Minimap', root=>{
    let meshFound = null;
    root.traverse(o=>{ if(o.isMesh && !meshFound) meshFound = o; });
    if(!meshFound){ console.error('Minimap.glb contains no mesh — minimap disabled.'); return; }
    meshFound.updateMatrixWorld(true);
    const posAttr = meshFound.geometry.attributes.position;
    const uvAttr = meshFound.geometry.attributes.uv;
    if(!uvAttr){ console.error('Minimap mesh has no UVs — minimap disabled.'); return; }
    const pts = [];
    const v = new THREE.Vector3();
    for(let i=0;i<posAttr.count;i++){
      v.fromBufferAttribute(posAttr, i).applyMatrix4(meshFound.matrixWorld);
      pts.push({ x:v.x, z:v.z, u:uvAttr.getX(i), v:uvAttr.getY(i) });
    }
    minimapTransform = solveAffineFromPoints(pts);
    if(!minimapTransform) console.error('Minimap calibration failed — sample points were collinear.');
  }, ()=>{}, err=>{ console.error('Minimap load failed', err); });
}

// The source Minimap.png stores its content at ~60% alpha (153/255) rather than fully opaque,
// while the surrounding area is correctly at 0% — so the whole image reads as uniformly
// translucent instead of "solid map, transparent perimeter." Boosting non-zero alpha back
// toward full opacity (leaving true-zero pixels untouched) corrects this without needing a
// re-export. Runs once on load, not per frame.
function loadMinimapImage(){
  const img = new Image();
  img.onload = () => {
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    try {
      const imgData = octx.getImageData(0, 0, off.width, off.height);
      const d = imgData.data;
      const BAKED_ALPHA = 0.6;
      for(let i=3; i<d.length; i+=4){
        if(d[i]>0) d[i] = Math.min(255, Math.round(d[i]/BAKED_ALPHA));
      }
      octx.putImageData(imgData, 0, 0);
    } catch(e){
      console.error('Minimap alpha correction skipped (canvas pixel read blocked) — using the image as-is:', e);
    }
    minimapBgCanvas = off;
  };
  img.onerror = () => console.error('Minimap.png failed to load');
  img.src = './Minimap.png';
}

// Draws the map and the blips through one shared transform, which is what keeps them in
// agreement. Previously the map was a CSS background scaled independently of the canvas the
// blips were drawn on, so the two could never line up.
//
// The view is centred on the player: the map slides underneath a fixed marker rather than the
// marker moving across a fixed map. That reads better at this size, and it means the zoom can
// be raised without losing track of where you are.
function updateMinimap(){
  if(!minimapCtx) return;
  const canvas = minimapCanvasEl;
  const cw = canvas.width, ch = canvas.height;
  minimapCtx.clearRect(0,0,cw,ch);
  if(!minimapTransform || !minimapBgCanvas) return;

  const playerUV = worldToMinimapUV(camera.position.x, camera.position.z);
  if(!playerUV) return;

  // The map is drawn MINIMAP_ZOOM times the size of its cell, so only a fraction shows.
  // Scaled uniformly from the width so the art keeps its aspect ratio whatever the cell's is.
  const scale = (cw*MINIMAP_ZOOM)/minimapBgCanvas.width;
  const drawW = minimapBgCanvas.width*scale;
  const drawH = minimapBgCanvas.height*scale;

  const vOf = uv => MINIMAP_V_FLIP ? (1-uv.v) : uv.v;
  // Offset that puts the player's own position at the centre of the cell.
  const offX = cw/2 - playerUV.u*drawW;
  const offY = ch/2 - vOf(playerUV)*drawH;

  minimapCtx.imageSmoothingEnabled = false;   // keep the map crisp, in keeping with the rest
  minimapCtx.drawImage(minimapBgCanvas, offX, offY, drawW, drawH);

  // Enemies: small hard-edged squares, drawn on the same offset as the map.
  minimapCtx.fillStyle = MINIMAP_ENEMY_COLOR;
  const es = MINIMAP_ENEMY_SIZE;
  zombies.forEach(z=>{
    if(z.dying) return;
    const uv = worldToMinimapUV(z.group.position.x, z.group.position.z);
    if(!uv) return;
    const x = Math.round(offX + uv.u*drawW), y = Math.round(offY + vOf(uv)*drawH);
    if(x < -es || x > cw+es || y < -es || y > ch+es) return;   // outside the cell
    minimapCtx.fillRect(x-es/2, y-es/2, es, es);
  });

  // The Guitarrista, if he's out there, so he can be found again after a dismissal.
  if(typeof guitarrista !== 'undefined' && guitarrista){
    const uv = worldToMinimapUV(guitarrista.group.position.x, guitarrista.group.position.z);
    if(uv){
      const x = Math.round(offX + uv.u*drawW), y = Math.round(offY + vOf(uv)*drawH);
      minimapCtx.fillStyle = MINIMAP_GUITAR_COLOR;
      minimapCtx.fillRect(x-3, y-3, 6, 6);
    }
  }

  drawPlayerMarker(cw/2, ch/2);
}

// A blocky diamond built from square blocks rather than a smooth path, so it matches the
// pixelated look instead of sitting on top of it as clean vector art.
function drawPlayerMarker(cx, cy){
  const b = MINIMAP_PLAYER_BLOCK;
  const rows = [1,3,5,7,5,3,1];          // widths in blocks, forming the diamond
  const h = rows.length;
  minimapCtx.fillStyle = MINIMAP_PLAYER_OUTLINE;
  for(let r=0;r<h;r++){
    const w = rows[r]+2;                  // one block of outline on each side
    const x = Math.round(cx - (w*b)/2);
    const y = Math.round(cy + (r - h/2)*b);
    minimapCtx.fillRect(x, y-b*0.5, w*b, b*2);
  }
  minimapCtx.fillStyle = MINIMAP_PLAYER_COLOR;
  for(let r=0;r<h;r++){
    const w = rows[r];
    const x = Math.round(cx - (w*b)/2);
    const y = Math.round(cy + (r - h/2)*b);
    minimapCtx.fillRect(x, y, w*b, b);
  }
}

