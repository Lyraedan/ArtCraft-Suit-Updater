'use strict';

// The twelve ArtCraft Crafting Apps published under the `storytold` GitHub org.
// `repo` drives the GitHub release checks. `icon` is a path relative to the
// renderer (src/renderer/index.html); every icon is bundled under assets/icons
// so the app works fully offline.
const APPS = [
  {
    id: 'photocraft',
    name: 'PhotoCraft',
    repo: 'storytold/photocraft',
    blurb: 'Image editor',
    icon: '../../assets/icons/photocraft.webp'
  },
  {
    id: 'vectorcraft',
    name: 'VectorCraft',
    repo: 'storytold/vectorcraft',
    blurb: 'Vector illustration',
    icon: '../../assets/icons/vectorcraft.webp'
  },
  {
    id: 'filmcraft',
    name: 'FilmCraft',
    repo: 'storytold/filmcraft',
    blurb: 'Video editor',
    icon: '../../assets/icons/filmcraft.webp'
  },
  {
    id: 'lightcraft',
    name: 'LightCraft',
    repo: 'storytold/lightcraft',
    blurb: 'Photo library & raw developer',
    icon: '../../assets/icons/lightcraft.webp'
  },
  {
    id: 'pdfcraft',
    name: 'PdfCraft',
    repo: 'storytold/pdfcraft',
    blurb: 'PDF workbench',
    icon: '../../assets/icons/pdfcraft.webp'
  },
  {
    id: 'effectcraft',
    name: 'EffectCraft',
    repo: 'storytold/effectcraft',
    blurb: 'Motion graphics & VFX',
    icon: '../../assets/icons/effectcraft.webp'
  },
  {
    id: 'designcraft',
    name: 'DesignCraft',
    repo: 'storytold/designcraft',
    blurb: 'Page layout & publishing',
    icon: '../../assets/icons/designcraft.webp'
  },
  {
    id: 'wordcraft',
    name: 'WordCraft',
    repo: 'storytold/wordcraft',
    blurb: 'Word processor',
    icon: '../../assets/icons/wordcraft.png'
  },
  {
    id: 'cadcraft',
    name: 'CADCraft',
    repo: 'storytold/cadcraft',
    blurb: 'CAD & drafting',
    icon: '../../assets/icons/cadcraft.png'
  },
  {
    id: 'soundcraft',
    name: 'SoundCraft',
    repo: 'storytold/soundcraft',
    blurb: 'Audio editor',
    icon: '../../assets/icons/soundcraft.png'
  },
  {
    id: 'gridcraft',
    name: 'GridCraft',
    repo: 'storytold/gridcraft',
    blurb: 'Spreadsheet',
    icon: '../../assets/icons/gridcraft.png'
  },
  {
    id: 'deckcraft',
    name: 'DeckCraft',
    repo: 'storytold/deckcraft',
    blurb: 'Presentations',
    icon: '../../assets/icons/deckcraft.png'
  }
];

function getApp(id) {
  return APPS.find((app) => app.id === id) || null;
}

module.exports = { APPS, getApp };
