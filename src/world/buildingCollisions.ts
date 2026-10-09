import type { BuildingFootprint, Point2 } from './osm.ts';

/**
 * 2D player clearance against OSM building footprints.
 * Independent of visual triangle winding, mesh backface settings and Babylon.
 * Buildings are currently sealed (no interiors, doors or ramps).
 */
interface PreparedBuilding {
  outline: Point2[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function segmentDistanceSquared(point: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 1e-10
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lenSq))
    : 0;
  const px = point.x - a.x - t * dx;
  const pz = point.z - a.z - t * dz;
  return px * px + pz * pz;
}

function insidePolygon(point: Point2, outline: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.z > point.z) !== (b.z > point.z)) {
      const intersectionX = (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x;
      if (point.x < intersectionX) inside = !inside;
    }
  }
  return inside;
}

function prepare(building: BuildingFootprint): PreparedBuilding | null {
  const outline = building.outline;
  if (!Array.isArray(outline) || outline.length < 3 || outline.length > 300 ||
      outline.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
  return {
    outline,
    minX: Math.min(...outline.map(p => p.x)),
    maxX: Math.max(...outline.map(p => p.x)),
    minZ: Math.min(...outline.map(p => p.z)),
    maxZ: Math.max(...outline.map(p => p.z))
  };
}

export class BuildingCollisionField {
  private readonly groups = new Map<string, PreparedBuilding[]>();

  setGroup(id: string, buildings: readonly BuildingFootprint[]): void {
    const prepared = buildings.map(prepare).filter((entry): entry is PreparedBuilding => entry !== null);
    this.groups.set(id, prepared);
  }

  removeGroup(id: string): void {
    this.groups.delete(id);
  }

  clear(): void {
    this.groups.clear();
  }

  isBlocked(point: Point2, radius: number): boolean {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z) ||
        !Number.isFinite(radius) || radius <= 0) return true;
    const radiusSq = radius * radius;
    for (const buildings of this.groups.values()) {
      for (const building of buildings) {
        if (point.x < building.minX - radius || point.x > building.maxX + radius ||
            point.z < building.minZ - radius || point.z > building.maxZ + radius) continue;
        if (insidePolygon(point, building.outline)) return true;
        for (let i = 0; i < building.outline.length; i++) {
          if (segmentDistanceSquared(point, building.outline[i],
            building.outline[(i + 1) % building.outline.length]) <= radiusSq) return true;
        }
      }
    }
    return false;
  }

  /**
   * Small swept steps prevent tunnelling into thin or concave outlines at sprint
   * speed or during slow frames. Axis fallback gives predictable wall sliding.
   */
  move(position: Point2, displacement: Point2, radius: number): Point2 {
    if (this.isBlocked(position, radius)) return { ...position };
    if (!Number.isFinite(displacement.x) || !Number.isFinite(displacement.z)) return { ...position };
    const distance = Math.hypot(displacement.x, displacement.z);
    if (!distance) return { ...position };
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.08, Math.min(0.18, radius / 2))));
    const sx = displacement.x / steps, sz = displacement.z / steps;
    let x = position.x, z = position.z;
    for (let i = 0; i < steps; i++) {
      const diagonal = { x: x + sx, z: z + sz };
      if (!this.isBlocked(diagonal, radius)) {
        x = diagonal.x;
        z = diagonal.z;
        continue;
      }
      if (!this.isBlocked({ x: x + sx, z }, radius)) x += sx;
      if (!this.isBlocked({ x, z: z + sz }, radius)) z += sz;
    }
    return { x, z };
  }

  /**
   * Look outward from the requested spawn, with a modest safety margin.
   * Used at initial spawn and by R to recover from bad imported data.
   */
  findSafePosition(
    preferred: Point2, radius: number, halfWorldSize = 500, maxDistance = 100
  ): Point2 | null {
    const limit = halfWorldSize - radius - 2;
    const initial = {
      x: Math.max(-limit, Math.min(limit, preferred.x)),
      z: Math.max(-limit, Math.min(limit, preferred.z))
    };
    if (!this.isBlocked(initial, radius)) return initial;
    for (let distance = 1; distance <= maxDistance; distance += 1) {
      for (let step = 0; step < 32; step++) {
        const angle = (step * Math.PI * 2) / 32;
        const point = {
          x: initial.x + Math.cos(angle) * distance,
          z: initial.z + Math.sin(angle) * distance
        };
        if (Math.abs(point.x) >= limit || Math.abs(point.z) >= limit) continue;
        if (!this.isBlocked(point, radius)) return point;
      }
    }
    return null;
  }
}
