import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import htmlContent from './LandingPage.html?raw';

export default function LandingPage() {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 100vh is only the fallback before the iframe's first real RESIZE report
  // (landing-bridge.js) arrives -- keeping a fixed height afterward is what
  // caused the nested-scroll mobile/tablet sizing bug (see landing-bridge.js
  // for the full explanation).
  const [iframeHeight, setIframeHeight] = useState<number | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // SECURITY: only accept messages from this exact iframe (srcDoc
      // content shares the parent's origin, so an origin check alone
      // wouldn't exclude other same-origin windows/iframes — pin to the
      // specific source window too) and only ever to a relative in-app path
      // (for NAVIGATE) or a plain number (for RESIZE).
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'NAVIGATE' && typeof event.data.path === 'string' && event.data.path.startsWith('/')) {
        // seen-fields-categories-referral-task.md #5 -- carry ?ref=CODE from
        // this landing page's own URL onto the "ابدأ الآن" register link, so
        // Login.tsx can record the referral once the new tenant signs up.
        // The iframe is srcDoc (no real location/query of its own), so this
        // has to happen here on the parent side, not in landing-bridge.js.
        const ref = new URLSearchParams(window.location.search).get('ref');
        let path = event.data.path;
        if (ref) {
          const url = new URL(path, window.location.origin);
          if (url.searchParams.get('view') === 'register' && !url.searchParams.has('ref')) {
            url.searchParams.set('ref', ref);
            path = url.pathname + url.search;
          }
        }
        navigate(path);
      } else if (event.data?.type === 'RESIZE' && typeof event.data.height === 'number' && event.data.height > 0) {
        setIframeHeight(event.data.height);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigate]);

  // External file, not an inline block: srcDoc iframes inherit the parent
  // document's CSP, and script-src has no 'unsafe-inline' (server.ts) --
  // an inline <script> here would be silently blocked on every real
  // deployment, same issue fixed for LandingPage.html's own inline script.
  const modifiedHtml = htmlContent.replace(
    '</body>',
    `<script src="assets/landing-bridge.js"></script></body>`
  );

  return (
    <iframe
      ref={iframeRef}
      srcDoc={modifiedHtml}
      style={{ width: '100%', height: iframeHeight ? `${iframeHeight}px` : '100vh', border: 'none', display: 'block' }}
      title="Landing Page"
    />
  );
}
