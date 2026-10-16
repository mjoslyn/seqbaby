export function isMobileDevice() {
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  } catch {}
  return (navigator.maxTouchPoints || 0) > 0 || window.innerWidth <= 768;
}
// The phone LAYOUT, as distinct from a touch device (isMobileDevice): the
// breakpoint the stylesheet's mobile block is keyed on, so render.js's quick
// row, the fx button's phone behaviour and the stylesheet always agree about
// what a phone is. A touchscreen laptop at full width is not one.
export const PHONE_MQ = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(max-width: 768px)")
  : null;
export function isPhoneLayout() { return !!PHONE_MQ?.matches; }
export function setStatus(msg, isErr = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("is-err", isErr);
}

