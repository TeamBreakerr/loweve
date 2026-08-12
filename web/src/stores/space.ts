import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type Space = 'media' | 'games';

export const useSpace = defineStore('space', () => {
  const current = ref<Space>(localStorage.getItem('loweve-space') === 'games' ? 'games' : 'media');
  const isGames = computed(() => current.value === 'games');

  function set(space: Space) {
    current.value = space;
    localStorage.setItem('loweve-space', space);
  }

  return { current, isGames, set };
});
