import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import htmlContent from './LandingPage.html?raw';

export default function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NAVIGATE') {
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
            window.parent.postMessage({ type: 'NAVIGATE', path: href }, '*');
          }
        }
      });
    </script></body>`
  );

  return (
    <iframe
      srcDoc={modifiedHtml}
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title="Landing Page"
    />
  );
}
