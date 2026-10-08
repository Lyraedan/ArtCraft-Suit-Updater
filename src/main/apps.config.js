'use strict';

// The twelve ArtCraft Crafting Apps published under the `storytold` GitHub org.
// `repo` is used for the GitHub Releases API; `icon` is the CDN icon when it
// exists (the five newest apps have none and fall back to a generated tile).
const APPS = [
  {
    id: 'photocraft',
    name: 'PhotoCraft',
    repo: 'storytold/photocraft',
    blurb: 'Image editor',
    icon: 'https://getartcraft.com/images/apps/photocraft/icon.webp'
  },
  {
    id: 'vectorcraft',
    name: 'VectorCraft',
    repo: 'storytold/vectorcraft',
    blurb: 'Vector illustration',
    icon: 'https://getartcraft.com/images/apps/vectorcraft/icon.webp'
  },
  {
    id: 'filmcraft',
    name: 'FilmCraft',
    repo: 'storytold/filmcraft',
    blurb: 'Video editor',
    icon: 'https://getartcraft.com/images/apps/filmcraft/icon.webp'
  },
  {
    id: 'lightcraft',
    name: 'LightCraft',
    repo: 'storytold/lightcraft',
    blurb: 'Photo library & raw developer',
    icon: 'https://getartcraft.com/images/apps/lightcraft/icon.webp'
  },
  {
    id: 'pdfcraft',
    name: 'PdfCraft',
    repo: 'storytold/pdfcraft',
    blurb: 'PDF workbench',
    icon: 'https://getartcraft.com/images/apps/pdfcraft/icon.webp'
  },
  {
    id: 'effectcraft',
    name: 'EffectCraft',
    repo: 'storytold/effectcraft',
    blurb: 'Motion graphics & VFX',
    icon: 'https://getartcraft.com/images/apps/effectcraft/icon.webp'
  },
  {
    id: 'designcraft',
    name: 'DesignCraft',
    repo: 'storytold/designcraft',
    blurb: 'Page layout & publishing',
    icon: 'https://getartcraft.com/images/apps/designcraft/icon.webp'
  },
  {
    id: 'wordcraft',
    name: 'WordCraft',
    repo: 'storytold/wordcraft',
    blurb: 'Word processor',
    icon: null
  },
  {
    id: 'cadcraft',
    name: 'CADCraft',
    repo: 'storytold/cadcraft',
    blurb: 'CAD & drafting',
    icon: null
  },
  {
    id: 'soundcraft',
    name: 'SoundCraft',
    repo: 'storytold/soundcraft',
    blurb: 'Audio editor',
    icon: null
  },
  {
    id: 'gridcraft',
    name: 'GridCraft',
    repo: 'storytold/gridcraft',
    blurb: 'Spreadsheet',
    icon: null
  },
  {
    id: 'deckcraft',
    name: 'DeckCraft',
    repo: 'storytold/deckcraft',
    blurb: 'Presentations',
    icon: null
  }
];

function getApp(id) {
  return APPS.find((app) => app.id === id) || null;
}

module.exports = { APPS, getApp };
