# LectureBag Android 개발 앱

> 현재 녹음 기능은 비활성화되어 있다. 아래 녹음 관련 설명은 기존 코드 보존을 위한 참고이며, 현재 출시 범위가 아니다. `VITE_RECORDING_ENABLED=false`를 유지한다.

## 현재 결과

- 패키지: `com.lecturebag.app`, 버전 `1.0` / 코드 `1`, 최소 Android 7(API 24), 대상 SDK 36.
- Capacitor 8 안에 React 화면을 번들로 포함한다. 서버 웹페이지를 그대로 여는 구조가 아니며, 업데이트에는 새 APK/AAB가 필요하다.
- CameraX 미리보기와 JPEG 전용 촬영을 기존 카메라 UI에 연결했다. 비율·전후면·플래시 설정이 네이티브 카메라로 전달된다. 실제 원본은 Android 내부 저장소에 먼저 기록한다.
- 마이크는 `RecordingService`의 AAC/M4A 녹음이다. WebView의 `MediaRecorder`에 의존하지 않는다. 화면 이동·잠금·백그라운드 전환은 종료 조건이 아니다.
- 앱의 정지 버튼과 Android 녹음 알림에서 저장 후 종료할 수 있다. 최근 앱 목록에서 앱을 닫으면 종료·저장을 시도한다. 서비스는 자동 재시작하지 않는다.
- Android 필수 녹음 알림과 카메라·마이크 시스템 표시는 유지한다.
- Google 로그인은 Credential Manager, Drive 동의는 AuthorizationClient를 사용한다. Google 로그인 페이지를 WebView 안에서 열지 않는다.

## 빌드

이 Mac에는 프로젝트 내부 `.android-tools/`에 Temurin JDK 21, SDK 36, 빌드 도구와 Gradle 캐시를 준비했다. 이 디렉터리와 생성물은 Git에 포함하지 않는다.

```sh
npm run android:apk     # 웹 번들 동기화 + 디버그 APK
npm run android:check   # Android Lint
npm run android:open    # Android Studio가 설치된 경우 프로젝트 열기
npm run android:bundle # 스토어용 unsigned release AAB 생성; 서명·등록은 별도
```

다른 개발 환경에서는 Android Studio의 JDK 21과 SDK 36을 설치하고 `JAVA_HOME`, `ANDROID_HOME`을 지정한다. `scripts/android_build.mjs`가 프로젝트 도구 또는 Android Studio JDK를 찾는다.

APK 경로: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Firebase / 서버

- Firebase 프로젝트 `lecturebag`에 Android 앱 `1:253224522207:android:eb359dc92170d43698346a` 등록.
- 이 Mac의 디버그 인증서 SHA-1 / SHA-256 등록 완료. SDK 설정에서 Android OAuth 클라이언트와 웹 OAuth 클라이언트가 존재하는 것을 확인했다.
- 디버그 SHA-1: `13:82:5A:0D:8A:D6:DD:EF:3A:F3:F5:6A:8D:86:48:FC:4D:E2:AA:24`.
- Firebase 콘솔에서 해당 Android 앱의 공개 설정 파일 `google-services.json`을 받아 `android/app/google-services.json`에 둔다. 이 파일은 Git 제외 대상이며, 서비스 계정 비밀키 JSON과는 다르다. 현재 Mac에는 준비되어 있다.
- Firebase 로그인은 이 파일의 `default_web_client_id`를 사용한다. Drive 연결은 별도로 `VITE_GOOGLE_WEB_CLIENT_ID` 또는 로컬 `GOOGLE_DRIVE_WEB_CLIENT_ID`를 빌드 시 고정한다. 두 OAuth 클라이언트 ID가 같을 필요는 없다. 서버 client secret은 번들에 넣지 않는다.
- `scripts/android_build.mjs`가 Android/웹 Firebase 프로젝트 일치, Google 로그인 클라이언트 존재, Drive 클라이언트 ID 형식을 확인하고 공개 Drive ID만 `local.properties`에 기록한다. Android Studio에서 직접 빌드하기 전에도 이 스크립트를 한 번 실행한다.
- 네이티브 Firebase Auth가 확인한 UID와 JS Firebase 사용자가 일치해야 파일 접근을 허용한다. 보안 수정 전 APK에서 갱신한 경우 한 번 새로 로그인해야 할 수 있다. 기존 녹음·사진 파일은 삭제하지 않는다.
- API에서 `ANDROID_ENABLED=true`와 `ANDROID_OAUTH_READY=true`를 모두 설정한 경우에만 `https://localhost` origin을 허용한다. Firebase 사용자 검증과 기존 Drive 상태 challenge는 그대로 적용한다. 이 설정은 Android 앱으로부터의 서버 접근을 허용하므로 배포 후 별도 확인이 필요하다.
- Android AuthorizationClient의 서버 인증 코드는 빈 redirect URI로 교환한다. 웹 OAuth의 redirect URI 동작은 변경하지 않는다.
- Firebase JS 인증과 데이터 계정은 기존 웹·PC와 공유한다. Android의 로컬 저장소는 브라우저와 별개이므로, 웹에만 남아 있고 Drive에 업로드되지 않은 파일은 자동으로 복사되지 않는다.
- Play 배포 시에는 Play 앱 서명 인증서의 SHA-1/SHA-256을 추가로 등록해야 한다. 디버그 인증서가 이를 대신하지 않는다.

## 원본 보존과 녹음 제한

네이티브 원본과 메타데이터는 앱 내부 저장소에 계정별로 저장한다. 앱의 IndexedDB에 원본과 업로드 대기 항목이 저장된 후에만 임시 원본을 정리한다. 정리 중 앱이 종료되면 동일 파일 ID로 중복 저장 없이 이어서 처리한다. 휴지통·완전 삭제 이력이 있는 파일은 다시 생성하지 않는다.

정상 종료한 녹음은 네이티브 파일 재생 길이와 실제 녹음 시간을 비교한다. 차이가 크거나 중단 경고가 있으면 원본을 기기에 보관하고 자동 업로드를 보류한다. Android 10 이상에서는 마이크가 다른 앱/전화 때문에 무음 처리되는 이벤트도 감지해 중단 사유를 기록한다.

운영체제 강제 종료, 강제 중지, 전원 차단에서는 종료 콜백이나 MP4 파일 마무리가 실행된다고 보장할 수 없다. 다음 실행 시 남은 원본을 검토 대상으로 가져오지만 끝부분 누락·재생 불가는 복구를 보장하지 않는다. 파일 길이 검사는 모든 음성이 온전하다는 증명이 아니다.

## 검증 상태 / 다음 단계

- 2026-11-02 보안 검토: TypeScript, Node 테스트 162개, 네이티브 보안 단위 테스트 7개, Android/API/Drive 관련 서버 테스트 101개 통과.
- 디버그 APK와 unsigned release AAB 빌드, Android Lint 검사. 상세 범위와 남은 제한은 [보안 검토 보고서](ANDROID_SECURITY_REVIEW_2026-11-02.md)를 참고한다.
- 실기기 미연결: 로그인, 실제 사진 품질, 30분 이상 화면 잠금 녹음, 녹음 중 연속 촬영, 알림 일시정지·종료, 전화 수신, 블루투스 전환은 아직 실기기 검증하지 못했다.
- 갤러리 가져오기·파일 내보내기·공유 및 탐색기 전체 흐름도 실기기 QA가 필요하다. 현 APK는 개발 테스트용이며 스토어 출시 완료가 아니다.
- 스토어 업로드에는 릴리스 서명, Play Console 등록, 정책·데이터 보안 양식, 폐쇄 테스트 설정이 남아 있다.

공식 구현 근거: [Capacitor Android](https://capacitorjs.com/docs/android), [CameraX 사진 촬영](https://developer.android.com/media/camera/camerax/take-photo), [Android 사용자 데이터 권한](https://developer.android.com/identity/authorization), [마이크 입력 공유](https://developer.android.com/media/platform/sharing-audio-input).
