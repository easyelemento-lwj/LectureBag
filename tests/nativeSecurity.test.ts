import test from 'node:test';
import assert from 'node:assert/strict';
import { validNativeMediaUri } from '../src/services/native';
import { androidSecurityPolicy } from '../scripts/androidSecurityPolicy';

const id = '9a91b172-6694-44d3-af25-605d58952d4c';
const root = `file:///data/user/0/com.lecturebag.app/files/recordings/${'a'.repeat(64)}`;
test('native media URI rejects remote, encoded traversal, auth files and malformed names', () => {
  assert.equal(validNativeMediaUri(`${root}/${id}.m4a`), true);
  assert.equal(validNativeMediaUri(`${root}/photos/${id}.jpg`), true);
  assert.equal(validNativeMediaUri(`${root.replace('user/0', 'data')}/${id}.m4a`), true);
  for (const uri of [
    `https://evil.test/files/recordings/${id}.m4a`, `${root}/../${id}.m4a`, `${root}/%2e%2e/${id}.m4a`,
    `${root}/${id}.json`, `${root}/${id}.m4a?download=1`, `${root}/${id}.m4a#fragment`,
    `${root}/photos/${id}.m4a`, `${root}/------------------------------------.m4a`,
    `${root.replace('com.lecturebag.app', 'com.lecturebag.app.evil')}/${id}.m4a`,
  ]) assert.equal(validNativeMediaUri(uri), false, uri);
});
test('Android CSP limits script execution and blocks remote frames and workers', () => {
  const csp = androidSecurityPolicy('https://api.example.test/v1');
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  for (const directive of ['object-src', 'base-uri', 'frame-src', 'worker-src', 'form-action']) {
    assert.ok(csp.includes(`${directive} 'none'`));
  }
  assert.ok(csp.includes('https://api.example.test '));
  assert.doesNotMatch(csp, /connect-src[^;]*https:\s/);
  for (const url of ['http://api.test', 'https://name:password@api.test', 'https://api.test/?token=x', 'https://api.test/#x']) {
    assert.throws(() => androidSecurityPolicy(url));
  }
});
