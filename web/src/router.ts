// web/src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import Home from './views/Home.vue';
import Me from './views/Me.vue';
import Together from './views/Together.vue';
import Plan from './views/Plan.vue';
import Work from './views/Work.vue';
import Settings from './views/Settings.vue';

export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/me', name: 'me', component: Me },
    { path: '/together', name: 'together', component: Together },
    { path: '/plan', name: 'plan', component: Plan },
    { path: '/work/:id', name: 'work', component: Work },
    { path: '/settings', name: 'settings', component: Settings },
  ],
  scrollBehavior() { return { top: 0 }; },
});
