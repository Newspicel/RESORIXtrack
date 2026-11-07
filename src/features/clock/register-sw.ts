/** Registers the offline service worker (production builds only; the dev server serves unbundled modules). */
let done = false

const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})

export function registerServiceWorker(): void {
  if (done || !import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  done = true
  if (document.readyState === "complete") register()
  else window.addEventListener("load", register, { once: true })
}
