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
