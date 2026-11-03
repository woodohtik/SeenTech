(function () {
  'use strict';

  // Click tracking -- shared chrome on every blog page type
  // (seen-blog-reference/01_..html:654-655, 02_..html:482-483).
  window.dataLayer = window.dataLayer || [];
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-track]');
    if (t) window.dataLayer.push({ event: 'click', label: t.getAttribute('data-track'), page: location.pathname });
  });

  // Chip filter -- index page only. Progressive enhancement: the chips are
  // real links to the real /blog/category/{slug}/ pages, so this only
  // intercepts the click to filter cards already in this page's own
  // server-rendered HTML instead of navigating away.
  if (document.body.getAttribute('data-blog-page') === 'index') {
    var chips = document.querySelectorAll('.chips a');
    var cards = document.querySelectorAll('#grid [data-pillar]');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        var f = chip.getAttribute('data-f');
        if (!f) return;
        e.preventDefault();
        chips.forEach(function (c) { c.classList.remove('on'); c.removeAttribute('aria-current'); });
        chip.classList.add('on');
        chip.setAttribute('aria-current', 'page');
        cards.forEach(function (card) {
          card.style.display = (f === 'all' || card.getAttribute('data-pillar') === f) ? '' : 'none';
        });
      });
    });
  }

  // TOC scroll-spy + print-the-model-section -- article page only.
  var tocLinks = document.querySelectorAll('.toc a');
  if (tocLinks.length > 0) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            tocLinks.forEach(function (l) { l.classList.remove('cur'); });
            var a = map[e.target.id];
            if (a) a.classList.add('cur');
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      document.querySelectorAll('.prose section[id]').forEach(function (s) { io.observe(s); });
    }
    if (window.matchMedia('(max-width:1023px)').matches) {
      var d = document.querySelector('.toc-box');
      if (d) d.removeAttribute('open');
    }
  }
  document.querySelectorAll('[data-print-tpl]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.body.classList.add('print-tpl');
      window.print();
      setTimeout(function () { document.body.classList.remove('print-tpl'); }, 500);
    });
  });

  // Search page -- only runs when #results exists.
  var results = document.getElementById('results');
  if (results) {
    var params = new URLSearchParams(location.search);
    var q = (params.get('q') || '').toLowerCase();
    var noResults = document.getElementById('no-results');
    if (q) {
      fetch('/blog/search-index.json').then(function (r) { return r.json(); }).then(function (index) {
        var matches = index.filter(function (entry) {
          return entry.title.toLowerCase().indexOf(q) !== -1 || entry.excerpt.toLowerCase().indexOf(q) !== -1;
        });
        if (matches.length === 0) { if (noResults) noResults.style.display = ''; return; }
        function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        results.innerHTML = matches.map(function (entry) {
          return '<article class="card"><a class="card-link" href="/blog/' + esc(entry.slug) + '"><h3>' + esc(entry.title) + '</h3><p>' + esc(entry.excerpt) + '</p></a></article>';
        }).join('');
      });
    }
  }
})();
