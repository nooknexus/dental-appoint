import { useSyncExternalStore } from 'react';

export interface PublicService {
  id: number;
  code: string;
  name: string;
  description: string;
  priceLabel: string;
}

interface PublicServicesSnapshot {
  status: 'loading' | 'ready' | 'error';
  services: PublicService[];
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const loadingSnapshot: PublicServicesSnapshot = { status: 'loading', services: [] };
const subscribers = new Set<() => void>();
let snapshot = loadingSnapshot;
let requestGeneration = 0;

function emitChange() {
  subscribers.forEach((subscriber) => subscriber());
}

async function refreshPublicServices() {
  const generation = ++requestGeneration;
  snapshot = loadingSnapshot;
  emitChange();

  try {
    const response = await fetch(`${apiBase}/services`);
    if (!response.ok) throw new Error('Unable to load services');
    const data = await response.json() as { services?: PublicService[] };
    if (!Array.isArray(data.services)) throw new Error('Invalid services response');
    if (generation !== requestGeneration) return;
    snapshot = { status: 'ready', services: data.services };
  } catch {
    if (generation !== requestGeneration) return;
    snapshot = { status: 'error', services: [] };
  }

  emitChange();
}

function subscribe(listener: () => void) {
  const shouldRefresh = subscribers.size === 0;
  subscribers.add(listener);
  if (shouldRefresh) void refreshPublicServices();

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      requestGeneration += 1;
      snapshot = loadingSnapshot;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

export function usePublicServices() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
