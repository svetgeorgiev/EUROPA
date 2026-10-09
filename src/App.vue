<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { EuropaGame, type GameStats } from './game/EuropaGame';
import { computed } from 'vue';
import { worldToGeo } from './geo/coordinates';
import { NOVA_ZAGORA_ANCHOR } from './geo/worldConfig';
const canvas = ref<HTMLCanvasElement | null>(null);
const locked = ref(false);
const error = ref('');
const worldMode = ref<'test' | 'osm'>('test');
const stats = ref<GameStats>({ fps: 0, x: 0, y: 0, z: 0, grounded: false });
const previewGeo = computed(() => worldToGeo({ x: stats.value.x, y: 0, z: stats.value.z }, NOVA_ZAGORA_ANCHOR));
let game: EuropaGame | null = null;
onMounted(() => {
  if (!canvas.value) return;
  game = new EuropaGame(canvas.value, {
    onStats: value => { stats.value = value; },
    onLockChange: value => { locked.value = value; },
    onError: message => { error.value = message; },
    onWorldChange: mode => { worldMode.value = mode; }
  });
});
onBeforeUnmount(() => { game?.dispose(); game = null; });
function start(): void { game?.requestPointerLock(); }
</script>
<template>
  <main class="viewport">
    <canvas ref="canvas" class="game-canvas" @click="start" aria-label="EUROPA 3D game viewport" />
    <header class="hud-top"><div class="brand">EUROPA <span>002B</span></div><div class="sub">{{ worldMode === 'osm' ? 'REAL-WORLD STREET & BUILDING LAYOUT' : 'TEST ENVIRONMENT · IMPORT PENDING' }}</div></header>
    <div class="stats" aria-live="off"><strong>{{ stats.fps }}</strong> FPS <span class="separator">·</span> X {{ stats.x.toFixed(1) }} · Y {{ stats.y.toFixed(1) }} · Z {{ stats.z.toFixed(1) }} <span class="separator">·</span> {{ stats.grounded ? 'GROUNDED' : 'AIRBORNE' }}</div>
    <div class="geo-preview" :title="worldMode === 'osm' ? 'Real OSM planimetric geometry; elevation not yet implemented' : 'Simulated projection only — run pnpm map:fetch to import real roads and buildings'">{{ worldMode === 'osm' ? 'OSM GEO PREVIEW · FLAT TERRAIN' : 'GEO PREVIEW (SIMULATED)' }} · {{ previewGeo.latitude.toFixed(6) }}° N · {{ previewGeo.longitude.toFixed(6) }}° E</div>
    <div v-if="error" style="position:absolute;top:90px;left:24px;right:24px;padding:16px;background:#5b1414;color:white;z-index:30;overflow-wrap:anywhere">Game engine error: {{ error }} — press F12 for details.</div>
    <div v-if="locked" class="crosshair" aria-hidden="true">+</div>
    <section v-if="!locked" class="start-overlay" @click="start">
      <div class="start-card">
        <div class="eyebrow">PROTOTYPE BUILD 0.1</div>
        <h1>THE WORLD<br />AFTER THE FALL.</h1>
        <p>{{ worldMode === 'osm' ? 'Explore real Nova Zagora street and building footprints from OpenStreetMap. Buildings are simplified, terrain is flat and interiors are not implemented.' : 'This is still the synthetic test environment. Run pnpm map:fetch to download real Nova Zagora streets and buildings.' }}</p>
        <button type="button" @click.stop="start">CLICK TO ENTER <span>→</span></button>
        <div class="controls">WASD — Move <span>·</span> Mouse — Look <span>·</span> Shift — Sprint <span>·</span> Space — Jump <span>·</span> Esc — Pause</div>
      </div>
    </section>
    <footer class="footer"><template v-if="worldMode === 'osm'">NOVA ZAGORA · MAP DATA <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL 1.0</a></template><template v-else>NOVA ZAGORA · SYNTHETIC TEST WORLD · RUN pnpm map:fetch</template></footer>
  </main>
</template>
