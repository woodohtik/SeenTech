import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import htmlContent from './LandingPage.html?raw';

export default function LandingPage() {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // SECURITY: only accept NAVIGATE messages from this exact iframe
      // (srcDoc content shares the parent's origin, so an origin check alone
      // wouldn't exclude other same-origin windows/iframes — pin to the
      // specific source window too) and only ever to a relative in-app path.
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'NAVIGATE' && typeof event.data.path === 'string' && event.data.path.startsWith('/')) {
        navigate(event.data.path);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigate]);

  const modifiedHtml = htmlContent.replace(
    '</body>',
    `<script>
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (link) {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/')) {
            e.preventDefault();
            // NOTE: srcDoc documents report window.location.origin as the
            // literal string "null" (about:srcdoc quirk in Chromium-based
            // browsers), which would make postMessage's targetOrigin check
            // never match the real parent origin and silently drop the
            // message. '*' is safe here: the payload is just a relative
            // in-app path (no sensitive data), and the parent-side listener
            // already verifies event.source is this exact iframe before
            // acting on it.
            window.parent.postMessage({ type: 'NAVIGATE', path: href }, '*');
          }
        }
      });
    </script></body>`
  );

  return (
    <iframe
      ref={iframeRef}
      srcDoc={modifiedHtml}
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title="Landing Page"
    />
  );
}
