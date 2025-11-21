// src/router/routes.ts
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('../components/layout/MainLayoutComponent.vue'),
    meta: {requiresAuth: true},
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/pages/HomePage.vue'),
      },

      {
        path: 'mint',
        name: 'mint',
        component: () => import('@/pages/trading/MintPage.vue'),
      },
    ]
  },
  {
    path: '/landing',
    component: () => import('../components/layout/FullPageLayoutComponent.vue'),
    meta:{requiresAuth: false},
    children: [
      { path: 'logout', component: () => import('../pages/landing/LogoutPage.vue') },
    ],
  },
  {
    path: '/error',
    component: () => import('../components/layout/FullPageLayoutComponent.vue'),
    meta:{requiresAuth: false},
    children: [
      { path: '404-not-found', component: () => import('../pages/error/ErrorNotFound.vue') },
    ],
  }
]

export default routes
