"use strict";
// MAIN LOOP
// =================================================================
function animate(){
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  // Outside the state check: the title screen is on show while the level is still loading,
  // which is exactly when someone is most likely to be playing with the filters.
  if(typeof updateCoverTreatment === 'function') updateCoverTreatment();
  // Outside the play branch on purpose: it has to notice the game pausing to stop the voice.
  if(typeof syncBossVoicePause === 'function') syncBossVoicePause(gameState === 'playing');

  if(gameState==='playing'){
    gameTime += delta;   // frozen whenever the game isn't in play
    updateMovement(delta);
    if(mouseDown) tryShoot(elapsed);
    finishReloadIfDue(elapsed);
    updateZombies(delta, elapsed);
    updateZombieAnimations(delta);
    updateGuitarrista(delta, elapsed);
    updateBoss(delta, elapsed);
    updateRMines(delta);
    updateBillboards();
    updateMinimap();
    updateFace(delta);
    updateFPV(delta, elapsed);
    updateStatusEffects(delta, elapsed);
    updateCombo(delta);
    updateWave(delta, elapsed);
    updateInteractables(delta, elapsed);
    updateSoap(delta, elapsed);
    updateWeaponAudio();
    updateWeddingWeapons(delta, elapsed);
    updateProjectiles(delta, elapsed);
    updatePuddles(delta, elapsed);
    updateVortexFields(delta, elapsed);
    updateBlackHoles(delta, elapsed);
    updateParticles(delta, elapsed);
    updateDamageNumbers(delta);
    updateDrops(delta, gameTime);
    updateTrajectoryMarker();
    updateSpreadRing();
    updateHUD();
  }

  if(gameState!=='loading'){
    updatePosReadout();
    renderFrame();
  }
}

init();
