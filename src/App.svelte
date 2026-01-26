<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { userStore } from './lib/stores/user.svelte';
  import { canvasStore } from './lib/stores/canvas.svelte';
  import { getPixelCoordinates, drawPixel, renderCanvas } from './lib/utils/canvas';
  import { CANVAS_SIZE, SCALE, MAX_INK, BASE_COLORS, BATCH_DELAY } from './lib/constants';
  import { supabase } from './lib/supabase';

  let canvasElement: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let color = $state('#000000');
  let isDrawing = $state(false);
  let lastPixel: { x: number; y: number } | null = null;
  let pendingPixels = $state<Record<string, string>>({});
  let batchTimeout: ReturnType<typeof setTimeout> | null = null;

  const ink = $derived(userStore.ink);
  const userId = $derived(userStore.id);
  const isLoading = $derived(userStore.isLoading);
  const inkPercentage = $derived((ink / MAX_INK) * 100);

  $effect(() => {
    const pixels = canvasStore.pixels;
    if (ctx && pixels && !isLoading) {
      const allPixels = { ...pixels, ...pendingPixels };
      renderCanvas(ctx, allPixels);
    }
  });

  onMount(async () => {
    await userStore.initialize();
    await canvasStore.load();
    
    ctx = canvasElement.getContext('2d');
    if (ctx) {
      renderCanvas(ctx, canvasStore.pixels);
    }
    
    canvasStore.subscribeToUpdates();
  });

  onDestroy(() => {
    userStore.destroy();
    canvasStore.destroy();
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
  });

  function scheduleBatch() {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }

    batchTimeout = setTimeout(() => {
      flushPixelBatch();
    }, BATCH_DELAY);
  }

  async function flushPixelBatch() {
    if (Object.keys(pendingPixels).length === 0 || !userId) return;

    const pixelsToSend = { ...pendingPixels };

    try {
      const { error: canvasError } = await supabase.rpc('update_canvas_pixels', {
        pixel_updates: pixelsToSend
      });

      if (canvasError) {
        console.error('Error updating canvas:', canvasError);
        const updatedPixels = { ...canvasStore.pixels, ...pixelsToSend };
        const { error: fallbackError } = await supabase
          .from('canvas_state')
          .update({
            pixels: updatedPixels,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);

        if (fallbackError) {
          console.error('Fallback update failed:', fallbackError);
          return;
        }
      }

      setTimeout(() => {
        Object.keys(pixelsToSend).forEach(key => {
          if (canvasStore.pixels[key] === pixelsToSend[key]) {
            delete pendingPixels[key];
          }
        });
      }, 100);

      await supabase
        .from('users')
        .update({
          ink: ink,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    } catch (error) {
      console.error('Error in batch update:', error);
    }
  }

  function handleDrawPixel(x: number, y: number, pixelColor: string) {
    if (ink <= 0 || !userId || !ctx) return false;

    if (lastPixel && (lastPixel.x !== x || lastPixel.y !== y)) {
      const dx = x - lastPixel.x;
      const dy = y - lastPixel.y;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      
      for (let i = 0; i <= steps; i++) {
        const t = steps > 0 ? i / steps : 0;
        const px = Math.round(lastPixel.x + dx * t);
        const py = Math.round(lastPixel.y + dy * t);
        const pixelKey = `${px},${py}`;
        
        if (pendingPixels[pixelKey] !== pixelColor) {
          drawPixel(ctx, px, py, pixelColor);
          canvasStore.addPixel(px, py, pixelColor);
          pendingPixels[pixelKey] = pixelColor;
          userStore.consumeInk(1);
        }
      }
    } else {
      const pixelKey = `${x},${y}`;
      drawPixel(ctx, x, y, pixelColor);
      canvasStore.addPixel(x, y, pixelColor);
      pendingPixels[pixelKey] = pixelColor;
      userStore.consumeInk(1);
    }

    lastPixel = { x, y };
    scheduleBatch();
    return true;
  }

  function handleMouseDown(e: MouseEvent) {
    if (ink <= 0 || isLoading) return;
    isDrawing = true;
    const coords = getPixelCoordinates(e, canvasElement);
    if (coords) {
      lastPixel = null;
      handleDrawPixel(coords.x, coords.y, color);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDrawing || ink <= 0 || isLoading) return;
    const coords = getPixelCoordinates(e, canvasElement);
    if (coords) {
      handleDrawPixel(coords.x, coords.y, color);
    }
  }

  function handleMouseUp() {
    isDrawing = false;
    lastPixel = null;
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    flushPixelBatch();
  }

  function handleMouseLeave() {
    isDrawing = false;
    lastPixel = null;
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    flushPixelBatch();
  }
</script>

{#if isLoading}
  <div>Loading...</div>
{:else}
  <div class="container">
    <h2 class="header">Graffiti Wall</h2>

    <div class="ink-meter">
      <div 
        class="ink-fill" 
        style="width: {inkPercentage}%; background: {ink < 10 ? 'red' : 'deepskyblue'};"
      ></div>
    </div>

    <div class="palette">
      {#each BASE_COLORS as c}
        <button
          class="color-button"
          class:selected={color === c}
          style="background-color: {c};"
          onclick={() => color = c}
          aria-label={`Select color ${c}`}
        ></button>
      {/each}
    </div>

    <canvas
      bind:this={canvasElement}
      width={CANVAS_SIZE * SCALE}
      height={CANVAS_SIZE * SCALE}
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
      onmouseleave={handleMouseLeave}
      aria-label="Graffiti Wall Canvas"
      class="canvas"
    ></canvas>
  </div>
{/if}

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1em;
  }

  .header {
    font-family: 'Pixelify Sans', sans-serif;
    font-size: 2rem;
    margin: 0;
  }

  .ink-meter {
    width: 300px;
    height: 20px;
    background: #eee;
    border-radius: 0;
    overflow: hidden;
  }

  .ink-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .palette {
    display: flex;
    gap: 0.5em;
  }

  .color-button {
    width: 30px;
    height: 30px;
    border: 1px solid black;
    cursor: pointer;
    padding: 0;
  }

  .color-button.selected {
    border: 3px solid white;
  }

  .canvas {
    border: 2px solid #333;
    cursor: crosshair;
    image-rendering: pixelated;
  }
</style>