// Shared bits for the generated pages (and the reference for the hand-written ones):
// self-hosted font, structured data (who Igor is, for Google and AI assistants).

const SITE = 'https://nevios.fr';

// Outfit is a variable font: one file per character set covers weights 400 to 800
const FONT_HEAD = `<link rel="preload" href="/fonts/outfit-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Outfit';font-style:normal;font-weight:400 800;font-display:swap;src:url(/fonts/outfit-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}@font-face{font-family:'Outfit';font-style:normal;font-weight:400 800;font-display:swap;src:url(/fonts/outfit-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}</style>`;

const PERSON = {
  '@type': 'Person',
  '@id': `${SITE}/#igor`,
  name: 'Igor Sautier',
  alternateName: '@automatise_avec_igor',
  url: `${SITE}/`,
  image: `${SITE}/igor-avatar.jpg`,
  jobTitle: 'Formateur IA et automatisation',
  description: "Formateur IA et automatisation. Il aide les indépendants et les entreprises à utiliser l'IA (ChatGPT, Claude, n8n) pour automatiser leurs tâches.",
  knowsAbout: ['Intelligence artificielle', 'Automatisation', 'ChatGPT', 'Claude', 'n8n', 'Prompt engineering'],
  worksFor: { '@type': 'Organization', name: 'Nevios', url: `${SITE}/` },
  sameAs: [
    'https://instagram.com/automatise_avec_igor',
    'https://tiktok.com/@automatise_avec_igor',
    'https://youtube.com/@automatise_avec_igor',
    'https://linkedin.com/in/igor-sautier'
  ]
};

const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  url: `${SITE}/`,
  name: 'Igor Sautier',
  inLanguage: 'fr-FR',
  publisher: { '@id': PERSON['@id'] }
};

// One <script type="application/ld+json"> with Igor + the site + the page's own nodes
function jsonLd(...nodes) {
  const graph = { '@context': 'https://schema.org', '@graph': [PERSON, WEBSITE, ...nodes] };
  return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`;
}

module.exports = { SITE, FONT_HEAD, PERSON, WEBSITE, jsonLd };
