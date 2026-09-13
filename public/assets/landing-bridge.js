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
