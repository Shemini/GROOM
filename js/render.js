"use strict";
// INIT
// =================================================================
function init(){
  player.xpToNext = xpForLevel(player.level);
  playerStamina = PLAYER_STAMINA_MAX;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 500);
  raycaster.camera = camera; // THREE.Sprite raycasting throws without this set; costs nothing to set regardless

  renderer = new THREE.WebGLRenderer({ antialias:false, logarithmicDepthBuffer:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  clock = new THREE.Clock();

  minimapCanvasEl = el('minimapCanvas');
  minimapCtx = minimapCanvasEl.getContext('2d');

  ambientLight = new THREE.AmbientLight(new THREE.Color(settings.ambientColor), settings.ambientIntensity);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(new THREE.Color(settings.sunColor), settings.sunIntensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;
  sunLight.target = new THREE.Object3D();
  scene.add(sunLight);
  scene.add(sunLight.target);
  // Positioned/oriented once the level's real size is known — see configureSunShadow().

  flashLight = new THREE.PointLight(0xfff2c0, 0, 12, 2);
  camera.add(flashLight);
  scene.add(camera);

  buildSky();
  buildPostProcess();
  buildTrajectoryMarker();

  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', e => { keys[e.code]=true; handleKeyDown(e); });
  document.addEventListener('keyup', e => { keys[e.code]=false; });
  document.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mousedown', e => { if(e.button===0) mouseDown=true; });
  document.addEventListener('mouseup', e => { if(e.button===0) mouseDown=false; });
  document.addEventListener('pointerlockchange', onPointerLockChange);

  startBtn.addEventListener('click', requestLock);
  pauseOverlay.addEventListener('click', requestLock);
  el('btnToggleLock').addEventListener('click', toggleCursorLock);
  el('restartBtn').addEventListener('click', () => window.location.reload());

  levelUpCardsEl.addEventListener('click', e=>{
    const card = e.target.closest('.lvlCard'); if(!card) return;
    const ctype = card.dataset.ctype;
    if(ctype==='stat') chooseLevelUpCard({ctype:'stat', key:card.dataset.key});
    else if(ctype==='weapon') chooseLevelUpCard({ctype:'weapon', widx:parseInt(card.dataset.widx,10)});
    else chooseLevelUpCard({ctype:'evolve', widx:parseInt(card.dataset.widx,10)});
  });
  rerollBtnEl.addEventListener('click', doReroll);
  swapCardsEl.addEventListener('click', e=>{
    const card = e.target.closest('.lvlCard'); if(card) confirmSwap(parseInt(card.dataset.slot,10));
  });
  el('dbgMoney').addEventListener('click', ()=>{ player.money+=1000; updateHUD(); });
  el('dbgLevel').addEventListener('click', ()=>{ player.pendingLevelUps++; maybeShowLevelUp(); });
  el('dbgHeal').addEventListener('click', ()=>{ player.health=player.maxHealth; updateHUD(); });
  el('dbgWave').addEventListener('click', ()=>{
    for(let i=zombies.length-1;i>=0;i--){ scene.remove(zombies[i].group); zombies.splice(i,1); }
    wave.spawned = wave.toSpawn;
  });

  wireSettingsUI();
  applySettingsToUI();
  loadAssets();
  updateHUD();
  animate();
}

function requestLock(){ initAudio(); renderer.domElement.requestPointerLock(); }

function toggleCursorLock(){
  if(gameState==='playing'){
    gameState = 'settings';
    document.exitPointerLock();
    updateLockButtonLabel();
  } else if(gameState==='settings' || gameState==='menu'){
    requestLock();
  }
}
function updateLockButtonLabel(){
  const btn = el('btnToggleLock');
  if(btn) btn.textContent = gameState==='playing' ? 'UNLOCK CURSOR [B]' : 'LOCK CURSOR [B]';
}

function onPointerLockChange(){
  isLocked = document.pointerLockElement === renderer.domElement;
  if(isLocked){
    startOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    if(gameState==='menu'){ gameState='playing'; startWave(); }
    else if(gameState==='paused' || gameState==='settings'){ gameState='playing'; }
  } else if(gameState==='playing'){
    gameState = 'paused';
    pauseOverlay.classList.remove('hidden');
  }
  updateLockButtonLabel();
}

function onMouseMove(e){
  if(!isLocked) return;
  const sens = 0.0022;
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= e.movementX * sens;
  euler.x -= e.movementY * sens;
  euler.x = Math.max(-Math.PI/2+0.02, Math.min(Math.PI/2-0.02, euler.x));
  camera.quaternion.setFromEuler(euler);
}

function handleKeyDown(e){
  if(e.code==='KeyR' && gameState==='playing') startReload();
  if(e.code==='KeyM') toggleMute();
  if(e.code==='KeyB') toggleCursorLock();
  if(e.code==='Backquote') debugPanelEl.classList.toggle('hidden');
  if(e.code==='KeyE' && gameState==='playing' && currentInteractable){
    if(currentInteractable.type==='station') interactStation(currentInteractable.station);
    else if(currentInteractable.type==='box') interactBox();
    else if(currentInteractable.type==='guitarrista') hireGuitarrista();
  }
  if(['Digit1','Digit2','Digit3','Digit4'].includes(e.code) && gameState==='playing'){
    const slotIdx = parseInt(e.code.slice(-1),10)-1;
    const wIdx = player.slots[slotIdx];
    if(wIdx!==null) switchWeapon(wIdx);
  }
}
function switchWeapon(idx){ player.currentWeapon = idx; player.reloading = false; updateHUD(); }

function onResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  rebuildRenderTarget();
}

// =================================================================
// SKY
// =================================================================
function buildSky(){
  const geo = new THREE.SphereGeometry(400, 24, 16);
  skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      skyColor: { value: new THREE.Color(settings.skyColor) },
      horizonColor: { value: new THREE.Color(settings.horizonColor) },
      horizonSharpness: { value: settings.horizonSharpness },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 skyColor; uniform vec3 horizonColor; uniform float horizonSharpness;
      varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -1.0, 1.0);
        float t = pow(max(0.0, 1.0 - h), horizonSharpness);
        vec3 color = mix(skyColor, horizonColor, t);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide, depthWrite:false, depthTest:false,
  });
  skyMesh = new THREE.Mesh(geo, skyMaterial);
  skyMesh.renderOrder = -1;
  scene.add(skyMesh);
}

// =================================================================
// POST PROCESS: pixelation + color grading + LUT, sky excluded via depth
// =================================================================
function buildPostProcess(){
  quadScene = new THREE.Scene();
  quadCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

  const lutTex = new THREE.TextureLoader().load('./LUT_V01.png');
  lutTex.minFilter = THREE.LinearFilter;
  lutTex.magFilter = THREE.LinearFilter;
  lutTex.wrapS = lutTex.wrapT = THREE.ClampToEdgeWrapping;
  lutTex.flipY = false;

  quadMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tLUT: { value: lutTex },
      brightness: { value: settings.brightness },
      contrast: { value: settings.contrast },
      hue: { value: settings.hue },
      saturation: { value: settings.saturation },
      tint: { value: new THREE.Vector3(settings.tintR, settings.tintG, settings.tintB) },
      lutStrength: { value: settings.lutStrength },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tLUT;
      uniform float brightness, contrast, hue, saturation, lutStrength;
      uniform vec3 tint;
      varying vec2 vUv;

      vec3 rgb2hsv(vec3 c){
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0*d+e)), d/(q.x+e), q.x);
      }
      vec3 hsv2rgb(vec3 c){
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p-K.xxx, 0.0, 1.0), c.y);
      }
      vec3 applyLUT(vec3 color){
        color = clamp(color, 0.0, 1.0);
        float blueIndex = color.b * 15.0;
        float b0 = floor(blueIndex);
        float b1 = min(b0+1.0, 15.0);
        float mixF = blueIndex - b0;
        vec2 texSize = vec2(256.0, 16.0);
        float tileSize = 16.0;
        vec2 uv0 = vec2((b0*tileSize + color.r*15.0 + 0.5) / texSize.x, (color.g*15.0+0.5)/texSize.y);
        vec2 uv1 = vec2((b1*tileSize + color.r*15.0 + 0.5) / texSize.x, (color.g*15.0+0.5)/texSize.y);
        vec3 c0 = texture2D(tLUT, uv0).rgb;
        vec3 c1 = texture2D(tLUT, uv1).rgb;
        return mix(c0, c1, mixF);
      }

      void main(){
        vec3 raw = texture2D(tDiffuse, vUv).rgb;
        float depth = texture2D(tDepth, vUv).r;

        if(depth > 0.9999){
          // sky / background — left ungraded
          gl_FragColor = vec4(raw, 1.0);
          return;
        }

        vec3 color = raw;
        color += brightness;
        color = (color - 0.5) * (1.0+contrast) + 0.5;
        vec3 hsv = rgb2hsv(clamp(color,0.0,1.0));
        hsv.x = fract(hsv.x + hue/360.0);
        color = hsv2rgb(hsv);
        float gray = dot(color, vec3(0.299,0.587,0.114));
        color = mix(vec3(gray), color, saturation);
        color *= tint;
        color = clamp(color, 0.0, 1.0);

        vec3 graded = applyLUT(color);
        color = mix(color, graded, lutStrength);

        gl_FragColor = vec4(clamp(color,0.0,1.0), 1.0);
      }
    `
  });

  quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), quadMaterial);
  quadScene.add(quadMesh);
  rebuildRenderTarget();
}

function rebuildRenderTarget(){
  if(renderTarget) renderTarget.dispose();
  const w = Math.max(2, Math.floor(window.innerWidth / settings.pixelSize));
  const h = Math.max(2, Math.floor(window.innerHeight / settings.pixelSize));
  const depthTexture = new THREE.DepthTexture(w,h);
  depthTexture.type = THREE.UnsignedShortType;
  renderTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
    depthTexture: depthTexture, depthBuffer: true,
  });
  quadMaterial.uniforms.tDiffuse.value = renderTarget.texture;
  quadMaterial.uniforms.tDepth.value = depthTexture;
}

function renderFrame(){
  skyMesh.position.copy(camera.position);
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCamera);
}

// =================================================================
// SETTINGS UI
// =================================================================

function applySettingsToUI(){
  const setRange = (id, val, labelId, fmt) => {
    const input = el(id); if(input) input.value = val;
    if(labelId){ const lab = el(labelId); if(lab) lab.textContent = fmt ? fmt(val) : val.toFixed(2); }
  };
  setRange('brightness', settings.brightness, 'vBrightness');
  setRange('contrast', settings.contrast, 'vContrast');
  setRange('hue', settings.hue, 'vHue', v=>Math.round(v)+'\u00b0');
  setRange('saturation', settings.saturation, 'vSaturation');
  setRange('pixelSize', settings.pixelSize, 'vPixelSize', v=>String(Math.round(v)));
  setRange('lutStrength', settings.lutStrength, 'vLutStrength');
  setRange('horizonSharpness', settings.horizonSharpness, 'vHorizonSharpness', v=>v.toFixed(1));
  setRange('sunIntensity', settings.sunIntensity, 'vSunIntensity');
  setRange('ambientIntensity', settings.ambientIntensity, 'vAmbientIntensity');
  setRange('contactShadowOpacity', settings.contactShadowOpacity, 'vContactShadowOpacity');
  if(el('tintR')) el('tintR').value = settings.tintR;
  if(el('tintG')) el('tintG').value = settings.tintG;
  if(el('tintB')) el('tintB').value = settings.tintB;
  if(el('skyColor')) el('skyColor').value = settings.skyColor;
  if(el('horizonColor')) el('horizonColor').value = settings.horizonColor;
  if(el('sunColor')) el('sunColor').value = settings.sunColor;
  if(el('ambientColor')) el('ambientColor').value = settings.ambientColor;
  if(el('contactShadowColor')) el('contactShadowColor').value = settings.contactShadowColor;

  if(quadMaterial){
    quadMaterial.uniforms.brightness.value = settings.brightness;
    quadMaterial.uniforms.contrast.value = settings.contrast;
    quadMaterial.uniforms.hue.value = settings.hue;
    quadMaterial.uniforms.saturation.value = settings.saturation;
    quadMaterial.uniforms.tint.value.set(settings.tintR, settings.tintG, settings.tintB);
    quadMaterial.uniforms.lutStrength.value = settings.lutStrength;
  }
  if(skyMaterial){
    skyMaterial.uniforms.skyColor.value.set(settings.skyColor);
    skyMaterial.uniforms.horizonColor.value.set(settings.horizonColor);
    skyMaterial.uniforms.horizonSharpness.value = settings.horizonSharpness;
  }
  if(sunLight){ sunLight.color.set(settings.sunColor); sunLight.intensity = settings.sunIntensity; }
  if(ambientLight){ ambientLight.color.set(settings.ambientColor); ambientLight.intensity = settings.ambientIntensity; }
  if(typeof zombies !== 'undefined'){
    zombies.forEach(z=>{ z.blob.material.color.set(settings.contactShadowColor); z.blob.material.opacity = settings.contactShadowOpacity; });
  }
  rebuildRenderTarget();
}

function wireSettingsUI(){
  const bind = (id, uniformKey, fmt) => {
    const input = el(id), label = el('v'+id.charAt(0).toUpperCase()+id.slice(1));
    input.addEventListener('input', ()=>{
      const v = parseFloat(input.value);
      settings[id] = v;
      if(id==='pixelSize') rebuildRenderTarget();
      else if(quadMaterial.uniforms[uniformKey||id]) quadMaterial.uniforms[uniformKey||id].value = v;
      if(label) label.textContent = fmt ? fmt(v) : v.toFixed(2);
    });
  };
  bind('brightness'); bind('contrast'); bind('hue', 'hue', v=>Math.round(v)+'°');
  bind('saturation'); bind('pixelSize', null, v=>Math.round(v)); bind('lutStrength');

  ['tintR','tintG','tintB'].forEach(id=>{
    el(id).addEventListener('input', ()=>{
      settings[id] = parseFloat(el(id).value);
      quadMaterial.uniforms.tint.value.set(settings.tintR, settings.tintG, settings.tintB);
    });
  });

  el('skyColor').addEventListener('input', ()=>{
    settings.skyColor = el('skyColor').value;
    skyMaterial.uniforms.skyColor.value.set(settings.skyColor);
  });
  el('horizonColor').addEventListener('input', ()=>{
    settings.horizonColor = el('horizonColor').value;
    skyMaterial.uniforms.horizonColor.value.set(settings.horizonColor);
  });
  el('horizonSharpness').addEventListener('input', ()=>{
    const v = parseFloat(el('horizonSharpness').value);
    settings.horizonSharpness = v;
    skyMaterial.uniforms.horizonSharpness.value = v;
    el('vHorizonSharpness').textContent = v.toFixed(1);
  });

  el('sunColor').addEventListener('input', ()=>{
    settings.sunColor = el('sunColor').value;
    sunLight.color.set(settings.sunColor);
  });
  el('sunIntensity').addEventListener('input', ()=>{
    const v = parseFloat(el('sunIntensity').value);
    settings.sunIntensity = v; sunLight.intensity = v;
    el('vSunIntensity').textContent = v.toFixed(2);
  });
  el('ambientColor').addEventListener('input', ()=>{
    settings.ambientColor = el('ambientColor').value;
    ambientLight.color.set(settings.ambientColor);
  });
  el('ambientIntensity').addEventListener('input', ()=>{
    const v = parseFloat(el('ambientIntensity').value);
    settings.ambientIntensity = v; ambientLight.intensity = v;
    el('vAmbientIntensity').textContent = v.toFixed(2);
  });
  el('contactShadowColor').addEventListener('input', ()=>{
    settings.contactShadowColor = el('contactShadowColor').value;
    zombies.forEach(z=>z.blob.material.color.set(settings.contactShadowColor));
  });
  el('contactShadowOpacity').addEventListener('input', ()=>{
    const v = parseFloat(el('contactShadowOpacity').value);
    settings.contactShadowOpacity = v;
    zombies.forEach(z=>z.blob.material.opacity = v);
    el('vContactShadowOpacity').textContent = v.toFixed(2);
  });

  el('btnReset').addEventListener('click', ()=>{
    Object.assign(settings, DEFAULT_SETTINGS);
    applySettingsToUI();
  });

  el('btnCopy').addEventListener('click', ()=>{
    const json = JSON.stringify(settings, null, 2);
    const box = el('jsonOut');
    box.style.display='block'; box.value=json; box.select();
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).catch(()=>{});
  });

  el('btnAddPoint').addEventListener('click', ()=>{
    const x = parseFloat(camera.position.x.toFixed(2));
    const z = parseFloat(camera.position.z.toFixed(2));
    capturedNodes.push({ id: 'node'+(capturedNodes.length+1), x, z });
    refreshPointsList();
  });
  el('btnClearPoints').addEventListener('click', ()=>{
    capturedNodes = [];
    refreshPointsList();
  });
  el('btnExportPoints').addEventListener('click', ()=>{
    if(capturedNodes.length===0) return;
    const body = capturedNodes.map(n=>`  { id:'${n.id}', x:${n.x}, z:${n.z} },`).join('\n');
    const text = `const NAV_NODES = [\n${body}\n];\n`;
    const blob = new Blob([text], {type:'text/javascript'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nav_nodes.js';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

let capturedNodes = [];
function refreshPointsList(){
  const box = document.getElementById('pointsOut');
  const countEl = document.getElementById('pointCount');
  if(countEl) countEl.textContent = capturedNodes.length;
  if(box) box.value = capturedNodes.map(n=>`{ id:'${n.id}', x:${n.x}, z:${n.z} },`).join('\n');
}

function updatePosReadout(){
  const el2 = document.getElementById('posReadout');
  if(!el2 || !camera) return;
  el2.textContent = `x: ${camera.position.x.toFixed(2)}, z: ${camera.position.z.toFixed(2)}`;
}

// =================================================================
