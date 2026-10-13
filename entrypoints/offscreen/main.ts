import { AppError } from "../../src/errors/app-error";
import { transcribeAudioChunk } from "../../src/transcription/provider";
import { CaptureSession } from "../../src/transcription/capture-session";
import type {
  OffscreenStartMessage,
  OffscreenStopMessage,
} from "../../src/transcription/messages";
import type { TabTranscriptionEvent } from "../../src/transcription/contracts";

let activeSession: CaptureSession | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    typeof message !== "object" ||
    message === null ||
    (message as { target?: unknown }).target !== "offscreen"
  )
    return undefined;

  const type = (message as { type?: unknown }).type;
  if (type === "TRANSCRIPTION_OFFSCREEN_START") {
    startSession(message as OffscreenStartMessage)
      .then(() => sendResponse({ success: true }))
      .catch((cause) =>
        sendResponse({
          success: false,
          error:
            cause instanceof Error ? cause.message : "后台音频采集器启动失败",
        }),
      );
    return true;
  }
  if (type === "TRANSCRIPTION_OFFSCREEN_STOP") {
    const stopMessage = message as OffscreenStopMessage;
    if (activeSession?.taskId === stopMessage.taskId) {
      activeSession.stop(stopMessage.stoppedEarly);
    }
    sendResponse({ success: true });
    return undefined;
  }
  return undefined;
});

async function startSession(message: OffscreenStartMessage): Promise<void> {
  if (activeSession) {
    throw new AppError(
      "TRANSCRIPTION_CAPTURE_FAILED",
      "已有一个视频正在转录，请先停止当前任务",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: message.streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    });
  } catch (cause) {
    throw new AppError("TRANSCRIPTION_CAPTURE_FAILED", "无法建立标签页音频流", {
      cause,
    });
  }

  let audioContext: AudioContext | undefined;
  const releaseMedia = () => {
    for (const track of stream.getTracks()) track.stop();
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
  };

  let session: CaptureSession | null = null;
  try {
    audioContext = new AudioContext();
    // Tab capture mutes the tab; route the captured audio back to the speakers.
    audioContext.createMediaStreamSource(stream).connect(audioContext.destination);
    await audioContext.resume();

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const created = new CaptureSession(
      {
        taskId: message.taskId,
        config: message.config,
        recorder,
        releaseMedia,
      },
      {
        transcribe: (blob, config, durationMs, signal) =>
          transcribeAudioChunk(blob, config, durationMs, undefined, signal),
        emit: emitEvent,
        onClosed: () => {
          if (activeSession === created) activeSession = null;
        },
      },
    );
    session = created;
    activeSession = created;

    recorder.addEventListener("dataavailable", (event) =>
      created.handleData(event.data),
    );
    recorder.addEventListener("stop", () => {
      void created.handleRecorderStopped();
    });
    recorder.addEventListener("error", () => {
      void created.fail(
        new AppError(
          "TRANSCRIPTION_CAPTURE_FAILED",
          "浏览器录音器发生错误，已保留此前转写内容",
        ),
      );
    });
    for (const track of stream.getAudioTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (activeSession === created && !created.isStopping) {
            created.stop(true);
          }
        },
        { once: true },
      );
    }

    await created.start(message.metadata);
  } catch (cause) {
    if (session) session.dispose();
    else releaseMedia();
    throw new AppError(
      "TRANSCRIPTION_CAPTURE_FAILED",
      "音频录制初始化失败，已释放采集资源，请重试",
      { cause },
    );
  }
}

async function emitEvent(event: TabTranscriptionEvent): Promise<void> {
  await chrome.runtime
    .sendMessage({ type: "TRANSCRIPTION_EVENT" as const, event })
    .catch(() => undefined);
}
