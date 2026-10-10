import { Matrix, Scene, Vector3 } from '@babylonjs/core';
import { getCoverageReport, type LandmarkCoverage } from './buildingCoverage.ts';
import type { WorldMap, Point2 } from './osm.ts';
import type { NavigationData } from './navigation.ts';
import {
  mappedBuildingsOnCampus, mappedSchoolForLandmark,
  type CampusSiteData
} from './CampusSites.ts';

interface Marker {
  position: Point2;
  element: HTMLDivElement;
  schoolGrounds: boolean;
}

/**
 * A screen-space overlay projected from the real OSM point, rather than a
 * double-sided Babylon plane. Text stays upright and legible from EVERY
 * viewing direction. The overlay is not world geometry or a collider.
 */
export class PoiMarkers {
  private readonly markers: Marker[] = [];
  private readonly layer: HTMLDivElement;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;

  constructor(
    scene: Scene, canvas: HTMLCanvasElement, map: WorldMap,
    nav: NavigationData, sites: CampusSiteData | null = null
  ) {
    this.scene = scene;
    this.canvas = canvas;
    const parent = canvas.parentElement;
    if (!parent) throw new Error('Game canvas has no label overlay parent');
    const layer = document.createElement('div');
    layer.className = 'poi-marker-layer';
    layer.setAttribute('aria-hidden', 'true');
    // No click interception: pointer lock and the minimap remain usable.
    layer.style.pointerEvents = 'none';
    this.layer = layer;
    parent.appendChild(layer);

    try {
      for (const entry of getCoverageReport(map, nav).slice(0, 45)) {
        const marker = this.makeMarker(entry, map, sites);
        layer.appendChild(marker.element);
        this.markers.push(marker);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private makeMarker(
    entry: LandmarkCoverage, map: WorldMap, sites: CampusSiteData | null
  ): Marker {
    const mappedFootprint = entry.status !== 'no-nearby-footprint';
    const school = sites ? mappedSchoolForLandmark(entry.landmark, sites.sites) : null;
    const campusBuildingCount = school
      ? mappedBuildingsOnCampus(school, map.buildings).length : 0;
    const element = document.createElement('div');
    element.className = school ? 'poi-marker poi-marker--campus'
      : mappedFootprint ? 'poi-marker' : 'poi-marker poi-marker--no-footprint';
    const title = document.createElement('strong');
    // textContent avoids accidentally interpreting OSM user-provided names as HTML.
    title.textContent = entry.landmark.name;
    const caption = document.createElement('span');
    caption.textContent = school
      ? 'MAPPED SCHOOL GROUNDS · ' + campusBuildingCount +
        (campusBuildingCount === 1 ? ' BUILDING IN SITE' : ' BUILDINGS IN SITE')
      : mappedFootprint
        ? 'OSM LANDMARK · NEAR IMPORTED BUILDING'
        : 'OSM POI · NO IMPORTED BUILDING OUTLINE';
    element.append(title, caption);
    element.hidden = true;
    return { position: entry.landmark.point, element, schoolGrounds: school !== null };
  }

  /** Run at most ~30 fps from the game loop, even at high render rates. */
  update(player: Point2, maxDistance = 85): void {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth(), height = engine.getRenderHeight();
    if (!width || !height || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
    const forward = camera.getForwardRay().direction;
    const viewport = camera.viewport.toGlobal(width, height);
    const cssX = this.canvas.clientWidth / width;
    const cssY = this.canvas.clientHeight / height;
    let shown = 0;
    for (const marker of this.markers) {
      // Campus identity is useful before arriving at the school gate. Other
      // POIs retain the existing short range to avoid a wall of labels.
      const range = marker.schoolGrounds ? Math.max(maxDistance, 130) : maxDistance;
      const dx = marker.position.x - player.x, dz = marker.position.z - player.z;
      if (dx * dx + dz * dz > range * range ||
          dx * dx + dz * dz < 16 || shown >= 8) {
        marker.element.hidden = true;
        continue;
      }
      const point = new Vector3(marker.position.x, 4.0, marker.position.z);
      if (Vector3.Dot(forward, point.subtract(camera.position)) <= 0.5) {
        marker.element.hidden = true;
        continue;
      }
      const result = Vector3.Project(point, Matrix.Identity(),
        this.scene.getTransformMatrix(), viewport);
      if (result.z < 0 || result.z > 1 || !Number.isFinite(result.x) || !Number.isFinite(result.y)) {
        marker.element.hidden = true;
        continue;
      }
      const x = result.x * cssX, y = result.y * cssY;
      if (x < 48 || x > this.canvas.clientWidth - 48 ||
          y < 72 || y > this.canvas.clientHeight - 65) {
        marker.element.hidden = true;
        continue;
      }
      marker.element.hidden = false;
      marker.element.style.left = x.toFixed(1) + 'px';
      marker.element.style.top = y.toFixed(1) + 'px';
      shown++;
    }
  }

  dispose(): void {
    this.layer.remove();
    this.markers.length = 0;
  }
}
