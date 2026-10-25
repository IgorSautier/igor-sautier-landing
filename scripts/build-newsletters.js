// Generates the public newsletter pages from Brevo at deploy time:
//   newsletter/index.html           archive of every newsletter sent
//   newsletter/<slug>/index.html    one page per newsletter
//   newsletter/<slug>/email.html    the cleaned email, shown in an iframe
//   newsletters.json                latest newsletters, read by the homepage
// Needs BREVO_API_KEY. NEWSLETTER_FIXTURE=path.json uses local data instead (for testing).
// Any Brevo error fails the build on purpose, so Netlify keeps the previous deploy live.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'newsletter');
const SITE = 'https://nevios.fr';
const LIST_ID = Number(process.env.NEWSLETTER_LIST_ID || 4);
const CAL = 'https://cal.com/igor-sautier/audit-des-taches-automatisables';

async function brevo(endpoint) {
  const res = await fetch('https://api.brevo.com/v3' + endpoint, {
    headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' }
  });
  if (!res.ok) throw new Error('Brevo ' + endpoint + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function loadCampaigns() {
  if (process.env.NEWSLETTER_FIXTURE) {
    return JSON.parse(fs.readFileSync(process.env.NEWSLETTER_FIXTURE, 'utf8'));
  }
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
  const list = [];
  for (let offset = 0; ; offset += 100) {
    const page = await brevo('/emailCampaigns?type=classic&status=sent&excludeHtmlContent=true&limit=100&offset=' + offset);
    list.push(...(page.campaigns || []));
    if (!page.campaigns || page.campaigns.length < 100) break;
  }
  const newsletters = list.filter(c => ((c.recipients && c.recipients.lists) || []).includes(LIST_ID));
  const full = [];
  for (const c of newsletters) full.push(await brevo('/emailCampaigns/' + c.id));
  return full;
}

// "{{ contact.PRENOM | default : 'Salut' }}" -> "Salut", any other merge tag -> ""
function resolveTags(str) {
  return String(str || '')
    .replace(/\{\{\s*contact\.[A-Z0-9_]+\s*\|\s*default\s*:\s*'([^']*)'\s*\}\}/gi, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[ \t]+,/g, ',')
    .trim();
}

// Runs inside email.html so any email template (light or dark) takes the site's look:
// white background, dark text, Outfit font, site red. Buttons and badges keep their colours.
const RESTYLE_EMAIL = `<script>(function(){
  var w = window, d = document;
  function rgba(s){ var m = s.match(/[\\d.]+/g); return m ? {r:+m[0], g:+m[1], b:+m[2], a: m.length > 3 ? +m[3] : 1} : null; }
  function lum(c){ return (0.299*c.r + 0.587*c.g + 0.114*c.b) / 255; }
  function sat(c){ return Math.max(c.r,c.g,c.b) - Math.min(c.r,c.g,c.b); }
  var els = [d.body].concat([].slice.call(d.body.querySelectorAll('*')));
  var cardW = 0;
  els.forEach(function(el){ var r = el.getBoundingClientRect(); if (r.width <= 640 && r.width > cardW && w.getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') cardW = r.width; });
  if (!cardW) cardW = Math.min(600, d.body.clientWidth);
  // 1. Backgrounds: page and card become transparent (the site card is white), big dark boxes become cream
  els.forEach(function(el){
    var cs = w.getComputedStyle(el), c = rgba(cs.backgroundColor), wd = el.getBoundingClientRect().width;
    var big = el === d.body || wd >= 200;
    if (!big) return;
    el.removeAttribute('background');
    if (cs.backgroundImage !== 'none') el.style.setProperty('background-image', 'none', 'important');
    if (c && c.a > 0 && lum(c) < 0.45) {
      el.removeAttribute('bgcolor');
      el.style.setProperty('background-color', wd >= cardW * 0.95 || el === d.body ? 'transparent' : '#f5f2ef', 'important');
    }
    ['Top','Right','Bottom','Left'].forEach(function(s){
      var b = rgba(cs['border' + s + 'Color']);
      if (parseFloat(cs['border' + s + 'Width']) > 0 && b && lum(b) < 0.45) el.style.setProperty('border-' + s.toLowerCase() + '-color', '#ded9d3', 'important');
    });
  });
  // 2. Text: light text on what is now a light background becomes dark; red becomes the site red
  function bgOf(el){
    for (; el && el !== d.documentElement; el = el.parentElement) { var c = rgba(w.getComputedStyle(el).backgroundColor); if (c && c.a > 0) return c; }
    return {r:255, g:255, b:255, a:1};
  }
  els.forEach(function(el){
    var cs = w.getComputedStyle(el), c = rgba(cs.color);
    if (!/courier|mono/i.test(cs.fontFamily)) el.style.setProperty('font-family', "'Outfit', system-ui, sans-serif", 'important');
    if (!c) return;
    if (c.r > 180 && c.g < 80 && c.b < 80) { el.style.setProperty('color', '#BB111C', 'important'); return; }
    if (lum(c) <= 0.6 || lum(bgOf(el)) <= 0.6) return;
    var col = sat(c) > 60 ? 'rgb(' + Math.round(c.r*0.6) + ',' + Math.round(c.g*0.6) + ',' + Math.round(c.b*0.6) + ')' : lum(c) > 0.85 ? '#1a1a1a' : '#6b6b6b';
    el.style.setProperty('color', col, 'important');
  });
})();</script>`;

function cleanEmail(html) {
  let out = String(html || '');
  // A sentence built around the unsubscribe link ("P.S. ... clique ici") makes no sense without it: drop the paragraph
  out = out.replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?href="\{\{\s*unsubscribe\s*\}\}"[\s\S]*?<\/p>/gi, '');
  // Elsewhere (footer), drop the unsubscribe / profile / mirror links and the separator before them
  const gap = '(?:\\s|&nbsp;|&#160;)*';
  out = out.replace(new RegExp(gap + '(?:·|&middot;|&#183;)?' + gap + '<a\\b[^>]*href="\\{\\{\\s*(?:unsubscribe|update_profile|mirror)\\s*\\}\\}"[^>]*>[\\s\\S]*?<\\/a>', 'gi'), '');
  out = resolveTags(out);
  // Keep the light version: the site is light, dark-mode email styles would clash
  out = out.replace(/\(prefers-color-scheme:\s*dark\)/gi, '(max-width:0px)')
           .replace(/color-scheme\s*:\s*light\s+dark/gi, 'color-scheme:light')
           .replace(/<meta[^>]*color-scheme[^>]*>/gi, '');
  const headExtra = '<meta name="robots" content="noindex"><meta name="color-scheme" content="light"><base target="_blank">' +
    '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>:root{color-scheme:light!important}html,body{background:transparent!important;overflow:hidden}</style>';
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + headExtra) : headExtra + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, RESTYLE_EMAIL + '</body>') : out + RESTYLE_EMAIL;
  return out;
}

function slugify(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'newsletter';
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function frDate(iso, withWeekday) {
  const opts = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' };
  if (withWeekday) opts.weekday = 'long';
  const s = new Date(iso).toLocaleDateString('fr-FR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- shared page chrome (same nav, menu and footer as the other pages) ----------

const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--accent:#BB111C;--accent-hover:#a00f18;--t1:#1a1a1a;--t2:#6b6b6b;--t3:#888;--bg:#f5f2ef;--card:#fff;--line:#ded9d3;--sans:'Outfit',system-ui,sans-serif}
body{font-family:var(--sans);background:var(--bg);color:var(--t1);line-height:1.7;-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:inherit}
nav{position:sticky;top:0;z-index:100;background:var(--bg);border-bottom:1px solid var(--line)}
.nav-inner{max-width:1280px;margin:0 auto;padding:0 48px;display:flex;align-items:center;justify-content:space-between;height:56px}
.nav-brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700}
.nav-avatar{width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0}
.nav-avatar img{width:100%;height:100%;object-fit:cover}
.nav-links{display:flex;align-items:center;gap:32px}
.nav-links a{font-size:14px;color:var(--t2);transition:color .15s}
.nav-links a:hover{color:var(--t1)}
.nav-cta{display:inline-flex;align-items:center;background:var(--accent);color:#fff;font-size:14px;font-weight:600;padding:8px 20px;border-radius:9999px;transition:background .15s}
.nav-cta:hover{background:var(--accent-hover)}
.hamburger{display:none;background:none;border:none;cursor:pointer;padding:4px;flex-direction:column;gap:5px}
.hamburger span{display:block;width:20px;height:1.5px;background:var(--t1);border-radius:1px;transition:background .15s}
.hamburger:hover span{background:var(--accent)}
.mobile-overlay{display:none;position:fixed;inset:0;z-index:150;background:rgba(0,0,0,0.3)}
.mobile-overlay.open{display:block}
.mobile-menu{display:none;position:fixed;top:0;left:0;bottom:0;width:85%;max-width:380px;background:var(--bg);z-index:200;flex-direction:column;overflow-y:auto;box-shadow:4px 0 24px rgba(0,0,0,0.1)}
.mobile-menu.open{display:flex}
.mm-close{position:absolute;top:16px;right:16px;background:none;border:1px solid var(--line);border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;color:var(--t2)}
.mm-profile{text-align:center;padding:64px 24px 24px;border-bottom:1px solid var(--line)}
.mm-avatar{width:80px;height:80px;border-radius:50%;overflow:hidden;margin:0 auto 12px}
.mm-avatar img{width:100%;height:100%;object-fit:cover}
.mm-name{font-size:18px;font-weight:700}
.mm-title{font-size:14px;color:var(--t3)}
.mm-links{padding:16px 0;flex:1}
.mm-link{display:flex;align-items:center;gap:14px;padding:14px 24px;font-size:16px;color:var(--t2);font-weight:500;transition:color .15s}
.mm-link:hover{background:rgba(0,0,0,0.03);color:var(--accent)}
.mm-link:hover svg{color:var(--accent)}
.mm-link svg{width:20px;height:20px;flex-shrink:0;color:var(--t3)}
.mm-bottom{padding:20px 24px;border-top:1px solid var(--line)}
.mm-bottom p{font-size:15px;font-weight:700;margin-bottom:4px}
.mm-sub{font-size:13px;color:var(--t3);margin-bottom:12px}
.mm-cta{display:block;width:100%;padding:14px;background:var(--accent);color:#fff;border-radius:9999px;font-size:15px;font-weight:600;text-align:center}
.wrap{max-width:720px;margin:0 auto;padding:40px 24px 80px}
.back{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:var(--t2);margin-bottom:28px;transition:color .15s}
.back:hover{color:var(--accent)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.nl-date{font-size:14px;color:var(--t3);margin-bottom:8px}
h1{font-size:40px;font-weight:800;line-height:1.15;margin-bottom:16px}
.lead{font-size:17px;color:var(--t2);margin-bottom:24px}
.share{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:transparent;border-radius:9999px;padding:8px 16px;font-family:var(--sans);font-size:14px;font-weight:600;color:var(--t1);cursor:pointer;transition:border-color .15s,color .15s;margin-bottom:24px}
.share:hover{border-color:var(--accent);color:var(--accent)}
.sub-box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:28px}
.sub-box p{font-size:14px;color:var(--t2);margin-bottom:12px}
.sub-form{display:flex;gap:10px}
.sub-form input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:6px;font-family:var(--sans);font-size:15px;background:var(--bg);color:var(--t1);outline:none}
.sub-form input:focus{border-color:var(--accent)}
.sub-form button{height:44px;padding:0 22px;border:none;border-radius:9999px;background:var(--accent);color:#fff;font-family:var(--sans);font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s}
.sub-form button:hover{background:var(--accent-hover)}
.email-card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.email-card iframe{display:block;width:100%;height:1200px;border:0}
.end-box{text-align:center;margin-top:40px}
.end-box h2{font-size:22px;font-weight:700;margin-bottom:14px}
.end-box .sub-form{max-width:460px;margin:0 auto}
.nl-list{display:flex;flex-direction:column;gap:12px}
.nl-item{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px;background:var(--card);border:1px solid var(--line);border-radius:12px;transition:border-color .15s}
.nl-item:hover{border-color:var(--accent)}
.nl-item:hover .nl-item-title{color:var(--accent)}
.nl-item-title{font-size:18px;font-weight:700;line-height:1.3;margin-bottom:6px;transition:color .15s}
.nl-item-desc{font-size:14px;color:var(--t2);line-height:1.6}
.nl-arrow{font-size:18px;color:var(--t3);flex-shrink:0;margin-top:22px}
.empty{color:var(--t2)}
footer{border-top:1px solid var(--line);padding:20px 24px;max-width:720px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#a3a3a3;flex-wrap:wrap;gap:8px}
footer a{color:#a3a3a3}
footer a:hover{color:var(--accent)}
.toast{position:fixed;right:24px;bottom:24px;z-index:300;display:flex;align-items:center;gap:12px;max-width:380px;padding:18px 22px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.08);font-size:15px;font-weight:600;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .25s}
.toast.show{opacity:1;transform:translateY(0);pointer-events:auto}
.toast-check{width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.toast-close{margin-left:auto;background:none;border:none;cursor:pointer;color:var(--t3);font-size:20px;line-height:1;padding:0 0 2px 8px;transition:color .15s}
.toast-close:hover{color:var(--accent)}
@media(max-width:768px){
  .nav-inner{padding:0 20px}
  .nav-links,.nav-cta{display:none}
  .hamburger{display:flex}
  .wrap{padding:28px 16px 64px}
  h1{font-size:30px}
  .sub-form{flex-direction:column}
  .sub-form input{flex:none;width:100%}
  .nl-item{padding:16px}
  .nl-item-title{font-size:16px}
  .toast{left:16px;right:16px;bottom:16px;max-width:none}
}`;

const SOCIAL = `
<a href="https://instagram.com/automatise_avec_igor" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5"/></svg></a>
<a href="https://tiktok.com/@automatise_avec_igor" target="_blank" rel="noopener" aria-label="TikTok"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.48a8.27 8.27 0 004.76 1.51V7.54a4.83 4.83 0 01-1-.85z"/></svg></a>
<a href="https://youtube.com/@automatise_avec_igor" target="_blank" rel="noopener" aria-label="YouTube"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31.4 31.4 0 000 12a31.4 31.4 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31.4 31.4 0 0024 12a31.4 31.4 0 00-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg></a>
<a href="https://linkedin.com/in/igor-sautier" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 013.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77A1.75 1.75 0 000 1.73v20.54A1.75 1.75 0 001.77 24h20.45A1.75 1.75 0 0024 22.27V1.73A1.75 1.75 0 0022.22 0z"/></svg></a>`;

function subForm(cta) {
  return `<form class="sub-form" name="newsletter" method="POST" data-netlify="true" action="/merci.html">
  <input type="hidden" name="form-name" value="newsletter">
  <input type="email" name="email" required placeholder="Ton adresse email" aria-label="Ton adresse email">
  <button type="submit">${cta}</button>
</form>`;
}

function page({ title, description, canonical, body }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="@automatise_avec_igor">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-brand"><div class="nav-avatar"><img src="/igor.jpg" alt="Igor Sautier"></div>Igor Sautier</a>
    <div class="nav-links">
      <a href="/">Accueil</a>
      <a href="/ressources/index.html">Ressources</a>
      <a href="/newsletter/">Newsletter</a>
      <a href="/a-propos.html">&Agrave; propos</a>
    </div>
    <a href="${CAL}" class="nav-cta" target="_blank" rel="noopener">R&eacute;server un appel</a>
    <button class="hamburger" id="hamburgerBtn" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="mobile-overlay" id="mobileOverlay"></div>
<div class="mobile-menu" id="mobileMenu">
  <button class="mm-close" id="mmClose" aria-label="Fermer">&times;</button>
  <div class="mm-profile">
    <div class="mm-avatar"><img src="/igor.jpg" alt="Igor Sautier"></div>
    <div class="mm-name">Igor Sautier</div>
    <div class="mm-title">Formateur IA &amp; Automatisation</div>
  </div>
  <div class="mm-links">
    <a href="/" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/></svg> Accueil</a>
    <a href="/ressources/index.html" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> Ressources</a>
    <a href="/newsletter/" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> Newsletter</a>
    <a href="/a-propos.html" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg> &Agrave; propos</a>
  </div>
  <div class="mm-bottom">
    <p>Rejoins 1 000+ lecteurs</p>
    <div class="mm-sub">Chaque mardi. Pas de spam.</div>
    <a href="#subscribe" class="mm-cta">S'inscrire &agrave; la newsletter</a>
  </div>
</div>
${body}
<footer>
  <span>&copy; 2026 Igor Sautier &middot; <a href="/mentions-legales.html">Mentions l&eacute;gales</a></span>
  <div style="display:flex;gap:14px">${SOCIAL}</div>
</footer>
<div class="toast" id="toast" role="status"></div>
<script>
(function(){
  var menu = document.getElementById('mobileMenu');
  var overlay = document.getElementById('mobileOverlay');
  function openMenu(){ menu.classList.add('open'); overlay.classList.add('open'); document.body.style.overflow='hidden'; }
  function closeMenu(){ menu.classList.remove('open'); overlay.classList.remove('open'); document.body.style.overflow=''; }
  document.getElementById('hamburgerBtn').addEventListener('click', openMenu);
  document.getElementById('mmClose').addEventListener('click', closeMenu);
  overlay.addEventListener('click', closeMenu);
  var mlinks = menu.querySelectorAll('a');
  for(var i=0;i<mlinks.length;i++) mlinks[i].addEventListener('click', closeMenu);

  var toast = document.getElementById('toast'), toastTimer;
  function hideToast(){ toast.classList.remove('show'); }
  function showToast(msg, isError){
    toast.innerHTML = (isError ? '' : '<span class="toast-check"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>') +
      '<span>' + msg + '</span><button type="button" class="toast-close" aria-label="Fermer">&times;</button>';
    toast.querySelector('.toast-close').addEventListener('click', hideToast);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 3000);
  }

  var forms = document.querySelectorAll('form[data-netlify]');
  for(var f=0;f<forms.length;f++){
    forms[f].addEventListener('submit', function(e){
      e.preventDefault();
      var form = this, btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      fetch('/', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(new FormData(form)).toString()})
        .then(function(r){ if(!r.ok) throw new Error(r.status); form.reset(); showToast('Bienvenue ! Ton premier email arrive tr\\u00e8s bient\\u00f4t.'); })
        .catch(function(){ showToast('Oups, \\u00e7a n\\'a pas march\\u00e9. R\\u00e9essaie dans un instant.', true); })
        .then(function(){ btn.disabled = false; });
    });
  }

  var share = document.getElementById('shareBtn');
  if(share) share.addEventListener('click', function(){
    var data = {title: document.title, url: location.href};
    if(navigator.share){ navigator.share(data).catch(function(){}); return; }
    navigator.clipboard.writeText(location.href).then(function(){ showToast('Lien copi\\u00e9. Tu peux le partager.'); });
  });

  var frame = document.getElementById('emailFrame');
  // offsetHeight is the email's own height (scrollHeight never drops below the iframe's)
  function fit(){ try { frame.style.height = Math.ceil(frame.contentDocument.documentElement.getBoundingClientRect().height) + 'px'; } catch(e){} }
  if(frame){
    frame.addEventListener('load', function(){
      fit();
      if(window.ResizeObserver) new ResizeObserver(fit).observe(frame.contentDocument.body);
    });
  }
})();
</script>
</body>
</html>
`;
}

const ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
const SHARE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';

function newsletterPage(n) {
  const canonical = `${SITE}/newsletter/${n.slug}/`;
  return page({
    title: `${n.subject} | La newsletter d'Igor`,
    description: n.previewText || n.subject,
    canonical,
    body: `<main class="wrap">
  <a href="/newsletter/" class="back">${ARROW} Toutes les newsletters</a>
  <div class="nl-date">${esc(frDate(n.date, true))}</div>
  <h1>${esc(n.subject)}</h1>
  <button class="share" id="shareBtn" type="button">${SHARE_ICON} Partager</button>
  <div class="sub-box" id="subscribe">
    <p>Abonne-toi pour la recevoir chaque mardi dans ta bo&icirc;te mail.</p>
    ${subForm('S\'inscrire gratuitement')}
  </div>
  <div class="email-card"><iframe id="emailFrame" src="/newsletter/${n.slug}/email.html" title="${esc(n.subject)}" scrolling="no" loading="eager"></iframe></div>
  <div class="end-box">
    <h2>&Ccedil;a t'a plu ? Re&ccedil;ois la prochaine directement dans ta bo&icirc;te mail.</h2>
    ${subForm('S\'inscrire gratuitement')}
  </div>
</main>`
  });
}

function archivePage(items) {
  const list = items.length
    ? items.map(n => `<a href="/newsletter/${n.slug}/" class="nl-item">
      <div>
        <div class="nl-date">${esc(frDate(n.date))}</div>
        <div class="nl-item-title">${esc(n.subject)}</div>
        ${n.previewText ? `<div class="nl-item-desc">${esc(n.previewText)}</div>` : ''}
      </div>
      <span class="nl-arrow">&rarr;</span>
    </a>`).join('\n    ')
    : '<p class="empty">La premi&egrave;re newsletter arrive bient&ocirc;t.</p>';
  return page({
    title: 'La newsletter du mardi | Igor Sautier',
    description: "Toutes les newsletters d'Igor Sautier : l'actu IA qui compte vraiment, un prompt à tester et une automatisation à copier. Chaque mardi, gratuit.",
    canonical: `${SITE}/newsletter/`,
    body: `<main class="wrap">
  <div class="eyebrow">La newsletter du mardi</div>
  <h1>Toutes les newsletters.</h1>
  <p class="lead">Ce qui a vraiment chang&eacute; dans l'IA, ce que &ccedil;a change pour toi, et un truc &agrave; faire tout de suite. Chaque mardi.</p>
  <div class="sub-box" id="subscribe">
    <p>Rejoins 1 000+ lecteurs. Gratuit, d&eacute;sinscription en un clic.</p>
    ${subForm('S\'inscrire gratuitement')}
  </div>
  <div class="nl-list">
    ${list}
  </div>
</main>`
  });
}

async function main() {
  const campaigns = await loadCampaigns();
  const used = new Set();
  const items = campaigns
    .map(c => {
      const subject = resolveTags(c.subject) || c.name;
      let slug = slugify(subject);
      if (used.has(slug)) slug += '-' + c.id;
      used.add(slug);
      return {
        id: c.id,
        subject,
        previewText: resolveTags(c.previewText),
        date: c.sentDate || c.scheduledAt || c.createdAt,
        slug,
        html: c.htmlContent
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const n of items) {
    const dir = path.join(OUT, n.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), newsletterPage(n));
    fs.writeFileSync(path.join(dir, 'email.html'), cleanEmail(n.html));
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), archivePage(items));
  fs.writeFileSync(path.join(ROOT, 'newsletters.json'), JSON.stringify(
    items.map(({ subject, previewText, date, slug }) => ({ subject, previewText, date, url: `/newsletter/${slug}/` })), null, 2) + '\n');

  console.log(`Newsletter pages built: ${items.length} newsletter(s)`);
  items.forEach(n => console.log(`  /newsletter/${n.slug}/`));
}

main().catch(err => {
  console.error('Newsletter build failed:', err.message);
  process.exit(1);
});
