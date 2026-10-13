import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureStartupError,
  createMemoryTabRegistry,
  createSessionTabRegistry,
  TranscriptionBackgroundController,
  type ActiveTabRegistry,
} from "../../src/transcription/background-controller";
import type { StartTabTranscriptionMessage } from "../../src/transcription/messages";
import type { TranscriptionConfigStore } from "../../src/transcription/config-store";

function fakeStorageArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) delete data[key];
    }),
  };
}

function setup(registry: ActiveTabRegistry = createMemoryTabRegistry()) {
  const sendMessage = vi.fn().mockResolvedValue({ success: true });
  const tabsSend = vi.fn().mockResolvedValue({ success: true });
  const capture = vi.fn().mockResolvedValue("stream");
  const capturedTabs = vi.fn().mockResolvedValue([]);
  const get = vi
    .fn()
    .mockResolvedValue({
      id: 1,
      active: true,
      url: "https://www.bilibili.com/video/BVtest",
    });
  vi.stubGlobal("chrome", {
    tabs: { get, sendMessage: tabsSend },
    tabCapture: {
      getMediaStreamId: capture,
      getCapturedTabs: capturedTabs,
    },
    runtime: {
      sendMessage,
      getURL: (path: string) => path,
      getContexts: vi.fn().mockResolvedValue([{}]),
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    },
  });
  const store = {
    get: vi.fn().mockResolvedValue({ apiKey: "secret" }),
  } as unknown as TranscriptionConfigStore;
  const controller = new TranscriptionBackgroundController(store, () => true, registry);
  const message = {
    type: "TRANSCRIPTION_START_REQUEST",
    tabId: 1,
    taskId: "test-task",
    metadata: {},
  } as StartTabTranscriptionMessage;
  return { controller, message, capture, capturedTabs, get, sendMessage, tabsSend, store, registry };
}

afterEach(() => vi.unstubAllGlobals());

describe("tab audio startup", () => {
  it("explains authorization without leaking the original error", () => {
    const error = captureStartupError(
      new Error("Extension has not been invoked secret-token"),
    );
    expect(error.message).toContain("授权");
    expect(error.message).not.toContain("secret-token");
    expect(
      captureStartupError(
        new Error("Cannot capture a tab with an active stream"),
      ).message,
    ).toContain("正在被采集");
    expect(
      captureStartupError(new Error("No tab with id: 1")).message,
    ).toContain("失效");
  });
  it("permits retry after a capture failure", async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(new Error("not been invoked"));
    await expect(s.controller.start(s.message, {})).rejects.toThrow("授权");
    await expect(s.controller.start(s.message, {})).resolves.toEqual({
      taskId: "test-task",
    });
  });
  it("rejects inactive tabs before capture", async () => {
    const s = setup();
    s.get.mockResolvedValue({
      id: 1,
      active: false,
      url: "https://www.bilibili.com/video/BVtest",
    });
    await expect(s.controller.start(s.message, {})).rejects.toThrow("切换");
    expect(s.capture).not.toHaveBeenCalled();
  });
  it("serializes startup and rejects duplicate sessions", async () => {
    const s = setup();
    const first = s.controller.start(s.message, {});
    await expect(s.controller.start(s.message, {})).rejects.toThrow(
      "已有转录任务",
    );
    await first;
    expect(s.capture).toHaveBeenCalledTimes(1);
  });
  it("releases capture and restores playback on playback failure even if stop fails", async () => {
    const s = setup();
    s.tabsSend.mockResolvedValueOnce({ success: false });
    s.sendMessage
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    await expect(s.controller.start(s.message, {})).rejects.toThrow(
      "已停止采集",
    );
    expect(s.tabsSend).toHaveBeenLastCalledWith(1, {
      type: "TRANSCRIPTION_STOP_PLAYBACK",
      taskId: "test-task",
    });
    await expect(s.controller.start(s.message, {})).resolves.toBeDefined();
  });
  it("cleans up an offscreen startup failure", async () => {
    const s = setup();
    s.sendMessage.mockResolvedValueOnce({
      success: false,
      error: "private detail",
    });
    await expect(s.controller.start(s.message, {})).rejects.toThrow(
      "后台音频采集器启动失败",
    );
    expect(s.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "TRANSCRIPTION_OFFSCREEN_STOP" }),
    );
  });
  it("rejects untrusted senders", async () => {
    const s = setup();
    const untrusted = new TranscriptionBackgroundController(s.store, () => false, s.registry);
    await expect(untrusted.start(s.message, {})).rejects.toThrow("拒绝");
    expect(s.capture).not.toHaveBeenCalled();
  });
  it("requires a saved transcription config", async () => {
    const s = setup();
    vi.mocked(s.store.get).mockResolvedValueOnce(null);
    await expect(s.controller.start(s.message, {})).rejects.toMatchObject({
      code: "INVALID_TRANSCRIPTION_CONFIG",
    });
  });
  it("rejects a second start while a capture is still running", async () => {
    const s = setup();
    await s.controller.start(s.message, {});
    s.capturedTabs.mockResolvedValue([{ status: "active" }]);
    await expect(
      s.controller.start({ ...s.message, taskId: "second" }, {}),
    ).rejects.toThrow("已有转录任务");
  });
  it("clears stale task records when no capture is running", async () => {
    const s = setup();
    await s.registry.set("stale-task", 9);
    await expect(s.controller.start(s.message, {})).resolves.toEqual({
      taskId: "test-task",
    });
    expect(await s.registry.get("stale-task")).toBeUndefined();
    expect(await s.registry.get("test-task")).toBe(1);
  });
  it("stops playback on failure after a service worker restart", async () => {
    const area = fakeStorageArea();
    const s = setup(createSessionTabRegistry(area));
    await s.controller.start(s.message, {});

    const restarted = new TranscriptionBackgroundController(
      s.store,
      () => true,
      createSessionTabRegistry(area),
    );
    s.tabsSend.mockClear();
    await restarted.handleEvent({
      type: "failed",
      taskId: "test-task",
      error: { code: "TRANSCRIPTION_FAILED", message: "x" },
      cues: [],
    });
    expect(s.tabsSend).toHaveBeenCalledWith(1, {
      type: "TRANSCRIPTION_STOP_PLAYBACK",
      taskId: "test-task",
    });
    expect(area.data["transcription.activeTabs"]).toEqual({});
  });
  it("stop restores playback and playback end forgets the task", async () => {
    const s = setup();
    await s.controller.start(s.message, {});
    s.tabsSend.mockClear();
    await expect(
      s.controller.stop({ type: "TRANSCRIPTION_STOP_REQUEST", taskId: "test-task" }, {}),
    ).resolves.toEqual({ stopped: true });
    expect(s.tabsSend).toHaveBeenCalledWith(1, {
      type: "TRANSCRIPTION_STOP_PLAYBACK",
      taskId: "test-task",
    });
    await s.controller.playbackEnded(
      { type: "TRANSCRIPTION_PLAYBACK_ENDED", taskId: "test-task" },
      {},
    );
    expect(await s.registry.size()).toBe(0);
  });
  it("surfaces an offscreen stop failure", async () => {
    const s = setup();
    s.sendMessage.mockResolvedValueOnce({ success: false, error: "stuck" });
    await expect(
      s.controller.stop({ type: "TRANSCRIPTION_STOP_REQUEST", taskId: "x" }, {}),
    ).rejects.toThrow("stuck");
  });
  it("ignores non-terminal events", async () => {
    const s = setup();
    await s.controller.start(s.message, {});
    await s.controller.handleEvent({ type: "capturing", taskId: "test-task", recordedMs: 1 });
    expect(await s.registry.get("test-task")).toBe(1);
    await s.controller.handleEvent({
      type: "completed",
      taskId: "test-task",
      recordedMs: 1,
      cues: [],
      language: "zh",
      stoppedEarly: false,
    });
    expect(await s.registry.size()).toBe(0);
  });
});

describe("session tab registry", () => {
  it("serializes concurrent writes", async () => {
    const area = fakeStorageArea();
    const registry = createSessionTabRegistry(area);
    await Promise.all([registry.set("a", 1), registry.set("b", 2), registry.set("c", 3)]);
    expect(await registry.size()).toBe(3);
    await registry.delete("b");
    await registry.delete("missing");
    expect(area.data["transcription.activeTabs"]).toEqual({ a: 1, c: 3 });
    await registry.clear();
    expect(await registry.size()).toBe(0);
  });
});
