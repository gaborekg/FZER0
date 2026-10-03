// Records the microphone to a compressed file while the measurement runs.
// Safari produces audio/mp4 (.m4a), which plays on every phone and computer.

const PREFERRED_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export function canRecordAudio() {
  return typeof window.MediaRecorder !== 'undefined';
}

export function startAudioRecording(stream) {
  const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start();

  const collect = () =>
    chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/mp4' }) : null;

  return {
    // Must be called BEFORE the capture's tracks are stopped — stopping the
    // tracks first can end the recorder without its last chunk.
    stop: () =>
      new Promise((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(collect());
          return;
        }
        recorder.onstop = () => resolve(collect());
        recorder.stop();
      }),
  };
}
