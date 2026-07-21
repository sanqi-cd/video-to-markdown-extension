import { describe, expect, it } from 'vitest'
import {
  requiresModel,
  selectAppPage,
  type ModelTestState,
  type VideoContextState,
} from '../../src/core/product-state'
import type { VideoMetadata } from '../../src/core/contracts'
import { shouldConfirmTabSwitch, type ActiveTabSnapshot } from '../../src/browser/active-tab'

/**
 * Side Panel 2.0 的产品状态验收入口。
 *
 * 任务 0 只冻结行为契约，不提前引入任务 1/2/3 的生产状态模型。
 * 后续任务实现对应模块时，应将 todo 替换为针对真实 reducer、组件和路由的断言。
 */
describe('Side Panel 2.0 产品状态契约', () => {
  const metadata: VideoMetadata = {
    platform: 'youtube',
    videoId: 'video-1',
    title: '测试视频',
    canonicalUrl: 'https://www.youtube.com/watch?v=video-1',
  }

  describe('R-P0-01 视频上下文状态', () => {
    it.each<[VideoContextState, ReturnType<typeof selectAppPage>]>([
      [{ status: 'loading' }, 'loading'],
      [{ status: 'unsupported' }, 'unsupported'],
      [{ status: 'refresh-required', tabId: 7 }, 'refresh-required'],
      [{ status: 'no-subtitle', metadata }, 'no-subtitle'],
      [{ status: 'ready', metadata, tracks: [] }, 'ready'],
      [{ status: 'failed', error: { code: 'NETWORK_FAILED', message: '失败' } }, 'video-error'],
    ])('将 $status 映射到独立页面', (state, expected) => {
      expect(selectAppPage('home', state)).toBe(expected)
    })

    it('设置页优先于视频上下文，返回后仍可恢复原状态', () => {
      const state: VideoContextState = { status: 'ready', metadata, tracks: [] }
      expect(selectAppPage('settings', state)).toBe('settings')
      expect(selectAppPage('home', state)).toBe('ready')
    })
  })

  describe('R-P0-02 模型测试状态', () => {
    it('idle、testing、success、failed 使用单一判别字段', () => {
      const states: ModelTestState[] = [
        { status: 'idle' },
        { status: 'testing', startedAt: 1 },
        { status: 'success', latencyMs: 200 },
        { status: 'failed', error: { code: 'NETWORK_FAILED', message: '失败' } },
      ]
      expect(states.map((state) => state.status)).toEqual([
        'idle', 'testing', 'success', 'failed',
      ])
    })
  })

  describe('R-P0-03 活动标签页切换', () => {
    it('任务运行中切换视频时先确认，不静默替换任务上下文', () => {
      const current: ActiveTabSnapshot = {
        tabId: 1,
        url: metadata.canonicalUrl,
        video: { platform: 'youtube', videoId: metadata.videoId },
      }
      const next: ActiveTabSnapshot = {
        tabId: 2,
        url: 'https://www.bilibili.com/video/BV123',
        video: { platform: 'bilibili', videoId: 'BV123' },
      }
      expect(shouldConfirmTabSwitch(current, next, true)).toBe(true)
      expect(shouldConfirmTabSwitch(current, next, false)).toBe(false)
    })
  })

  describe('模型按需配置', () => {
    it('中文字幕高保真不依赖模型', () => {
      expect(requiresModel('high-fidelity', 'zh-CN', 'zh')).toBe(false)
    })

    it('同语言高保真无需模型，跨语言高保真和 AI 精炼依赖模型', () => {
      expect(requiresModel('high-fidelity', 'en', 'en')).toBe(false)
      expect(requiresModel('high-fidelity', 'en', 'zh')).toBe(true)
      expect(requiresModel('high-fidelity', 'zh-CN', 'en')).toBe(true)
      expect(requiresModel('refined', 'zh-CN', 'zh')).toBe(true)
    })
  })

  describe('任务状态优先于视频上下文', () => {
    const ready: VideoContextState = { status: 'ready', metadata, tracks: [] }

    it.each([
      ['running', 'generating'],
      ['partial', 'partial'],
      ['completed', 'result'],
      ['failed', 'task-error'],
      ['cancelled', 'cancelled'],
    ] as const)('将 %s 映射到 %s', (status, page) => {
      expect(selectAppPage('home', ready, status)).toBe(page)
    })

    it('取消时有已验证内容则进入部分完成页', () => {
      expect(selectAppPage('home', ready, 'cancelled', true)).toBe('partial')
      expect(selectAppPage('home', ready, 'cancelled', false)).toBe('cancelled')
    })
  })
})
