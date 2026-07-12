import type { StorageArea } from '../model/config-store'

const PREF_KEY = 'userPreferences'

export type UserPreferences = {
  selectedTrackId: string | null
  mode: 'high-fidelity' | 'refined'
  includeTimestamps: boolean
}

const DEFAULTS: UserPreferences = {
  selectedTrackId: null,
  mode: 'high-fidelity',
  includeTimestamps: false,
}

export function createPreferencesStore(storage: StorageArea) {
  return {
    async get(): Promise<UserPreferences> {
      const result = await storage.get([PREF_KEY])
      const value = result[PREF_KEY]
      if (value && typeof value === 'object') {
        return { ...DEFAULTS, ...(value as Partial<UserPreferences>) }
      }
      return { ...DEFAULTS }
    },
    async set(prefs: Partial<UserPreferences>): Promise<void> {
      const current = await this.get()
      await storage.set({ [PREF_KEY]: { ...current, ...prefs } })
    },
  }
}
