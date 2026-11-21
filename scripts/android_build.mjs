import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnv } from 'vite';
const root = resolve(import.meta.dirname, '..');
const tools = join(root, '.android-tools');
const localJdk = existsSync(tools) ? readdirSync(tools).find(name => name.startsWith('jdk-')) : undefined;
const jdk = process.env.JAVA_HOME || (localJdk ? join(tools, localJdk, 'Contents/Home') : '/Applications/Android Studio.app/Contents/jbr/Contents/Home');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(tools, 'sdk');
if (!existsSync(join(jdk, 'bin/java')) || !existsSync(join(sdk, 'platforms/android-36'))) {
  console.error('JDK 21과 Android SDK 36이 필요합니다. docs/ANDROID_APP.md를 확인해 주세요.'); process.exit(1);
}
const task = process.argv[2] || 'assembleDebug';
if (!['assembleDebug', 'bundleRelease', 'lintDebug', 'signingReport', 'testDebugUnitTest'].includes(task)) throw Error('지원하지 않는 빌드 작업');
const configPath = join(root, 'android/app/google-services.json');
if (!existsSync(configPath)) throw Error('Firebase Android 앱의 google-services.json이 필요합니다. docs/ANDROID_APP.md를 확인해 주세요.');
const firebase = JSON.parse(readFileSync(configPath, 'utf8'));
const publicFirebase = loadEnv('android', root, 'VITE_FIREBASE_PROJECT_ID');
if (firebase.project_info?.project_id !== publicFirebase.VITE_FIREBASE_PROJECT_ID) throw Error('Android와 웹 Firebase 프로젝트가 일치하지 않습니다.');
const client = firebase.client?.find(c => c.client_info?.android_client_info?.package_name === 'com.lecturebag.app');
if (!client?.oauth_client?.some(c => c.client_type === 3)) throw Error('Firebase Android 로그인용 웹 OAuth 클라이언트 설정이 필요합니다.');
const driveClient = loadEnv('android', root, 'VITE_GOOGLE_WEB_CLIENT_ID').VITE_GOOGLE_WEB_CLIENT_ID ||
  loadEnv('android', root, 'GOOGLE_DRIVE_WEB_CLIENT_ID').GOOGLE_DRIVE_WEB_CLIENT_ID;
if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(driveClient || '')) throw Error('Google Drive 웹 OAuth 클라이언트 ID가 필요합니다.');
// Only public client ID + SDK path; never copy backend client secrets here.
writeFileSync(join(root, 'android/local.properties'), `sdk.dir=${sdk}\nlecturebag.driveWebClientId=${driveClient}\n`);
const result = spawnSync(join(root, 'android/gradlew'), ['-p', join(root, 'android'), task, '--console=plain'], {
  stdio: 'inherit', env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, GRADLE_USER_HOME: join(tools, 'gradle') },
});
process.exit(result.status ?? 1);
