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
  frozen: false,     // held between waves, when there's nothing to kill
};

function comboStageDef(){ return COMBO_STAGES[combo.stage] || COMBO_STAGES[0]; }

// Additive, as specified: stage 3 is +45%, not 1.15^3.
function comboDamageDealtMult(){ return 1 + combo.stage*COMBO_DAMAGE_BONUS; }
function comboRewardMult(){ return 1 + combo.stage*COMBO_REWARD_BONUS; }
function comboDamageTakenMult(){ return 1 + combo.stage*COMBO_DAMAGE_TAKEN_PENALTY; }

function comboOnKill(){
  combo.count++;
  if(combo.count >= COMBO_KILLS_PER_STAGE && combo.stage < COMBO_STAGES.length-1){
    combo.stage++;
    combo.count = 0;
    comboOnStageChanged(true);
  }
  // Any kill refreshes the window, so a steady pace holds a stage indefinitely.
  combo.timer = comboStageDef().timer;
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
  const def = comboStageDef();
  if(rising) showWaveBanner(def.label, '+'+Math.round(combo.stage*COMBO_DAMAGE_BONUS*100)+'% daño y botín');
}

function updateCombo(delta){
  // Frozen between waves: the gap before enemies start arriving is dead time the player can't
  // do anything about, and letting it eat the combo would make early stages nearly unholdable.
  if(combo.frozen) return;
  if(combo.timer <= 0) return;
  combo.timer -= delta;
  if(combo.timer <= 0) comboDecay();
}

// Called by the wave logic: held while waiting, released once enemies are actually spawning.
function comboSetFrozen(f){ combo.frozen = !!f; }

function comboReset(){
  combo.stage = 0; combo.count = 0; combo.timer = 0; combo.frozen = false;
  if(typeof setFaceMood === 'function') setFaceMood(COMBO_STAGES[0].mood);
}
