// web/src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import Home from './views/Home.vue';
import Me from './views/Me.vue';
import Together from './views/Together.vue';
import Plan from './views/Plan.vue';
import Work from './views/Work.vue';
import Settings from './views/Settings.vue';
import Trash from './views/Trash.vue';
import GamesHome from './views/games/GamesHome.vue';
import GamesMe from './views/games/GamesMe.vue';
import GamesTogether from './views/games/GamesTogether.vue';
import GamesPlan from './views/games/GamesPlan.vue';
import GameWork from './views/games/GameWork.vue';
import GamesTrash from './views/games/GamesTrash.vue';

export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/', name: 'home', component: Home, meta: { space: 'media', page: 'home' } },
    { path: '/me', name: 'me', component: Me, meta: { space: 'media', page: 'me' } },
    { path: '/together', name: 'together', component: Together, meta: { space: 'media', page: 'together' } },
    { path: '/plan', name: 'plan', component: Plan, meta: { space: 'media', page: 'plan' } },
    { path: '/work/:id', name: 'work', component: Work, meta: { space: 'media', page: 'work' } },
    { path: '/games', name: 'games-home', component: GamesHome, meta: { space: 'games', page: 'home' } },
    { path: '/games/me', name: 'games-me', component: GamesMe, meta: { space: 'games', page: 'me' } },
    { path: '/games/playing', name: 'games-playing', component: GamesTogether, props: { mode: 'playing' }, meta: { space: 'games', page: 'playing' } },
    { path: '/games/together', name: 'games-together', component: GamesTogether, props: { mode: 'completed' }, meta: { space: 'games', page: 'together' } },
    { path: '/games/plan', name: 'games-plan', component: GamesPlan, meta: { space: 'games', page: 'plan' } },
    { path: '/games/work/:id', name: 'game-work', component: GameWork, meta: { space: 'games', page: 'work' } },
    { path: '/games/trash', name: 'games-trash', component: GamesTrash, meta: { space: 'games', page: 'trash' } },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/trash', name: 'trash', component: Trash },
  ],
  scrollBehavior() { return { top: 0 }; },
});
