"use strict";
// =================================================================
// COMBO
//
// Kills build a combo through four stages. Each stage pays more (damage dealt, gold, XP) but
// also costs more (damage taken), so pushing for a high combo is a real gamble rather than a
// free bonus. The stage also drives the portrait's mood, which replaces the placeholder
// "cycle per wave" behaviour.
//
// Decay steps DOWN one stage rather than resetting to zero: losing a hard-won Mad combo
// entirely on one slow second would be punishing enough that nobody would chase it.
// =================================================================

const combo = {
  stage: 0,          // index into COMBO_STAGES
  count: 0,          // kills banked toward the next stage
  timer: 0,          // seconds left before the stage decays
  frozen: false,     // held while there's nothing to kill (unused since waves went)
};

// The corner text's own state: `kick` jumps on every kill and decays, which is what makes each
// kill land as a jolt; the steady shake underneath grows with stage and progress.
const comboHype = { kick: 0, jitterT: 0, ox: 0, oy: 0, rot: 0, shownStage: -1 };

function comboStageDef(){ return COMBO_STAGES[combo.stage] || COMBO_STAGES[0]; }

// Additive, as specified: stage 3 is +45%, not 1.15^3.
function comboDamageDealtMult(){ return 1 + combo.stage*COMBO_DAMAGE_BONUS; }
function comboRewardMult(){ return 1 + combo.stage*COMBO_REWARD_BONUS; }
function comboDamageTakenMult(){ return 1 + combo.stage*COMBO_DAMAGE_TAKEN_PENALTY; }

// Demonio, the last stage, only exists for a player who's made the Pacto con Satán.
function comboMaxStage(){
  return COMBO_STAGES.length - 1 - (statEvolved('enemyIntensity') ? 0 : 1);
}

// Pura Inquina: an extra damage multiplier by stage, on top of the combo's own.
function comboPerkDamageMult(){
  return statEvolved('damage') ? (PURA_INQUINA_MULT[combo.stage] || 1) : 1;
}

function comboOnKill(){
  combo.count++;
  if(combo.count >= COMBO_KILLS_PER_STAGE && combo.stage < comboMaxStage()){
    combo.stage++;
    combo.count = 0;
    comboOnStageChanged(true);
  }
  // Any kill refreshes the window, so a steady pace holds a stage indefinitely.
  combo.timer = comboStageDef().timer;
  comboHype.kick = Math.min(2.2, comboHype.kick + 1);
}

function comboDecay(){
  if(combo.stage > 0){
    combo.stage--;
    combo.count = 0;
    combo.timer = comboStageDef().timer;
    comboOnStageChanged(false);
  } else {
    combo.count = 0;
    combo.timer = 0;
  }
}

function comboOnStageChanged(rising){
  if(typeof setFaceMood === 'function') setFaceMood(comboStageDef().mood);
  // Reaching a stage hits harder than an ordinary kill. (It used to be a banner in the middle
  // of the screen; the corner text says it now.)
  if(rising) comboHype.kick = 2.6;
}

function updateCombo(delta){
  // Frozen between waves: the gap before enemies start arriving is dead time the player can't
  // do anything about, and letting it eat the combo would make early stages nearly unholdable.
  updateComboHype(delta);
  if(combo.frozen) return;
  if(combo.timer <= 0) return;
  combo.timer -= delta;
  if(combo.timer <= 0) comboDecay();
}

// ---------- the corner text ----------
// Shown only from CONTENTO up. Intensity is the stage plus progress toward the next one, so it
// winds up kill by kill: bigger, faster, more violent shaking. Each kill adds a jolt on top.
function updateComboHype(delta){
  const box = document.getElementById('comboHype');
  if(!box) return;
  const stage = combo.stage;
  const on = stage >= 1;
  if(box.classList.contains('on') !== on) box.classList.toggle('on', on);
  if(!on){ comboHype.kick = 0; comboHype.shownStage = -1; return; }

  if(comboHype.shownStage !== stage){
    comboHype.shownStage = stage;
    for(let i=1;i<=4;i++) box.classList.toggle('st'+i, i === stage);
    const txt = document.getElementById('comboHypeText');
    if(txt) txt.textContent = t('hype.text', { s: comboLabel(stage) });
  }
  const sub = document.getElementById('comboHypeSub');
  if(sub){
    const label = t('hype.sub', { d: Math.round(stage*COMBO_DAMAGE_BONUS*100), p: SCORE_COMBO_MULT[stage] || 1 });
    if(sub.textContent !== label) sub.textContent = label;
  }

  const progress = combo.count / COMBO_KILLS_PER_STAGE;
  const intensity = stage + progress;                       // 1 .. 5
  comboHype.kick = Math.max(0, comboHype.kick - delta*4.5);
  const k = comboHype.kick;
  // New random offsets ~30 times a second: smooth per-frame noise reads as wobble, not shake.
  comboHype.jitterT -= delta;
  if(comboHype.jitterT <= 0){
    comboHype.jitterT = 1/30;
    const amp = 0.6 + intensity*0.9 + k*intensity*2.2;      // pixels
    comboHype.ox = (Math.random()*2-1)*amp;
    comboHype.oy = (Math.random()*2-1)*amp;
    comboHype.rot = (Math.random()*2-1)*(0.4 + intensity*0.35 + k*2.5);
  }
  const scale = 0.9 + intensity*0.06 + k*0.16;
  box.style.transform = 'translate(' + comboHype.ox.toFixed(1) + 'px,' + comboHype.oy.toFixed(1) + 'px) ' +
                        'rotate(' + comboHype.rot.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
  // The last third of the window: it flickers, so a stage about to drop is still readable.
  const fading = combo.timer > 0 && combo.timer < comboStageDef().timer*0.33;
  if(box.classList.contains('fading') !== fading) box.classList.toggle('fading', fading);
}

// Called by the wave logic: held while waiting, released once enemies are actually spawning.
function comboSetFrozen(f){ combo.frozen = !!f; }

function comboReset(){
  combo.stage = 0; combo.count = 0; combo.timer = 0; combo.frozen = false;
  comboHype.kick = 0; comboHype.shownStage = -1;
  const box = document.getElementById('comboHype');
  if(box){ box.classList.remove('on','fading','st1','st2','st3','st4'); box.style.transform = ''; }
  if(typeof setFaceMood === 'function') setFaceMood(COMBO_STAGES[0].mood);
}
