import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { MAX_INK, REGENERATION_RATE } from '../constants';

interface User {
  id: string;
  ink: number;
  joinedAt: string;
}

export class UserStore {
  #id = $state<string | null>(null);
  #ink = $state(MAX_INK);
  #isLoading = $state(true);
  #regenerationTimer: ReturnType<typeof setInterval> | null = null;

  get id() { return this.#id; }
  
  get ink() { return this.#ink; }

  get isLoading() { return this.#isLoading; }

  async initialize() {
    const stored = JSON.parse(localStorage.getItem('graffiti-wall-user') || '{}');

    let user: User = {
      id: stored.id ?? uuidv4(),
      ink: stored.ink ?? MAX_INK,
      joinedAt: stored.joinedAt ?? new Date().toISOString(),
    }

    const { data: dbUser, error } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        ink: user.ink,
        joined_at: user.joinedAt,
        updated_at: user.joinedAt,
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting user:', error);
      this.#id = user.id;
      this.#ink = user.ink;
    } else if (dbUser) {
      this.#id = dbUser.id;
      this.#ink = dbUser.ink;
    }

    localStorage.setItem('graffiti-wall-user', JSON.stringify({
      id: error ? user.id : dbUser.id,
      ink: error ? user.ink : dbUser.ink,
      joinedAt: error ? user.joinedAt : dbUser.joined_at,
    }));

    this.#isLoading = false;

    supabase
      .channel('user-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${this.#id}`,
      }, (payload) => {
        const updatedUser = payload.new as { ink: number };
        this.#ink = updatedUser.ink;
        }
      )
      .subscribe();

    this.#regenerationTimer = setInterval(() => {
      if (!this.#id) return;
        
      this.#ink = Math.min(this.#ink + 1, MAX_INK);
        
      supabase
        .from('users')
        .update({ ink: this.#ink, updated_at: new Date().toISOString() })
        .eq('id', this.#id)
        .then(({ error }) => {
          if (error) console.error('Error updating ink:', error);
         });
    }, REGENERATION_RATE);
  }

  consumeInk(amount: number) {
    this.#ink = Math.max(0, this.#ink - amount);
  }

  destroy() {
    if (this.#regenerationTimer) {
      clearInterval(this.#regenerationTimer);
    }
  }
}

export const userStore = new UserStore();