'use strict';

const API = 'https://api.github.com';
const WEB = 'https://github.com';
const USER_AGENT = 'ArtCraft-Suite-Updater';

// How long a resolved release is reused before re-checking GitHub.
const RELEASE_TTL = 30 * 1000;

class GitHubError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    Object.assign(this, meta);
  }
}

// In-memory ETag cache for the API fallback path.
const apiCache = new Map();
// repo -> { at, data } for the resolved release (web or API).
const releaseCache = new Map();

async function requestJson(url) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };
  const cached = apiCache.get(url);
  if (cached && cached.etag) headers['If-None-Match'] = cached.etag;

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    throw new GitHubError('offline', `Network error contacting GitHub: ${err.message}`);
  }

  if (response.status === 304 && cached) return cached.data;

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
    const resetAt = resetSeconds ? resetSeconds * 1000 : 0;
    const waitSeconds = resetAt ? Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)) : null;
    throw new GitHubError(
      'rate-limit',
      `GitHub API rate limit reached${waitSeconds != null ? ` (resets in ~${waitSeconds}s)` : ''}. Try again shortly.`,
      { remaining, resetAt }
    );
  }

  if (response.status === 404) {
    throw new GitHubError('not-found', 'Repository or release not found.', { url });
  }

  if (!response.ok) {
    throw new GitHubError('http', `GitHub API error (HTTP ${response.status}).`, {
      status: response.status,
      url
    });
  }

  const data = await response.json();
  apiCache.set(url, { etag: response.headers.get('etag'), data, at: Date.now() });
  return data;
}

// The API "latest release" (used only when a token is configured or as a
// degraded fallback if GitHub's web markup changes).
async function getLatestReleaseApi(repo) {
  return requestJson(`${API}/repos/${repo}/releases/latest`);
}

function sizeToBytes(text) {
  const match = /([0-9.]+)\s*(Bytes|KB|MB|GB)/.exec(text || '');
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const multiplier = { Bytes: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[match[2]] || 1;
  return Math.round(value * multiplier);
}

// Parses the HTML fragment GitHub serves at
//   https://github.com/{owner}/{repo}/releases/expanded_assets/{tag}
// which contains the release's uploaded assets without touching the API.
function parseExpandedAssets(html) {
  const assets = [];
  const blocks = String(html).match(/<li[^>]*Box-row[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    const href = /href="(\/[^"]*\/releases\/download\/[^"]+)"/.exec(block);
    if (!href) continue;
    const name = decodeURIComponent(href[1].split('/').pop());
    const sizeText = />([0-9.]+ (?:Bytes|KB|MB|GB))</.exec(block);
    assets.push({
      name,
      size: sizeToBytes(sizeText && sizeText[1]),
      url: `${WEB}${href[1]}`
    });
  }
  return assets;
}

// Reads the latest tag from GitHub's /releases/latest redirect (no API cost).
async function getLatestTagWeb(repo) {
  let response;
  try {
    response = await fetch(`${WEB}/${repo}/releases/latest`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow'
    });
  } catch (err) {
    throw new GitHubError('offline', `Network error contacting GitHub: ${err.message}`);
  }

  if (response.status === 404) {
    throw new GitHubError('not-found', 'Repository or release not found.', { repo });
  }
  if (!response.ok) {
    throw new GitHubError('http', `GitHub returned HTTP ${response.status}.`, { status: response.status });
  }

  const tag = response.url.includes('/releases/tag/')
    ? decodeURIComponent(response.url.split('/releases/tag/')[1].split(/[?#]/)[0])
    : null;
  if (response.body && response.body.cancel) response.body.cancel().catch(() => {});
  if (!tag) throw new GitHubError('parse', 'Could not determine the latest release tag.');
  return tag;
}

async function getReleaseAssetsWeb(repo, tag) {
  const response = await fetch(`${WEB}/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) {
    throw new GitHubError('http', `Failed to load release assets (HTTP ${response.status}).`, {
      status: response.status
    });
  }
  const assets = parseExpandedAssets(await response.text());
  if (assets.length === 0) throw new GitHubError('parse', 'No release assets were found.');
  return assets;
}

// Builds an API-shaped release object from the public web endpoints.
async function getLatestReleaseWeb(repo) {
  const tag = await getLatestTagWeb(repo);
  const assets = await getReleaseAssetsWeb(repo, tag);
  return {
    tag_name: tag,
    name: tag,
    html_url: `${WEB}/${repo}/releases/tag/${tag}`,
    published_at: null,
    body: '',
    assets: assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      browser_download_url: asset.url
    }))
  };
}

// Resolves the latest release without using the rate-limited API by default.
// A GITHUB_TOKEN (if set) switches to the API for richer data; otherwise the
// public web endpoints are used, falling back to the API if parsing fails.
async function getLatestRelease(repo, { force = false } = {}) {
  const cached = releaseCache.get(repo);
  if (!force && cached && Date.now() - cached.at < RELEASE_TTL) return cached.data;

  let release;
  if (process.env.GITHUB_TOKEN) {
    release = await getLatestReleaseApi(repo);
  } else {
    try {
      release = await getLatestReleaseWeb(repo);
    } catch (webError) {
      try {
        release = await getLatestReleaseApi(repo);
      } catch {
        throw webError;
      }
    }
  }

  releaseCache.set(repo, { at: Date.now(), data: release });
  return release;
}

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  } catch (err) {
    throw new GitHubError('offline', `Network error fetching ${url}: ${err.message}`);
  }
  if (!response.ok) {
    throw new GitHubError('http', `Failed to fetch ${url} (HTTP ${response.status}).`, {
      status: response.status
    });
  }
  return response.text();
}

// Decodes the XML/HTML entities GitHub uses in the releases atom feed.
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Reads the latest release notes from the public releases atom feed (no API cost).
async function getLatestReleaseNotes(repo) {
  let response;
  try {
    response = await fetch(`${WEB}/${repo}/releases.atom`, {
      headers: { 'User-Agent': USER_AGENT }
    });
  } catch (err) {
    throw new GitHubError('offline', `Network error contacting GitHub: ${err.message}`);
  }
  if (!response.ok) {
    throw new GitHubError('http', `Failed to load release notes (HTTP ${response.status}).`, {
      status: response.status
    });
  }
  const xml = await response.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!entry) throw new GitHubError('parse', 'No release notes were found.');
  const body = entry[1];
  const title = /<title>([\s\S]*?)<\/title>/.exec(body);
  const updated = /<updated>([\s\S]*?)<\/updated>/.exec(body);
  const content = /<content type="html">([\s\S]*?)<\/content>/.exec(body);
  return {
    title: title ? decodeXmlEntities(title[1]).trim() : null,
    updated: updated ? updated[1].trim() : null,
    html: content ? decodeXmlEntities(content[1]).trim() : ''
  };
}

function clearCache() {
  apiCache.clear();
  releaseCache.clear();
}

module.exports = {
  GitHubError,
  getLatestRelease,
  getLatestReleaseApi,
  getLatestReleaseWeb,
  getLatestTagWeb,
  getReleaseAssetsWeb,
  getLatestReleaseNotes,
  parseExpandedAssets,
  sizeToBytes,
  decodeXmlEntities,
  requestJson,
  fetchText,
  clearCache
};
