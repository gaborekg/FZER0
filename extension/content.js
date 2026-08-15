(async () => {
  const { isMeetCallUrl } = await import(chrome.runtime.getURL('src/meet-url.js'));
  const { createPrefsStore } = await import(chrome.runtime.getURL('src/prefs.js'));
  const { mountPanel } = await import(chrome.runtime.getURL('extension/panel/panel.js'));

  const HOST_ID = 'fzer0-panel-host';

  let mounted = false;
  let mounting = false;
  let audioContext = null;
  let stream = null;
  let unmountPanel = null;

  async function startAudioPipeline(renderReading) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('extension/worklet/f0-processor.js')
    );

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'fzer0-f0-processor');
    workletNode.port.onmessage = (event) => renderReading(event.data);
    source.connect(workletNode);
  }

  function stopAudioPipeline() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }

  // A single host element for whatever we put on the page — the panel or a
  // notice explaining why there is no panel. Replacing rather than appending
  // means a failed mount can't leave a dead card behind for the next one to
  // stack on top of.
  function createHost() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
    return host;
  }

  // Both of the ways mounting can give up used to do so silently, which from
  // the outside is indistinguishable from a broken extension — the exact
  // report a fresh Chrome profile produces. Say what happened instead.
  function mountNotice(message, action) {
    const shadow = createHost().attachShadow({ mode: 'open' });
    const card = document.createElement('div');
    card.style.cssText = [
      'position:fixed', 'top:4rem', 'right:1rem', 'z-index:2147483647',
      'max-width:16rem', 'padding:0.85rem 0.95rem',
      'background:#f6f5fa', 'color:#2b2b2b',
      'font:400 0.85rem/1.45 system-ui, sans-serif',
      'border-radius:0.9rem', 'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
    ].join(';');

    const text = document.createElement('p');
    text.textContent = message;
    text.style.cssText = 'margin:0';
    card.appendChild(text);

    if (action) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.style.cssText = [
        'display:block', 'width:100%', 'margin-top:0.7rem', 'padding:0.45rem',
        'font:600 0.8rem system-ui, sans-serif', 'color:#ffffff',
        'background:#2b6b4a', 'border:0', 'border-radius:0.5rem', 'cursor:pointer',
      ].join(';');
      button.addEventListener('click', action.onClick);
      card.appendChild(button);
    }

    shadow.appendChild(card);
  }

  async function maybeMountPanel() {
    if (mounted || mounting) return;
    if (!isMeetCallUrl(window.location.pathname)) return;

    mounting = true;
    try {
      const prefs = createPrefsStore();
      const setup = await prefs.getSetup();

      // A fresh profile has nothing stored. Onboarding opens on install, but
      // it is a tab like any other and gets closed without being finished.
      if (!setup.targetNote) {
        mountNotice('FZER0 setup is not finished, so there is nothing to measure against yet.', {
          label: 'Open setup',
          // Content scripts can't call openOptionsPage themselves — only the
          // service worker can.
          onClick: () => chrome.runtime.sendMessage({ type: 'open-options' }),
        });
        return;
      }

      const { renderReading, unmount } = mountPanel(createHost(), setup);
      unmountPanel = unmount;

      try {
        await startAudioPipeline(renderReading);
      } catch {
        unmountPanel?.();
        unmountPanel = null;
        stopAudioPipeline();
        mountNotice(
          'FZER0 needs the microphone on this page. Allow it in the address bar, then reload the tab.'
        );
        return;
      }

      mounted = true;
    } finally {
      mounting = false;
    }
  }

  function teardownPanel() {
    stopAudioPipeline();
    unmountPanel?.();
    unmountPanel = null;
    document.getElementById(HOST_ID)?.remove();
    mounted = false;
  }

  maybeMountPanel();

  let lastPathname = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
      if (mounted && !isMeetCallUrl(lastPathname)) {
        teardownPanel();
      } else if (!mounted) {
        maybeMountPanel();
      }
    }
  }, 1000);
})();
