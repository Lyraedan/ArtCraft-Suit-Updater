'use strict';

(function () {
  const state = {
    apps: [],
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
    globalError: null
  };

  const sidebarList = document.getElementById('app-list');
  const detailPane = document.getElementById('detail');
  const checkedLabel = document.getElementById('checked-label');
  const checkAllButton = document.getElementById('check-all');

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
    if (result.managedByInstaller) {
      return result.status === 'outdated'
        ? { cls: 'outdated', text: `Installer v${result.installedVersion} → v${result.latestVersion}` }
        : { cls: 'current', text: 'Installer · up to date' };
    }
    if (result.status === 'outdated') {
      return { cls: 'outdated', text: `v${result.installedVersion} → v${result.latestVersion}` };
    }
    if (result.status === 'current') return { cls: 'current', text: `Up to date · v${result.latestVersion}` };
    return { cls: 'pending', text: '' };
  }

  // --- sidebar -------------------------------------------------------------

  function renderSidebar() {
    sidebarList.replaceChildren();

    for (const app of state.apps) {
      const result = state.results[app.id];
      const pill = statusInfo(result);

      const nameEl = h('div', { class: 'name', text: app.name });
      const infoEl = h('div', { class: 'info' }, [nameEl]);

      const trailing = state.busy[app.id]
        ? h('span', { class: 'activity' })
        : h('span', { class: `pill ${pill.cls}`, text: pill.text });

      const row = h('li', { class: state.selectedId === app.id ? 'selected' : '' }, [
        iconElement(app),
        infoEl,
        trailing
      ]);
      row.addEventListener('click', () => selectApp(app.id));
      sidebarList.append(row);
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
      checkedLabel.textContent = '';
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
      if (result.installDir) {
        versions.append(h('div', { class: 'muted', text: result.installDir }));
      }
    }

    const headMeta = h('div', { class: 'head-meta' }, [
      h('span', { class: `pill ${pill.cls}`, text: pill.text }),
      versions,
      result && result.htmlUrl
        ? h('a', {
            class: 'link',
            text: 'View on GitHub →',
            href: result.htmlUrl,
            onclick: (event) => {
              event.preventDefault();
              window.api.openExternal(result.htmlUrl);
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

    const progressNode = renderProgress(app.id);
    if (progressNode) children.push(progressNode);

    if (state.errors[app.id]) {
      children.push(h('div', { class: 'error-box', text: state.errors[app.id] }));
    }

    detailPane.replaceChildren(...children);
  }

  function renderInstalledActions(app, result) {
    const canOpen = Boolean(result.canOpen);
    const busy = Boolean(state.busy[app.id]);

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
      disabled: busy,
      onclick: () => reinstall(app, result)
    });

    const revealButton = h('button', {
      class: 'btn ghost',
      type: 'button',
      text: 'Show in folder',
      disabled: !canOpen,
      onclick: () => revealApp(app)
    });

    const summary = result.managedByInstaller
      ? `Installer handed off · v${result.installedVersion}`
      : `Installed v${result.installedVersion}${result.installedFormat ? ` · ${result.installedFormat}` : ''}`;

    return h('div', { class: 'section' }, [
      h('h2', { text: 'Installed' }),
      h('div', { class: 'actions' }, [openButton, reinstallButton, revealButton]),
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
      rows.push(h('div', { class: 'notice', text: 'No downloads found for this platform in the latest release.' }));
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
        targetDir = (result && result.baseDir) || null;
        if (!targetDir) {
          targetDir = await window.api.pickDir(app.id);
          if (!targetDir) {
            delete state.progress[app.id];
            return;
          }
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
      const response = await window.api.checkAll(target);
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

  // --- boot ----------------------------------------------------------------

  async function init() {
    const brandIcon = document.getElementById('brand-icon');
    if (brandIcon) brandIcon.addEventListener('error', () => brandIcon.remove());

    try {
      const info = await window.api.listApps();
      state.apps = info.apps;
      state.platform = info.platform;
      state.osLabels = info.osLabels;
      state.selectedOs = info.platform.os;
    } catch (err) {
      state.globalError = err && err.message ? err.message : String(err);
    }

    checkAllButton.addEventListener('click', () => checkAll());
    window.api.onProgress(onProgress);

    renderSidebar();
    selectApp(state.apps[0] ? state.apps[0].id : null);
    updateCheckedLabel();
    await checkAll();
  }

  init();
})();
