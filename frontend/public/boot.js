// Runs before paint: applies the saved theme, language and accent colour so the page does not flash.
// Kept as an external file so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var root = document.documentElement;
    var t = localStorage.getItem("rt.theme");
    if (!t) t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    root.dataset.theme = t;
    var l = localStorage.getItem("rt.locale");
    if (l) root.lang = l;
    var a = localStorage.getItem("rt.accent");
    if (a && /^#[0-9a-f]{6}$/i.test(a)) {
      var n = parseInt(a.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
      var mix = function (k, w) { return "rgb(" + Math.round(r + (k - r) * w) + "," + Math.round(g + (k - g) * w) + "," + Math.round(b + (k - b) * w) + ")"; };
      root.style.setProperty("--color-brand", a);
      root.style.setProperty("--color-brand-bright", mix(255, 0.28));
      root.style.setProperty("--color-brand-ink", mix(0, 0.22));
    }
  } catch (e) {}
})();
