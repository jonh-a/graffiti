import { supabase } from '../supabase';

type CanvasPixels = Record<string, string>;

export class CanvasStore {
  #pixels = $state<CanvasPixels>({});
  #channel: ReturnType<typeof supabase.channel> | null = null;

  get pixels() {
    return this.#pixels;
  }

  async load() {
    const { data, error } = await supabase
      .from('canvas_state')
      .select('pixels')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('Error loading canvas:', error);
      return;
    }

    this.#pixels = (data?.pixels as CanvasPixels) || {};
  }

  subscribeToUpdates() {
    if (this.#channel) return;

    this.#channel = supabase
      .channel('canvas-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'canvas_state',
          filter: 'id=eq.1'
        },
        (payload) => {
          this.#pixels = (payload.new.pixels as CanvasPixels) || {};
        }
      )
      .subscribe();
  }

  addPixel(x: number, y: number, color: string) {
    this.#pixels[`${x},${y}`] = color;
  }

  destroy() {
    if (this.#channel) {
      supabase.removeChannel(this.#channel);
      this.#channel = null;
    }
  }
}

export const canvasStore = new CanvasStore();