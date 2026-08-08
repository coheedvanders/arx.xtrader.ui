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

      {
        path: 'alerto',
        name: 'alerto',
        component: () => import('@/pages/trading/AlertoPage.vue'),
      },

      {
        path: 'black-swan-net-tester',
        name: 'black-swan-net-tester',
        component: () => import('@/pages/trading/BlackSwanNetTesterPage.vue'),
      },

      {
        path: 'seed-planter',
        name: 'seed-planter',
        component: () => import('@/pages/trading/SeedPlanterPage.vue'),
      },

      {
        path: 'angel-fish-scanner',
        name: 'angel-fish-scanner',
        component: () => import('@/pages/trading/AngelFishScannerPage.vue'),
      },

      {
        path: 'ma-crossing',
        name: 'ma-crossing',
        component: () => import('@/pages/trading/BestMACrossingScannerPage.vue'),
      },

      {
        path: 'accumulation',
        name: 'accumulation',
        component: () => import('@/pages/trading/AccumulationPage.vue'),
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
