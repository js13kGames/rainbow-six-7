import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, LIMIT_BYTES } from '../scripts/build.js';

test('standalone uncompressed artifact stays within the byte budget', async () => {
  const { html, bytes } = await buildArtifact();
  assert.equal(LIMIT_BYTES, 13000);
  assert.equal(bytes, Buffer.byteLength(html));
  assert.ok(bytes < LIMIT_BYTES, `${bytes} bytes exceeds budget ${LIMIT_BYTES}`);
});

test('artifact is ASCII, inline and has no runtime network or compressed loader', async () => {
  const {html}=await buildArtifact();
  assert.doesNotMatch(html, /<script[^>]+src=|<link|<img|@import|https?:\/\/|eval\(|DecompressionStream|new Function|fetch\(|XMLHttpRequest|WebSocket/i);
  assert.match(html, /<style>.+<\/style>/s);
  assert.match(html, /<script>.+<\/script>/s);
  assert.equal(/[^\x00-\x7f]/.test(html), false, 'ASCII artifact');
});
