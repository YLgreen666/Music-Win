/** A compile-time flag and runtime detection also support tauri dev's Vite server. */
export const isDesktop = (typeof __RHINE_DESKTOP__ !== 'undefined' && __RHINE_DESKTOP__) ||
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
