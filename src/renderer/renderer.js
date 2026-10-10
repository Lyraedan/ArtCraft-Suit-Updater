'use strict';

(function () {
  const state = {
    apps: [],
    categories: [],
    collapsed: {},
    platform: { os: 'windows', arch: 'x64' },
    osLabels: { windows: 'Windows', macos: 'macOS', linux: 'Linux' },
    selectedOs: null,
    results: {},
    selectedId: null,
    checking: false,
    busy: {},
    progress: {},
    errors: {},
    notes: {},
    notesOpen: {},
    notesLoading: {},
    checkedAt: null,
    globalError: null,
    version: '',
    updaterUpdate: null,
    settings: { checkOnStart: true, theme: 'dark', autoScan: true, confirmUninstall: true, portableDir: '' },
    settingsOpen: false,
    settingsDirError: '',
    settingsDirDraft: null
  };

  const sidebarList = document.getElementById('app-list');
  const detailPane = document.getElementById('detail');
  const checkedLabel = document.getElementById('checked-label');
  const checkAllButton = document.getElementById('check-all');
  const settingsButton = document.getElementById('settings-btn');
  const settingsRoot = document.getElementById('settings-root');
  const progressDock = document.getElementById('progress-dock');
  const versionEl = document.getElementById('app-version');

  // --- small helpers -------------------------------------------------------

  function h(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
    const kids = Array.isArray(children) ? children : [children];
    for (const child of kids) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(hash);
  }

  function iconElement(app, sizeClass) {
    if (app.icon) {
      const img = h('img', { class: `app-icon ${sizeClass || ''}`.trim(), src: app.icon, alt: app.name });
      img.addEventListener('error', () => {
        img.replaceWith(tileElement(app, sizeClass));
      });
      return img;
    }
    return tileElement(app, sizeClass);
  }

  function tileElement(app, sizeClass) {
    const hue = hashCode(app.id) % 360;
    const tile = h('div', {
      class: `app-tile ${sizeClass || ''}`.trim(),
      text: app.name.slice(0, 2).toUpperCase()
    });
    tile.style.background = `linear-gradient(135deg, hsl(${hue} 62% 44%), hsl(${(hue + 45) % 360} 60% 30%))`;
    return tile;
  }

  function parseVersion(value) {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(value || '');
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  }

  function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
      if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    const decimals = index === 0 || value >= 10 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[index]}`;
  }

  function statusInfo(result) {
    if (!result) return { cls: 'pending', text: 'Not checked' };
    if (result.error) return { cls: 'error', text: 'Error' };
    if (result.status === 'not-installed') return { cls: 'pending', text: 'Not installed' };
    if (result.status === 'installed') return { cls: 'current', text: 'Installed' };
    if (result.managedByInstaller) {
      if (!result.latestVersion) return { cls: 'current', text: 'Installer' };
      return result.status === 'outdated'
        ? { cls: 'outdated', text: 'Update available' }
        : { cls: 'current', text: 'Up to date' };
    }
    if (result.status === 'outdated') {
      return { cls: 'outdated', text: 'Update available' };
    }
    if (result.status === 'current') {
      if (!result.latestVersion) {
        return result.installedVersion
          ? { cls: 'current', text: 'Installed' }
          : { cls: 'pending', text: 'Not checked' };
      }
      return { cls: 'current', text: 'Up to date' };
    }
    return { cls: 'pending', text: '' };
  }

  // The greyed-out version shown to the side of the pill: the latest version
  // when the app isn't installed, or the installed version when it is up to date.
  function sideVersion(result) {
    if (!result || result.error) return null;
    if (result.status === 'not-installed') return result.latestVersion || null;
    if (result.status === 'current' && result.latestVersion && result.installedVersion) {
      return result.installedVersion;
    }
    return null;
  }

  // --- sidebar -------------------------------------------------------------

  function appRow(app) {
    const result = state.results[app.id];
    const pill = statusInfo(result);

    const nameEl = h('div', { class: 'name', text: app.name });
    const infoEl = h('div', { class: 'info' }, [nameEl]);

    // Greyed-out version beside the pill (latest when not installed, installed
    // when up to date).
    const version = sideVersion(result);
    const latestEl = version ? h('span', { class: 'row-version', text: `v${version}` }) : null;

    const trailing = state.busy[app.id]
      ? h('span', { class: 'activity' })
      : h('span', { class: `pill ${pill.cls}`, text: pill.text });

    const row = h('li', { class: state.selectedId === app.id ? 'selected' : '' }, [
      iconElement(app),
      infoEl,
      latestEl,
      trailing
    ]);
    row.addEventListener('click', () => selectApp(app.id));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectApp(app.id);
      openContextMenu(app);
    });
    return row;
  }

  function toggleCategory(id) {
    state.collapsed[id] = !state.collapsed[id];
    renderSidebar();
  }

  function renderSidebar() {
    sidebarList.replaceChildren();

    for (const category of state.categories) {
      const apps = state.apps.filter((app) => (app.category || 'creative') === category.id);
      if (apps.length === 0) continue;

      const collapsed = Boolean(state.collapsed[category.id]);
      const header = h('li', { class: `category-header ${collapsed ? 'collapsed' : ''}`.trim() }, [
        h('span', { class: 'category-caret', text: collapsed ? '▸' : '▾' }),
        h('span', { class: 'category-label', text: category.label }),
        h('span', { class: 'category-count', text: String(apps.length) })
      ]);
      header.addEventListener('click', () => toggleCategory(category.id));
      sidebarList.append(header);

      if (collapsed) continue;
      for (const app of apps) sidebarList.append(appRow(app));
    }
  }

  function updateCheckedLabel() {
    if (state.globalError) {
      checkedLabel.textContent = state.globalError;
      return;
    }
    if (state.checkedAt) {
      const time = new Date(state.checkedAt).toLocaleTimeString();
      checkedLabel.textContent = `Last checked ${time} · ${state.osLabels[state.selectedOs] || state.selectedOs}`;
    } else {
      checkedLabel.textContent = 'Not checked yet';
    }
  }

  // --- detail --------------------------------------------------------------

  function selectApp(id) {
    state.selectedId = id;
    renderSidebar();
    renderDetail();
  }

  function renderDetail() {
    if (!state.selectedId) {
      detailPane.replaceChildren(h('div', { class: 'empty', text: 'Select an app to get started.' }));
      renderProgressDock(null);
      return;
    }

    const app = state.apps.find((item) => item.id === state.selectedId);
    if (!app) return;
    const result = state.results[app.id];

    const pill = statusInfo(result);
    const versions = h('div', { class: 'versions' });
    if (result && !result.error) {
      versions.append(
        h('div', {}, [
          result.managedByInstaller ? 'Installer: ' : 'Installed: ',
          h('b', { text: result.installedVersion ? `v${result.installedVersion}` : '—' })
        ]),
        h('div', {}, ['Latest: ', h('b', { text: result.latestVersion ? `v${result.latestVersion}` : '—' })])
      );
      if (result.systemInstall && result.systemSource) {
        versions.append(h('div', { class: 'muted', text: `System install · ${result.systemSource}` }));
      }
      if (result.installDir) {
        versions.append(h('div', { class: 'muted', text: result.installDir }));
      }
    }

    const headMeta = h('div', { class: 'head-meta' }, [
      h('span', { class: `pill ${pill.cls}`, text: pill.text }),
      versions,
      app.repo
        ? h('a', {
            class: 'link',
            text: 'View on GitHub →',
            href: `https://github.com/${app.repo}`,
            onclick: (event) => {
              event.preventDefault();
              window.api.openExternal(`https://github.com/${app.repo}`);
            }
          })
        : null
    ]);

    const header = h('div', { class: 'detail-head' }, [
      iconElement(app, 'lg'),
      h('div', {}, [h('h1', { text: app.name }), h('p', { text: app.blurb })]),
      headMeta
    ]);

    const children = [header];

    if (state.checking && !result) {
      children.push(h('div', { class: 'notice', text: 'Checking for updates…' }));
    }

    if (result && result.error) {
      children.push(h('div', { class: 'error-box', text: result.error }));
    }

    if (result && !result.error) {
      children.push(renderChangelog(app, result));
      if (result.installedVersion) children.push(renderInstalledActions(app, result));
      children.push(renderDownloads(app, result));
    }

    if (state.errors[app.id]) {
      children.push(h('div', { class: 'error-box', text: state.errors[app.id] }));
    }

    detailPane.replaceChildren(...children);
    renderProgressDock(app.id);
  }

  // The download/install progress lives in a fixed bar at the bottom of the
  // window (over the content) rather than at the end of the scrolling detail.
  function renderProgressDock(appId) {
    if (!progressDock) return;
    progressDock.replaceChildren();
    const node = appId ? renderProgress(appId) : null;
    if (node) progressDock.append(node);
  }

  // Maps a detected system-install source to the release asset that matches it,
  // so "Reinstall" hands off the same installer format. pacman (AUR) installs
  // have no matching release artifact, so Reinstall is unavailable for them.
  const SYSTEM_EXT = {
    msi: 'msi',
    dmg: 'dmg',
    deb: 'deb',
    rpm: 'rpm',
    flatpak: 'flatpak',
    appimage: 'AppImage',
    tarball: 'tar.gz'
  };

  function systemReinstallAsset(result) {
    const ext = result && result.systemInstall ? SYSTEM_EXT[result.systemSource] : null;
    if (!ext) return null;
    return (result.assets || []).find((asset) => asset.ext === ext) || null;
  }

  function renderInstalledActions(app, result) {
    const canOpen = Boolean(result.canOpen);
    const canReveal = Boolean(result.canReveal);
    const busy = Boolean(state.busy[app.id]);
    const systemAsset = result.systemInstall ? systemReinstallAsset(result) : null;
    const canReinstall = result.systemInstall ? Boolean(systemAsset) : true;

    const openButton = h('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Open',
      disabled: busy || !canOpen,
      title: canOpen ? '' : 'Open is available for portable installs',
      onclick: () => openApp(app)
    });

    const reinstallButton = h('button', {
      class: 'btn',
      type: 'button',
      text: 'Reinstall',
      disabled: busy || !canReinstall,
      title: canReinstall ? '' : `Managed by ${result.systemSource}`,
      onclick: () => (result.systemInstall ? startInstall(app, systemAsset) : reinstall(app, result))
    });

    const revealButton = h('button', {
      class: 'btn ghost',
      type: 'button',
      text: 'Show in folder',
      disabled: !canReveal,
      onclick: () => revealApp(app)
    });

    const uninstallButton = h('button', {
      class: 'btn danger',
      type: 'button',
      text: 'Uninstall',
      disabled: busy,
      onclick: () => uninstallApp(app)
    });

    let summary;
    if (result.systemInstall) {
      summary = `System install · v${result.installedVersion}${result.systemSource ? ` · ${result.systemSource}` : ''}`;
    } else if (result.managedByInstaller) {
      summary = `Installer handed off · v${result.installedVersion}`;
    } else {
      summary = `Installed v${result.installedVersion}${result.installedFormat ? ` · ${result.installedFormat}` : ''}`;
    }

    return h('div', { class: 'section' }, [
      h('h2', { text: 'Installed' }),
      h('div', { class: 'actions' }, [openButton, reinstallButton, revealButton, uninstallButton]),
      h('div', { class: 'notice', text: summary })
    ]);
  }

  async function openApp(app) {
    state.errors[app.id] = '';
    try {
      await window.api.openApp(app.id);
    } catch (err) {
      state.errors[app.id] = err && err.message ? err.message : String(err);
    }
    renderDetail();
  }

  function reinstall(app, result) {
    const assets = result.assets || [];
    const match =
      (result.installedAssetName && assets.find((asset) => asset.name === result.installedAssetName)) ||
      (result.installedFormat && assets.find((asset) => asset.ext === result.installedFormat)) ||
      assets[0];
    if (!match) {
      state.errors[app.id] = 'No matching download is available to reinstall.';
      renderDetail();
      return;
    }
    startInstall(app, match);
  }

  async function revealApp(app) {
    state.errors[app.id] = '';
    try {
      await window.api.revealApp(app.id);
    } catch (err) {
      state.errors[app.id] = err && err.message ? err.message : String(err);
      renderDetail();
    }
  }

  async function uninstallApp(app) {
    if (state.busy[app.id]) return;
    state.busy[app.id] = true;
    state.errors[app.id] = '';
    renderSidebar();
    renderDetail();
    try {
      const response = await window.api.uninstall(app.id);
      if (response && response.cancelled) return;
      const result = state.results[app.id];
      if (result) {
        result.installedVersion = null;
        result.managedByInstaller = false;
        result.systemInstall = false;
        result.systemSource = null;
        result.flatpakApp = null;
        result.installedFormat = null;
        result.installedAssetName = null;
        result.installDir = null;
        result.baseDir = null;
        result.canOpen = false;
        result.canReveal = false;
        result.status = 'not-installed';
      }
    } catch (err) {
      state.errors[app.id] = err && err.message ? err.message : String(err);
    } finally {
      state.busy[app.id] = false;
      renderSidebar();
      renderDetail();
    }
  }

  // --- context menu --------------------------------------------------------

  // Builds the right-click menu for an app from its current status, then
  // dispatches the chosen action.
  async function openContextMenu(app) {
    const result = state.results[app.id];
    const installed = Boolean(result && result.installedVersion);
    const items = [{ id: 'check', label: 'Check for update' }];

    if (installed) {
      if (result.canOpen) items.push({ id: 'open', label: 'Open' });
      if (result.canReveal) items.push({ id: 'reveal', label: 'Show in folder' });

      const systemAsset = result.systemInstall ? systemReinstallAsset(result) : null;
      const canReinstall = result.systemInstall ? Boolean(systemAsset) : true;
      if (canReinstall) items.push({ id: 'reinstall', label: 'Reinstall' });

      items.push({ type: 'separator' }, { id: 'uninstall', label: 'Uninstall' });
    }

    items.push({ type: 'separator' }, { id: 'notes', label: 'View changelog' });
    items.push({
      id: 'github',
      label: 'View on GitHub',
      enabled: Boolean(app.repo)
    });

    const action = await window.api.showContextMenu(items);
    if (!action) return;
    dispatchMenuAction(app, action, result);
  }

  function dispatchMenuAction(app, action, result) {
    switch (action) {
      case 'check':
        checkOne(app.id);
        break;
      case 'open':
        openApp(app);
        break;
      case 'reveal':
        revealApp(app);
        break;
      case 'reinstall':
        if (result.systemInstall) startInstall(app, systemReinstallAsset(result));
        else reinstall(app, result);
        break;
      case 'uninstall':
        uninstallApp(app);
        break;
      case 'notes':
        showNotes(app);
        break;
      case 'github':
        if (app.repo) window.api.openExternal(`https://github.com/${app.repo}`);
        break;
      default:
        break;
    }
  }

  async function checkOne(appId) {
    if (state.busy[appId]) return;
    state.busy[appId] = true;
    state.errors[appId] = '';
    renderSidebar();
    if (state.selectedId === appId) renderDetail();
    try {
      const response = await window.api.checkAll({ appId });
      for (const item of response.apps) state.results[item.id] = item;
      state.checkedAt = response.checkedAt;
    } catch (err) {
      state.errors[appId] = err && err.message ? err.message : String(err);
    } finally {
      state.busy[appId] = false;
      renderSidebar();
      updateCheckedLabel();
      if (state.selectedId === appId) renderDetail();
    }
  }

  // --- changelog -----------------------------------------------------------

  const ALLOWED_TAGS = new Set([
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B',
    'EM', 'I', 'CODE', 'PRE', 'BLOCKQUOTE', 'A', 'HR', 'DEL', 'DETAILS', 'SUMMARY',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB'
  ]);

  // Renders untrusted release-note HTML safely: unknown elements are unwrapped,
  // all attributes are dropped except validated links and titles.
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const clean = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1) {
          const tag = child.tagName;
          if (!ALLOWED_TAGS.has(tag)) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            continue;
          }
          for (const attr of Array.from(child.attributes)) {
            const name = attr.name.toLowerCase();
            if (tag === 'A' && name === 'href') {
              if (!/^https?:/i.test(attr.value)) child.removeAttribute(attr.name);
            } else if (name !== 'title') {
              child.removeAttribute(attr.name);
            }
          }
          if (tag === 'A') {
            child.setAttribute('rel', 'noopener noreferrer');
            child.setAttribute('target', '_blank');
          }
          clean(child);
        } else if (child.nodeType !== 3) {
          node.removeChild(child);
        }
      }
    };
    clean(doc.body);
    return doc.body;
  }

  function renderChangelog(app, result) {
    const open = Boolean(state.notesOpen[app.id]);
    const toggle = h('button', {
      class: 'btn',
      type: 'button',
      text: open ? 'Hide changelog' : 'View changelog',
      onclick: () => toggleNotes(app)
    });

    const section = h('div', { class: 'section' }, [h('h2', { text: 'Release notes' }), toggle]);
    if (!open) return section;

    const loading = state.notesLoading[app.id];
    const notes = state.notes[app.id];

    if (loading) {
      section.append(h('div', { class: 'notice', text: 'Loading release notes…' }));
    } else if (!notes) {
      section.append(h('div', { class: 'notice', text: 'No release notes available.' }));
    } else if (notes.error) {
      section.append(h('div', { class: 'error-box', text: notes.error }));
    } else {
      if (notes.updated) {
        const when = new Date(notes.updated);
        if (!Number.isNaN(when.getTime())) {
          section.append(h('div', { class: 'muted', text: `Published ${when.toLocaleDateString()}` }));
        }
      }
      const notesEl = h('div', { class: 'notes' }, [sanitizeHtml(notes.html)]);
      notesEl.addEventListener('click', (event) => {
        const anchor = event.target && event.target.closest ? event.target.closest('a') : null;
        if (anchor && anchor.href) {
          event.preventDefault();
          window.api.openExternal(anchor.href);
        }
      });
      section.append(notesEl);
    }

    if (result && result.htmlUrl) {
      section.append(
        h('a', {
          class: 'link',
          text: 'Full release notes on GitHub →',
          href: result.htmlUrl,
          onclick: (event) => {
            event.preventDefault();
            window.api.openExternal(result.htmlUrl);
          }
        })
      );
    }
    return section;
  }

  function toggleNotes(app) {
    state.notesOpen[app.id] = !state.notesOpen[app.id];
    if (state.notesOpen[app.id] && !state.notes[app.id]) loadNotes(app.id);
    else renderDetail();
  }

  // Used by the context menu: opens the changelog, but does nothing if it is
  // already open (so it never accidentally hides it).
  function showNotes(app) {
    if (state.notesOpen[app.id]) return;
    state.notesOpen[app.id] = true;
    if (!state.notes[app.id]) loadNotes(app.id);
    else renderDetail();
  }

  async function loadNotes(appId) {
    state.notesLoading[appId] = true;
    renderDetail();
    try {
      state.notes[appId] = await window.api.releaseNotes(appId);
    } catch (err) {
      state.notes[appId] = { error: err && err.message ? err.message : String(err) };
    } finally {
      state.notesLoading[appId] = false;
      if (state.selectedId === appId) renderDetail();
    }
  }

  function renderDownloads(app, result) {
    const select = h('select', {
      onchange: (event) => checkAll(event.target.value)
    });
    for (const os of ['windows', 'macos', 'linux']) {
      const option = h('option', { value: os, text: state.osLabels[os] || os });
      if (os === state.selectedOs) option.selected = true;
      select.append(option);
    }

    const platformRow = h('div', { class: 'platform-row' }, [
      h('span', { class: 'muted', text: 'Platform' }),
      select
    ]);

    const rows = [];
    const assets = result.assets || [];
    assets.forEach((asset, index) => {
      rows.push(renderDownloadRow(app, asset, index === 0));
    });

    if (rows.length === 0) {
      rows.push(
        h('div', {
          class: 'notice',
          text: result.latestVersion
            ? 'No downloads found for this platform in the latest release.'
            : 'Check for updates to see available downloads.'
        })
      );
    }

    return h('div', { class: 'section' }, [
      h('h2', { text: 'Get it' }),
      platformRow,
      h('div', { class: 'dl-list' }, rows),
      h('div', {
        class: 'notice',
        text: 'Portable builds install automatically into their own subfolder inside a folder you choose, so several apps can share the same location. Installers (.msi/.dmg/.deb/.rpm/.flatpak) download, verify, then open with your system installer.'
      })
    ]);
  }

  function renderDownloadRow(app, asset, isPrimary) {
    const busy = Boolean(state.busy[app.id]);
    const result = state.results[app.id];
    // "Reinstall" only for the exact artifact that was installed, not every
    // portable build for every platform/architecture.
    const isInstalledAsset = Boolean(result && result.installedAssetName && asset.name === result.installedAssetName);
    let buttonLabel = 'Install';
    if (asset.kind === 'installer') buttonLabel = 'Download & open';
    else if (isInstalledAsset) buttonLabel = 'Reinstall';

    const button = h('button', {
      class: `btn ${isPrimary ? 'primary' : ''}`.trim(),
      type: 'button',
      text: buttonLabel,
      disabled: busy,
      onclick: () => startInstall(app, asset)
    });

    const labelRow = h('div', { class: 'dl-label' }, [
      asset.label,
      isPrimary ? h('span', { class: 'tag', text: 'Recommended' }) : null
    ]);

    const info = h('div', { class: 'dl-info' }, [
      labelRow,
      h('div', { class: 'dl-name', text: asset.name }),
      h('div', { class: 'muted', text: asset.sizeLabel || formatBytes(asset.size) })
    ]);

    const row = h('div', { class: `dl-row ${isPrimary ? 'primary' : ''}`.trim() }, [info, button]);
    if (isPrimary) row.dataset.primary = 'true';
    return row;
  }

  function renderProgress(appId) {
    const busy = state.busy[appId];
    const progress = state.progress[appId];
    if (!busy && !progress) return null;

    const phase = progress ? progress.phase : 'starting';
    const received = progress ? progress.received : 0;
    const total = progress ? progress.total : 0;

    let text = 'Preparing…';
    let percent = null;

    if (phase === 'downloading') {
      percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
      text = total
        ? `Downloading · ${formatBytes(received)} / ${formatBytes(total)} (${percent}%)`
        : `Downloading · ${formatBytes(received)}`;
    } else if (phase === 'installing') {
      text = 'Verifying and installing…';
    } else if (phase === 'done') {
      text = 'Installed.';
      percent = 100;
    } else if (phase === 'opened') {
      text = 'Installer opened. Complete the setup in the window that appeared.';
      percent = 100;
    }

    const bar = h('div', {
      class: `progress-bar ${percent === null ? 'indeterminate' : ''}`.trim()
    });
    bar.dataset.progressBar = appId;
    if (percent !== null) bar.style.width = `${percent}%`;

    const top = h('div', { class: 'progress-top' }, [
      h('span', { text }),
      h('span', { class: 'muted', text: percent === null ? 'working…' : `${percent}%` })
    ]);

    const wrap = h('div', { class: 'progress-wrap' }, [top, h('div', { class: 'progress-track' }, [bar])]);

    const canCancel = phase === 'downloading' || phase === 'starting';
    if (canCancel) {
      wrap.append(
        h('button', {
          class: 'btn danger',
          type: 'button',
          text: 'Cancel',
          style: 'margin-top:10px',
          onclick: () => window.api.cancel(appId)
        })
      );
    }
    return wrap;
  }

  // --- actions -------------------------------------------------------------

  async function startInstall(app, asset) {
    if (state.busy[app.id]) return;
    state.busy[app.id] = true;
    state.errors[app.id] = '';
    state.progress[app.id] = { received: 0, total: asset.size || 0, phase: 'starting' };
    renderSidebar();
    if (state.selectedId === app.id) renderDetail();

    try {
      let targetDir = null;

      if (asset.kind === 'portable') {
        const result = state.results[app.id];
        // Reinstall into the same folder if known; otherwise use the global
        // portable directory when it is still valid, asking for one otherwise
        // (treating an empty or invalid setting the same way).
        targetDir = (result && result.baseDir) || null;
        if (!targetDir && state.settings.portableDir) {
          const check = await window.api.checkDir(state.settings.portableDir);
          targetDir = check && check.valid ? state.settings.portableDir : null;
        }
        if (!targetDir) {
          targetDir = await window.api.pickDir(app.id);
          if (!targetDir) {
            delete state.progress[app.id];
            return;
          }
          await saveSettings({ portableDir: targetDir });
        }
      }

      const download = await window.api.download({ appId: app.id, assetName: asset.name });

      state.progress[app.id] = { received: 0, total: 0, phase: download.kind === 'portable' ? 'installing' : 'installing' };
      if (state.selectedId === app.id) renderDetail();

      await window.api.install({
        appId: app.id,
        archivePath: download.archivePath,
        ext: download.ext,
        kind: download.kind,
        targetDir,
        version: download.version,
        tag: download.tag
      });

      state.progress[app.id] = {
        received: 0,
        total: 0,
        phase: download.kind === 'portable' ? 'done' : 'opened'
      };

      if (download.kind === 'portable') {
        const result = state.results[app.id];
        if (result) {
          result.installedVersion = download.version;
          result.installedFormat = download.ext;
          result.installedAssetName = asset.name;
          result.baseDir = targetDir;
          result.canOpen = true;
          result.status = 'current';
        }
      }

      const persisted = await window.api.getState();
      const info = persisted[app.id];
      const result = state.results[app.id];
      if (result && info && info.version) {
        result.installedVersion = info.version;
        result.installDir = info.installDir || result.installDir;
        result.baseDir = info.baseDir || result.baseDir;
        result.installedFormat = info.format || result.installedFormat;
        result.installedAssetName = info.assetName || result.installedAssetName;
        result.canOpen = Boolean(info.installDir || info.launchPath || info.appPath);
        result.status = compareVersions(info.version, result.latestVersion) < 0 ? 'outdated' : 'current';
      }
    } catch (err) {
      state.errors[app.id] = err && err.message ? err.message : String(err);
    } finally {
      state.busy[app.id] = false;
      setTimeout(() => {
        delete state.progress[app.id];
        if (state.selectedId === app.id) renderDetail();
      }, 2500);
      renderSidebar();
      if (state.selectedId === app.id) renderDetail();
    }
  }

  async function checkAll(os) {
    const target = os || state.selectedOs || state.platform.os;
    state.selectedOs = target;
    state.checking = true;
    state.globalError = null;
    renderSidebar();
    if (state.selectedId) renderDetail();
    checkAllButton.disabled = true;

    try {
      const response = await window.api.checkAll({ os: target });
      state.results = {};
      for (const item of response.apps) state.results[item.id] = item;
      state.checkedAt = response.checkedAt;
    } catch (err) {
      state.globalError = err && err.message ? err.message : String(err);
    } finally {
      state.checking = false;
      checkAllButton.disabled = false;
      renderSidebar();
      updateCheckedLabel();
      if (state.selectedId) renderDetail();
    }
  }

  function onProgress(payload) {
    state.progress[payload.appId] = payload;
    const bar = document.querySelector(`[data-progress-bar="${payload.appId}"]`);
    if (!bar) {
      if (state.selectedId === payload.appId) renderDetail();
      return;
    }
    if (payload.phase === 'downloading' && payload.total) {
      const percent = Math.min(100, Math.round((payload.received / payload.total) * 100));
      bar.classList.remove('indeterminate');
      bar.style.width = `${percent}%`;
      const top = bar.closest('.progress-wrap').querySelector('.progress-top span');
      if (top) {
        top.textContent = `Downloading · ${formatBytes(payload.received)} / ${formatBytes(payload.total)} (${percent}%)`;
      }
    }
  }

  // --- launcher version ----------------------------------------------------

  // Shows the launcher's version in the sidebar footer, with a link to the
  // releases page when a newer version of the updater is available.
  function renderVersionTag() {
    if (!versionEl) return;
    versionEl.replaceChildren();
    if (!state.version) return;

    const base = `v${state.version}`;
    const update = state.updaterUpdate;

    if (update && update.updateAvailable && update.releasesUrl) {
      versionEl.append(
        h('a', {
          class: 'version-link',
          text: `${base} - Update available`,
          href: update.releasesUrl,
          onclick: (event) => {
            event.preventDefault();
            window.api.openExternal(update.releasesUrl);
          }
        })
      );
      return;
    }

    versionEl.textContent = update && !update.error ? `${base} - Up to date` : base;
  }

  async function checkUpdater() {
    try {
      state.updaterUpdate = await window.api.checkUpdater();
    } catch {
      state.updaterUpdate = null;
    }
    renderVersionTag();
  }

  // --- settings ------------------------------------------------------------

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
  }

  function applySettings() {
    applyTheme();
    if (state.settings.autoScan) startPeriodicScan();
    else stopPeriodicScan();
  }

  async function loadSettings() {
    try {
      const settings = await window.api.getSettings();
      if (settings && typeof settings === 'object') state.settings = { ...state.settings, ...settings };
    } catch {
      // keep defaults
    }
    applyTheme();
  }

  async function saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    applySettings();
    renderSettings();
    try {
      const saved = await window.api.setSettings(patch);
      if (saved && typeof saved === 'object') {
        state.settings = { ...state.settings, ...saved };
        applySettings();
      }
    } catch {
      // keep the in-memory value for this session
    }
  }

  function settingsField(title, hint, control) {
    return h('div', { class: 'field' }, [
      h('div', { class: 'field-text' }, [
        h('div', { class: 'field-title', text: title }),
        hint ? h('div', { class: 'field-hint', text: hint }) : null
      ]),
      control
    ]);
  }

  function checkboxControl(key) {
    const input = h('input', { type: 'checkbox' });
    input.checked = Boolean(state.settings[key]);
    input.addEventListener('change', () => saveSettings({ [key]: input.checked }));
    return input;
  }

  function themeControl() {
    const select = h('select', { onchange: (event) => saveSettings({ theme: event.target.value }) });
    for (const value of ['dark', 'light']) {
      const option = h('option', { value, text: value === 'dark' ? 'Dark' : 'Light' });
      if (state.settings.theme === value) option.selected = true;
      select.append(option);
    }
    return select;
  }

  async function choosePortableDir() {
    const dir = await window.api.pickDir({ title: 'Choose the default folder for portable apps' });
    if (dir) applyPortableDir(dir);
  }

  function directoryErrorMessage(check) {
    switch (check && check.reason) {
      case 'not-absolute':
        return 'Invalid path';
      case 'not-directory':
        return 'That path is not a folder.';
      case 'not-writable':
        return 'That folder is not writable.';
      case 'unreadable':
        return 'That folder is inaccessible.';
      default:
        return 'That folder is not valid.';
    }
  }

  // Validates a folder and saves it when valid, otherwise keeps what the user
  // typed and surfaces an error. The folder is only created later, on install.
  async function applyPortableDir(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      state.settingsDirError = '';
      state.settingsDirDraft = null;
      saveSettings({ portableDir: '' });
      return;
    }
    const check = await window.api.checkDir(trimmed);
    if (check && check.valid) {
      state.settingsDirError = '';
      state.settingsDirDraft = null;
      saveSettings({ portableDir: trimmed });
    } else {
      state.settingsDirDraft = value;
      state.settingsDirError = directoryErrorMessage(check);
      renderSettings();
    }
  }

  function directoryField() {
    const displayValue =
      state.settingsDirDraft != null ? state.settingsDirDraft : state.settings.portableDir || '';
    const empty = !displayValue;
    const input = h('input', {
      class: `dir-input ${empty ? 'is-empty' : ''} ${state.settingsDirError ? 'is-invalid' : ''}`.trim(),
      type: 'text',
      spellcheck: 'false',
      title: state.settings.portableDir || ''
    });
    input.value = displayValue;
    input.placeholder = 'Not set';
    input.addEventListener('change', () => applyPortableDir(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });

    const choose = h('button', {
      class: 'btn',
      type: 'button',
      text: 'Choose…',
      onclick: choosePortableDir
    });

    return h('div', { class: 'field dir-field' }, [
      h('div', { class: 'field-title', text: 'Portable install folder' }),
      input,
      choose,
      h('div', { class: 'field-hint', text: 'Where portable apps are installed.' }),
      h('div', {
        class: 'field-hint',
        text: state.settingsDirError
          ? 'Empty / Invalid — asks where to install'
          : 'Not set — asks where to install'
      }),
      state.settingsDirError ? h('div', { class: 'field-error', text: state.settingsDirError }) : null
    ]);
  }

  function openSettings() {
    state.settingsOpen = true;
    renderSettings();
  }

  function closeSettings() {
    state.settingsOpen = false;
    state.settingsDirError = '';
    state.settingsDirDraft = null;
    renderSettings();
  }

  function renderSettings() {
    if (!settingsRoot) return;
    settingsRoot.replaceChildren();
    if (!state.settingsOpen) return;

    const panel = h(
      'div',
      { class: 'settings-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
      [
        h('h2', { text: 'Settings' }),
        h('p', { class: 'panel-sub', text: 'Preferences are saved automatically.' }),
        settingsField(
          'Check for updates on start',
          'Look for new releases when the app opens.',
          checkboxControl('checkOnStart')
        ),
        settingsField('Theme', 'Dark or light appearance.', themeControl()),
        settingsField(
          'Scan for installs automatically',
          'Periodically detect apps installed or removed outside the updater.',
          checkboxControl('autoScan')
        ),
        settingsField(
          'Confirm before uninstalling',
          'Ask before removing an app.',
          checkboxControl('confirmUninstall')
        ),
        directoryField(),
        h('div', { class: 'settings-actions' }, [
          h('button', { class: 'btn primary', type: 'button', text: 'Done', onclick: closeSettings })
        ])
      ]
    );

    const overlay = h('div', { class: 'overlay' }, [panel]);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSettings();
    });
    settingsRoot.append(overlay);
  }

  // --- periodic install scan ----------------------------------------------

  // A light, network-free re-scan of local installs so apps installed or removed
  // outside the updater (e.g. via flatpak or a package manager) show up without
  // a manual check. Only installed state is refreshed; versions still come from
  // the last release check.
  const SCAN_INTERVAL = 15000;
  let scanTimer = null;
  let scanInFlight = false;

  function startPeriodicScan() {
    if (scanTimer) return;
    scanTimer = setInterval(() => scanInstalls(), SCAN_INTERVAL);
  }

  function stopPeriodicScan() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  }

  async function scanInstalls() {
    if (scanInFlight) return;
    if (state.checking || state.globalError) return;
    if (Object.values(state.busy).some(Boolean)) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    scanInFlight = true;
    let response;
    try {
      response = await window.api.scanInstalls();
    } catch {
      scanInFlight = false;
      return;
    }
    scanInFlight = false;

    let changed = false;
    for (const item of response.apps) {
      const result = state.results[item.id];
      if (!result || result.error) continue;

      const signature = (value) =>
        [
          value.installedVersion,
          value.managedByInstaller,
          value.systemInstall,
          value.status,
          value.canOpen,
          value.canReveal,
          value.installDir
        ].join('|');

      const before = signature(result);
      result.installedVersion = item.installedVersion;
      result.managedByInstaller = item.managedByInstaller;
      result.systemInstall = item.systemInstall;
      result.systemSource = item.systemSource;
      result.flatpakApp = item.flatpakApp;
      result.installedFormat = item.installedFormat;
      result.canOpen = item.canOpen;
      result.canReveal = item.canReveal;
      result.installDir = item.installDir;
      result.baseDir = item.baseDir;
      result.installedAssetName = item.installedAssetName;
      result.status = item.status;
      if (signature(result) !== before) changed = true;
    }

    if (changed) {
      renderSidebar();
      if (state.selectedId) renderDetail();
    }
  }

  // Seeds results from a local scan alone (no network) so installed status shows
  // when "check for updates on start" is off. Update info stays blank until a
  // real check runs.
  async function seedFromScan() {
    try {
      const response = await window.api.scanInstalls();
      for (const item of response.apps) {
        state.results[item.id] = { ...item, latestVersion: null, assets: [], notes: '', htmlUrl: null };
      }
      renderSidebar();
      if (state.selectedId) renderDetail();
    } catch {
      // ignore; the user can still run a full check
    }
  }

  // --- boot ----------------------------------------------------------------

  async function init() {
    const brandIcon = document.getElementById('brand-icon');
    if (brandIcon) brandIcon.addEventListener('error', () => brandIcon.remove());

    try {
      const info = await window.api.listApps();
      state.apps = info.apps;
      state.categories = info.categories && info.categories.length
        ? info.categories
        : [{ id: 'creative', label: 'Creative Suite' }];
      state.platform = info.platform;
      state.osLabels = info.osLabels;
      state.selectedOs = info.platform.os;
      state.version = info.version || '';
      if (state.version) document.title = `ArtCraft Suite Updater v${state.version}`;
      renderVersionTag();
    } catch (err) {
      state.globalError = err && err.message ? err.message : String(err);
    }

    checkAllButton.addEventListener('click', () => checkAll());
    window.api.onProgress(onProgress);
    window.addEventListener('focus', () => scanInstalls());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.settingsOpen) closeSettings();
    });
    if (settingsButton) settingsButton.addEventListener('click', openSettings);

    await loadSettings();

    renderSidebar();
    selectApp(state.apps[0] ? state.apps[0].id : null);
    checkUpdater();

    if (state.settings.checkOnStart) {
      await checkAll();
    } else {
      await seedFromScan();
      updateCheckedLabel();
    }

    applySettings();
  }

  init();
})();
