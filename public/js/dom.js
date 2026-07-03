export function isMobileDevice() {
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  } catch {}
  return (navigator.maxTouchPoints || 0) > 0 || window.innerWidth <= 768;
}
export function setStatus(msg, isErr = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
}

