import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_WEAPON, FOUND_RESERVE_ROUNDS, MAGAZINE_SIZE, fireWeapon,
  pickUpWeapon, reloadWeapon, validWeaponAmmo
} from '../src/game/weaponState.ts';

test('gun is initially absent and cannot fire', () => {
  const result = fireWeapon({ ...EMPTY_WEAPON });
  assert.equal(result.fired, false);
  assert.deepEqual(result.next, EMPTY_WEAPON);
});

test('gun pickup loads one magazine and provides fixed spare ammo', () => {
  const pickedUp = pickUpWeapon({ ...EMPTY_WEAPON });
  assert.deepEqual(pickedUp, {
    owned: true, loaded: MAGAZINE_SIZE, reserve: FOUND_RESERVE_ROUNDS
  });
  // Repeating the car pickup must never duplicate ammunition.
  assert.deepEqual(pickUpWeapon(pickedUp), pickedUp);
});

test('shooting consumes exactly one round without going negative', () => {
  let state = pickUpWeapon({ ...EMPTY_WEAPON });
  for (let i = 0; i < MAGAZINE_SIZE; i++) {
    const shot = fireWeapon(state);
    assert.equal(shot.fired, true);
    state = shot.next;
  }
  assert.equal(state.loaded, 0);
  assert.equal(fireWeapon(state).fired, false);
});

test('reload moves only available reserve rounds into the magazine', () => {
  const state = { owned: true, loaded: 2, reserve: 3 };
  const reloaded = reloadWeapon(state);
  assert.equal(reloaded.added, 3);
  assert.deepEqual(reloaded.next, { owned: true, loaded: 5, reserve: 0 });
  assert.deepEqual(state, { owned: true, loaded: 2, reserve: 3 });
  assert.equal(reloadWeapon(reloaded.next).added, 0);
});

test('localStorage data is rejected if corrupt or over capacity', () => {
  assert.equal(validWeaponAmmo(null), false);
  assert.equal(validWeaponAmmo({ owned: true, loaded: -1, reserve: 1 }), false);
  assert.equal(validWeaponAmmo({ owned: true, loaded: MAGAZINE_SIZE + 1, reserve: 1 }), false);
  assert.equal(validWeaponAmmo({ owned: true, loaded: 2.5, reserve: 1 }), false);
  assert.equal(validWeaponAmmo({ owned: true, loaded: 8, reserve: 1000000 }), false);
  assert.equal(validWeaponAmmo(pickUpWeapon({ ...EMPTY_WEAPON })), true);
});
