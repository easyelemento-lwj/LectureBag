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
      b.onResolve({ filter: /(?:^|\/)cloudCatalog$/ }, () => ({ path: 'catalog', namespace: 'drive-fixture' }));
      b.onResolve({ filter: /services\/drive\/driveAuth$/ }, () => ({ path: 'oauth', namespace: 'drive-fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'drive-fixture' }, ({ path }) => ({ contents: path === 'oauth'
        ? `export const loadDriveOAuth=async()=>({}); export const requestDriveCode=async()=>"mock-code";`
        : `let state=window.__driveAuto ? {connected:true,revision:1,connectionId:"mock-connection",email:"drive@example.invalid"} : {connected:false,revision:0};
          const records=[], reserved=new Map(); export class CatalogError extends Error {}
          export class CloudCatalog {
            async status(){return state}
            async start(){return {clientId:"mock-client",state:"mock-state",expiresIn:300}}
            async connect(){state={connected:true,revision:1,connectionId:"mock-connection",email:"drive@example.invalid"};return state}
            async disconnect(){state={connected:false,revision:2};return state}
            async list(folder){return {files:records.filter(r=>r.logicalFolderId===folder),nextCursor:null}}
            async transferToken(){return {accessToken:"synthetic",ownerHash:"owner",expiresIn:3600}}
            async reserveId(conn,key,candidate){if(!reserved.has(key))reserved.set(key,candidate); return {id:reserved.get(key)}}
            async commit(record){records.push(record);window.driveTransfers.commits++;return record}
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
      window.__driveAuto=${drivePreview && scenario.capture};
      window.driveTransfers={starts:0,chunks:0,commits:0};
      if(window.__driveAuto){
        const realFetch=window.fetch.bind(window), files=new Map(); let serial=0, metadata;
        window.fetch=async (input,init)=>{
          const url=new URL(String(input),location.href);
          if(url.hostname!=='www.googleapis.com')return realFetch(input,init);
          if(init?.headers?.Authorization!=='Bearer synthetic')throw new Error('Unexpected credential');
          if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['synthetic-'+(++serial)]});
          if(url.pathname.startsWith('/upload/')){
            if(init.method==='POST'){
              window.driveTransfers.starts++;metadata=JSON.parse(init.body);
              return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic'}});
            }
            window.driveTransfers.chunks++;
            const checksum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await init.body.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
            const file={...metadata,size:String(init.body.size),sha256Checksum:checksum};files.set(file.id,file);return Response.json(file);
          }
          if(init.method==='POST'){const file=JSON.parse(init.body);files.set(file.id,file);return Response.json({id:file.id})}
          const file=files.get(url.pathname.split('/').at(-1));return file?Response.json(file):new Response(null,{status:404});
        };
      }
      Object.defineProperty(navigator,'maxTouchPoints',{value:${scenario.touch}});
      Object.defineProperty(navigator,'userAgentData',{value:undefined});
      Object.defineProperty(navigator,'standalone',{value:${!!scenario.standalone}});
      window.mediaCalls=[]; navigator.mediaDevices.getUserMedia=async c=>{
        window.mediaCalls.push(c);
        if(window.__driveAuto && c.video){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#14532d';ctx.fillRect(0,0,640,480);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('Synthetic lecture frame',40,180);
          return canvas.captureStream(5)}
        throw new DOMException('Test denied','NotAllowedError')
      };
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
    if (drivePreview && scenario.capture) {
      await wait(`document.body.innerText.includes('Drive 자동 업로드')`);
      await wait(`document.querySelector('video')?.readyState>=2`);
      await wait(`document.querySelector('[data-tour="capture"]')?.disabled===false`);
      if (scenario.name === 'phone') {
        await command('Network.enable');
        await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      }
      await evaluate(`document.querySelector('[data-tour="capture"]').click()`);
      if (scenario.name === 'phone') {
        await wait(`document.body.innerText.includes('오프라인 · 사진은 기기에 보관됩니다.')`);
        assert.equal(await evaluate('window.driveTransfers.starts'), 0);
        await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      }
      try { await wait(`window.driveTransfers.commits===1`); }
      catch(error) {
        console.log(scenario.name, await evaluate(`({text:document.body.innerText,transfers:window.driveTransfers})`));
        throw error;
      }
      await wait(`document.body.innerText.includes('대기 0개')`);
      assert.deepEqual(await evaluate('window.driveTransfers'), { starts: 1, chunks: 1, commits: 1 });
      const stored = await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('keyval-store');r.onsuccess=()=>{const g=r.result.transaction('keyval').objectStore('keyval').get('lecture_snap_photos_platform-test');g.onsuccess=()=>resolve(g.result.length);g.onerror=reject}})`);
      assert.ok(stored > 0, 'automatic upload must keep local camera originals');
      await command('Page.reload');
      await wait(`document.querySelector('[aria-label="튜토리얼 닫기"]')`);
      await evaluate(`document.querySelector('[aria-label="튜토리얼 닫기"]').click()`);
      await wait(`document.body.innerText.includes('Drive 자동 업로드')`);
      assert.equal(await evaluate('window.driveTransfers.starts'), 0, 'completed capture must not upload again after reload');
      console.log(`PASS ${scenario.name}: camera -> durable source/outbox -> automatic upload/commit; reload does not duplicate`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: scenario.height, height: scenario.width, deviceScaleFactor: 1, mobile: scenario.capture });
    assert.equal(await evaluate('!!document.querySelector("video")'), scenario.capture);
    if (!scenario.capture) {
      // App center can close back to the explorer, never to a camera or blank screen.
      await evaluate(`document.querySelector('[data-tour="apps"]').click()`);
      await wait(`document.body.innerText.includes('APP CENTRE')`);
      if (drivePreview) {
        await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='Google Drive 연결' && !b.disabled)`);
        assert.ok((await evaluate('document.body.innerText')).includes('새로 촬영한 사진은 앱이 열려 있는 동안 자동 업로드'));
        await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='Google Drive 연결').click()`);
        await wait(`document.body.innerText.includes('연결됨: drive@example.invalid')`);
        await wait(`!!document.querySelector('[aria-label="시험 사진 선택"]')`);
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
