# Google Drive 구현 현황

업데이트: 2026-10-05. 내부 개발용 기반 구현이며 공개 출시·운영 배포가 아니다.
계획서의 A~F 완료 조건은 유지한다. 실기기 PoC를 통과했다고 표시하지 않는다.

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
- 앱 센터: 내부 시험 플래그를 켰을 때만 연결·상태·연결 해제 UI를 표시한다. 자동 업로드가 아직 활성화되지 않았음을 표시한다.
- Firestore 클라이언트 직접 접근 차단 규칙 및 목록용 색인 선언.

## 현재 실제로 실행 가능한 API

| API | 역할 |
| --- | --- |
| `POST /api/drive/auth/start` | 일회용 연결 시도 발급 |
| `POST /api/drive/connect` | 웹 OAuth 코드 교환·검증·연결 저장 |
| `GET /api/drive/status` | 현재 사용자 연결 정보 조회 |
| `POST /api/drive/disconnect` | 연결 버전 무효화·저장된 갱신 토큰 삭제, 원본 유지 |
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
4. Firestore 데이터베이스와 서버 권한을 준비한다. 규칙·색인은 `firebase.json`에 연결했으나 원격 배포하지 않았다.
5. `DRIVE_TOKEN_REDIS_URL`은 전용 ACL·영속 저장·백업·noeviction 정책의 비밀 저장소를 가리킨다. 운영에서는 TLS를 사용한다. 기존 AI 제한용/삭제 가능한 캐시와 공유하지 않는다.
6. 독립적으로 생성한 Fernet 키를 서버 비밀 변수 `DRIVE_TOKEN_KEYS_JSON`의 버전별 JSON으로 설정한다. `DRIVE_TOKEN_KEY_VERSION`이 가리키는 키로 새 암호문을 만들며 이전 버전 키로 기존 암호문을 읽을 수 있다. 실제 기존 암호문 일괄 재암호화와 고아 토큰 정리는 별도 구현 대상이다.
7. 내부 시험 환경에서만 `DRIVE_ENABLED=true`, 허용할 Firebase UID의 `DRIVE_INTERNAL_TEST_UIDS`, `VITE_DRIVE_INTERNAL_PREVIEW=true`를 설정한다. 허용 목록이 비어 있으면 모든 사용자를 거절한다.
8. 앱 센터에서 연결·계정 확인·연결 해제를 시험한다. 여기까지는 기존 촬영 저장 동작에 자동 업로드를 붙이지 않는다.

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

- 현재 로컬 `.env`에는 Drive OAuth 클라이언트·서버 secret·토큰 Redis·암호화 키 설정이 없다. 값 자체를 출력하거나 임의로 생성해 운영에 연결하지 않았다. 실제 Google 연결·Firestore 권한·Redis 영속성 검증은 이 환경 설정 후 수행해야 한다.
- 저장소에는 iOS·Android·설치형 데스크톱 프로젝트가 아직 없다. 로컬 Xcode 선택 경로도 CommandLineTools다. 네이티브 앱 프로젝트, 서명 설정, 실제 기기 빌드·전송 검증이 필요하다.
- iOS 파일 저장 + URLSession, Android 파일 저장 + WorkManager, 네이티브 Google 인증, OS 작업과 대기열 조정은 미구현이다. 현재 대기열의 IndexedDB 어댑터는 웹 내부 시험용이며 모바일의 최종 저장소가 아니다.
- 원본을 안전하게 기록한 후 작업이 유실되지 않도록 파일/대기열 복구 절차를 완성하고 실제 촬영·녹음 저장 지점에 연결해야 한다. 현재 자동 업로드 worker는 실행되지 않는다.
- 루트·연도·학기·과목 폴더 생성, 파일 ID 예약과 업로드 오케스트레이션, 탐색기 원격 목록 연결, 인증 다운로드·캐시·오디오 재생은 미완료다.
- 삭제·복원·권한 철회·Picker 가져오기·변경 커서·설정 동기화·서버 AI 작업·설치형 PC 자동 보관도 아직 구현되지 않았다.
- `commit`은 원격 메타데이터를 검증하지만 원본 바이트의 MIME 시그니처와 로컬 체크섬 비교는 전송 계층에서 추가 검증해야 한다.
- 대기열 lease 만료·재시도 단위 테스트 통과만으로 OS 백그라운드 지속을 보장할 수 없다. A~F의 실제 계정/실기기 검증과 운영 토큰 수명주기·장애 복구 검증 전에는 공개하지 않는다.
