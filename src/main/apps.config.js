'use strict';

// The twelve ArtCraft Crafting Apps published under the `storytold` GitHub org.
// `repo` drives the GitHub release checks. `icon` is a path relative to the
// renderer (src/renderer/index.html); every icon is bundled under assets/icons
// so the app works fully offline.
//
// `category` groups the apps in the sidebar: 'creative' (Creative Suite) or
// 'office' (Office Suite).
//
// `ids` describes how each app appears once installed on a system, used by
// system-installs.js to detect non-portable installs. The apps are native Rust
// builds with a shared packaging playbook, so the values follow one convention:
//   bundle     macOS bundle id and Flatpak app id   ai.storyteller.<id>
//   package    deb / rpm / pacman package name      <id>
//   executable binary and .exe stem                 <id>
//   appName    MSI ProductName and macOS .app name  <Name>
//   aliases    historical package names that were renamed
const APPS = [
  {
    id: 'photocraft',
    name: 'PhotoCraft',
    repo: 'storytold/photocraft',
    blurb: 'Image editor',
    category: 'creative',
    icon: '../../assets/icons/photocraft.webp',
    ids: { bundle: 'ai.storyteller.photocraft', package: 'photocraft', executable: 'photocraft', appName: 'PhotoCraft' }
  },
  {
    id: 'vectorcraft',
    name: 'VectorCraft',
    repo: 'storytold/vectorcraft',
    blurb: 'Vector illustration',
    category: 'creative',
    icon: '../../assets/icons/vectorcraft.webp',
    ids: { bundle: 'ai.storyteller.vectorcraft', package: 'vectorcraft', executable: 'vectorcraft', appName: 'VectorCraft' }
  },
  {
    id: 'filmcraft',
    name: 'FilmCraft',
    repo: 'storytold/filmcraft',
    blurb: 'Video editor',
    category: 'creative',
    icon: '../../assets/icons/filmcraft.webp',
    ids: { bundle: 'ai.storyteller.filmcraft', package: 'filmcraft', executable: 'filmcraft', appName: 'FilmCraft' }
  },
  {
    id: 'lightcraft',
    name: 'LightCraft',
    repo: 'storytold/lightcraft',
    blurb: 'Photo library & raw developer',
    category: 'creative',
    icon: '../../assets/icons/lightcraft.webp',
    ids: { bundle: 'ai.storyteller.lightcraft', package: 'lightcraft', executable: 'lightcraft', appName: 'LightCraft' }
  },
  {
    id: 'pdfcraft',
    name: 'PdfCraft',
    repo: 'storytold/pdfcraft',
    blurb: 'PDF workbench',
    category: 'creative',
    icon: '../../assets/icons/pdfcraft.webp',
    ids: {
      bundle: 'ai.storyteller.pdfcraft',
      package: 'pdfcraft',
      executable: 'pdfcraft',
      appName: 'PdfCraft',
      aliases: ['printcraft']
    }
  },
  {
    id: 'effectcraft',
    name: 'EffectCraft',
    repo: 'storytold/effectcraft',
    blurb: 'Motion graphics & VFX',
    category: 'creative',
    icon: '../../assets/icons/effectcraft.webp',
    ids: { bundle: 'ai.storyteller.effectcraft', package: 'effectcraft', executable: 'effectcraft', appName: 'EffectCraft' }
  },
  {
    id: 'designcraft',
    name: 'DesignCraft',
    repo: 'storytold/designcraft',
    blurb: 'Page layout & publishing',
    category: 'creative',
    icon: '../../assets/icons/designcraft.webp',
    ids: { bundle: 'ai.storyteller.designcraft', package: 'designcraft', executable: 'designcraft', appName: 'DesignCraft' }
  },
  {
    id: 'soundcraft',
    name: 'SoundCraft',
    repo: 'storytold/soundcraft',
    blurb: 'Audio editor',
    category: 'creative',
    icon: '../../assets/icons/soundcraft.png',
    ids: { bundle: 'ai.storyteller.soundcraft', package: 'soundcraft', executable: 'soundcraft', appName: 'SoundCraft' }
  },
  {
    id: 'cadcraft',
    name: 'CADCraft',
    repo: 'storytold/cadcraft',
    blurb: 'CAD & drafting',
    category: 'creative',
    icon: '../../assets/icons/cadcraft.png',
    ids: { bundle: 'ai.storyteller.cadcraft', package: 'cadcraft', executable: 'cadcraft', appName: 'CADCraft' }
  },
  {
    id: 'wordcraft',
    name: 'WordCraft',
    repo: 'storytold/wordcraft',
    blurb: 'Word processor',
    category: 'office',
    icon: '../../assets/icons/wordcraft.png',
    ids: { bundle: 'ai.storyteller.wordcraft', package: 'wordcraft', executable: 'wordcraft', appName: 'WordCraft' }
  },
  {
    id: 'gridcraft',
    name: 'GridCraft',
    repo: 'storytold/gridcraft',
    blurb: 'Spreadsheet',
    category: 'office',
    icon: '../../assets/icons/gridcraft.png',
    ids: { bundle: 'ai.storyteller.gridcraft', package: 'gridcraft', executable: 'gridcraft', appName: 'GridCraft' }
  },
  {
    id: 'deckcraft',
    name: 'DeckCraft',
    repo: 'storytold/deckcraft',
    blurb: 'Presentations',
    category: 'office',
    icon: '../../assets/icons/deckcraft.png',
    ids: { bundle: 'ai.storyteller.deckcraft', package: 'deckcraft', executable: 'deckcraft', appName: 'DeckCraft' }
  }
];

// Sidebar groups, in display order.
const CATEGORIES = [
  { id: 'creative', label: 'Creative Suite' },
  { id: 'office', label: 'Office Suite' }
];

function getApp(id) {
  return APPS.find((app) => app.id === id) || null;
}

module.exports = { APPS, CATEGORIES, getApp };
