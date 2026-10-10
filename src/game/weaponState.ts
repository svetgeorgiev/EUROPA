/** Pure, serialisable EUROPA-002F firearm inventory rules (no Babylon dependency). */
export const MAGAZINE_SIZE = 8;
export const FOUND_RESERVE_ROUNDS = 24;

export interface WeaponAmmo {
  owned: boolean;
  loaded: number;
  reserve: number;
}

export const EMPTY_WEAPON: Readonly<WeaponAmmo> = Object.freeze({
  owned: false, loaded: 0, reserve: 0
});

export function validWeaponAmmo(value: unknown, magazineSize = MAGAZINE_SIZE): value is WeaponAmmo {
  if (!value || typeof value !== 'object') return false;
  const ammo = value as Partial<WeaponAmmo>;
  return typeof ammo.owned === 'boolean' &&
    Number.isInteger(ammo.loaded) && Number.isInteger(ammo.reserve) &&
    ammo.loaded! >= 0 && ammo.loaded! <= magazineSize &&
    ammo.reserve! >= 0 && ammo.reserve! <= 500;
}

export function pickUpWeapon(state: WeaponAmmo, magazineSize = MAGAZINE_SIZE, reserve = FOUND_RESERVE_ROUNDS): WeaponAmmo {
  return state.owned ? { ...state } : {
    owned: true, loaded: magazineSize, reserve
  };
}

export function fireWeapon(state: WeaponAmmo): { next: WeaponAmmo; fired: boolean } {
  if (!state.owned || state.loaded <= 0) return { next: { ...state }, fired: false };
  return { next: { ...state, loaded: state.loaded - 1 }, fired: true };
}

export function reloadWeapon(state: WeaponAmmo, magazineSize = MAGAZINE_SIZE): { next: WeaponAmmo; added: number } {
  if (!state.owned || state.loaded >= magazineSize || state.reserve <= 0) {
    return { next: { ...state }, added: 0 };
  }
  const added = Math.min(magazineSize - state.loaded, state.reserve);
  return { next: { ...state, loaded: state.loaded + added, reserve: state.reserve - added }, added };
}
/**
 * Spare ammunition recovered from a test supply cache.
 * Deliberately capped to avoid unbounded local save values.
 */
export function addReserveAmmunition(
  state: WeaponAmmo, rounds: number, maxReserve = 96
): { next: WeaponAmmo; added: number } {
  if (!state.owned || !Number.isInteger(rounds) || rounds <= 0) {
    return { next: { ...state }, added: 0 };
  }
  const added = Math.min(rounds, Math.max(0, maxReserve - state.reserve));
  return {
    next: { ...state, reserve: state.reserve + added },
    added
  };
}
