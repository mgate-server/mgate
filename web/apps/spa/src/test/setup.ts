import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia; ThemeProvider-adjacent code and Tailwind-driven
// prefers-color-scheme checks only run in the browser, but stub it so any component that reads
// it during a test doesn't throw.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
