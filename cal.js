// Opens the audit booking (Cal.com) in a popup over the site instead of a new tab.
// Links keep their normal href: if the popup can't open (blocker, no JS), Cal.com opens as before.
(function () {
  var LINK = 'igor-sautier/audit-des-taches-automatisables';
  var links = document.querySelectorAll('a[href*="cal.com/' + LINK + '"]');
  if (!links.length) return;

  // Official Cal.com embed loader (loads https://app.cal.com/embed/embed.js on first call)
  (function (C, A, L) {
    var p = function (a, ar) { a.q.push(ar); };
    var d = C.document;
    C.Cal = C.Cal || function () {
      var cal = C.Cal, ar = arguments;
      if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement('script')).src = A; cal.loaded = true; }
      if (ar[0] === L) {
        var api = function () { p(api, arguments); };
        var namespace = ar[1];
        api.q = api.q || [];
        if (typeof namespace === 'string') { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ['initNamespace', namespace]); }
        else p(cal, ar);
        return;
      }
      p(cal, ar);
    };
  })(window, 'https://app.cal.com/embed/embed.js', 'init');

  Cal('init', 'audit', { origin: 'https://cal.com' });
  Cal.ns.audit('ui', { layout: 'month_view', cssVarsPerTheme: { light: { 'cal-brand': '#BB111C' } } });

  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (e) {
      e.preventDefault();
      var href = this.href;
      Cal.ns.audit('modal', { calLink: LINK, config: { layout: 'month_view' } });
      // Fallback: no popup after 2.5 s means the embed couldn't load, go to Cal.com directly
      setTimeout(function () { if (!document.querySelector('cal-modal-box')) location.href = href; }, 2500);
    });
  }
})();
