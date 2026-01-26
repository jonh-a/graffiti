import { CANVAS_SIZE, SCALE } from '../constants';

export function getPixelCoordinates(
  e: MouseEvent,
  canvas: HTMLCanvasElement
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / SCALE);
  const y = Math.floor((e.clientY - rect.top) / SCALE);

  if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return null;

  return { x, y };
}

export function drawPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
}

export function clearPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  ctx.clearRect(x * SCALE, y * SCALE, SCALE, SCALE);
}

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  pixels: Record<string, string>
): void {
  // Clear canvas first
  ctx.clearRect(0, 0, CANVAS_SIZE * SCALE, CANVAS_SIZE * SCALE);
  
  // Draw all pixels
  Object.entries(pixels).forEach(([key, color]) => {
    const [x, y] = key.split(',').map(Number);
    drawPixel(ctx, x, y, color);
  });
}