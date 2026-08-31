"use strict";
// MAIN LOOP
// =================================================================
function animate(){
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  if(gameState==='playing'){
    updateMovement(delta);
    if(mouseDown) tryShoot(elapsed);
    finishReloadIfDue(elapsed);
    updateZombies(delta, elapsed);
    updateZombieAnimations(delta);
    updateGuitarrista(delta, elapsed);
    updateBillboards();
    updateMinimap();
    updateFace(delta);
    updateStatusEffects(delta, elapsed);
    updateWave(delta, elapsed);
    updateInteractables(delta, elapsed);
    updateProjectiles(delta, elapsed);
    updatePuddles(delta, elapsed);
    updateVortexFields(delta, elapsed);
    updateBlackHoles(delta, elapsed);
    updateDamageNumbers(delta);
    updateDrops(delta, elapsed);
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
