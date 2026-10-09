<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { WorldMap } from '../world/osm';

const props = defineProps<{
  map: WorldMap;
  x: number;
  z: number;
  yaw: number;
  overview: boolean;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const size = computed(() => props.overview ? 340 : 216);
const viewDistance = computed(() => props.overview ? 1000 : 240);
const label = computed(() => props.overview ? 'NOVA ZAGORA · 1 KM²' : 'LOCAL MAP · NORTH UP');

function draw(): void {
  const element = canvas.value;
  if (!element) return;
  const ctx = element.getContext('2d');
  if (!ctx) return;
  const n = size.value;
  const scale = (n - 24) / viewDistance.value;
  const centerX = props.overview ? 0 : props.x;
  const centerZ = props.overview ? 0 : props.z;
  const project = (x: number, z: number): [number, number] => [
    n / 2 + (x - centerX) * scale,
    n / 2 - (z - centerZ) * scale
  ];
  ctx.clearRect(0, 0, n, n);
  ctx.fillStyle = '#1c282a';
  ctx.fillRect(0, 0, n, n);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, n, n);
  ctx.clip();

  // Fixed geographic metre grid shows stable orientation when walking.
  ctx.strokeStyle = 'rgba(194,205,193,0.10)';
  ctx.lineWidth = 1;
  const radius = viewDistance.value * 0.7;
  for (let i = Math.floor((centerX - radius) / 50) * 50; i <= centerX + radius; i += 50) {
    const [screenX] = project(i, centerZ);
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, n);
    ctx.stroke();
  }
  for (let j = Math.floor((centerZ - radius) / 50) * 50; j <= centerZ + radius; j += 50) {
    const [, screenY] = project(centerX, j);
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(n, screenY);
    ctx.stroke();
  }

  // Real OSM building footprints; rendered as simple diagram symbols.
  ctx.fillStyle = '#626f69';
  ctx.strokeStyle = '#82918a';
  ctx.lineWidth = 0.7;
  for (const building of props.map.buildings) {
    if (building.outline.length < 3) continue;
    const [firstX, firstY] = project(building.outline[0].x, building.outline[0].z);
    ctx.beginPath();
    ctx.moveTo(firstX, firstY);
    for (let i = 1; i < building.outline.length; i++) {
      const [px, py] = project(building.outline[i].x, building.outline[i].z);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Real OSM road centerlines and approximate width, not navigation routing.
  ctx.strokeStyle = '#c2b8a6';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of props.map.roads) {
    const [x1, y1] = project(road.a.x, road.a.z);
    const [x2, y2] = project(road.b.x, road.b.z);
    ctx.lineWidth = Math.max(1, road.widthMeters * scale);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  // Player arrow remains geographic north-up; yaw 0 = facing north (+Z).
  const [px, py] = project(props.x, props.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(props.yaw);
  ctx.fillStyle = '#e9b55e';
  ctx.strokeStyle = '#0c1517';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(7, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.font = 'bold 11px system-ui';
  ctx.fillStyle = '#dbe8d7';
  ctx.fillText('N', 10, 17);
  ctx.strokeStyle = '#dbe8d7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(n - 82, n - 16);
  ctx.lineTo(n - 82 + 50 * scale, n - 16);
  ctx.stroke();
  ctx.font = '10px system-ui';
  ctx.fillText('50 m', n - 82, n - 23);
}

onMounted(draw);
watch([
  () => props.x, () => props.z, () => props.yaw, () => props.map, () => props.overview
], draw, { flush: 'post' });
</script>

<template>
  <section class="local-map" :class="{ 'local-map--overview': overview }"
    aria-label="North-up local map using OpenStreetMap building and street geometry">
    <div class="local-map__heading">
      <span>{{ label }}</span>
      <span class="local-map__hint">M · {{ overview ? 'ZOOM IN' : 'OVERVIEW' }}</span>
    </div>
    <canvas ref="canvas" :width="size" :height="size"
      role="img" aria-label="OpenStreetMap streets, building outlines, north indicator and player arrow" />
    <div class="local-map__footer">Your position <span>{{ x.toFixed(0) }} E · {{ z.toFixed(0) }} N</span></div>
  </section>
</template>

<style scoped>
.local-map{position:absolute;left:20px;bottom:43px;z-index:4;background:rgba(15,25,27,.91);border:1px solid #62736a88;border-radius:7px;overflow:hidden;width:218px;color:#d2e1d7;font-family:inherit;pointer-events:none;box-shadow:0 5px 22px #0007}
.local-map--overview{width:342px}
.local-map__heading,.local-map__footer{padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:7px}
.local-map__heading{font-size:10px;font-weight:700;letter-spacing:.09em}
.local-map__hint{font-size:9px;color:#d9ad63}
.local-map canvas{display:block;width:100%;height:auto}
.local-map__footer{font-size:10px;color:#b2c3bb}
.local-map__footer span{color:#f4d6a0;font-variant-numeric:tabular-nums}
@media(max-width:600px){.local-map{bottom:34px;left:12px;width:172px}.local-map--overview{width:min(310px,90vw)}}
</style>
