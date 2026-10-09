<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { WorldMap } from '../world/osm';
import { nearestNamedStreet, type NavigationData } from '../world/navigation';

const props = defineProps<{
  map: WorldMap;
  navigation?: NavigationData | null;
  x: number;
  z: number;
  yaw: number;
  overview: boolean;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const size = computed(() => props.overview ? 340 : 216);
const viewDistance = computed(() => props.overview ? 1000 : 240);
const label = computed(() => props.overview ? 'NOVA ZAGORA · 1 KM²' : 'LOCAL MAP · NORTH UP');
const nearbyStreet = computed(() => props.navigation
  ? nearestNamedStreet(props.navigation.streets, { x: props.x, z: props.z }, 110)
  : null);

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

  // Text labels are a distinct, optional ODbL metadata layer.
  // Screen-space collision checking keeps small maps readable.
  if (props.navigation) {
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const near = (item: { point: { x: number; z: number } }): number =>
      (item.point.x - centerX) ** 2 + (item.point.z - centerZ) ** 2;
    const visible = (p: { x: number; z: number }): boolean => {
      const [x, y] = project(p.x, p.z);
      return x >= 14 && y >= 24 && x <= n - 14 && y <= n - 18;
    };

    const labelAt = (name: string, point: { x: number; z: number }, landmark: boolean): void => {
      const [x, y] = project(point.x, point.z);
      ctx.font = landmark ? '600 10px system-ui' : '10px system-ui';
      const displayed = name.length > 26 ? name.slice(0, 25) + '…' : name;
      const width = Math.ceil(ctx.measureText(displayed).width) + 10;
      const height = 15;
      const rect = {
        x: Math.max(5, Math.min(n - width - 5, x - width / 2)),
        y: Math.max(21, Math.min(n - height - 7, y - 21)),
        w: width, h: height
      };
      if (boxes.some(old => rect.x < old.x + old.w + 3 &&
          rect.x + rect.w + 3 > old.x &&
          rect.y < old.y + old.h + 3 &&
          rect.y + rect.h + 3 > old.y)) return;
      boxes.push(rect);
      ctx.fillStyle = landmark ? 'rgba(45,41,30,.92)' : 'rgba(18,27,29,.82)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = landmark ? '#f2cb7f' : '#e2e0d5';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayed, rect.x + 5, rect.y + height / 2);
      ctx.textBaseline = 'alphabetic';
      if (landmark) {
        ctx.fillStyle = '#e9b55e';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    for (const item of [...props.navigation.landmarks]
      .filter(item => visible(item.point)).sort((a, b) => near(a) - near(b))
      .slice(0, props.overview ? 14 : 9)) {
      labelAt(item.name, item.point, true);
    }
    for (const item of [...props.navigation.streets]
      .filter(item => visible(item.point)).sort((a, b) => near(a) - near(b))
      .slice(0, props.overview ? 16 : 12)) {
      labelAt(item.name, item.point, false);
    }
  }

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
  () => props.x, () => props.z, () => props.yaw, () => props.map,
  () => props.navigation, () => props.overview
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
    <div v-if="navigation" class="local-map__metadata">
      <span>{{ navigation.streets.length }} named ways · {{ navigation.landmarks.length }} landmarks</span>
      <span v-if="nearbyStreet" :title="'Approximate nearest mapped label: ' + nearbyStreet.name">NEAR: {{ nearbyStreet.name }}</span>
    </div>
    <div v-else class="local-map__metadata local-map__metadata--empty">Names not imported yet · run map:nav</div>
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
.local-map__metadata{padding:5px 10px;display:flex;flex-direction:column;gap:3px;border-top:1px solid #ffffff18;color:#c2cabe;font-size:9px;line-height:1.35;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.local-map__metadata span{overflow:hidden;text-overflow:ellipsis}
.local-map__metadata--empty{color:#e9b55e}
@media(max-width:600px){.local-map{bottom:34px;left:12px;width:172px}.local-map--overview{width:min(310px,90vw)}}
</style>
