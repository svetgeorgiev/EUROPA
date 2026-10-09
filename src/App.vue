<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { EuropaGame, type GameStats } from './game/EuropaGame';
const canvas = ref<HTMLCanvasElement | null>(null);
const locked = ref(false);
const error = ref('');
const stats = ref<GameStats>({ fps: 0, x: 0, y: 0, z: 0, grounded: false });
let game: EuropaGame | null = null;
onMounted(() => {
  if (!canvas.value) return;
  game = new EuropaGame(canvas.value, {
    onStats: value => { stats.value = value; },
    onLockChange: value => { locked.value = value; },
    onError: message => { error.value = message; }
  });
});
onBeforeUnmount(() => { game?.dispose(); game = null; });
function start(): void { game?.requestPointerLock(); }
</script>
<template>
  <main class="viewport">
    <canvas ref="canvas" class="game-canvas" @click="start" aria-label="EUROPA 3D game viewport" />
    <header class="hud-top"><div class="brand">EUROPA <span>001</span></div><div class="sub">ENGINE FOUNDATION · TEST ENVIRONMENT</div></header>
    <div class="stats" aria-live="off"><strong>{{ stats.fps }}</strong> FPS <span class="separator">·</span> X {{ stats.x.toFixed(1) }} · Y {{ stats.y.toFixed(1) }} · Z {{ stats.z.toFixed(1) }} <span class="separator">·</span> {{ stats.grounded ? 'GROUNDED' : 'AIRBORNE' }}</div>
    <div v-if="error" style="position:absolute;top:90px;left:24px;right:24px;padding:16px;background:#5b1414;color:white;z-index:30;overflow-wrap:anywhere">Game engine error: {{ error }} — press F12 for details.</div>
    <div v-if="locked" class="crosshair" aria-hidden="true">+</div>
    <section v-if="!locked" class="start-overlay" @click="start">
      <div class="start-card">
        <div class="eyebrow">PROTOTYPE BUILD 0.1</div>
        <h1>THE WORLD<br />AFTER THE FALL.</h1>
        <p>A first-person movement and collision test. Real-world geographic data comes in a later milestone.</p>
        <button type="button" @click.stop="start">CLICK TO ENTER <span>→</span></button>
        <div class="controls">WASD — Move <span>·</span> Mouse — Look <span>·</span> Shift — Sprint <span>·</span> Space — Jump <span>·</span> Esc — Pause</div>
      </div>
    </section>
    <footer class="footer">NOVA ZAGORA · GEOGRAPHIC IMPORT NOT YET ENABLED</footer>
  </main>
</template>
