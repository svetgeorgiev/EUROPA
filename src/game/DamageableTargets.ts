import {
  AbstractMesh, Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3
} from '@babylonjs/core';
import { applyDamage } from './motionPhysics';
import type { Point2 } from '../world/osm';

interface Target {
  mesh: Mesh;
  material: StandardMaterial;
  hp: number;
  velocity: Vector3;
  spin: Vector3;
  idleSeconds: number;
}
interface Fragment {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
}

/**
 * Destructible *game props*, not OSM buildings or real-world objects.
 * Integrates impulse, gravity, ground contact and damping as cheap local physics.
 * It is not a substitute for Havok rigid bodies or server-authoritative damage.
 */
export class DamageableTargets {
  private readonly targets = new Map<number, Target>();
  private readonly fragments: Fragment[] = [];
  private readonly fragmentMaterial: StandardMaterial;
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly notify: (message: string) => void) {
    this.fragmentMaterial = new StandardMaterial('target-splinter-mat', scene);
    this.fragmentMaterial.diffuseColor = Color3.FromHexString('#9d6c3c');
  }

  spawnNear(position: Point2, isBlocked: (position: Point2) => boolean): void {
    // Prefer the open ground on the far side of the car, away from the
    // mapped school wall. Check OSM building-footprint safety before creating.
    const offsets = [
      { x: -4, z: -7 }, { x: 0, z: -9 }, { x: 4, z: -7 },
      { x: -7, z: -10 }, { x: 7, z: -10 }, { x: 1, z: -13 }
    ];
    let spawned = 0;
    for (const offset of offsets) {
      if (spawned >= 3) break;
      const candidate = { x: position.x + offset.x, z: position.z + offset.z };
      if (isBlocked(candidate)) continue;
      this.createCrate(candidate, spawned++);
    }
    if (spawned) this.notify('Three-hit training crates near the car · aim and shoot to damage');
  }

  private createCrate(point: Point2, index: number): void {
    const mesh = MeshBuilder.CreateBox('damageable-crate-' + index, {
      width: 1.05, height: 1.05, depth: 1.05
    }, this.scene);
    mesh.position.set(point.x, 0.525, point.z);
    const mat = new StandardMaterial('damageable-crate-wood-' + index, this.scene);
    mat.diffuseColor = Color3.FromHexString('#9d6c3c');
    mat.specularColor = Color3.Black();
    mesh.material = mat;
    mesh.isPickable = true;
    mesh.checkCollisions = true;
    this.targets.set(mesh.uniqueId, {
      mesh, material: mat, hp: 3, velocity: Vector3.Zero(),
      spin: Vector3.Zero(), idleSeconds: 0
    });
  }

  hit(mesh: AbstractMesh, impact: Vector3, shotDirection: Vector3): boolean {
    const target = this.targets.get(mesh.uniqueId);
    if (!target || target.hp <= 0 || this.disposed) return false;
    target.hp = applyDamage(target.hp, 1);
    const direction = shotDirection.normalizeToNew();
    target.velocity.addInPlace(direction.scale(1.5));
    target.velocity.y = Math.max(1.8, target.velocity.y + 1.3);
    const hitOffset = impact.subtract(target.mesh.position);
    target.spin.addInPlace(new Vector3(
      -hitOffset.y * direction.z,
      hitOffset.x * direction.z - hitOffset.z * direction.x,
      hitOffset.y * direction.x
    ).scale(0.9));
    if (target.hp > 0) {
      target.material.diffuseColor = Color3.FromHexString(
        target.hp === 2 ? '#8a5940' : '#714c3b'
      );
      this.notify('Crate hit · ' + target.hp + ' HP remaining');
    } else {
      this.shatter(target);
      this.notify('Crate destroyed · physical debris spawned');
    }
    return true;
  }

  private shatter(target: Target): void {
    const position = target.mesh.position.clone();
    this.targets.delete(target.mesh.uniqueId);
    target.mesh.dispose();
    target.material.dispose();
    for (let index = 0; index < 5; index++) {
      const fragment = MeshBuilder.CreateBox('crate-debris-' + index, {
        size: 0.15 + (index % 3) * 0.04
      }, this.scene);
      fragment.position.copyFrom(position);
      fragment.material = this.fragmentMaterial;
      fragment.isPickable = false;
      fragment.checkCollisions = false;
      const angle = index * Math.PI * 2 / 5;
      this.fragments.push({
        mesh: fragment,
        velocity: new Vector3(
          Math.cos(angle) * 2.0, 1.5 + (index % 3) * 0.7,
          Math.sin(angle) * 2.0
        ),
        life: 3
      });
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    dt = Math.max(0, Math.min(dt, 0.05));
    for (const target of this.targets.values()) {
      if (target.velocity.lengthSquared() < 0.001 &&
          target.spin.lengthSquared() < 0.001 && target.idleSeconds > 0.5) continue;
      target.velocity.y -= 16 * dt;
      target.mesh.position.addInPlace(target.velocity.scale(dt));
      target.mesh.rotation.addInPlace(target.spin.scale(dt));
      // Simple flat-terrain bounce. Rotation is visual, not full contact solver.
      if (target.mesh.position.y < 0.55) {
        target.mesh.position.y = 0.55;
        target.velocity.y = Math.abs(target.velocity.y) * 0.16;
        if (target.velocity.y < 0.12) target.velocity.y = 0;
      }
      target.velocity.x *= Math.exp(-3.5 * dt);
      target.velocity.z *= Math.exp(-3.5 * dt);
      target.spin.scaleInPlace(Math.exp(-5 * dt));
      target.idleSeconds += dt;
    }
    for (let index = this.fragments.length - 1; index >= 0; index--) {
      const part = this.fragments[index];
      part.life -= dt;
      if (part.life <= 0) {
        part.mesh.dispose();
        this.fragments.splice(index, 1);
        continue;
      }
      part.velocity.y -= 16 * dt;
      part.mesh.position.addInPlace(part.velocity.scale(dt));
      part.mesh.rotation.y += 4 * dt;
      if (part.mesh.position.y < 0.08) {
        part.mesh.position.y = 0.08;
        part.velocity.y = Math.abs(part.velocity.y) * 0.2;
        part.velocity.x *= 0.82;
        part.velocity.z *= 0.82;
      }
      part.mesh.visibility = Math.min(1, part.life);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const target of this.targets.values()) {
      target.mesh.dispose();
      target.material.dispose();
    }
    this.targets.clear();
    for (const part of this.fragments) part.mesh.dispose();
    this.fragments.length = 0;
    this.fragmentMaterial.dispose();
  }
}
