// Isolated Chrome smoke test: real UI + mocked sign-in/media, no production account or API.
// Run after npm run build with: node scripts/check_platform_ui.mjs /path/to/build
import { build } from 'esbuild';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const temp = await mkdtemp(join(tmpdir(), 'lecturebag-platform-ui-'));
const drivePreview = process.env.DRIVE_PREVIEW_TEST === '1';
const assets = join(resolve(process.argv[2] || 'dist'), 'assets');
const css = await readFile(join(assets, (await readdir(assets)).find(name => name.endsWith('.css'))));
await build({ entryPoints: ['src/main.tsx'], bundle: true, outfile: join(temp, 'app.js'), format: 'iife', jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify(drivePreview ? { VITE_DRIVE_INTERNAL_PREVIEW: 'true' } : {}), 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-test-services', setup(b) {
    b.onResolve({ filter: /AuthContext(?:\.tsx)?$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    b.onResolve({ filter: /\/firebase(?:\.ts)?$/ }, () => ({ path: 'firebase', namespace: 'fixture' }));
    b.onResolve({ filter: /\.css$/ }, () => ({ path: 'style', namespace: 'fixture' }));
    if (drivePreview) {
      b.onResolve({ filter: /services\/drive\/cloudCatalog$/ }, () => ({ path: 'catalog', namespace: 'drive-fixture' }));
      b.onResolve({ filter: /services\/drive\/driveAuth$/ }, () => ({ path: 'oauth', namespace: 'drive-fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'drive-fixture' }, ({ path }) => ({ contents: path === 'oauth'
        ? `export const loadDriveOAuth=async()=>({}); export const requestDriveCode=async()=>"mock-code";`
        : `let state={connected:false,revision:0}; export class CloudCatalog {
            async status(){return state}
            async start(){return {clientId:"mock-client",state:"mock-state",expiresIn:300}}
            async connect(){state={connected:true,revision:1,connectionId:"mock-connection",email:"drive@example.invalid"};return state}
            async disconnect(){state={connected:false,revision:2};return state}
          }`, loader: 'js' }));
    }
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'auth'
      ? `const user = {uid:'platform-test', displayName:'Test', email:'test@example.invalid'}; export const AuthProvider=({children})=>children; export const useAuth=()=>({user,loading:false,isConfigured:true,signOut:async()=>{},signInWithGoogle:async()=>({})});`
      : path === 'firebase' ? 'export const auth={currentUser:null};' : '', loader: 'js' }));
  } }],
});
const bundle = await readFile(join(temp, 'app.js'));
const logo = await readFile('public/lecturebag-logo.png');
const server = createServer((req, res) => {
  const [type, data] = req.url === '/app.js' ? ['text/javascript', bundle] : req.url === '/style.css' ? ['text/css', css]
    : req.url === '/lecturebag-logo.png' ? ['image/png', logo]
    : ['text/html', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'];
  res.writeHead(200, { 'Content-Type': type }); res.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const wsUrl = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
    chrome.on('error', reject);
    chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id; const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
    pending.set(next, { resolve, reject, timer }); socket.send(JSON.stringify({ id: next, method, params, sessionId }));
  });
  const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  for (const scenario of [
    { name: 'desktop', ua: desktop, platform: 'MacIntel', touch: 0, width: 1440, height: 900, capture: false },
    { name: 'phone', ua: phone, platform: 'iPhone', touch: 5, width: 390, height: 844, capture: true },
    { name: 'android-home', ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', platform: 'Linux armv8l', touch: 5, width: 412, height: 915, capture: true, standalone: true },
    { name: 'ipad-home', ua: desktop, platform: 'MacIntel', touch: 5, width: 1180, height: 820, capture: true, standalone: true },
  ]) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'UI evaluation failed');
      return response.result.value;
    };
    const wait = expression => evaluate(`new Promise((resolve,reject)=>{const start=Date.now(); const tick=()=>{if(${expression})resolve(true);else if(Date.now()-start>7000)reject(new Error('UI wait timed out'));else setTimeout(tick,50)};tick()})`);
    await command('Runtime.enable'); await command('Page.enable');
    await command('Emulation.setUserAgentOverride', { userAgent: scenario.ua, platform: scenario.platform });
    await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: scenario.capture });
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(navigator,'maxTouchPoints',{value:${scenario.touch}});
      Object.defineProperty(navigator,'userAgentData',{value:undefined});
      Object.defineProperty(navigator,'standalone',{value:${!!scenario.standalone}});
      window.mediaCalls=[]; navigator.mediaDevices.getUserMedia=async c=>{window.mediaCalls.push(c); throw new DOMException('Test denied','NotAllowedError')};
      localStorage.clear();
      localStorage.setItem('lecturebag_app_tutorial_v4:platform-test:apps','seen');
    ` });
    await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await wait('document.querySelector("dialog[open]")');
    assert.ok((await evaluate('document.body.innerText')).includes(scenario.capture ? '카메라 화면을 살펴보세요' : '파일 탐색기를 살펴보세요'), scenario.name);
    await evaluate(`document.querySelector('[aria-label="튜토리얼 닫기"]').click()`);
    await wait('!document.querySelector("dialog[open]")');
    assert.equal(await evaluate('!!document.querySelector("video")'), scenario.capture);
    assert.equal((await evaluate('window.mediaCalls.length')) > 0, scenario.capture);
    await command('Emulation.setDeviceMetricsOverride', { width: scenario.height, height: scenario.width, deviceScaleFactor: 1, mobile: scenario.capture });
    assert.equal(await evaluate('!!document.querySelector("video")'), scenario.capture);
    if (!scenario.capture) {
      // App center can close back to the explorer, never to a camera or blank screen.
      await evaluate(`document.querySelector('[data-tour="apps"]').click()`);
      await wait(`document.body.innerText.includes('APP CENTRE')`);
      if (drivePreview) {
        await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='Google Drive 연결' && !b.disabled)`);
        assert.ok((await evaluate('document.body.innerText')).includes('자동 업로드는 아직 활성화되지 않았습니다'));
        await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='Google Drive 연결').click()`);
        await wait(`document.body.innerText.includes('연결됨: drive@example.invalid')`);
        await evaluate(`window.confirm=()=>true; Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='연결 해제').click()`);
        await wait(`document.body.innerText.includes('연결되지 않음')`);
        assert.equal(await evaluate(`Object.keys(localStorage).some(k=>/token|drive.*code/i.test(k))`), false);
        console.log('PASS Drive preview: connect, status, disconnect, no persistent tokens');
      } else {
        assert.equal(await evaluate(`!!document.querySelector('[aria-label="Google Drive 연결 시험"]')`), false);
      }
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('앱 설명')).click()`);
      await wait(`document.body.innerText.includes('튜토리얼 다시보기')`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('튜토리얼 다시보기')).click()`);
      const picker = await evaluate(`document.querySelector('#tutorial-section-picker').innerText`);
      assert.ok(!picker.includes('카메라')); assert.ok(picker.includes('파일 탐색기') && picker.includes('앱 센터'));
      await evaluate(`document.querySelector('button[title="닫기"]').click()`);
      await wait(`!document.body.innerText.includes('튜토리얼 다시보기')`);
      assert.equal(await evaluate(`document.querySelectorAll('button[title="닫기"]').length`), 0);
      assert.equal(await evaluate('window.mediaCalls.length'), 0);
      assert.ok((await evaluate('document.body.innerText')).includes('PC에 있는 사진과 녹음 파일을 가져오세요'));
      await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      assert.equal(await evaluate('!!document.querySelector("video")'), false);
    }
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(`/private/tmp/lecturebag-platform-${scenario.name}.png`, Buffer.from(screenshot.data, 'base64'));
    console.log(`PASS ${scenario.name}: initial screen, tutorial, permissions, resize${!scenario.capture ? ', app-center navigation/replay' : ''}`);
    await send('Target.closeTarget', { targetId });
  }
  assert.deepEqual(errors, []);
  await send('Browser.close');
} finally {
  socket?.close(); chrome.kill(); server.close();
  // Chrome may still be flushing its isolated profile; it contains no real account data.
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
