# 보안 수정 결과와 운영 반영 절차

## 코드 수정 완료

- AI 문서 목록·본문과 설정을 UID별 저장소로 분리했습니다. 로그아웃/계정 전환 시 사용자 화면과 상태를 재생성합니다.
- 브라우저 개인 Gemini API 키 저장 및 직접 Gemini 호출을 제거했습니다. 이전 개인 키는 앱 시작 시 브라우저 저장소에서 제거합니다.
- 계정이 바뀌면 진행 중인 AI 요청의 결과를 새 계정에 적용하지 않습니다.
- 쓰레기통을 IndexedDB의 단일 읽기·쓰기 트랜잭션으로 변경했습니다. 영구 삭제 기록과 원본 파일 제거가 함께 저장되고, 오래된 탭이 삭제 기록이나 원본을 다시 저장할 수 없게 했습니다. BroadcastChannel과 포커스/주기적 갱신으로 탭 상태를 동기화합니다.
- Firebase Admin SDK에서 토큰의 서명·클레임·만료·폐기·계정 정지를 검증합니다. 검증된 UID만 사용량 제한에 사용합니다.
- /api/models, /docs, /openapi.json 등 운영 디버그 경로를 제거했습니다.
- 파일은 10 MiB, HTTP 본문은 14 MiB, 프롬프트는 20,000자로 제한했습니다. 기본 파일 서명 및 MIME 검사, JSON 검증, 요청 수신 15초 및 AI 처리 55초 제한을 적용했습니다. 서명 검사는 모든 파일 구조를 완전 디코딩하는 검사가 아닙니다.
- AI 요청은 비동기로 처리하고 무차별 모델 재시도를 제거했습니다. 출력은 4,096 토큰으로 제한했습니다.
- Redis 원자 연산으로 사용자별 분당/일일 요청 수, 전체 일일 요청 수와 동시 처리 수를 제한합니다. Redis가 없거나 실패하면 AI 요청을 차단합니다.
- 오류 응답에 업스트림 상세 메시지, 사용자 입력, 비밀키가 노출되지 않도록 했습니다.
- Firebase Hosting에 클릭재킹 방지, nosniff, Referrer/Permissions 정책을 추가했습니다. 기본 CSP의 frame-ancestors/object-src/base-uri는 강제 적용하며 전체 스크립트/연결 CSP는 Report-Only입니다. 실제 Google 로그인 등 확인 후 강제로 전환해야 합니다.
- 사용하지 않는 express, @types/express, @google/genai 프론트엔드 의존성을 제거했습니다. 서버 의존성은 버전을 고정하고 requirements.txt에 직접 기재합니다. requirements.lock은 동일한 검증 버전 목록입니다.
- Markdown 링크는 http/https/mailto만 허용합니다.
- scripts/check_secrets.py는 staged 추가 행에 포함된 키 형태의 값을 출력 없이 검사합니다. python3 scripts/check_secrets.py로 커밋 전에 실행하거나 CI에 연결할 수 있습니다. 과거 키의 폐기를 대체하지 않습니다.

## 기존 데이터 처리 — 반드시 확인

이전 버전의 공통 localStorage 키(lecture_snap_ai_docs, doc_*, 사진/녹음 미러 등)는 소유 계정을 식별할 수 없습니다. 이를 현재 로그인한 계정에 자동 귀속시키면 다른 사람의 자료가 노출될 수 있으므로 읽기/자동 이전을 중단했습니다. 기존 자료를 삭제하지는 않았습니다. 계정별 IndexedDB 사진·녹음·시간표와 쓰레기통 데이터는 유지됩니다.

기존 공통 AI 문서는 새 계정별 목록에 자동으로 나타나지 않습니다. 소유자 확인 뒤 해당 계정에서 내보내기/가져오기 등 통제된 이전을 별도로 진행해야 합니다. 이전이 완료된 뒤에만 공통 키를 정리하십시오. 브라우저의 같은 출처 저장소에 대한 로컬 접근 자체를 UID 이름만으로 차단하거나 암호화하는 것은 아닙니다.

## 운영 반영 전 필요한 설정

현재 수정은 로컬 작업 디렉터리에 적용됐으며 배포하지 않았습니다. 실제 사용자 토큰과 운영 Firebase/Redis/Gemini 연결 검증은 하지 않았습니다.

Railway 등 백엔드 환경에 다음을 설정합니다. 실제 비밀값은 채팅이나 저장소에 넣지 말고 배포 서비스의 비밀 환경변수로 등록합니다.

| 변수 | 용도 |
| --- | --- |
| GEMINI_API_KEY | 유효한 서버 전용 Gemini 키 |
| FIREBASE_PROJECT_ID | 운영 Firebase 프로젝트 ID |
| FIREBASE_SERVICE_ACCOUNT_JSON 또는 ADC | Firebase Admin의 토큰 취소/계정 정지 조회에 필요한 서버 인증. 최소 권한으로 사용자 조회 권한을 부여 |
| REDIS_URL | 모든 API 인스턴스가 공유할 Redis. 비공개 네트워크/인증 및 외부 연결 시 TLS 사용 |
| GEMINI_MODEL | 기본 gemini-3.5-flash. 운영 프로젝트에서 지원하는 모델 확인 |

기본 한도는 사용자별 10회/분, 50회/일, 전체 1,000회/일, 사용자 동시 2개, 전체 동시 4개입니다. .env.example의 AI_* 변수로 조정합니다. 일일 창은 UTC 기준입니다. 요청 횟수 한도이지 금액 기반 과금 상한은 아니므로 Google Cloud 예산·할당량도 별도 설정해야 합니다.

인증 정보나 Redis가 없는 상태에서 새 백엔드를 배포하면 AI 기능은 503으로 차단됩니다. 설정을 완료한 뒤 백엔드를 배포하고, 유효한 사용자로 소규모 기능 확인 후 프론트엔드를 배포해야 합니다. 프론트엔드 전체 CSP는 우선 Report-Only에서 Google 로그인·카메라·녹음·AI 호출의 위반 로그를 확인합니다.

Railway의 설치 단계에 별도 잠금 파일이 복사되지 않으므로 requirements.txt에 고정 버전 목록을 직접 기재합니다. requirements.lock과 동일하게 유지합니다. pip는 취약점 수정 버전(검증 환경 26.2 이상)을 사용합니다. requirements.in은 직접 의존성 갱신용입니다. 사용한 모델이나 프록시 호스트를 변경하면 CSP 연결 대상도 점검해야 합니다.

## 키 폐기와 Git 과거 이력

- 소유자가 노출된 키를 발급처에서 이미 삭제했다고 확인했습니다.
- 별도 미러에서 과거 `.env`를 제거하고 GitHub main/master에 반영했습니다. 정리된 기록에서 과거 키 일치 항목은 0건입니다.
- 현재 작업을 저장소 밖에 백업한 뒤 로컬 reflog와 도달 불가능한 객체를 정리했습니다. 현재 파일·인덱스·참조 보존과 남은 Git 객체의 과거 키 0건을 확인했습니다.
- GitHub PR과 포크는 0개였으나, 과거 커밋의 서버 조회는 가능했습니다. GitHub Support 요청문을 준비했으며 서버 캐시 삭제는 미완료입니다.

## 검증

- TypeScript 검사 및 프로덕션 빌드 통과.
- 프론트엔드 테스트 7개: 계정 분리, 동시 저장, 영구 삭제 후 오래된 탭의 재저장, 실패 롤백, 30일 경계, 원본 정리, 개별 복원.
- 서버 보안 테스트 11개: 미인증 차단, 만료/폐기/정지 인증 오류 처리, 본문·필드 제한, chunked 본문 제한, 파일 서명, Redis 설정 누락 차단, 인스턴스 간 한도·동시성, 오류 메시지, 개발 CORS.
- npm audit: 알려진 취약점 0건.
- 별도 Python 검증 환경 pip-audit: 알려진 취약점 0건. 검증 환경의 pip 취약 버전도 업데이트했습니다.
- 실제 운영 키 회전, Firebase/Redis 연결, Google 로그인 및 CSP 전체 강제 적용 검증, 배포는 별도 운영 단계입니다.

저장소가 node_modules를 이미 추적하고 있어 npm 의존성 제거에 따른 해당 파일 삭제가 Git 변경 목록에 다수 표시됩니다. 원래의 사용자 변경을 보존하기 위해 임의로 인덱스나 저장소 이력을 재작성하지 않았습니다.

참고한 공식 문서: [Firebase Admin 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Google Gen AI Python SDK](https://googleapis.github.io/python-genai/), [Firebase Hosting 설정](https://firebase.google.com/docs/hosting/full-config).
