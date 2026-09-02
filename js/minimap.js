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

function updateMinimap(){
  if(!minimapCtx) return;
  const canvas = minimapCanvasEl;
  minimapCtx.clearRect(0,0,canvas.width,canvas.height);
  hudApplyMinimapBackground(); // the map art is the cell's CSS background; this canvas is blips only
  if(!minimapTransform) return; // markers wait on calibration; background can already show

  minimapCtx.fillStyle = '#e8434a';
  zombies.forEach(z=>{
    const uv = worldToMinimapUV(z.group.position.x, z.group.position.z);
    if(!uv) return;
    const zx = uv.u*canvas.width;
    const zy = (MINIMAP_V_FLIP ? (1-uv.v) : uv.v) * canvas.height;
    minimapCtx.beginPath();
    minimapCtx.arc(zx,zy,5,0,Math.PI*2);
    minimapCtx.fill();
  });

  const playerUV = worldToMinimapUV(camera.position.x, camera.position.z);
  if(playerUV){
    const px = playerUV.u*canvas.width;
    const py = (MINIMAP_V_FLIP ? (1-playerUV.v) : playerUV.v) * canvas.height;
    minimapCtx.fillStyle = '#4ea8e8';
    minimapCtx.beginPath();
    minimapCtx.arc(px,py,6,0,Math.PI*2);
    minimapCtx.fill();
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 2;
    minimapCtx.stroke();
  }
}

