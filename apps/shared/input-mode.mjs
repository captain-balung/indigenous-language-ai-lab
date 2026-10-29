const MIC_SVG = `<svg class="input-mode-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>`;
const KEY_SVG = `<svg class="input-mode-toggle__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 5v-2h10v2H7zm9-5h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>`;

const SWITCH_HTML = `<span class="input-mode-toggle__thumb" aria-hidden="true"></span><span class="input-mode-toggle__option input-mode-toggle__option--voice">${MIC_SVG}</span><span class="input-mode-toggle__option input-mode-toggle__option--type">${KEY_SVG}</span>`;

const ARIA = {
  type: "目前打字，按一下改為錄音",
  voice: "目前錄音，按一下改為打字"
};

/**
 * 錄音／打字互斥切換。預設 voice。
 * @returns {{ mode: () => "type"|"voice", setMode: (mode: "type"|"voice") => void }}
 */
export function wireInputMode({ root, toggle, typePanel, voicePanel, onModeChange, initial = "voice" }) {
  let mode = initial === "type" ? "type" : "voice";

  function renderSwitch() {
    if (!toggle || toggle.dataset.inputModeReady === "1") return;
    toggle.innerHTML = SWITCH_HTML;
    toggle.dataset.inputModeReady = "1";
  }

  function apply() {
    if (root) root.dataset.inputMode = mode;
    if (typePanel) typePanel.hidden = mode !== "type";
    if (voicePanel) voicePanel.hidden = mode !== "voice";
    if (toggle) {
      renderSwitch();
      toggle.dataset.mode = mode;
      toggle.setAttribute("aria-label", ARIA[mode]);
    }
  }

  function setMode(next) {
    const resolved = next === "voice" ? "voice" : "type";
    if (resolved === mode) {
      apply();
      return;
    }
    mode = resolved;
    apply();
    onModeChange?.(mode);
  }

  apply();
  toggle?.addEventListener("click", () => setMode(mode === "type" ? "voice" : "type"));

  return {
    mode: () => mode,
    setMode
  };
}
