import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_WEAPON, FOUND_RESERVE_ROUNDS, MAGAZINE_SIZE, fireWeapon,
  pickUpWeapon, reloadWeapon, validWeaponAmmo, addReserveAmmunition
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

test('prototype ammo cache restores empty gun without changing magazine directly', () => {
  const empty = { owned: true, loaded: 0, reserve: 0 };
  const result = addReserveAmmunition(empty, 24);
  assert.equal(result.added, 24);
  assert.deepEqual(result.next, { owned: true, loaded: 0, reserve: 24 });
  const loaded = reloadWeapon(result.next);
  assert.equal(loaded.next.loaded, 8);
  assert.equal(loaded.next.reserve, 16);
  assert.deepEqual(empty, { owned: true, loaded: 0, reserve: 0 });
});

test('ammo restock respects cap and refuses non-owners or invalid values', () => {
  assert.equal(addReserveAmmunition({ ...EMPTY_WEAPON }, 24).added, 0);
  assert.equal(addReserveAmmunition({ owned: true, loaded: 8, reserve: 90 }, 24).added, 6);
  assert.equal(addReserveAmmunition({ owned: true, loaded: 8, reserve: 96 }, 24).added, 0);
  assert.equal(addReserveAmmunition({ owned: true, loaded: 1, reserve: 0 }, -3).added, 0);
});

test('M249 has 60 loaded and 120 reserve without changing the first rifle', () => {
  const state = pickUpWeapon({ ...EMPTY_WEAPON }, 60, 120);
  assert.deepEqual(state, { owned: true, loaded: 60, reserve: 120 });
  assert.equal(validWeaponAmmo(state), false, 'old rifle validator stays 8-round');
  assert.equal(validWeaponAmmo(state, 60), true, 'M249 validator allows 60');
  const afterShot = fireWeapon(state);
  assert.equal(afterShot.fired, true);
  assert.equal(afterShot.next.loaded, 59);
  const reloaded = reloadWeapon(afterShot.next, 60);
  assert.deepEqual(reloaded.next, { owned: true, loaded: 60, reserve: 119 });
});
