// Applies the stored (or system) theme before first paint, so there is no
// flash of the wrong colour scheme. Kept as a static file so the Content
// Security Policy can remain script-src 'self' with no inline allowance.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* Storage unavailable (private mode); fall back to the light theme. */
  }
})();
