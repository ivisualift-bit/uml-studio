import { isTauri } from '@tauri-apps/api/core';
import { BrowserProjectRepository } from '@/services/persistence/browserRepository';
import { indexedDbRecovery } from '@/services/persistence/recovery';
import { TauriProjectRepository } from '@/services/persistence/tauriRepository';
import type { ProjectRepository, RecoveryRepository } from '@/services/persistence/types';

/** Runtime capability detection (uses Tauri's own API, not user-agent sniffing — spec §21.3). */
export function isDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Keyboard conventions follow the OS that produces the key events. `navigator.platform` reports the
 * real OS (User-Agent Client Hints can be overridden by device emulation), so it is checked first.
 */
export function isMac(): boolean {
  try {
    const platform = navigator.platform || (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || '';
    return /mac|iphone|ipad/i.test(platform);
  } catch {
    return false;
  }
}

let repository: ProjectRepository | null = null;

export function projectRepository(): ProjectRepository {
  repository ??= isDesktop() ? new TauriProjectRepository() : new BrowserProjectRepository();
  return repository;
}

export function recoveryRepository(): RecoveryRepository {
  return indexedDbRecovery;
}
