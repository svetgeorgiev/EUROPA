import {
  Color3, DynamicTexture, Mesh, Scene, StandardMaterial, Texture, VertexData
} from '@babylonjs/core';
import {
  buildFacadeDecor, buildRoadDecor, type DetailGeometry
} from './proceduralDetails.ts';
import type { MapBounds } from './roadJunctions.ts';

export const WORLD_COLORS = {
  grass: '#586b56',
  asphalt: '#495156',
  footpath: '#817b6e',
  concrete: '#8e8c82',
  paint: '#c1bba7',
  facades: ['#9b887a', '#847b70', '#969d97', '#a48e80', '#9f9d93']
} as const;

export function makeMaterial(
  scene: Scene, name: string, hex: string, emissiveStrength = 0.035
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.ambientColor = color.scale(0.4);
  mat.emissiveColor = color.scale(emissiveStrength);
  mat.specularColor = new Color3(0.035, 0.035, 0.035);
  mat.specularPower = 24;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  return mat;
}

function speckledSurface(
  scene: Scene, name: string, kind: 'grass' | 'asphalt', tileCount: number
): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 256, height: 256 }, scene, false);
  const context = texture.getContext();
  context.fillStyle = kind === 'grass' ? '#64765d' : '#4f575a';
  context.fillRect(0, 0, 256, 256);
  let seed = kind === 'grass' ? 0x9a132a : 0x40fe31;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Stable palette variation, not external photographic assets or map data.
  const palette = kind === 'grass'
    ? ['#4e6250', '#73846c', '#556c55', '#78866b', '#4d5e4d']
    : ['#40474a', '#656d6f', '#545c5e', '#444c4f', '#717879'];
  for (let i = 0; i < 2400; i++) {
    context.fillStyle = palette[Math.floor(random() * palette.length)];
    const x = Math.floor(random() * 256);
    const y = Math.floor(random() * 256);
    const size = random() > 0.92 ? 3 : 1;
    context.fillRect(x, y, size, size);
  }
  if (kind === 'asphalt') {
    context.strokeStyle = '#454c50';
    context.lineWidth = 0.65;
    for (let i = 0; i < 9; i++) {
      const x = random() * 256, y = random() * 256;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + random() * 22, y + random() * 11);
      context.stroke();
    }
  }
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = tileCount;
  texture.vScale = tileCount;
  return texture;
}

export interface WorldMaterials {
  ground: StandardMaterial;
  road: StandardMaterial;
  path: StandardMaterial;
  shoulder: StandardMaterial;
  marking: StandardMaterial;
  facadeDetail: StandardMaterial;
  treeBark: StandardMaterial;
  treeFoliage: StandardMaterial;
  roofs: StandardMaterial[];
  walls: StandardMaterial[];
  dispose: () => void;
}

export function createWorldMaterials(
  scene: Scene, namePrefix: string, groundSizeMeters: number
): WorldMaterials {
  const ground = makeMaterial(scene, namePrefix + '-terrain', '#ffffff', 0.015);
  const road = makeMaterial(scene, namePrefix + '-asphalt', '#ffffff', 0.035);
  const path = makeMaterial(scene, namePrefix + '-footpath', WORLD_COLORS.footpath, 0.035);
  const shoulder = makeMaterial(scene, namePrefix + '-shoulders', WORLD_COLORS.concrete, 0.03);
  const marking = makeMaterial(scene, namePrefix + '-road-marking', WORLD_COLORS.paint, 0.04);
  const facadeDetail = makeMaterial(scene, namePrefix + '-facade-decoration', '#c1c7c5', 0.075);
  const treeBark = makeMaterial(scene, namePrefix + '-tree-bark', '#76523c', 0.025);
  const treeFoliage = makeMaterial(scene, namePrefix + '-tree-leaves', '#3c6643', 0.025);
  treeBark.specularColor = Color3.Black();
  treeFoliage.specularColor = Color3.Black();
  const roofs = ['#a6593d', '#884b3a', '#636268'].map((hex, i) =>
    makeMaterial(scene, namePrefix + '-roof-' + i, hex, 0.035));
  const roofTexture = new DynamicTexture(namePrefix + '-roof-tiles',
    { width: 128, height: 128 }, scene, false);
  const roofContext = roofTexture.getContext();
  roofContext.fillStyle = '#dbd3c9';
  roofContext.fillRect(0, 0, 128, 128);
  roofContext.strokeStyle = '#8e8882';
  roofContext.lineWidth = 2;
  // Stylised clay/slate tile courses; shared across all chunks.
  for (let y = 0; y <= 128; y += 16) {
    roofContext.beginPath();
    roofContext.moveTo(0, y);
    roofContext.lineTo(128, y);
    roofContext.stroke();
    for (let x = ((y / 16) % 2) * 12; x <= 128; x += 24) {
      roofContext.beginPath();
      roofContext.moveTo(x, y);
      roofContext.lineTo(x, y + 16);
      roofContext.stroke();
    }
  }
  roofTexture.update(false);
  roofTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  roofTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  for (const roof of roofs) roof.diffuseTexture = roofTexture;

  const walls = WORLD_COLORS.facades.map((hex, i) =>
    makeMaterial(scene, namePrefix + '-facade-' + i, hex, 0.04)
  );

  const textures = [
    speckledSurface(scene, namePrefix + '-grass-grain', 'grass',
      Math.max(1, Math.round(groundSizeMeters / 10))),
    speckledSurface(scene, namePrefix + '-asphalt-grain', 'asphalt', 1)
  ];
  ground.diffuseTexture = textures[0];
  road.diffuseTexture = textures[1];
  const materials = [ground, road, path, shoulder, marking, facadeDetail, treeBark, treeFoliage, ...roofs, ...walls];
  return {
    ground, road, path, shoulder, marking, facadeDetail, treeBark, treeFoliage, roofs, walls,
    dispose: () => {
      for (const material of materials) material.dispose();
      for (const texture of [...textures, roofTexture]) texture.dispose();
    }
  };
}

export function makeDetailMesh(
  scene: Scene, name: string, data: DetailGeometry, material: StandardMaterial
): Mesh | null {
  if (!data.indices.length) return null;
  const mesh = new Mesh(name, scene);
  const vertices = new VertexData();
  vertices.positions = data.positions;
  vertices.indices = data.indices;
  vertices.normals = data.normals;
  if (data.colors) vertices.colors = data.colors;
  vertices.applyToMesh(mesh);
  mesh.material = material;
  mesh.useVertexColors = Boolean(data.colors);
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  return mesh;
}

export function renderProceduralRoadDetails(
  scene: Scene,
  prefix: string,
  roads: readonly import('./osm.ts').RoadSegment[],
  materials: WorldMaterials,
  bounds?: MapBounds
): Mesh[] {
  const decorations = buildRoadDecor(roads, bounds);
  const shoulders = makeDetailMesh(scene, prefix + '-shoulders',
    decorations.shoulders, materials.shoulder);
  const markings = makeDetailMesh(scene, prefix + '-lane-paint',
    decorations.markings, materials.marking);
  return [shoulders, markings].filter((mesh): mesh is Mesh => mesh !== null);
}

export function renderProceduralFacadeDetails(
  scene: Scene,
  prefix: string,
  buildings: readonly import('./osm.ts').BuildingFootprint[],
  materials: WorldMaterials
): Mesh | null {
  return makeDetailMesh(scene, prefix + '-windows-and-doors',
    buildFacadeDecor(buildings), materials.facadeDetail);
}
