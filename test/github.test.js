'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseExpandedAssets, sizeToBytes, decodeXmlEntities } = require('../src/main/github');

const SAMPLE_HTML = `
<ul data-view-component="true">
  <li data-view-component="true" class="Box-row d-flex flex-column flex-md-row">
    <span class="d-flex flex-items-start">package icon</span>
    <a href="/storytold/photocraft/releases/download/v0.5.0/photocraft-0.5.0-windows-x64.msi">photocraft-0.5.0-windows-x64.msi</a>
    <span>52.4 MB</span>
  </li>
  <li data-view-component="true" class="Box-row d-flex flex-column flex-md-row">
    <a href="/storytold/photocraft/releases/download/v0.5.0/SHA256SUMS.txt">SHA256SUMS.txt</a>
    <span>1.2 KB</span>
  </li>
  <li data-view-component="true" class="Box-row">
    <a href="/storytold/photocraft/archive/refs/tags/v0.5.0.zip">Source code (zip)</a>
  </li>
</ul>`;

test('parseExpandedAssets extracts uploaded assets and ignores source archives', () => {
  const assets = parseExpandedAssets(SAMPLE_HTML);
  assert.equal(assets.length, 2);
  assert.deepEqual(
    assets.map((asset) => asset.name),
    ['photocraft-0.5.0-windows-x64.msi', 'SHA256SUMS.txt']
  );
  assert.equal(
    assets[0].url,
    'https://github.com/storytold/photocraft/releases/download/v0.5.0/photocraft-0.5.0-windows-x64.msi'
  );
  assert.ok(assets[0].size > 52 * 1024 * 1024);
  assert.equal(assets[1].size, Math.round(1.2 * 1024));
});

test('parseExpandedAssets returns an empty list for unexpected markup', () => {
  assert.deepEqual(parseExpandedAssets('<div>nothing here</div>'), []);
});

test('sizeToBytes converts GitHub size labels', () => {
  assert.equal(sizeToBytes('512 Bytes'), 512);
  assert.equal(sizeToBytes('1 KB'), 1024);
  assert.equal(sizeToBytes('1.5 MB'), 1572864);
  assert.equal(sizeToBytes('2 GB'), 2147483648);
  assert.equal(sizeToBytes(''), 0);
  assert.equal(sizeToBytes(undefined), 0);
});

test('decodeXmlEntities decodes release-note HTML entities', () => {
  assert.equal(decodeXmlEntities('&lt;h2&gt;Hi&lt;/h2&gt;'), '<h2>Hi</h2>');
  assert.equal(decodeXmlEntities('a &amp; b &quot;c&quot; &#39;d&#39;'), 'a & b "c" \'d\'');
  assert.equal(decodeXmlEntities('&#x1F600;'), '\u{1F600}');
  assert.equal(decodeXmlEntities(''), '');
});
