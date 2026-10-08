# Google Drive 구현 현황

업데이트: 2026-10-08. 내부 테스트 계정용 서버는 Railway에서 사용 중이며 공개 출시는 아니다.
계획서의 A~F 완료 조건은 유지한다. 실기기 PoC를 통과했다고 표시하지 않는다.

## Android 실제 기기 시험 준비 (2026-10-08)

- 기존 공개 Hosting을 유지하고 7일짜리 `drive-mobile-test` 미리보기에 최신 프런트엔드를 배포했다.
- 테스트 주소는 [실기기 시험 기록](GOOGLE_DRIVE_DEVICE_TEST.md)에 적었다. Google OAuth의 기존 localhost 등록은 유지하고 해당 시험 origin을 추가했다.
- 서버 CORS와 Drive Origin 검증이 같은 `DRIVE_WEB_ORIGINS`의 정확한 목록을 사용하도록 연결했다. HTTPS 테스트 주소만 개별 허용하며 와일드카드·비보안 원격 origin은 거부한다.
- 서버 테스트는 Origin 경계 3개를 포함해 61개 통과했다. 실제 Android 촬영 결과는 아직 사용자 시험 대기다.

## 새 촬영 사진의 웹 자동 업로드 (2026-10-08)

- `VITE_DRIVE_INTERNAL_PREVIEW=true`인 내부 시험 앱의 신규 촬영만 대상으로 한다. 기존 사진을 스캔해 일괄 업로드하지 않는다. 녹음 업로드는 아직 연결하지 않았다.
- 촬영 UUID·원본과 업로드 의도를 같은 IndexedDB 트랜잭션으로 저장한다. 저장 실패 시 완료로 표시하지 않으며 메모리의 사진을 유지하고 저장 재시도를 제공한다. 카메라가 준비되지 않았을 때 검은 대체 이미지를 저장·전송하지 않는다.
- 앱 전체에 전경 worker를 연결했다. 앱 센터를 닫아도 작업하며, 새 촬영·온라인 복구·앱 복귀·30초 주기로 대기열을 확인한다. 한 번에 최대 3개를 처리하며 Web Locks와 작업별 만료 lease로 탭 간 중복을 막는다.
- Drive 연결을 확인한 뒤만 전송한다. 미연결 촬영 의도는 최초 확인된 연결에 한 번만 묶으며, 이미 연결 ID가 정해진 사진은 다른 연결 세대로 자동 이전하지 않는다. UID 변경·연결 변경은 진행 요청을 취소한다.
- 촬영 시점의 `dateFolders.ts` 분류를 고정한다. 기본 모드는 `LectureBag / 연도 / 상하반기 / 월 / 일`, 시간표 모드는 `LectureBag / 연도 / 학기 / 과목 / 월 / 일`이다. 이후 시간표 수정이나 분류 모드 변경에 따른 원격 폴더 재배치는 미구현이다.
- 동일 Drive ID로 재시도한다. 세션 URI는 UI·로그·Firestore가 아닌 전용 IndexedDB에만 보관하고, 재개 시 서버 확인 바이트를 조회한다. 이 브라우저 저장소는 OS 키체인이 아니며 같은 출처의 스크립트가 접근할 수 있다. 네이티브 보호 저장소를 대체하지 않는다. 세션이 만료되면 완료 파일을 다시 확인한 뒤 새 세션을 만든다.
- SHA-256·크기·MIME 검증과 목록 등록까지 성공해야 `Drive에 저장 완료`로 표시한다. 목록만 실패하면 원본 전송 없이 등록만 재시도한다. 성공 후에도 촬영 원본은 기기에 유지한다.
- 앱 센터의 `촬영 사진 자동 업로드`에서 대기·오류·최근 10개 작업·재시도·검증된 원본 열기를 제공한다. 카메라에서도 간단한 진행 상태를 보여준다.
- 전송 전·청크 사이·목록 등록 전에 원본과 기기 휴지통을 확인해 삭제된 작업을 취소한다. 삭제 직전 전송이 완료된 Drive 사본은 유지될 수 있다. 현재 로컬 휴지통은 Drive 삭제와 동기화되지 않으며 이 제한을 시험 UI에 표시한다. 공개 출시 전 양쪽 삭제 동기화가 필수다.
- 앱 종료 후 지속 전송, 실제 모바일 OS 재개, 다른 기기의 일반 탐색기 통합은 완료하지 않았다. IndexedDB를 지우면 기기 원본·대기열도 사라지므로 테스트 중 사이트 데이터를 지우지 않는다.

검증: TypeScript 검사·Node 테스트 50개·Python 테스트 58개·운영 빌드 통과. Drive 시험 ON/OFF 격리 Chrome 테스트에서 데스크톱·휴대폰·Android 홈 화면·iPad 홈 화면 분기 통과. 합성 카메라 영상으로 촬영 → 원본/의도 저장 → 자동 전송 → 등록을 확인했고, 오프라인 촬영 후 온라인 복구와 새로고침 후 중복 미전송도 확인했다. 이는 실제 iOS/Android 기기나 실제 Google 전송 검증이 아니다. 큰 JS 번들 경고와 Google SDK의 Python 사용 중단 예정 경고는 유지된다.

## 사진 한 장 실제 전송 시험 (2026-10-08)

- 연결된 내부 시험 패널에 JPEG/PNG/WebP 한 장 선택, 업로드 재시도, 페이지별 저장 목록, 원본 열기를 추가했다(최대 20MB).
- 원본 Blob과 사전 발급 Drive ID를 UID·연결별 IndexedDB에 먼저 보관한다. 탭 간 Web Locks로 같은 대기 사진의 동시 처리를 차단한다.
- 서버 `/api/drive/transfer-token`은 Firebase UID·연결 세대·Origin을 검증하고 갱신한 단기 접근 토큰만 no-store 응답으로 반환한다. 브라우저 메모리에서만 사용한다.
- `/api/drive/reserve-id`와 Firestore 트랜잭션으로 연결별 폴더 ID를 공유한다. 수동 시험 위치는 `LectureBag / 사진 업로드 시험`이며 자동 촬영 위치와 구분한다.
- 원본은 Drive로 직접 분할 업로드한다. 로컬 SHA-256과 Drive 체크섬 확인 후 서버에 목록을 등록해야 완료로 표시한다. 목록 등록 실패 시 완료된 Drive 원본을 재사용한다.
- 원본 열기는 인증 헤더로 Drive에서 직접 다운로드하고 목록의 SHA-256·바이트 크기를 검증한 뒤 Blob URL로 표시한다. 닫거나 화면을 떠나면 URL을 해제한다.
- Firestore 목록 색인을 CLI로 적용했고, 사용자가 실제 Google 계정으로 사진 한 장 업로드와 `Drive 원본 다운로드·검증 완료` 및 이미지 열람을 확인했다. 웹 전송에서 native fetch receiver가 바뀌던 오류도 수정했다.
- 수동 시험 도구는 미완료 전송을 동일 ID의 새 세션으로 재시도한다. 신규 촬영 자동 worker의 영속 세션 재개와는 구분한다. 네이티브 전송·녹음·버전 캐시·일반 탐색기 통합은 아직 없다.

## 구현된 부분

- 서버: Firebase 인증 + 내부 테스트 UID 허용 목록 + 기본 OFF 기능 플래그.
- 웹 OAuth: Google Identity Services popup code → 서버 코드 교환. UID·출처·연결 버전에 묶인 일회용 state, 정확한 Origin, `X-Requested-With` 검증.
- Google ID 토큰 서명·audience 검증, 개인 계정 제한, Drive `about`의 permission ID 확인, 기존 연결과 다른 Google 계정 자동 병합 차단.
- Firestore 트랜잭션으로 연결 버전 비교. 재승인 중 연결 해제나 다른 요청이 완료되면 이전 요청 거절.
- 서버 갱신 토큰: 별도 Redis 비밀 저장소에 Fernet 암호문 저장. 암호문은 UID·연결 ID를 포함하며 키 버전을 관리한다. 접근 토큰은 요청 메모리에만 유지한다.
- 파일 등록 API: Drive에서 소유자·앱 권한·앱 식별 메타데이터·부모 폴더·크기·MIME 확인 후 멱등 등록. 영구 삭제 표식과 충돌하는 재등록 거절.
- 파일 목록 API: UID·현재 연결·폴더 기준으로 최대 50개, 촬영 시각 + 파일 ID 커서. 원본은 응답에 넣지 않는다.
- 공통 업로드 대기열: 재실행 후 상태 복원, 계정·연결 세대 격리, 중복 등록 방지, 만료 가능한 작업 잠금, 취소 표식, 중단 재개, 재시도 상한. 목록 등록 단계 재시도는 원본을 다시 전송하지 않는다.
- 전경 Drive 전송 모듈: ID 발급, resumable 세션 시작, 청크 전송, Drive 응답의 확인 바이트 조회, 완료 크기 검사, 인증·용량·일시적 오류 구분. 네이티브 백그라운드 어댑터를 대체하지 않는다.
- 앱 센터: 내부 시험 플래그를 켰을 때만 연결·상태·연결 해제·수동 사진 시험·촬영 자동 업로드 상태를 표시한다.
- Firestore 클라이언트 직접 접근 차단 규칙 및 목록용 색인 선언.

## 현재 실제로 실행 가능한 API

| API | 역할 |
| --- | --- |
| `POST /api/drive/auth/start` | 일회용 연결 시도 발급 |
| `POST /api/drive/connect` | 웹 OAuth 코드 교환·검증·연결 저장 |
| `GET /api/drive/status` | 현재 사용자 연결 정보 조회 |
| `POST /api/drive/disconnect` | 연결 버전 무효화·저장된 갱신 토큰 삭제, 원본 유지 |
| `POST /api/drive/transfer-token` | 검증된 현재 연결의 단기 접근 토큰 제공 |
| `POST /api/drive/reserve-id` | 연결별 폴더 ID 멱등 예약 |
| `POST /api/cloud-files/commit` | 검증된 신규 업로드의 파일 목록 등록 |
| `GET /api/cloud-files` | 현재 연결·폴더의 목록과 다음 커서 |

`disconnect`는 Google 계정의 OAuth 동의 자체를 철회하지 않는다. 연결 정보·서버 자격을 제거한다.
권한 철회 UI/API와 원격 작업 취소 통합은 미완료다. 서버의 비밀 토큰 참조는 상태 응답에 포함되지 않는다.

등록할 신규 파일에는 `appProperties`의 `lecturebagFileId`(앱 UUID), `lecturebagConnectionId`,
`lecturebagOwner`(Firebase UID의 SHA-256 hex)가 필요하다. 부모 폴더에는
`lecturebagConnectionId`와 `lecturebagFolderId`가 있어야 한다. 파일과 폴더는 본인 My Drive 소유여야 한다.
Picker 파일 가져오기는 이 신규 업로드 등록 API로 우회하지 않고 별도 흐름으로 구현한다.

## 내부 연결 시험 준비

1. `.env.example`의 Drive 변수 이름을 사용한다. 코드·예제 파일에는 실제 비밀 값을 넣지 않는다.
2. Google Cloud에서 Drive API와 웹 OAuth 클라이언트를 구성한다. `openid`, `email`, `drive.file`을 요청한다. GIS popup 코드 교환의 redirect URI는 호출 페이지의 origin이다.
3. `GOOGLE_DRIVE_WEB_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `DRIVE_WEB_ORIGINS`를 서버에 설정한다. Origin은 Google과 API CORS에도 등록돼 있어야 한다.
4. Firestore 데이터베이스와 서버 권한을 준비한다. 현재 프로젝트는 데이터베이스·IAM 설정 및 목록 색인 배포를 마쳤다. 규칙·색인 선언은 `firebase.json`에 연결돼 있다.
5. `DRIVE_TOKEN_REDIS_URL`은 전용 ACL·영속 저장·백업·noeviction 정책의 비밀 저장소를 가리킨다. 운영에서는 TLS를 사용한다. 기존 AI 제한용/삭제 가능한 캐시와 공유하지 않는다.
6. 독립적으로 생성한 Fernet 키를 서버 비밀 변수 `DRIVE_TOKEN_KEYS_JSON`의 버전별 JSON으로 설정한다. `DRIVE_TOKEN_KEY_VERSION`이 가리키는 키로 새 암호문을 만들며 이전 버전 키로 기존 암호문을 읽을 수 있다. 실제 기존 암호문 일괄 재암호화와 고아 토큰 정리는 별도 구현 대상이다.
7. 내부 시험 환경에서만 `DRIVE_ENABLED=true`, 허용할 Firebase UID의 `DRIVE_INTERNAL_TEST_UIDS`, `VITE_DRIVE_INTERNAL_PREVIEW=true`를 설정한다. 허용 목록이 비어 있으면 모든 사용자를 거절한다.
8. 앱 센터에서 연결·계정 확인·수동 사진 전송을 시험한다. 최신 내부 시험 앱은 새 촬영 사진도 자동 전송한다. 모바일 앱의 카메라로 새 사진을 찍은 뒤 같은 패널의 자동 업로드 상태와 원본 열기를 확인한다.

참고: [Google popup code 모델](https://developers.google.com/identity/oauth2/web/guides/use-code-model),
[Drive 재개 업로드](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[Firestore 트랜잭션](https://firebase.google.com/docs/firestore/manage-data/transactions).

## 검증 범위

2026-10-05 실행 결과: `npm run lint` 통과, Node 테스트 38개 통과, Python 테스트 54개 통과, `npm run build` 성공. 기본 플래그 OFF 및 내부 시험 ON 모드의 Chrome smoke test에서 데스크톱·휴대폰·Android 홈 화면·iPad 홈 화면 분기 모두 통과했다. 내부 시험 모드에서는 연결·상태·해제와 영속 토큰 미저장을 모의 응답으로 검증했다. 이 UA 시뮬레이션은 실제 iPhone·Android 기기 검증이 아니다. 빌드의 큰 번들 경고와 Google SDK의 Python 사용 중단 예정 경고는 남아 있다.

- TypeScript 검사, Node 단위 테스트, 웹 운영 빌드.
- Python 테스트: 합성 Google 응답·Redis 테스트 더블·Firestore 트랜잭션 더블로 인증, 일회용 state, 계정 전환, 토큰 암호화, 파일 등록·목록 경계를 검증한다. 실제 Firestore 에뮬레이터 테스트를 대체하지 않는다.
- 브라우저 smoke test의 Drive 내부 시험 모드는 Google/서버 응답을 모의한다. 실제 계정이나 원본을 사용하지 않는다.

```sh
npm run lint
npm test
npm run build
python -m pytest -q tests/test_api_security.py tests/test_drive.py
node scripts/check_platform_ui.mjs dist
DRIVE_PREVIEW_TEST=1 node scripts/check_platform_ui.mjs dist
```

Python 테스트 환경에는 `requirements.txt` 외에 `pytest`, `fakeredis[lua]`가 필요하다.

## 다음 구현과 미완료 사항

- 사용자가 OAuth·Railway 변수·Firestore 권한 설정을 마쳤고 실제 연결/수동 사진 전송을 확인했다. Redis 영속성·백업 복구·키 순환 검증은 별도 필요하다. 비밀 값은 문서나 로그에 남기지 않는다.
- 저장소에는 iOS·Android·설치형 데스크톱 프로젝트가 아직 없다. 로컬 Xcode 선택 경로도 CommandLineTools다. 네이티브 앱 프로젝트, 서명 설정, 실제 기기 빌드·전송 검증이 필요하다.
- iOS 파일 저장 + URLSession, Android 파일 저장 + WorkManager, 네이티브 Google 인증, OS 작업과 대기열 조정은 미구현이다. 현재 대기열의 IndexedDB 어댑터는 웹 내부 시험용이며 모바일의 최종 저장소가 아니다.
- 웹 신규 촬영의 원본/의도 원자 저장과 자동 worker는 구현했다. 녹음 저장 지점, 네이티브 영속 파일/OS 작업 복구는 아직 연결하지 않았다.
- 웹 촬영 분류 폴더 생성·파일 ID 예약·전송·검증된 사진 다운로드는 구현했다. 일반 탐색기 원격 목록, 다운로드 캐시, 오디오 재생은 미완료다.
- 삭제·복원·권한 철회·Picker 가져오기·변경 커서·설정 동기화·서버 AI 작업·설치형 PC 자동 보관도 아직 구현되지 않았다.
- 사진 전송 계층은 SHA-256을 비교한다. 서버 `commit`은 원격 메타데이터를 검증하지만 원본 전체의 MIME 시그니처를 읽어 검증하지 않는다. 추가 형식 도입 시 바이트 검증 정책이 필요하다.
- 대기열 lease 만료·재시도 단위 테스트 통과만으로 OS 백그라운드 지속을 보장할 수 없다. A~F의 실제 계정/실기기 검증과 운영 토큰 수명주기·장애 복구 검증 전에는 공개하지 않는다.
