// Runs at every Netlify deploy (build command). Generates the newsletter pages from Brevo and the site indexes:
//   newsletter/index.html           archive of every newsletter sent
//   newsletter/<slug>/index.html    one page per newsletter
//   newsletters.json                latest newsletters, read by the homepage
//   sitemap.xml, llms.txt           every page of the site, for Google and AI assistants
// Needs BREVO_API_KEY. NEWSLETTER_FIXTURE=path.json uses local data instead (for testing).
// Any Brevo error fails the build on purpose, so Netlify keeps the previous deploy live.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'newsletter');
const { SITE, FONT_HEAD, jsonLd } = require('./site');
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

// Runs on the page once the email is in its shadow root, so any template (light or dark) takes the site's look:
// white background, dark text, Outfit font, site red. Buttons and badges keep their colours.
const RESTYLE_EMAIL = `<script>(function(){
  var w = window, host = document.getElementById('emailHost');
  var root = host && host.shadowRoot; if (!root) return;
  var top = root.querySelector('.email-root');
  function rgba(s){ var m = s.match(/[\\d.]+/g); return m ? {r:+m[0], g:+m[1], b:+m[2], a: m.length > 3 ? +m[3] : 1} : null; }
  function lum(c){ return (0.299*c.r + 0.587*c.g + 0.114*c.b) / 255; }
  function sat(c){ return Math.max(c.r,c.g,c.b) - Math.min(c.r,c.g,c.b); }
  var els = [top].concat([].slice.call(top.querySelectorAll('*')));
  var cardW = 0;
  els.forEach(function(el){ var r = el.getBoundingClientRect(); if (r.width <= 640 && r.width > cardW && w.getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') cardW = r.width; });
  if (!cardW) cardW = Math.min(600, top.clientWidth);
  // 1. Backgrounds: page and card become transparent (the site card is white), big dark boxes become cream
  els.forEach(function(el){
    var cs = w.getComputedStyle(el), c = rgba(cs.backgroundColor), wd = el.getBoundingClientRect().width;
    var big = el === top || wd >= 200;
    if (!big) return;
    el.removeAttribute('background');
    if (cs.backgroundImage !== 'none') el.style.setProperty('background-image', 'none', 'important');
    if (c && c.a > 0 && lum(c) < 0.45) {
      el.removeAttribute('bgcolor');
      el.style.setProperty('background-color', wd >= cardW * 0.95 || el === top ? 'transparent' : '#f5f2ef', 'important');
    }
    ['Top','Right','Bottom','Left'].forEach(function(s){
      var b = rgba(cs['border' + s + 'Color']);
      if (parseFloat(cs['border' + s + 'Width']) > 0 && b && lum(b) < 0.45) el.style.setProperty('border-' + s.toLowerCase() + '-color', '#ded9d3', 'important');
    });
  });
  // Small square photos (signature avatar) are round JPGs with dark corners: crop them to the circle
  [].slice.call(top.querySelectorAll('img')).forEach(function(img){
    var wd = img.width, ht = img.height;
    if (wd && wd <= 120 && Math.abs(wd - ht) <= 4) img.style.setProperty('border-radius', '50%', 'important');
  });
  // 2. Text: light text on what is now a light background becomes dark; red becomes the site red
  function bgOf(el){
    for (; el && el !== host; el = el.parentElement) { var c = rgba(w.getComputedStyle(el).backgroundColor); if (c && c.a > 0) return c; }
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

// Brevo serves full-size JPEGs (~150 KB for a header). Route them through Netlify's image CDN,
// sized to twice their displayed width and converted to WebP/AVIF; lazy-load all but the first.
// The allowed source domain is declared under [images] in netlify.toml.
function optimizeImages(html) {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const first = index++ === 0;
    tag = tag.replace(/\ssrc="(https:\/\/img\.mailinblue\.com\/[^"]+\.(?:jpe?g|png))"/i, (m, url) => {
      const width = Number((tag.match(/\swidth="(\d+)"/i) || [])[1]) || 600;
      return ` src="/.netlify/images?url=${encodeURIComponent(url)}&w=${Math.min(width * 2, 1200)}&q=80"`;
    });
    if (!first && !/\sloading=/i.test(tag)) tag = tag.replace(/^<img/i, '<img loading="lazy" decoding="async"');
    return tag;
  });
}

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
  out = optimizeImages(out);
  // Links in the email open in a new tab, like they would from a mail client
  out = out.replace(/<a\b(?![^>]*\starget=)([^>]*\shref="https?:)/gi, '<a target="_blank" rel="noopener"$1');
  return out;
}

// The email goes straight into the page inside a declarative shadow root: its styles stay isolated
// from the site, and its text is in the page source, readable by Google and AI assistants.
function emailBlock(html) {
  const styles = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('');
  const bodyMatch = html.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyStyle = bodyMatch && (bodyMatch[1].match(/\sstyle="([^"]*)"/i) || [])[1];
  const content = bodyMatch ? bodyMatch[2] : html.replace(/<head\b[\s\S]*?<\/head>/i, '').replace(/<\/?(?:html|body|!doctype)[^>]*>/gi, '');
  return `<div class="email-card"><div id="emailHost"><template shadowrootmode="open">${styles}` +
    `<style>:host{display:block}.email-root{color:#222;line-height:1.5}</style>` +
    `<div class="email-root"${bodyStyle ? ` style="${bodyStyle}"` : ''}>${content}</div></template></div></div>`;
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

function page({ title, description, canonical, body, schema = '', scripts = '' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="@automatise_avec_igor">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image:alt" content="Igor Sautier, formateur IA et automatisation">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og-image.jpg">
${FONT_HEAD}
<style>${CSS}</style>
${schema}
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-brand"><div class="nav-avatar"><img src="/igor-avatar.jpg" alt="Igor Sautier"></div>Igor Sautier</a>
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
    <div class="mm-avatar"><img src="/igor-avatar.jpg" alt="Igor Sautier"></div>
    <div class="mm-name">Igor Sautier</div>
    <div class="mm-title">Formateur IA &amp; Automatisation</div>
  </div>
  <div class="mm-links">
    <a href="/" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/></svg> Accueil</a>
    <a href="/ressources/index.html" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> Ressources</a>
    <a href="/newsletter/" class="mm-link"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/></svg> Newsletter</a>
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

})();
</script>
${scripts}
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
    schema: jsonLd({
      '@type': 'BlogPosting',
      '@id': `${canonical}#article`,
      headline: n.subject,
      description: n.previewText || n.subject,
      datePublished: n.date,
      inLanguage: 'fr-FR',
      url: canonical,
      mainEntityOfPage: canonical,
      image: `${SITE}/og-image.jpg`,
      author: { '@id': `${SITE}/#igor` },
      publisher: { '@id': `${SITE}/#igor` },
      isPartOf: { '@type': 'Blog', name: 'La newsletter du mardi', url: `${SITE}/newsletter/` }
    }),
    scripts: RESTYLE_EMAIL,
    body: `<main class="wrap">
  <a href="/newsletter/" class="back">${ARROW} Toutes les newsletters</a>
  <div class="nl-date">${esc(frDate(n.date, true))}</div>
  <h1>${esc(n.subject)}</h1>
  <button class="share" id="shareBtn" type="button">${SHARE_ICON} Partager</button>
  <div class="sub-box" id="subscribe">
    <p>Abonne-toi pour la recevoir chaque mardi dans ta bo&icirc;te mail.</p>
    ${subForm('S\'inscrire gratuitement')}
  </div>
  ${emailBlock(cleanEmail(n.html))}
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
    schema: jsonLd({
      '@type': 'CollectionPage',
      '@id': `${SITE}/newsletter/#page`,
      name: 'La newsletter du mardi',
      url: `${SITE}/newsletter/`,
      inLanguage: 'fr-FR',
      about: { '@id': `${SITE}/#igor` },
      hasPart: items.map(n => ({ '@type': 'BlogPosting', headline: n.subject, url: `${SITE}/newsletter/${n.slug}/`, datePublished: n.date }))
    }),
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

// ---------- sitemap.xml and llms.txt: hand-written pages + generated newsletters ----------

const NOT_LISTED = new Set(['merci.html', '404.html']);
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rarr: '→', middot: '·', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', Eacute: 'É', Agrave: 'À', Ccedil: 'Ç', rsquo: '’', hellip: '…' };
const decode = s => s.replace(/&([a-zA-Z]+);/g, (m, e) => ENTITIES[e] || m).replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c));

function staticPages() {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(ROOT, 'ressources')).filter(f => f.endsWith('.html')).map(f => 'ressources/' + f));
  return files.filter(f => !NOT_LISTED.has(f)).sort((a, b) => (b === 'index.html') - (a === 'index.html')).map(file => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const title = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || file).replace(/\s*\|\s*Igor Sautier$/, '');
    const description = decode((html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '');
    return { url: file === 'index.html' ? `${SITE}/` : `${SITE}/${file}`, file, title, description };
  });
}

function writeSiteIndexes(items) {
  const pages = staticPages();
  const nlUrls = [{ url: `${SITE}/newsletter/`, lastmod: items[0] && items[0].date }]
    .concat(items.map(n => ({ url: `${SITE}/newsletter/${n.slug}/`, lastmod: n.date })));
  const urls = pages.map(p => ({ url: p.url })).concat(nlUrls);
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.url}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);

  const line = p => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`;
  const guides = pages.filter(p => p.file.startsWith('ressources/') && p.file !== 'ressources/index.html');
  const main = pages.filter(p => !p.file.startsWith('ressources/') || p.file === 'ressources/index.html');
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), `# Igor Sautier (@automatise_avec_igor)

> Igor Sautier est formateur IA et automatisation, fondateur de Nevios (Le Vésinet, France). Il aide les indépendants et les entreprises à utiliser l'IA (ChatGPT, Claude, n8n) pour gagner du temps. Plus de 25 000 abonnés sur Instagram, TikTok et YouTube. Contenu en français.

Il propose un audit gratuit de 30 minutes pour identifier les tâches automatisables : https://cal.com/igor-sautier/audit-des-taches-automatisables

## Pages principales

${main.map(line).join('\n')}

## Guides gratuits

${guides.map(line).join('\n')}

## Newsletter du mardi

${items.map(n => `- [${n.subject}](${SITE}/newsletter/${n.slug}/) (${new Date(n.date).toISOString().slice(0, 10)})${n.previewText ? `: ${n.previewText}` : ''}`).join('\n') || '- Aucune newsletter publiée pour le moment.'}

## Réseaux

- Instagram : https://instagram.com/automatise_avec_igor
- TikTok : https://tiktok.com/@automatise_avec_igor
- YouTube : https://youtube.com/@automatise_avec_igor
- LinkedIn : https://linkedin.com/in/igor-sautier
`);
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
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), archivePage(items));
  fs.writeFileSync(path.join(ROOT, 'newsletters.json'), JSON.stringify(
    items.map(({ subject, previewText, date, slug }) => ({ subject, previewText, date, url: `/newsletter/${slug}/` })), null, 2) + '\n');
  writeSiteIndexes(items);

  console.log(`Newsletter pages built: ${items.length} newsletter(s)`);
  items.forEach(n => console.log(`  /newsletter/${n.slug}/`));
}

main().catch(err => {
  console.error('Newsletter build failed:', err.message);
  process.exit(1);
});
