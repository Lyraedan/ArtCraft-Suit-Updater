'use strict';

const API = 'https://api.github.com';
const USER_AGENT = 'ArtCraft-Suite-Updater';

class GitHubError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    Object.assign(this, meta);
  }
}

// Simple in-memory ETag cache to stretch the unauthenticated rate limit.
const cache = new Map();

async function requestJson(url) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };
  const cached = cache.get(url);
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
  cache.set(url, { etag: response.headers.get('etag'), data, at: Date.now() });
  return data;
}

async function getLatestRelease(repo) {
  return requestJson(`${API}/repos/${repo}/releases/latest`);
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

function clearCache() {
  cache.clear();
}

module.exports = { GitHubError, getLatestRelease, requestJson, fetchText, clearCache };
