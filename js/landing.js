"use strict";
// =================================================================
// TITLE / LANDING SCREEN
//
// Runs before the game does: cover art, then the logo, then the prompt, then the menu. PLAY
// stays disabled until the level has finished loading in the background, so the player can
// read the screen while the big environment file streams in.
//
// The music is a two-part cue: GROOM.ogg stings as the logo lands, then TremoloMinor.ogg
// takes over. The tremolo doesn't loop cleanly, so rather than looping it we fade the last
// half-second out, wait, and start it again.
// =================================================================

const LANDING_LOGO_AT = 900;      // ms from mount — the sound cue fires here too
const LANDING_PROMPT_AT = 3400;
const TREMOLO_FADE = 0.5;         // seconds of fade at the tail
const TREMOLO_GAP = 2.0;          // seconds of silence before it comes round again

let landingState = 'intro';       // intro | prompt | menu
let landingT0 = 0;
let landingTimers = [];
let titleMuted = false;

let sndGroom = null, sndTremolo = null;
let tremoloTimer = null, tremoloFadeRaf = null;
let titleAudioPending = false;    // set when autoplay was refused, retried on first input

function initLanding(){
  landingT0 = performance.now();

  // Preloaded rather than created on cue, so the sting isn't late on a slow connection.
  sndGroom = new Audio('./Audio/GROOM.ogg');
  sndTremolo = new Audio('./Audio/TremoloMinor.ogg');
  [sndGroom, sndTremolo].forEach(a=>{ a.preload='auto'; a.volume = 0.8; });
  sndGroom.addEventListener('ended', startTremoloCycle);
  sndGroom.addEventListener('error', ()=>console.warn('Audio/GROOM.ogg missing'));
  sndTremolo.addEventListener('error', ()=>console.warn('Audio/TremoloMinor.ogg missing'));

  landingTimers.push(setTimeout(showLogo, LANDING_LOGO_AT));
  landingTimers.push(setTimeout(showPrompt, LANDING_PROMPT_AT));

  document.addEventListener('keydown', onLandingKey);
  document.getElementById('startOverlay').addEventListener('click', onLandingClick);

  const mute = document.getElementById('btnTitleMute');
  if(mute) mute.addEventListener('click', e=>{ e.stopPropagation(); toggleTitleMute(); });
  const pix = document.getElementById('btnTitlePixel');
  if(pix) pix.addEventListener('click', e=>{ e.stopPropagation(); toggleLandingPixel(); });
  buildLandingPixelArt();

  const play = document.getElementById('startBtn');
  if(play) play.addEventListener('click', e=>{ e.stopPropagation(); });   // handled in render.js
}

function showLogo(){
  const wrap = document.getElementById('titleLogoWrap');
  if(wrap){ wrap.classList.add('in','shown'); }
  playTitleCue();
}

function showPrompt(){
  if(landingState !== 'intro') return;
  landingState = 'prompt';
  const wrap = document.getElementById('titleLogoWrap');
  if(wrap) wrap.classList.add('shown');
  const p = document.getElementById('titlePrompt');
  if(p) p.classList.add('on');
}

function openLandingMenu(){
  if(landingState === 'menu') return;
  landingState = 'menu';
  const p = document.getElementById('titlePrompt');
  if(p){ p.classList.remove('on'); p.style.opacity = 0; }
  const m = document.getElementById('titleMenu');
  if(m) m.classList.add('on');
}

// Enter (or a click) is a skip: during the intro it jumps to the prompt, and from there it
// opens the menu — so an impatient player is never made to sit through the sequence.
function landingAdvance(){
  if(landingState === 'intro'){
    landingTimers.forEach(clearTimeout); landingTimers = [];
    showLogo();
    showPrompt();
  } else if(landingState === 'prompt'){
    openLandingMenu();
  }
}

function onLandingKey(e){
  if(!landingVisible()) return;
  if(e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space'){
    e.preventDefault();
    retryTitleAudio();
    landingAdvance();
  } else if(e.code === 'KeyM'){
    toggleTitleMute();
  }
}

function onLandingClick(){
  if(!landingVisible()) return;
  retryTitleAudio();
  landingAdvance();
}

function landingVisible(){
  const el2 = document.getElementById('startOverlay');
  return el2 && !el2.classList.contains('hidden');
}

// ---------- audio ----------
// Browsers refuse audio before the player has interacted, and the logo cue fires on a timer
// rather than an input — so a refusal is expected on first load and simply queues the cue
// until the player presses something.
function playTitleCue(){
  if(!sndGroom || titleMuted) return;
  const p = sndGroom.play();
  if(p && p.catch) p.catch(()=>{ titleAudioPending = true; });
}

function retryTitleAudio(){
  if(!titleAudioPending || titleMuted) return;
  titleAudioPending = false;
  playTitleCue();
}

function startTremoloCycle(){
  if(!sndTremolo || titleMuted || landingState === 'gone') return;
  sndTremolo.currentTime = 0;
  sndTremolo.volume = titleMuted ? 0 : 0.8;
  const p = sndTremolo.play();
  if(p && p.catch) p.catch(()=>{ titleAudioPending = true; return; });
  watchTremoloTail();
}

// The track has no clean loop point, so the tail is faded manually and the next pass is
// scheduled after a gap rather than using audio.loop.
function watchTremoloTail(){
  cancelAnimationFrame(tremoloFadeRaf);
  const step = ()=>{
    if(!sndTremolo || sndTremolo.paused) return;
    const d = sndTremolo.duration;
    if(isFinite(d) && d > 0){
      const left = d - sndTremolo.currentTime;
      if(left <= TREMOLO_FADE){
        sndTremolo.volume = titleMuted ? 0 : Math.max(0, 0.8*(left/TREMOLO_FADE));
      }
      if(left <= 0.05){
        sndTremolo.pause();
        clearTimeout(tremoloTimer);
        tremoloTimer = setTimeout(startTremoloCycle, TREMOLO_GAP*1000);
        return;
      }
    }
    tremoloFadeRaf = requestAnimationFrame(step);
  };
  tremoloFadeRaf = requestAnimationFrame(step);
}

function toggleTitleMute(){
  titleMuted = !titleMuted;
  const b = document.getElementById('btnTitleMute');
  if(b){ b.textContent = titleMuted ? '♪ OFF' : '♪ ON'; b.classList.toggle('muted', titleMuted); }
  [sndGroom, sndTremolo].forEach(a=>{ if(a) a.volume = titleMuted ? 0 : 0.8; });
  // Keep the in-game mute in step, so the button means the same thing on both sides.
  if(typeof muted !== 'undefined' && muted !== titleMuted && typeof toggleMute === 'function') toggleMute();
}

// Called when the run actually starts.
function stopTitleAudio(){
  landingState = 'gone';
  clearTimeout(tremoloTimer);
  cancelAnimationFrame(tremoloFadeRaf);
  [sndGroom, sndTremolo].forEach(a=>{ if(a){ try{ a.pause(); }catch(e){} } });
  document.removeEventListener('keydown', onLandingKey);
}

// Enables PLAY once the level is ready; called from the asset loader.
function landingSetReady(){
  const play = document.getElementById('startBtn');
  if(play) play.disabled = false;
  const label = document.getElementById('loadingLabel');
  if(label) label.textContent = 'READY';
  const bar = document.getElementById('loadingBar');
  if(bar) bar.style.opacity = 0.35;
}

// =================================================================
// LANDING PIXEL / COLOUR-DEPTH TREATMENT
// The title screen is DOM, so the game's post-process never touches it — the cover sat there
// photographically smooth while everything after it was chunky and palette-limited. Here the
// cover and logo are re-rendered once into low-resolution canvases, quantised with the same
// levels and ordered dither the shader uses, and swapped in. The toggle flips between the
// treated and original images for comparison.
// =================================================================
let landingPixelOn = true;
let landingOriginals = null;      // { cover, logo } original URLs, for the toggle
let landingTreated = null;        // { cover, logo } processed data URLs

// Same 4x4 Bayer and per-channel levels as the grading shader, so the title and the game
// quantise identically rather than merely similarly.
function bayer4(x, y){
  const b2 = (a,b)=>{ a=Math.floor(a); b=Math.floor(b); const v=a*0.5+b*b*0.75; return v-Math.floor(v); };
  return b2(0.5*x, 0.5*y)*0.25 + b2(x, y);
}

function pixelateImage(img, pixelSize, depth, keepAlpha){
  const w = Math.max(1, Math.round(img.width / pixelSize));
  const h = Math.max(1, Math.round(img.height / pixelSize));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;          // average down, then quantise the result
  ctx.drawImage(img, 0, 0, w, h);
  try{
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    const L = colorLevelsFor(depth);
    const steps = [Math.max(1,L.x-1), Math.max(1,L.y-1), Math.max(1,L.z-1)];
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i = (y*w+x)*4;
        const dither = bayer4(x, y) - 0.5;
        for(let ch=0; ch<3; ch++){
          let v = d[i+ch]/255 + dither/steps[ch];
          v = Math.min(1, Math.max(0, v));
          d[i+ch] = Math.round(Math.round(v*steps[ch])/steps[ch]*255);
        }
        // The logo is a cutout, so snap its alpha too — soft edges would only reintroduce
        // the smoothness this is meant to remove.
        if(keepAlpha) d[i+3] = d[i+3] >= 128 ? 255 : 0;
      }
    }
    ctx.putImageData(data, 0, 0);
  }catch(e){
    console.warn('Landing: pixel treatment skipped (canvas pixel read blocked).', e);
  }
  return c.toDataURL('image/png');
}

function loadImage(src){
  return new Promise((res, rej)=>{ const i = new Image(); i.onload = ()=>res(i); i.onerror = rej; i.src = src; });
}

function buildLandingPixelArt(){
  const logoEl = document.getElementById('titleLogo');
  landingOriginals = { cover:'./Cover.jpg', logo: logoEl ? logoEl.getAttribute('src') : './CoverTittle.png' };
  const px = (typeof autoPixelSize === 'function') ? autoPixelSize() : 6;
  const depth = settings.colorDepth || 8;
  Promise.all([loadImage(landingOriginals.cover), loadImage(landingOriginals.logo)]).then(([cover, logo])=>{
    // The cover fills the viewport, so it's reduced relative to the screen; the logo is shown
    // at about a quarter of the width, so it gets the same on-screen block size.
    const coverPx = Math.max(1, px * (cover.width / (window.innerWidth||cover.width)));
    const logoShownW = (window.innerWidth||1920) * 0.2667;
    const logoPx = Math.max(1, px * (logo.width / logoShownW));
    landingTreated = {
      cover: pixelateImage(cover, coverPx, depth, false),
      logo:  pixelateImage(logo,  logoPx,  depth, true),
    };
    applyLandingArt();
  }).catch(e=>console.warn('Landing: could not build pixel art', e));
}

function applyLandingArt(){
  const set = (landingPixelOn && landingTreated) ? landingTreated : landingOriginals;
  if(!set) return;
  const overlay = document.getElementById('startOverlay');
  if(overlay) overlay.style.backgroundImage = 'url(' + set.cover + ')';
  const logo = document.getElementById('titleLogo');
  if(logo) logo.src = set.logo;
  const scan = document.getElementById('titleLogoScan');
  if(scan){ scan.style.webkitMaskImage = 'url(' + set.logo + ')'; scan.style.maskImage = 'url(' + set.logo + ')'; }
  const b = document.getElementById('btnTitlePixel');
  if(b){ b.textContent = landingPixelOn ? '▦ ON' : '▦ OFF'; b.classList.toggle('muted', !landingPixelOn); }
}

function toggleLandingPixel(){
  landingPixelOn = !landingPixelOn;
  applyLandingArt();
}
