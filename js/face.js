"use strict";
// =================================================================
// FACE HUD — a Doom-style portrait above the minimap.
//
// The sheet is one long sequence of animations laid out left-to-right, top-to-bottom, so the
// layout below is declared as an ordered list of (name, frameCount) and the start index of
// each animation is computed from it. Adding, removing or reordering an animation therefore
// means editing one line rather than recalculating every index by hand.
//
// Behaviour:
//   - The resting pose is frame 0 of the current mood's blink pair; frame 1 is the closed eye,
//     shown briefly at natural intervals.
//   - Idle animations fire on a long random timer.
//   - Hit animations override everything and always play to completion. Triggers that arrive
//     mid-animation are discarded rather than queued, so a burst of damage can't back up a
//     line of reactions that play out after the danger has passed.
//   - The whole head rides a slow sine "breath", faster in the more agitated moods, so it
//     still reads as alive while resting on a single frame.
// =================================================================

const FACE_MOODS = ['serious','happy','excited','mad'];

let faceImage = null;
let faceCanvas = null, faceCtx = null;
let faceAnims = {};          // name -> { start, frames, fps }
let faceMood = 'serious';
let faceMode = 'rest';       // 'rest' | 'blink' | 'idle' | 'hit'
let faceCurrent = null;      // the animation currently playing, if any
let faceFrame = 0;
let faceTimer = 0;
let faceBlinkTimer = 3;
let faceIdleTimer = 15;
let faceBobPhase = 0;

// Start indices are derived from FACE_LAYOUT, which is the ordered contents of the sheet.
function buildFaceAnims(){
  faceAnims = {};
  let start = 0;
  for(const entry of FACE_LAYOUT){
    const name = entry[0], frames = entry[1], fps = entry[2];
    faceAnims[name] = { start, frames, fps };
    start += frames;
  }
  const capacity = FACE_COLS*FACE_ROWS;
  if(start > capacity){
    console.error('Face sheet overflow: layout needs ' + start + ' frames but the grid holds ' + capacity + '.');
  } else {
    console.log('Face animations built: ' + start + ' frames used of ' + capacity + '.');
  }
}

function loadFace(){
  buildFaceAnims();
  faceCanvas = document.getElementById('faceCanvas');
  if(!faceCanvas){ console.warn('Face: canvas element missing.'); return; }
  faceCtx = faceCanvas.getContext('2d');
  faceImage = new Image();
  faceImage.onload = ()=>{ console.log('Face sheet loaded: ' + faceImage.width + 'x' + faceImage.height); };
  faceImage.onerror = ()=>{ console.warn('Face: ' + FACE_TEXTURE + ' failed to load — the portrait will stay blank.'); faceImage = null; };
  faceImage.src = FACE_TEXTURE;
}

function faceAnim(name){ return faceAnims[name] || null; }

// Resting pose: frame 0 of this mood's blink pair.
function faceRestFrame(){
  const b = faceAnim(faceMood + '.blink');
  return b ? b.start : 0;
}

function startFaceAnim(mode, anim){
  if(!anim) return;
  faceMode = mode;
  faceCurrent = anim;
  faceFrame = 0;
  faceTimer = 1/(anim.fps || FACE_DEFAULT_FPS);
}

// Called when the player takes damage. Hits interrupt anything except another hit.
function faceOnHit(){
  if(faceMode === 'hit') return;              // already reacting; discard rather than queue
  const hits = FACE_HIT_ANIMS.map(faceAnim).filter(Boolean);
  if(hits.length === 0) return;
  startFaceAnim('hit', hits[Math.floor(Math.random()*hits.length)]);
}

function setFaceMood(mood){
  if(FACE_MOODS.indexOf(mood) === -1) return;
  if(mood === faceMood) return;
  faceMood = mood;
  // Don't cut a hit reaction short; the mood applies from the next resting frame onward.
  if(faceMode !== 'hit'){ faceMode = 'rest'; faceCurrent = null; }
}

// Cycles moods so every state can be seen before the combo system exists to drive them.
function cycleFaceMoodForWave(waveNumber){
  setFaceMood(FACE_MOODS[(waveNumber-1) % FACE_MOODS.length]);
}

function updateFace(delta){
  if(!faceCtx) return;

  const speed = settings.faceAnimSpeed || 1;

  if(faceMode === 'hit' || faceMode === 'idle' || faceMode === 'blink'){
    faceTimer -= delta*speed;
    while(faceTimer <= 0){
      faceFrame++;
      if(faceFrame >= faceCurrent.frames){
        faceMode = 'rest'; faceCurrent = null; faceFrame = 0;
        break;
      }
      faceTimer += 1/(faceCurrent.fps || FACE_DEFAULT_FPS);
    }
  }

  if(faceMode === 'rest'){
    faceBlinkTimer -= delta;
    faceIdleTimer -= delta;
    if(faceBlinkTimer <= 0){
      faceBlinkTimer = FACE_BLINK_MIN + Math.random()*(FACE_BLINK_MAX-FACE_BLINK_MIN);
      startFaceAnim('blink', faceAnim(faceMood + '.blink'));
    } else if(faceIdleTimer <= 0){
      faceIdleTimer = FACE_IDLE_MIN + Math.random()*(FACE_IDLE_MAX-FACE_IDLE_MIN);
      const pool = [];
      for(let i=1;i<=4;i++){ const a = faceAnim(faceMood + '.idle' + i); if(a) pool.push(a); }
      if(pool.length) startFaceAnim('idle', pool[Math.floor(Math.random()*pool.length)]);
    }
  }

  // Breathing. Rate rises with agitation so the portrait reads as more wound up even while
  // sitting on a single resting frame.
  const bobHz = FACE_BOB_HZ[faceMood] !== undefined ? FACE_BOB_HZ[faceMood] : 0.25;
  faceBobPhase += delta*bobHz*Math.PI*2;
  const bobY = Math.sin(faceBobPhase)*FACE_BOB_PIXELS;

  drawFace(bobY);
}

function drawFace(bobY){
  const cw = faceCanvas.width, ch = faceCanvas.height;
  faceCtx.clearRect(0,0,cw,ch);
  if(!faceImage) return;

  const idx = faceCurrent ? (faceCurrent.start + faceFrame) : faceRestFrame();
  const col = idx % FACE_COLS, row = Math.floor(idx / FACE_COLS);
  const fw = faceImage.width / FACE_COLS, fh = faceImage.height / FACE_ROWS;
  faceCtx.drawImage(faceImage, col*fw, row*fh, fw, fh, 0, bobY, cw, ch);
}
