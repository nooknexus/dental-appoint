import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

Object.defineProperty(window, 'scrollTo', {
  value: () => undefined,
  writable: true,
});
