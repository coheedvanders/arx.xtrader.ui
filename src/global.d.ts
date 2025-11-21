export {};

declare global {
  interface Window {
    __AIRO_ROUTER__?: import('vue-router').Router;
  }
}