<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { userStore } from './lib/stores/user.svelte';
  import { canvasStore } from './lib/stores/canvas.svelte';
  import { getPixelCoordinates, drawPixel, renderCanvas } from './lib/utils/canvas';
  import { CANVAS_SIZE, SCALE, MAX_INK, BASE_COLORS, BATCH_DELAY } from './lib/constants';
  import { supabase } from './lib/supabase';

  let canvasElement: HTMLCanvasElement;
  let colorPickerElement: HTMLInputElement;
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

  function handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (ink <= 0 || isLoading) return;
    isDrawing = true;
    const touch = e.touches[0];
    const coords = getPixelCoordinatesFromPoint(touch.clientX, touch.clientY);
    if (coords) {
      lastPixel = null;
      handleDrawPixel(coords.x, coords.y, color);
    }
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!isDrawing || ink <= 0 || isLoading) return;
    const touch = e.touches[0];
    const coords = getPixelCoordinatesFromPoint(touch.clientX, touch.clientY);
    if (coords) {
      handleDrawPixel(coords.x, coords.y, color);
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    isDrawing = false;
    lastPixel = null;
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    flushPixelBatch();
  }

  function getPixelCoordinatesFromPoint(clientX: number, clientY: number) {
    if (!canvasElement) return null;
    const rect = canvasElement.getBoundingClientRect();
    // Calculate based on actual rendered size vs canvas logical size
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);

    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return null;

    return { x, y };
  }
</script>

{#if isLoading}
  <div>Loading...</div>
{:else}
  <div class="container">
    <h2 class="header">Graffiti Wall</h2>

    <p class="description">Vandalize the wall. Ink regenerates over time.
      <br>
      I'm not responsible for whatever's on here.
    </p>

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
      <label class="rainbow-button-wrapper">
        <button
          class="color-button rainbow-button"
          onclick={() => colorPickerElement?.click()}
          ontouchstart={(e) => {
            e.stopPropagation();
            colorPickerElement?.click();
          }}
          aria-label="Choose custom color"
          title="Choose custom color"
        >
        </button>
        <input
          type="color"
          bind:this={colorPickerElement}
          bind:value={color}
          class="color-picker-input"
          aria-label="Color picker"
        />
      </label>
    </div>

    <canvas
      bind:this={canvasElement}
      width={CANVAS_SIZE * SCALE}
      height={CANVAS_SIZE * SCALE}
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
      onmouseleave={handleMouseLeave}
      ontouchstart={handleTouchStart}
      ontouchmove={handleTouchMove}
      ontouchend={handleTouchEnd}
      ontouchcancel={handleTouchEnd}
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
    padding: 1em;
    width: 100%;
    box-sizing: border-box;
  }

  .header {
    font-family: 'Pixelify Sans', sans-serif;
    font-size: 2rem;
    margin: 0;
  }

  .description {
    font-family: 'Pixelify Sans', sans-serif;
    font-size: 1rem;
    margin: 0;
    text-align: center;
  }

  .ink-meter {
    width: 100%;
    max-width: 300px;
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
    flex-wrap: wrap;
    justify-content: center;
  }

  .color-button {
    width: 30px;
    height: 30px;
    border: 1px solid black;
    cursor: pointer;
    padding: 0;
    touch-action: none;
  }

  .color-button.selected {
    border: 3px solid white;
  }

  .rainbow-button-wrapper {
    position: relative;
    display: inline-block;
  }

  .rainbow-button {
    touch-action: auto;
    background: linear-gradient(90deg, 
      #ff0000 0%, 
      #ff7f00 14%, 
      #ffff00 28%, 
      #00ff00 42%, 
      #0000ff 57%, 
      #4b0082 71%, 
      #9400d3 85%, 
      #ff0000 100%);
    font-size: 1.2em;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .color-picker-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    pointer-events: auto;
    z-index: 1;
  }

  @media (max-width: 768px) {
    .color-picker-input {
      width: 30px;
      height: 30px;
    }
  }

  @media (max-width: 480px) {
    .color-picker-input {
      width: 40px;
      height: 40px;
    }
  }

  .canvas {
    border: 2px solid #333;
    cursor: crosshair;
    image-rendering: pixelated;
    max-width: 700px;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  @media (max-width: 768px) {
    .container {
      gap: 0.75em;
      padding: 0.75em;
    }

    .header {
      font-size: 1.5rem;
    }

    .ink-meter {
      height: 18px;
    }

    .color-button {
      width: 35px;
      height: 35px;
    }

    .canvas {
      width: 100%;
      max-width: min(100vw - 2em, 500px);
    }
  }

  @media (max-width: 480px) {
    .header {
      font-size: 1.25rem;
    }

    .ink-meter {
      height: 16px;
    }

    .color-button {
      width: 40px;
      height: 40px;
    }
  }
</style>