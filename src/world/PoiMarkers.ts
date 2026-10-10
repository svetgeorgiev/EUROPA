import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial
} from '@babylonjs/core';
import { getCoverageReport, type LandmarkCoverage } from './buildingCoverage.ts';
import type { WorldMap, Point2 } from './osm.ts';
import type { NavigationData } from './navigation.ts';

interface Marker {
  position: Point2;
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
}

/**
 * Lightweight floating "mapped place" labels. A POI marker is NEVER a building
 * footprint or a solid collider. It represents the point in the OSM dataset.
 */
export class PoiMarkers {
  private readonly markers: Marker[] = [];

  constructor(scene: Scene, map: WorldMap, nav: NavigationData) {
    const entries = getCoverageReport(map, nav);
    for (const entry of entries.slice(0, 45)) {
      const label = this.makeMarker(scene, entry);
      if (label) this.markers.push(label);
    }
  }

  private makeMarker(scene: Scene, entry: LandmarkCoverage): Marker | null {
    const point = entry.landmark.point;
    const mappedFootprint = entry.status !== 'no-nearby-footprint';
    const label = entry.landmark.name;
    const texture = new DynamicTexture('poi-label-' + entry.landmark.id,
      { width: 512, height: 128 }, scene, false);
    try {
      const ctx = texture.getContext();
      ctx.fillStyle = mappedFootprint ? '#182b29' : '#3a2f20';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = mappedFootprint ? '#779b86' : '#d6a960';
      ctx.lineWidth = 5;
      ctx.strokeRect(3, 3, 506, 122);
      ctx.fillStyle = '#f4ead6';
      ctx.font = 'bold 35px sans-serif';
      const title = label.length > 24 ? label.slice(0, 23) + '…' : label;
      ctx.fillText(title, 18, 53);
      ctx.fillStyle = mappedFootprint ? '#aec7b2' : '#f4c87c';
      ctx.font = '24px sans-serif';
      ctx.fillText(mappedFootprint ? 'OSM LANDMARK · NEAR BUILDING'
        : 'OSM POI · NO IMPORTED FOOTPRINT', 18, 94);
      texture.update(false);
      const material = new StandardMaterial('poi-material-' + entry.landmark.id, scene);
      material.diffuseTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      const mesh = MeshBuilder.CreatePlane('poi-' + entry.landmark.id,
        { width: 5.0, height: 1.25 }, scene);
      mesh.position.set(point.x, 3.6, point.z);
      mesh.material = material;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.setEnabled(false);
      return { position: point, mesh, material, texture };
    } catch (error) {
      console.warn('EUROPA: could not create optional POI label', error);
      texture.dispose();
      return null;
    }
  }

  update(player: Point2, maxDistance = 110): void {
    const maximumSquared = maxDistance * maxDistance;
    for (const marker of this.markers) {
      const distance = (player.x - marker.position.x) ** 2 +
        (player.z - marker.position.z) ** 2;
      marker.mesh.setEnabled(distance < maximumSquared && distance > 4);
    }
  }

  dispose(): void {
    for (const marker of this.markers) {
      marker.mesh.dispose();
      marker.material.dispose();
      marker.texture.dispose();
    }
    this.markers.length = 0;
  }
}
