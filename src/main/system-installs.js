'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Detects system (non-portable) installs of the Crafting Apps on the host OS.
//
// The apps are native Rust builds with a shared packaging playbook, so their
// identifiers are consistent:
//   macOS bundle id / Flatpak app id : ai.storyteller.<id>
//   Windows MSI ProductName          : <Name>   (publisher Learning Machines LLC)
//   deb/rpm/pacman package           : <id>
//   executable / .app / exe stem     : <id> / <Name>.app / <id>.exe
//
// Detection only makes sense for the machine this updater runs on, so it is
// keyed off process.platform. Everything is best-effort: a missing tool or a
// failed query simply yields no result.

const DEFAULT_PUBLISHER = 'Learning Machines LLC';
const BUNDLE_PREFIX = 'ai.storyteller';

function createRunner() {
  return (file, args) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err) {
          err.stdout = stdout;
          reject(err);
          return;
        }
        resolve(stdout);
      });
    });
}

// Runs a command, returning null when it is missing or fails. Detection must
// never throw, so every error is swallowed.
async function tryRun(runner, file, args) {
  try {
    return await runner(file, args);
  } catch {
    return null;
  }
}

// Resolves the per-app identifiers, falling back to the shared convention when
// apps.config.js doesn't override them.
function buildIdentifiers(app) {
  const ids = app.ids || {};
  const id = app.id;
  return {
    id,
    name: app.name,
    appName: ids.appName || app.name,
    bundle: ids.bundle || `${BUNDLE_PREFIX}.${id}`,
    package: ids.package || id,
    executable: ids.executable || id,
    publisher: ids.publisher || DEFAULT_PUBLISHER,
    aliases: Array.isArray(ids.aliases) ? ids.aliases : []
  };
}

// Reduces a package-manager version (0.5.0-1, 0.2.0~rc.1) to the X.Y.Z that the
// release tags use, so it compares cleanly against the latest version.
function normalizeVersion(value) {
  if (!value) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(value));
  if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  return String(value).replace(/^v/i, '');
}

// Parses "name version" lines from pacman/dpkg/rpm/flatpak listings.
function parsePairList(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)/.exec(line.trim());
    if (match) map[match[1].toLowerCase()] = match[2];
  }
  return map;
}

const parsePacmanList = parsePairList;
const parseDpkgList = parsePairList;
const parseRpmList = parsePairList;

// Flatpak bundles built from a release tarball often report an empty version
// column, so unlike the other managers this parser keeps the id regardless and
// leaves the version as an empty string to be filled in from `flatpak info`.
function parseFlatpakList(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\S+)(?:\s+(\S+))?/.exec(trimmed);
    if (match) map[match[1].toLowerCase()] = match[2] || '';
  }
  return map;
}

function parseFlatpakInfo(text) {
  const match = /^\s*Version:\s*(.+)$/m.exec(String(text || ''));
  return match ? match[1].trim() : null;
}

function matchPackage(map, keys) {
  if (!map) return null;
  for (const key of keys) {
    if (!key) continue;
    const lower = String(key).toLowerCase();
    if (map[lower] != null) return { name: lower, version: map[lower] };
  }
  return null;
}

// Parses the JSON emitted by the Windows detection script. Handles both the
// wrapper object and a bare array (older PowerShell / manual fixtures).
function parseWindowsQuery(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { entries: [], installDirs: {} };
  }
  if (Array.isArray(parsed)) return { entries: parsed.filter(Boolean), installDirs: {} };
  if (!parsed || typeof parsed !== 'object') return { entries: [], installDirs: {} };
  const entries = parsed.uninstall
    ? (Array.isArray(parsed.uninstall) ? parsed.uninstall : [parsed.uninstall])
    : parsed.DisplayName
      ? [parsed]
      : [];
  const installDirs = parsed.installDirs && typeof parsed.installDirs === 'object'
    ? parsed.installDirs
    : {};
  return { entries: entries.filter(Boolean), installDirs };
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Finds the Add/Remove Programs entry for an app and reads its version/location.
function matchUninstallEntries(entries, app, installDirs = {}) {
  const ids = buildIdentifiers(app);
  const candidates = [ids.appName, ids.name, ids.id, ...ids.aliases]
    .map(normalizeName)
    .filter(Boolean);
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  let best = null;
  for (const entry of list) {
    const display = normalizeName(entry.DisplayName);
    if (!display || /cli/.test(display)) continue;
    const matches = candidates.some(
      (candidate) =>
        display === candidate ||
        display.startsWith(`${candidate} `) ||
        display.startsWith(`${candidate}-`)
    );
    if (!matches) continue;
    const rawVersion = entry.DisplayVersion || null;
    const location = entry.InstallLocation || installDirs[entry.DisplayName] || null;
    const info = {
      installed: true,
      version: normalizeVersion(rawVersion),
      rawVersion,
      source: 'msi',
      location,
      displayName: entry.DisplayName,
      productCode: entry.PSChildName || null,
      uninstallString: entry.UninstallString || null,
      quietUninstallString: entry.QuietUninstallString || null
    };
    // Prefer an entry that actually carries a version.
    if (!best || (info.version && !best.version)) best = info;
  }
  return best;
}

function buildWindowsScript(apps) {
  const names = apps.map((app) => buildIdentifiers(app).appName);
  const literal = names.map((name) => `'${String(name).replace(/'/g, "''")}'`).join(',');
  return [
    `$names = @(${literal})`,
    "$paths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    '$entries = @(Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,InstallLocation,Publisher,PSChildName,UninstallString,QuietUninstallString)',
    '$dirs = @{}',
    'foreach ($n in $names) { $p = "HKLM:\\SOFTWARE\\$n"; if (Test-Path $p) { $v = (Get-ItemProperty $p -ErrorAction SilentlyContinue).InstallDir; if ($v) { $dirs[$n] = $v } } }',
    '[pscustomobject]@{ uninstall = $entries; installDirs = $dirs } | ConvertTo-Json -Compress -Depth 4'
  ].join('\n');
}

async function detectWindows(apps, { runner = createRunner(), fsImpl = fs } = {}) {
  const script = buildWindowsScript(apps);
  const out = await tryRun(runner, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ]);
  if (out == null) return { installs: {}, scanned: false };

  const { entries, installDirs } = parseWindowsQuery(out);
  const results = {};
  for (const app of apps) {
    const info = matchUninstallEntries(entries, app, installDirs);
    if (!info) continue;
    const ids = buildIdentifiers(app);
    const exe = `${ids.executable}.exe`;
    let launchTarget = null;
    if (info.location) {
      launchTarget = path.join(info.location, exe);
    } else {
      const bases = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.ProgramW6432
      ].filter(Boolean);
      for (const base of bases) {
        const candidate = path.join(base, ids.appName, exe);
        if (fsImpl.existsSync(candidate)) {
          info.location = path.join(base, ids.appName);
          launchTarget = candidate;
          break;
        }
      }
    }
    results[app.id] = { ...info, launchTarget };
  }
  return { installs: results, scanned: true };
}

async function detectMac(apps, { runner = createRunner(), fsImpl = fs, home = os.homedir() } = {}) {
  const results = {};
  for (const app of apps) {
    const ids = buildIdentifiers(app);
    const bundleName = `${ids.appName}.app`;
    const candidates = [
      path.join('/Applications', bundleName),
      path.join(home, 'Applications', bundleName)
    ];
    let bundle = candidates.find((candidate) => fsImpl.existsSync(candidate)) || null;
    if (!bundle) {
      const out = await tryRun(runner, 'mdfind', [`kMDItemCFBundleIdentifier == '${ids.bundle}'`]);
      const first = (out || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      if (first && fsImpl.existsSync(first)) bundle = first;
    }
    if (!bundle) continue;
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    const out = await tryRun(runner, 'plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      plist
    ]);
    const rawVersion = (out || '').trim() || null;
    results[app.id] = {
      installed: true,
      version: normalizeVersion(rawVersion),
      rawVersion,
      source: 'dmg',
      location: bundle,
      launchTarget: bundle
    };
  }
  return { installs: results, scanned: true };
}

function linuxPackageInfo(ids, source, hit, fsImpl) {
  const info = {
    installed: true,
    version: normalizeVersion(hit.version),
    rawVersion: hit.version,
    source,
    location: null,
    launchTarget: null,
    packageName: hit.name
  };
  if (source === 'flatpak') {
    info.flatpakApp = ids.bundle;
    return info;
  }
  const primary = `/usr/bin/${ids.executable}`;
  const fallback = `/usr/bin/${ids.package}`;
  const target = fsImpl.existsSync(primary) ? primary : fsImpl.existsSync(fallback) ? fallback : primary;
  info.location = '/usr/bin';
  info.launchTarget = target;
  return info;
}

// Queries every package manager present (pacman/dpkg/rpm/flatpak) in one pass
// each, so Debian, Fedora, Arch and Flatpak hosts are all covered.
async function detectLinux(apps, { runner = createRunner(), fsImpl = fs } = {}) {
  const sources = [
    { source: 'pacman', file: 'pacman', args: ['-Q'], parse: parsePacmanList },
    { source: 'dpkg', file: 'dpkg-query', args: ['-W', '-f=${Package} ${Version}\n'], parse: parseDpkgList },
    { source: 'rpm', file: 'rpm', args: ['-qa', '--qf', '%{NAME} %{VERSION}-%{RELEASE}\n'], parse: parseRpmList },
    {
      source: 'flatpak',
      file: 'flatpak',
      args: ['list', '--app', '--columns=application,version'],
      parse: parseFlatpakList
    }
  ];

  const installed = {};
  for (const source of sources) {
    const out = await tryRun(runner, source.file, source.args);
    if (out != null) installed[source.source] = source.parse(out);
  }

  const results = {};
  for (const app of apps) {
    const ids = buildIdentifiers(app);
    for (const source of sources) {
      const map = installed[source.source];
      if (!map) continue;
      const keys = source.source === 'flatpak' ? [ids.bundle] : [ids.package, ...ids.aliases];
      const hit = matchPackage(map, keys);
      if (!hit) continue;
      // Bundles built from a release tarball may have no version in the list;
      // ask flatpak directly before giving up on the version.
      if (source.source === 'flatpak' && !hit.version) {
        const infoOut = await tryRun(runner, 'flatpak', ['info', ids.bundle]);
        const version = infoOut ? parseFlatpakInfo(infoOut) : null;
        if (version) hit.version = version;
      }
      results[app.id] = linuxPackageInfo(ids, source.source, hit, fsImpl);
      break;
    }
  }
  return { installs: results, scanned: Object.keys(installed).length > 0 };
}

// Returns { installs: { [appId]: info }, scanned } for the host OS. `scanned`
// is true when the OS install databases were actually queried, so callers can
// treat "not found" as authoritative instead of falling back to stale state.
async function detectSystemInstalls(apps, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') return detectWindows(apps, options);
  if (platform === 'darwin') return detectMac(apps, options);
  if (platform === 'linux') return detectLinux(apps, options);
  return { installs: {}, scanned: false };
}

async function detectSystemInstall(app, options = {}) {
  const detection = await detectSystemInstalls([app], options);
  return detection.installs[app.id] || null;
}

module.exports = {
  buildIdentifiers,
  normalizeVersion,
  parsePairList,
  parsePacmanList,
  parseDpkgList,
  parseRpmList,
  parseFlatpakList,
  parseFlatpakInfo,
  matchPackage,
  parseWindowsQuery,
  matchUninstallEntries,
  buildWindowsScript,
  detectWindows,
  detectMac,
  detectLinux,
  detectSystemInstalls,
  detectSystemInstall
};
