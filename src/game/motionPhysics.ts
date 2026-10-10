/** Small, deterministic physics helpers used by the browser player controller. */
export interface PlanarMotion { x: number; z: number }
export interface MotionParams {
  walkSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  deceleration: number;
  airControl: number;
}

export const DEFAULT_MOTION: Readonly<MotionParams> = Object.freeze({
  walkSpeed: 4.5,
  sprintSpeed: 7.5,
  acceleration: 18,
  deceleration: 23,
  airControl: 0.35
});

export function approach(current: number, target: number, limit: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(limit)) return 0;
  return current + Math.max(-Math.max(0, limit), Math.min(Math.max(0, limit), target - current));
}

/**
 * Accelerate and stop gradually. Ground motion is snappier than mid-air steering.
 * Output is displacement velocity (metres/second), not a Babylon rigid body.
 */
export function stepPlanarMotion(
  velocity: PlanarMotion,
  direction: PlanarMotion,
  dt: number,
  grounded: boolean,
  sprinting: boolean,
  params: MotionParams = DEFAULT_MOTION
): PlanarMotion {
  const step = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  const length = Math.hypot(direction.x, direction.z);
  const x = length > 0.001 ? direction.x / length : 0;
  const z = length > 0.001 ? direction.z / length : 0;
  const speed = sprinting ? params.sprintSpeed : params.walkSpeed;
  const moving = length > 0.001;
  const rate = (moving ? params.acceleration : params.deceleration) *
    (grounded ? 1 : params.airControl);
  const maximum = rate * step;
  return {
    x: approach(velocity.x, x * speed, maximum),
    z: approach(velocity.z, z * speed, maximum)
  };
}

export function applyDamage(health: number, damage: number): number {
  if (!Number.isFinite(health) || !Number.isFinite(damage)) return 0;
  return Math.max(0, Math.min(health, health - Math.max(0, damage)));
}
