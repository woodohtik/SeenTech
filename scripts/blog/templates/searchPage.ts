import { STYLE_BLOCK, FONTS_PRECONNECT, renderSiteHeader, renderSiteFooter, renderStickyMobileCta, renderTrackingScript } from './shared';

// Static shell + a client script re-implementing filterSearchIndex's same
// lowercase-substring rule (scripts/blog/search.ts) -- duplicated
// deliberately since one runs in Node at build time and the other in the
// visitor's browser against the fetched search-index.json; both are driven
// by scripts/blog/search.test.ts.
export function renderSearchPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>البحث | مدونة سين</title>
<meta name="robots" content="noindex">
${FONTS_PRECONNECT}
<style>${STYLE_BLOCK}</style>
</head>
<body>
${renderSiteHeader()}
<main>
<section class="b-hero"><div class="wrap">
  <span class="eyebrow">مدونة سين</span>
  <h1>البحث</h1>
  <form class="search" role="search" action="https://seentech.io/blog/search"><label for="q" class="sr">ابحث في المدونة</label>
    <input id="q" name="q" type="search" placeholder="ابحث: مقاس، تأخير، رمضان، ورقة الطلب..."><button class="btn btn-ink" type="submit">بحث</button></form>
</div></section>
<section class="wrap" aria-labelledby="results-h">
  <div class="sec-h"><h2 id="results-h">نتائج البحث</h2></div>
  <div class="grid" id="results"></div>
  <p id="no-results" style="display:none">ما لقينا نتائج مطابقة.</p>
</section>
</main>
${renderSiteFooter()}
${renderStickyMobileCta()}
${renderTrackingScript()}
<script>
(function(){
  var params=new URLSearchParams(location.search);
  var q=(params.get('q')||'').toLowerCase();
  var results=document.getElementById('results');
  var noResults=document.getElementById('no-results');
  if(!q)return;
  fetch('/blog/search-index.json').then(function(r){return r.json()}).then(function(index){
    var matches=index.filter(function(entry){
      return entry.title.toLowerCase().indexOf(q)!==-1 || entry.excerpt.toLowerCase().indexOf(q)!==-1;
    });
    if(matches.length===0){noResults.style.display='';return}
    function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
    results.innerHTML=matches.map(function(entry){
      return '<article class="card"><a class="card-link" href="/blog/'+esc(entry.slug)+'"><h3>'+esc(entry.title)+'</h3><p>'+esc(entry.excerpt)+'</p></a></article>';
    }).join('');
  });
})();
</script>
</body></html>`;
}
