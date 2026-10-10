import {
  Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3, VertexData
} from '@babylonjs/core';
import { buildCampusSurface, isSchoolSite, type CampusSiteData } from './CampusSites.ts';

/**
 * Lightweight site-specific ground tint and annotation outline from real OSM
 * polygons. Neither is a fence, collision wall or verified path/entrance.
 * Lives across tile streaming: the 1km static metadata is only a few polygons.
 */
export class CampusGrounds {
  private readonly meshes: Mesh[] = [];
  private readonly surfaceMaterial: StandardMaterial;

  constructor(scene: Scene, data: CampusSiteData) {
    this.surfaceMaterial = new StandardMaterial('osm-campus-tint', scene);
    this.surfaceMaterial.diffuseColor = Color3.FromHexString('#8a956f');
    this.surfaceMaterial.emissiveColor = Color3.FromHexString('#182117');
    this.surfaceMaterial.specularColor = Color3.Black();
    this.surfaceMaterial.alpha = 0.85;
    this.surfaceMaterial.backFaceCulling = false;
    try {
      for (const site of data.sites.filter(isSchoolSite)) {
        const geometry = buildCampusSurface(site);
        if (!geometry) continue;
        const mesh = new Mesh('mapped-campus-ground-' + site.sourceId, scene);
        this.meshes.push(mesh);
        const vertices = new VertexData();
        vertices.positions = geometry.positions;
        vertices.normals = geometry.normals;
        vertices.indices = geometry.indices;
        vertices.applyToMesh(mesh);
        mesh.material = this.surfaceMaterial;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        for (let ringIndex = 0; ringIndex < geometry.boundaryRings.length; ringIndex++) {
          const ring = geometry.boundaryRings[ringIndex];
          const points = [...ring, ring[0]].map(
            point => new Vector3(point.x, 0.078, point.z)
          );
          const border = MeshBuilder.CreateLines(
            'mapped-campus-outline-' + site.sourceId + '-' + ringIndex,
            { points }, scene
          );
          border.color = Color3.FromHexString('#d3ca94');
          border.isPickable = false;
          border.checkCollisions = false;
          this.meshes.push(border);
        }
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes.length = 0;
    this.surfaceMaterial.dispose();
  }
}
