'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { once } = require('events');

const USER_AGENT = 'ArtCraft-Suite-Updater';

// keyed by download id (app id) -> AbortController
const active = new Map();

async function downloadFile(url, destPath, { id, onProgress, expectedSha256 } = {}) {
  const controller = new AbortController();
  if (id) active.set(id, controller);

  const tmpPath = `${destPath}.part`;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    active.delete(id);
    if (err.name === 'AbortError') throw new Error('Download cancelled.');
    throw new Error(`Network error: ${err.message}`);
  }

  if (!response.ok) {
    active.delete(id);
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  let received = 0;

  const out = fs.createWriteStream(tmpPath);
  try {
    const source = Readable.fromWeb(response.body);
    for await (const chunk of source) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      if (onProgress) onProgress({ received, total });
    }
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    out.destroy();
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    active.delete(id);
    if (controller.signal.aborted) throw new Error('Download cancelled.');
    throw err;
  }

  active.delete(id);

  const sha256 = hash.digest('hex');
  if (expectedSha256 && sha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw new Error(`Checksum mismatch for ${path.basename(destPath)}. The download may be corrupted.`);
  }

  await fsp.rename(tmpPath, destPath);
  return { path: destPath, size: received, sha256 };
}

function cancelDownload(id) {
  const controller = active.get(id);
  if (!controller) return false;
  controller.abort();
  active.delete(id);
  return true;
}

module.exports = { downloadFile, cancelDownload };
