// 基礎學習共用的「看提示」面板。
// 各頁只負責提供 markup 與當題內容；展開狀態、aria 與換題收合都在這裡處理。

export function createHintPanel({ toggle, panel, onClose } = {}) {
  if (!toggle || !panel) {
    return {
      render() {},
      open() {},
      close() {}
    };
  }

  const heading = panel.querySelector("[data-hint-heading]");
  const fields = [...panel.querySelectorAll("[data-hint]")];

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "收起提示" : "看提示";
    if (!open) onClose?.();
  };

  toggle.addEventListener("click", () => setOpen(panel.hidden));

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    render(values = {}, headingText = "") {
      if (heading) {
        heading.textContent = headingText;
        heading.hidden = !headingText;
      }
      for (const field of fields) {
        const value = values[field.dataset.hint];
        field.textContent = value == null ? "" : String(value);
      }
      setOpen(false);
    }
  };
}
