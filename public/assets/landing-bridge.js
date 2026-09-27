document.addEventListener('click', function(e) {
  const link = e.target.closest('a');
  if (link) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('/')) {
      e.preventDefault();
      // NOTE: srcDoc documents report location.origin as the literal string
      // "null" (about:srcdoc quirk in Chromium-based browsers), which would
      // make postMessage's targetOrigin check never match the real parent
      // origin and silently drop the message. '*' is safe here: the payload
      // is just a relative in-app path (no sensitive data), and the
      // parent-side listener already verifies event.source is this exact
      // iframe before acting on it.
      window.parent.postMessage({ type: 'NAVIGATE', path: href }, '*');
    }
  }
});

// LandingPage.tsx used to size this iframe with a fixed height:100vh --
// the page's real content (hero, stats, cards, FAQ, footer...) is always
// much taller than one viewport, so that fixed box made the IFRAME scroll
// internally while the outer app page stayed pinned at exactly one
// viewport height. Nested scroll regions like that are exactly what mobile
// Safari/Chrome handle worst (address-bar show/hide is tied to the outer
// page's scroll, which never happened; touch scroll landing on the inner
// box vs. the outer page is inconsistent) -- reported live as "not sized
// right" on mobile/tablet (2026-09-28). Reporting real content height and
// letting the parent size the iframe to match makes the outer page scroll
// naturally instead.
function reportHeight() {
  const height = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: 'RESIZE', height }, '*');
}
window.addEventListener('load', reportHeight);
window.addEventListener('resize', reportHeight);
new ResizeObserver(reportHeight).observe(document.documentElement);
