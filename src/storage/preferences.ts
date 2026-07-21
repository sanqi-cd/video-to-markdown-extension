import type { StorageArea } from '../model/config-store'
import { z } from 'zod'
import type { ProviderId } from '../model/provider-presets'
import type { OutputLanguage } from '../core/language'

const PREF_KEY = 'userPreferences'

export type UserPreferences = {
  selectedTrackId: string | null
  mode: 'high-fidelity' | 'refined'
  includeTimestamps: boolean
  outputLanguage: OutputLanguage
  lastProviderId: ProviderId
}

const DEFAULTS: UserPreferences = {
  selectedTrackId: null,
  mode: 'high-fidelity',
  includeTimestamps: false,
  outputLanguage: 'zh',
  lastProviderId: 'deepseek',
}

const PreferencesSchema = z.object({
  selectedTrackId: z.string().nullable(),
  mode: z.enum(['high-fidelity', 'refined']),
  includeTimestamps: z.boolean(),
  outputLanguage: z.enum(['zh', 'en']).default('zh'),
  lastProviderId: z.enum(['deepseek', 'openai', 'openrouter', 'custom']).default('deepseek'),
})

export function createPreferencesStore(storage: StorageArea) {
  const get = async (): Promise<UserPreferences> => {
    const result = await storage.get([PREF_KEY])
    const parsed = PreferencesSchema.safeParse(result[PREF_KEY])
    return parsed.success ? parsed.data : { ...DEFAULTS }
  }

  return {
    get,
    async set(prefs: Partial<UserPreferences>): Promise<void> {
      const current = await get()
      const parsed = PreferencesSchema.parse({ ...current, ...prefs })
      await storage.set({ [PREF_KEY]: parsed })
    },
  }
}
