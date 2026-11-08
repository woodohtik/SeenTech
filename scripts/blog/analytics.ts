import { blogConfig } from '../../content/blog.config';

// blogConfig's tracking IDs are git-committed build-time config, not
// runtime/user input, so baking the init calls into a build-generated
// static file (instead of an inline <script> on the page) is safe AND
// keeps vercel.json's CSP script-src 'self' (no 'unsafe-inline') intact
// once these IDs are eventually filled in -- the page never needs an
// inline script to configure analytics.
export function buildAnalyticsInitScript(): string {
  const lines: string[] = [];

  if (blogConfig.ga4MeasurementId) {
    lines.push(
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${blogConfig.ga4MeasurementId}');`
    );
  }

  if (blogConfig.snapchatPixelId) {
    lines.push(
      `(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u)})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${blogConfig.snapchatPixelId}');snaptr('track','PAGE_VIEW');`
    );
  }

  if (blogConfig.metaPixelId) {
    lines.push(
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${blogConfig.metaPixelId}');fbq('track','PageView');`
    );
  }

  return lines.join('\n');
}

export function hasAnyAnalyticsConfigured(): boolean {
  return !!(blogConfig.ga4MeasurementId || blogConfig.snapchatPixelId || blogConfig.metaPixelId);
}
