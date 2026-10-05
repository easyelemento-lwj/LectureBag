# LectureBag Google Drive 연결 구현 계획서

작성일: 2026-10-01
상태: 구현 진행 중. 2026-10-05 연결·카탈로그 API와 전송 기반 모듈을 추가했으며, 기능 플래그는 기본 OFF다. 전체 출시 조건은 아직 충족하지 않았다. 상세 진행·설정·미완료 항목은 [구현 현황](GOOGLE_DRIVE_PROGRESS.md)을 따른다.

## 1. 목표와 사용자 경험

사용자의 개인 Google Drive에 사진·녹음 원본을 보관하고, 같은 LectureBag 계정으로 로그인한 PC·태블릿에서 열람한다. 모바일 앱은 촬영·녹음과 백그라운드 자동 업로드를 담당하고, PC는 목록 조회·열람·다운로드·정리·AI 기능을 중심으로 제공한다. 운영자의 Cloud Storage에 원본을 중복 보관하지 않는 것을 기본으로 한다. 회원가입·로그인 후 Google Drive 연결을 완료해야 자료 저장 기능을 사용할 수 있다.

사용자 흐름:

1. 회원가입·로그인 후 `Google Drive 연결`을 누른다.
2. 연결할 Google 계정과 파일 접근 권한을 확인한다.
3. 연결이 완료되면 LectureBag에서 저장하는 모든 자료의 자동 업로드가 기본으로 활성화된다.
4. 모바일에서 촬영·녹음한 원본은 먼저 기기 파일로 안전하게 저장되고 iOS·Android의 백그라운드 전송 작업에 등록된다. 화면이 꺼지거나 다른 앱을 사용하는 동안에도 Drive 업로드를 계속 시도한다.
5. PC에서 같은 LectureBag 계정으로 로그인하고 필요한 Drive 권한을 승인하면 목록을 볼 수 있다.
6. 원본을 열 때 Drive에서 다운로드하고, 기기에 사본이 있으면 재사용한다.

오프라인·권한 만료·운영체제 제한으로 업로드가 중단되면 원본과 작업 상태를 기기에 유지하고 가능한 시점에 자동 재시도한다. 사용자가 앱을 강제 종료했거나 Drive 권한을 철회한 경우에는 앱 재실행 또는 재승인이 필요할 수 있다. `기기에 저장됨`과 `Drive에 저장 완료`는 다르며, Drive 저장이 확인되기 전에는 기기 원본을 삭제하지 않는다. 최초 공개 출시에서도 Drive 저장 확인 후 기기 원본을 자동 삭제하지 않는다.

## 2. 현재 코드에서 확인한 출발점

| 위치 | 현재 역할 | 구현 시 변경 방향 |
| --- | --- | --- |
| `src/utils/firebase.ts` | Firebase Auth 초기화, Google 로그인 제공자 | 로그인과 별도의 Drive 권한 흐름 추가 |
| `src/context/AuthContext.tsx` | Firebase 로그인·로그아웃, ID 토큰 | 계정 변경 시 Drive 작업 중단 연결 |
| `src/utils/accountStorage.ts` | UID별 로컬 키 | Drive 계정 및 연결 세대까지 격리 |
| `src/utils/mediaStorage.ts` | IndexedDB 저장·병합, 영구 삭제 방지 | 웹 캐시·원본 조회 어댑터 추가; 모바일 영속 대기열과 연결 |
| `src/types.ts` | 사진·녹음·문서 타입, dataUrl 사용 | 원본 위치·바이트 크기·동기화 상태 분리 |
| `src/utils/trash.ts` | 로컬 휴지통, 30일 만료, 삭제 표식 | 원격 휴지통 상태와 조정 |
| `src/context/TrashContext.tsx` | 휴지통 UI 상태 연결 | 원격 작업 대기·실패 표시 |
| `src/components/FolderExplorerModal.tsx` | 파일 탐색기 | 원격 목록, 다운로드, 상태 표시 |
| `src/components/VaultIosMain.tsx` | 주요 화면 구성 | Drive 설정 UI 연결 위치 조사 후 적용 |
| `src/utils/gemini.ts` | Firebase ID 토큰으로 AI 요청 | 원격 파일 해석 후 기존 AI 호출 |
| `proxy_server.py` | FastAPI, Firebase 인증, AI 처리 | 메타데이터 API와 Drive 기반 비동기 AI 작업 추가 |
| `api_security.py` | 요청 경계·AI 사용 제한 | 새 API 경로 및 별도 사용 제한 검토 |
| `PLATFORM_BEHAVIOR.md` | PC는 파일 관리, 모바일은 촬영·녹음 | 모바일 백그라운드 업로드와 PC 열람 중심 역할 명시 |

확인한 Firebase 초기화에는 Firestore 연결이 없다. 아래 Firestore 목록 저장은 새로 구현할 대상이다. 현재 AI 입력은 파일당 10MB 제한이 있으므로, Drive에 긴 녹음을 저장할 수 있다고 긴 녹음을 즉시 AI로 처리할 수 있는 것은 아니다.

## 3. 전체 출시 범위

아래 항목은 모두 최초 공개 출시 전에 완료한다. 구현과 검증은 의존성에 따라 단계적으로 진행하지만, 일부 기능만 완성된 상태로 공개하지 않는다.

- 개인 Google 계정의 My Drive만 지원한다.
- 사진·녹음 업로드, 현재 폴더 목록 조회, 원본 열기, 기기 사본 재사용을 지원한다.
- 모바일 앱은 iOS 백그라운드 `URLSession`과 Android `WorkManager` 등 운영체제 전송 기능을 사용해 앱이 화면에 없을 때도 업로드를 계속하거나 재개한다.
- 모바일 원본은 메모리의 dataUrl이 아니라 백그라운드 전송이 참조할 수 있는 기기 파일로 저장한다.
- Drive 접근 자격은 기기의 네이티브 OAuth SDK와 운영체제 보안 저장소로 관리한다. PC 웹의 단기 접근 토큰은 브라우저 메모리에서만 사용한다. 앱 종료 후 서버 AI·변경 조정에 필요한 사용자 갱신 토큰만 서버 전용 저장소에 암호화해 보관한다.
- 연결이 끊기거나 접근 토큰이 만료되면 대기 상태를 유지하고 재승인을 안내한다.
- 별도의 `기존 자료 올리기` 또는 `자동 업로드` 선택 단계는 두지 않는다. Drive 연결은 자동 업로드 활성화를 의미한다.
- PC는 기본적으로 모바일 촬영 원본의 업로드 주체가 아니며 Drive 목록 조회·필요 시 다운로드·정리·AI 기능을 제공한다. 사용자가 명시적으로 선택한 PC 파일 가져오기와 설치형 데스크톱 앱의 원본 자동 보관도 최초 공개 출시 범위에 포함한다.
- 다른 Drive 계정으로 변경할 때는 명시적인 연결 해제 후 새 연결 절차를 요구하며 자동 병합하지 않는다.
- 이름 변경·휴지통·복원·외부 Drive 변경의 동기화.
- 서버가 앱 종료 후에도 수행하는 AI 작업과 사용자별 갱신 토큰 관리.
- 설치형 데스크톱 앱을 통한 원본 자동 보관과 PC 파일 가져오기. 일반 브라우저 탭이 닫힌 뒤에도 지속되는 폴더 동기화를 웹앱만으로 보장하지 않는다.
- 시간표·분류 설정·요약 결과의 동기화 개선.
- 기존 Drive 파일 가져오기를 위한 Google Picker 선택 흐름.

내부 개발·시험 중에는 클라우드 파일의 삭제 UI를 일시적으로 막을 수 있지만, 공개 배포 전에는 삭제·복원·영구 삭제 정책과 실제 동작이 일치해야 한다. 업로드 대기 중인 기기 파일에는 로컬 휴지통 정책을 적용하고, Drive 저장이 완료된 자료는 원격 휴지통 상태와 동기화한다.

## 4. 저장 구조와 전송 경로

```text
모바일 기기 원본 + OS 백그라운드 업로드 대기열
           │ Drive로 직접 업로드
           ▼
사용자 Google Drive / LectureBag / 연도 / 학기 또는 상하반기 / 과목 등
           │ 직접 다운로드
           ▼
PC·태블릿의 LectureBag / 필요할 때 원본 캐시

Firestore: UID별 목록·Drive 파일 ID·폴더·동기화·작업 상태
Railway: Firebase 인증 검증·목록·변경 조정·삭제/복원·서버 AI API
서버 보안 저장소: 암호화된 Drive 갱신 토큰과 키 버전
```

폴더 규칙은 `src/utils/dateFolders.ts`의 현재 분류를 조사해 동일하게 적용한다. 파일별 JSON 보조 파일은 생성하지 않는다. 목록은 Firestore에, 원본은 Drive에 저장해 정보 중복 갱신을 줄인다.

Firestore 목록은 Drive 원본 존재의 영구 보증이 아니다. Drive에서 직접 파일을 변경하거나 삭제하면 재조정한다. 원본 다운로드가 실패했다고 로컬 원본까지 삭제해서는 안 된다.

목록 응답에는 원본 dataUrl을 포함하지 않는다. 썸네일은 필요한 항목만 별도 로드·캐시하며 공개 영구 URL을 만들지 않는다. 썸네일 전송과 생성도 사용량에 포함한다.

## 5. 로그인과 Drive 권한

Firebase 로그인은 LectureBag 사용자를 식별한다. Drive OAuth는 그 사용자가 연결한 Google Drive에 접근할 권한을 얻는다. Firebase ID 토큰으로 Drive 파일을 읽을 수 없고, Firebase 관리자 서비스 계정으로 고객 개인 Drive에 접근할 수 없다.

요청할 Drive 범위:

```text
https://www.googleapis.com/auth/drive.file
```

이 범위는 앱이 만들었거나 사용자가 앱에 선택해서 연결한 파일을 대상으로 한다. 특정 이름의 폴더만 잠그는 권한은 아니다. 전체 Drive 범위인 `drive` 또는 `drive.readonly`는 요청하지 않는다. 기존 Drive 파일 가져오기는 Google Picker에서 사용자가 명시적으로 선택한 파일로 제한한다. [공식 권한 문서](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

구현 작업:

- Google Cloud에서 Drive API 활성화, OAuth 동의 화면 및 iOS·Android·웹 클라이언트를 각각 설정한다.
- iOS 번들 ID·Android 패키지명과 서명 인증서·웹 허용 출처를 정확히 등록하고, 운영 배포 전 브랜드·개인정보처리방침 및 필요한 검증을 확인한다.
- 모바일은 각 플랫폼의 네이티브 Google OAuth 흐름과 앱 복귀를, PC 웹은 Google Identity Services 기반 전경 권한 흐름과 거절·팝업 차단을 처리한다.
- Firebase UID와 실제 연결된 Drive 계정 식별자를 서버에서 검증해 매핑한다. 이메일이나 브라우저가 보낸 UID만 믿지 않는다.
- 계정 식별은 Google이 반환하는 안정적 식별자를 사용한다. OAuth 방식에 따라 검증된 OIDC subject 또는 Drive 사용자 식별 정보를 이용하며 PoC에서 확정한다.
- 목록 등록 시 서버가 일시적으로 받은 Drive 접근 토큰으로 해당 연결 계정·파일 ID·크기·앱 소속을 확인한다. 토큰은 요청 처리 후 폐기하고 로그·DB에 저장하지 않는다.
- 이미 연결된 계정과 다른 계정을 선택하면 자동 병합하지 않고 오류와 선택한 계정을 안내한다.
- 모든 기기는 동일 Google Cloud 프로젝트의 호환되는 OAuth 구성을 사용하고, 기기 간 앱 생성 파일 접근 가능 여부를 PoC에서 검증한다.

권한 동의 문자열 한 줄 외에도 위 연결 흐름과 서버의 소유자 검증이 필요하다.

## 6. 데이터 모델 제안

LectureBag에서 생성하는 신규 자료는 UUID를 사용한다. 실제 마이그레이션 대상이 확인되는 경우에만 기존 파일 ID를 보존하고 전역 충돌 가능성을 검사한다. 크기는 화면용 문자열과 별도로 정수 바이트로 저장한다.

```ts
interface CloudMediaRecord {
  id: string;
  ownerUid: string;
  connectionId: string; // Drive 계정 및 연결 세대 식별
  driveFileId: string;
  driveParentId: string;
  logicalFolderId: string;
  name: string;
  kind: 'photo' | 'audio' | 'document';
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  updatedAt: string; // 서버 시각
  revision: number;
  checksum?: string;
  deletedAt?: string;
  purgedAt?: string;
}
```

기기별 로컬 테이블:

- `mediaFiles`: UID + 연결 ID + 파일 ID를 키로 모바일 원본의 기기 파일 경로·크기·체크섬·보호 상태·생성 시각을 보관한다. 대용량 원본을 DB Blob으로 저장하지 않는다.
- `uploadJobs`: 같은 키, 원본 파일 참조, 목표 Drive 파일 ID, 보호된 세션 URI, 확인된 바이트, 상태, 재시도 시각, iOS·Android 운영체제 작업 ID를 보관한다. 앱 재실행 시 운영체제 작업과 대기열을 조정한다.
- `downloadCache`: 파일 ID + 원본 버전/체크섬, 캐시 파일 경로 또는 웹 Blob, 마지막 접근 시각을 보관한다. 모바일은 파일 기반 캐시를, PC 웹은 IndexedDB Blob을 사용할 수 있다.

Drive 접근 토큰과 업로드 세션 URI는 Firestore나 분석 로그에 기록하지 않는다. 세션 URI가 필요한 경우 해당 기기의 보호된 저장 영역에만 보관한다.

Firestore 제안 경로:

- `users/{uid}/driveConnections/{connectionId}`: 계정 식별·루트 폴더·연결 상태.
- `users/{uid}/driveState/current`: 현재 연결 ID·연결 버전·서버 비밀 저장소 참조. OAuth 재승인과 연결 해제의 동시 요청을 트랜잭션으로 조정한다. 클라이언트에는 허용된 상태 필드만 반환한다.
- `users/{uid}/cloudFiles/{fileId}`: 목록 메타데이터.
- `users/{uid}/cloudOperations/{operationId}`: 멱등 작업과 진행 상태.
- `users/{uid}/driveConnections/{connectionId}/changeState/current`: Drive 변경 커서·마지막 성공 시각·재시도 상태.
- `users/{uid}/syncSettings/current`: 시간표·분류·기기 간 동기화 설정과 revision.
- `users/{uid}/aiJobs/{jobId}`: AI 작업 상태·입력 파일 참조·비용 중복 방지 키·결과 참조.
- `users/{uid}/aiResults/{resultId}`: 동기화할 AI 요약 결과와 원본 revision.
- `users/{uid}/desktopDevices/{deviceId}`: 설치형 데스크톱 앱의 연결·자동 보관 범위·마지막 동기화 상태.

갱신 토큰 평문·암호화 키·업로드 세션 URI는 Firestore에 저장하지 않는다. 갱신 토큰 암호문은 접근이 제한된 서버 전용 비밀 저장소에 두고, Firestore에는 토큰 상태·키 버전·마지막 갱신 시각 등 비민감 메타데이터만 기록한다.

Firestore 읽기·쓰기는 Railway를 통하도록 통일한다. 브라우저 Firestore 직접 접근은 rules에서 차단하고 서버가 검증된 Firebase UID로 경로를 결정한다. Admin SDK는 rules를 우회하므로 서버의 소유자 검증이 필수다. 운영 Firebase 서비스 계정에 Firestore 권한이 있는지 확인하고 필요한 최소 권한을 별도로 부여한다.

## 7. 업로드 및 중단 복구

1. 모바일 원본을 운영체제 파일 저장소에 안전하게 기록한 뒤 영속 업로드 대기열에 등록한다. 웹에서 생성된 보조 자료가 있다면 IndexedDB 저장 성공 후 별도 대기열에 등록한다.
2. 동기화 작업자는 현재 UID·연결 ID가 맞는지 확인한다.
3. 동일 파일의 기존 업로드 작업을 조회하고 중복 생성하지 않는다.
4. Drive 생성 ID 사전 발급 등 멱등성을 확보하는 방식을 검증한다. 폴더도 서버 작업 키로 중복 생성을 막는다.
5. Drive resumable 세션을 생성하고 세션 URI를 해당 기기의 보안 저장 영역에 보관한다.
6. iOS는 백그라운드 `URLSession`, Android는 `WorkManager` 기반 전송 작업으로 기기 파일을 보낸다. Drive 재개 프로토콜과 각 운영체제 전송 제약이 함께 충족되는지 실제 기기에서 검증한다.
7. 연결이 끊기면 Drive가 확인한 바이트 위치를 조회한 뒤 이어 보낸다. 화면 진행률을 기준으로 추정하지 않는다.
8. 완료 후 Drive 파일 크기와 가능한 체크섬을 확인한다.
9. 서버에 메타데이터를 멱등 등록한다. 여기까지 성공해야 `Drive에 저장 완료`로 표시한다.

Drive 업로드가 성공했지만 목록 등록이 실패하면 원본을 다시 올리지 않고 목록 등록만 재시도한다. 세션이 만료되면 기존 완료 파일 존재를 먼저 확인하고 새 세션을 만든다. Google은 resumable 세션의 만료와 복구 프로토콜을 문서화하고 있다. [업로드 공식 문서](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

UI 상태:

```text
local_saved → queued → uploading → verifying → registering → synced
                   ↘ offline / needs_auth / quota_full / retry_wait / failed
```

세션 URI는 접근 자격에 준하는 정보로 취급해 로그·분석 이벤트에 넣지 않는다. 계정 전환 시 진행 요청을 취소하고 늦게 도착한 응답도 이전 계정 저장소에만 반영한다. 모바일은 운영체제 작업 ID와 앱 작업 ID를 영속적으로 연결하고, 웹에서 업로드 기능을 제공하는 경우에는 여러 탭이 같은 작업을 실행하지 않도록 IndexedDB 임대 잠금과 만료 시간을 사용한다.

네트워크·일시적 429/5xx는 지수 백오프와 지터, 횟수 상한을 적용한다. 권한 거부·용량 부족은 자동 무한 재시도하지 않는다. 화면 꺼짐·다른 앱 사용·운영체제에 의한 앱 일시 정지 중에도 전송 또는 자동 재개되는 것을 완료 조건에 포함한다. 사용자의 강제 종료, 기기 전원 종료, 권한 철회, 운영체제의 극단적인 배터리 제한에서는 즉시 업로드를 보장하지 않으며 앱 재실행 또는 재승인 후 재개한다.

iOS 백그라운드 업로드는 메모리 데이터나 스트림이 아닌 기기 파일 기반 작업으로 구성한다. Android의 장기 업로드는 필요한 경우 사용자에게 진행 알림을 표시한다. 두 플랫폼 모두 앱이 다시 실행될 때 운영체제 작업 상태와 로컬 대기열을 조정해 완료 파일을 중복 업로드하지 않는다. [Apple 백그라운드 전송](<https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)>) · [Android 백그라운드 작업](https://developer.android.com/develop/background-work/background-tasks/persistent)

## 8. 목록·다운로드·외부 변경

- 현재 폴더를 페이지당 50개로 요청한다. 폴더·정렬 조건에 맞는 Firestore 색인을 추가한다.
- 커서는 안정적인 정렬 키와 파일 ID를 사용한다. 전체 자료를 매번 내려받지 않는다.
- 파일 열기: 로컬 원본/검증된 캐시 → 없으면 Drive 원본 다운로드.
- 다운로드 토큰은 URL 쿼리나 공개 공유 링크에 넣지 않는다. Authorization 헤더를 사용한다.
- 오디오의 인증된 부분 다운로드·재생·캐시 동작은 별도 PoC로 확인한다. 단순 audio URL만으로 구현 완료라고 판단하지 않는다.
- 기기 사본 삭제는 해당 기기의 캐시만 제거한다. Drive 원본 삭제와 구분한다.
- Drive 직접 변경은 연결별 changes 커서로 처리한다. 모든 페이지 처리 후에만 다음 커서를 확정한다.
- 초기 목록 스캔과 변경 커서 사이에 변경을 놓치지 않도록 커서 확보 → 스캔 → 변경 재적용 순서를 검증한다.
- 앱 실행 중에는 시작·사용자 새로고침·변경 커서로 조정하고, 앱 종료 중에는 서버 예약 작업이 연결별 변경 커서를 처리한다. 사용자 화면에 반영되는 최대 지연 시간을 정해 운영 지표로 측정한다.
- 404는 영구 삭제로 단정하지 않는다. 접근 권한 상실일 수 있으므로 `찾을 수 없거나 접근 불가`로 표시한다.

변경 API 근거: [Drive 변경 목록](https://developers.google.com/workspace/drive/api/guides/manage-changes).

## 9. 휴지통과 계정 해제 정책

서로 다른 동작을 명확하게 제공한다.

| 동작 | 의미 |
| --- | --- |
| 기기 사본 지우기 | 해당 기기 캐시만 제거, Drive 원본 유지 |
| 휴지통으로 이동 | Drive 원본 휴지통 처리와 목록 상태 동기화 |
| 복원 | Drive 복원 성공 후 목록 복원 |
| 영구 삭제 | 명시적 사용자 요청으로 Drive 삭제 후 영구 삭제 표식 유지 |
| Drive 연결 해제 | 작업·토큰·연결 중단, Drive 원본은 유지 |

클라우드 원본을 기간 경과만으로 자동 삭제하는 임시 전송함 방식은 이번 설계에 적용하지 않는다.

현재 로컬 휴지통의 30일 정책을 클라우드에 그대로 적용하면 안 된다. Drive 자체 휴지통 보존 정책과 실제 삭제 시각을 확인하고 안내를 맞춘다. 여기서 `예약된 삭제`는 기간 경과에 따른 자동 삭제가 아니라, 사용자가 명시적으로 요청했지만 오프라인·앱 종료·일시적 오류로 즉시 끝나지 않은 대기 작업을 뜻한다. 이 작업은 서버의 암호화된 갱신 토큰과 영속 작업 큐로 처리한다. 복원·삭제 동시 요청은 revision 비교로 처리하고, 영구 삭제 표식은 오래된 기기의 재업로드를 차단한다.

연결 해제 시 OAuth 승인 철회와 로컬 상태 제거를 구분한다. 토큰이 이미 만료된 경우 계정 설정에서 철회하는 안내를 제공한다. 사용자 계정 탈퇴가 Drive 파일 삭제까지 의미하지 않도록 정책에 명시한다.

## 10. AI 연동

### 전경 처리

사용자가 앱을 열어 실행하는 작업은 기기 원본 또는 Drive 다운로드 → 기존 AI API 입력 형식으로 변환 → 기존 인증·한도 검사를 거쳐 요약한다.

기존 `proxy_server.py`의 10MB 제한을 유지한다. 초과 파일에는 제한을 명확히 안내한다. 긴 녹음 지원은 분할·스트리밍/파일 API·자원 한도·비용을 별도 설계한 뒤 제공한다. Drive 저장 용량 제한과 AI 입력 제한은 별개다.

### 앱 종료 후 서버 처리

- 서버용 OAuth authorization code 흐름 및 offline access를 구현한다.
- 일회용 state를 Firebase UID·브라우저 연결 시도·만료시각과 묶고 callback에서 검증한다. 고정 허용 redirect URI만 사용한다.
- 갱신 토큰은 서버 전용 저장소에 암호화하고 키를 별도 보관한다. 로그·프런트엔드·Git에 넣지 않는다.
- 인증 코드 재사용, 계정 바꿔치기, 갱신 토큰 미반환, 철회·만료를 처리한다.
- 영속 AI 작업 큐, 재시도, 비용 중복 방지, 취소·결과 조회 API를 추가한다.
- 앱 종료 전에 원본이 Drive에 올라가 있어야 서버가 가져올 수 있다.
- AI 제공자에게 자료가 전달됨을 사용자가 이해할 수 있게 안내한다.

갱신 토큰은 만료된 접근 토큰을 재발급받는 증명이다. 인터넷 없이 파일을 읽는 기능이 아니다. [OAuth 공식 문서](https://developers.google.com/identity/protocols/oauth2/web-server)

## 11. 추가·변경 파일 제안

아래는 새로 만들 위치의 제안이며 현재 존재한다고 가정하지 않는다.

| 파일 | 작업 |
| --- | --- |
| `src/services/drive/driveAuth.ts` | 전경 OAuth, 토큰 만료·재승인 |
| `src/services/drive/driveClient.ts` | Drive API, 제한된 필드·오류 분류 |
| `src/services/drive/uploadQueue.ts` | 영속 대기열, 멱등 업로드, 중단 복구 |
| iOS 네이티브 Drive 업로드 어댑터 | 파일 기반 백그라운드 `URLSession`, 작업 복원·완료 전달 |
| Android 네이티브 Drive 업로드 어댑터 | `WorkManager`, 네트워크 조건·재시도·장기 작업 알림 |
| `src/services/drive/cloudCatalog.ts` | Railway 목록 API 어댑터 |
| `src/services/drive/mediaResolver.ts` | 로컬/Drive 원본 해석 및 캐시 |
| `src/context/DriveContext.tsx` | 계정·연결 상태 및 작업 취소 |
| `src/components/DriveConnectionPanel.tsx` | 연결·계정·용량·진행 UI |
| 설치형 데스크톱 동기화 어댑터 | 사용자가 선택한 로컬 폴더 접근, 원본 자동 보관, PC 파일 가져오기, 충돌·삭제 정책 적용 |
| `drive_routes.py` / `drive_catalog.py` | 인증된 연결·목록·파일 작업 API |
| `drive_oauth.py` / `drive_token_store.py` | 서버 OAuth callback, 갱신 토큰 암호화·교체·철회·삭제 |
| `drive_changes.py` / `drive_jobs.py` | 변경 커서 처리, 예약 조정, 삭제·복원 영속 작업 |
| `drive_ai_jobs.py` | 앱 종료 후 AI 작업, 멱등 실행·취소·결과 조회 |
| `firestore.rules` / `firestore.indexes.json` | 직접 접근 차단 및 목록 색인 |
| 기존 저장·탐색기·휴지통 파일 | 위 어댑터 연결, 업로드 대기 중인 기기 자료 보존 |

예정 API:

- Drive 연결: `POST /api/drive/connect`, `GET /api/drive/status`, `GET /api/drive/oauth/callback`, `POST /api/drive/disconnect`, `POST /api/drive/revoke`.
- 파일 목록·변경: `GET /api/cloud-files`, `POST /api/cloud-files/commit`, `PATCH /api/cloud-files/{id}`, `POST /api/cloud-files/{id}/trash`, `POST /api/cloud-files/{id}/restore`, `DELETE /api/cloud-files/{id}`.
- 가져오기·작업: `POST /api/drive/import`, `GET /api/cloud-operations/{id}`.
- 서버 AI: `POST /api/ai-jobs`, `GET /api/ai-jobs/{id}`, `DELETE /api/ai-jobs/{id}`.
- 설정 동기화: `GET /api/sync/settings`, `PUT /api/sync/settings`.

API 이름과 메서드는 구현 전 OpenAPI 계약 검토에서 확정한다. OAuth callback은 브라우저 리디렉션 종단점이므로 인증 시작 요청과 state 검증 방식에 맞게 `GET` 또는 `POST`를 선택한다.

현재 웹 내부 시험 구현은 GIS popup code 모델을 사용한다. `POST /api/drive/auth/start`가 UID·출처·연결 버전에 묶인 5분짜리 일회용 state를 발급하고, 코드 교환은 Firebase 인증이 필요한 `POST /api/drive/connect`에서 수행한다. GET callback으로 OAuth 코드를 서버 접근 로그에 남기지 않는다. 모바일 네이티브 OAuth는 별도 구현·실기기 검증 대상이다.

요청 UID는 클라이언트 입력으로 받지 않고 검증된 Firebase 토큰에서 얻는다. commit은 동일 파일 ID·버전 재요청 시 같은 결과를 반환한다. 임의 Drive URL을 서버가 fetch하는 API는 만들지 않는다. 기존 RequestBoundary의 경로·크기 제한과 CORS 설정에 새 API가 맞는지 확인한다.

환경 설정은 `.env.example`에 이름과 설명만 추가한다. 예: 공개 웹 클라이언트 ID, Drive 기능 플래그. OAuth client secret·redirect URI·토큰 암호화 키·키 버전은 Railway 비밀 변수와 서버 전용 비밀 저장소에 추가한다. 비밀 값에 `VITE_` 접두사를 쓰지 않는다.

## 12. 구현 순서와 통과 기준

### 단계 A — 네이티브 백그라운드 업로드 PoC

- [ ] 실제 iPhone 앱에서 Drive 동의 후 앱으로 복귀하고 파일 기반 백그라운드 전송을 시작한다.
- [ ] 실제 Android 앱에서 Drive를 연결하고 `WorkManager` 업로드 작업을 시작한다.
- [ ] PC Chrome에서는 같은 LectureBag·Drive 계정으로 목록 조회와 필요 시 다운로드가 가능하다.
- [ ] 앱이 만든 사진·긴 녹음을 Drive에 올리고 다른 기기에서 읽는다.
- [ ] 범위 밖 파일 접근이 차단된다.
- [ ] 70% 전송 중 네트워크를 끊고 재개해 원본과 결과가 일치한다.
- [ ] 화면 끄기·다른 앱 전환·운영체제에 의한 앱 일시 정지 중에도 업로드가 계속되거나 자동 재개된다.
- [ ] 앱 프로세스 종료·재실행 후 운영체제 작업과 로컬 대기열을 조정해 이어 보내거나 안전하게 다시 시도한다.
- [ ] 사용자가 앱을 강제 종료한 경우 재실행 후 대기 작업을 복구하며 원본이 손실되지 않는다.
- [ ] 모바일 직접 업로드와 PC의 인증된 다운로드·오디오 재생이 실제 기기와 브라우저에서 작동한다.

실패 시 Drive 연결 기능을 공개하지 않는다. 특히 네이티브 OAuth 복귀, 백그라운드 작업 복원, 원본 보존이 필수다.

### 단계 B — 계정 격리와 저장 계층

- [ ] 모바일 파일 저장소와 영속 작업 대기열을 구성하고 업로드 대기 자료를 안전하게 보존한다.
- [ ] 웹 IndexedDB는 PC의 다운로드 캐시 및 보조 자료 저장 용도로 분리한다.
- [ ] 계정 A 업로드 중 B 로그인해도 자료가 섞이지 않는다.
- [ ] 같은 파일을 여러 번 재시도하거나 두 탭에서 실행해도 Drive 파일이 중복되지 않는다.
- [ ] 업로드 성공·목록 실패 사이의 중단을 복구한다.

### 단계 C — 목록·열람·자동 동기화

- [ ] PC에서 현재 폴더만 페이지 단위로 조회한다.
- [ ] 기기 사본이 있으면 동일 버전 원본을 다시 다운로드하지 않는다.
- [ ] 새 자료는 별도 선택 없이 업로드 대기열에 등록되며 완료 여부를 파일별로 표시한다.
- [ ] Drive 외부 변경·권한 철회·용량 부족을 구분해서 표시한다.
- [ ] 이름 변경과 Drive에서 직접 수행한 변경을 연결별 변경 커서로 모든 기기에 반영한다.
- [ ] 시간표·과목 분류·설정·AI 요약 결과를 같은 LectureBag 계정의 기기 사이에서 동기화한다.
- [ ] Google Picker로 사용자가 선택한 기존 Drive 파일을 가져온다.

### 단계 D — 삭제·복원 정책

- [ ] 휴지통·복원·영구 삭제·기기 사본 삭제가 명확히 분리된다.
- [ ] 오래된 기기를 다시 연결해도 삭제된 파일을 재업로드하지 않는다.
- [ ] 새 기능을 꺼도 기존 기기 원본과 Drive 원본이 유지된다.
- [ ] 사용자가 요청한 뒤 오프라인·앱 종료로 대기 중인 삭제와 Drive 외부 변경을 서버 작업이 처리하고 다음 접속 때 일관된 상태를 보여준다.

### 단계 E — 서버 AI와 데스크톱 보관

- [ ] 사용자가 앱을 닫아도 서버의 영속 작업 큐가 AI 작업을 이어서 처리한다.
- [ ] 사용자별 Drive 갱신 토큰을 암호화하고 접근·교체·철회·삭제 절차를 검증한다.
- [ ] 같은 AI 작업의 재시도로 비용과 결과가 중복되지 않는다.
- [ ] 설치형 데스크톱 앱의 패키징 기술과 자동 업데이트·코드 서명·파일 시스템 권한 방식을 PoC에서 확정한다. 일반 웹앱에는 앱 종료 후 폴더 자동 보관을 약속하지 않는다.
- [ ] 설치형 데스크톱 앱이 사용자가 선택한 PC 폴더에 Drive 원본을 자동 보관하고 변경·삭제 정책을 명확히 표시한다.
- [ ] PC 파일 가져오기가 모바일 자료 및 Drive 기존 파일과 ID 충돌을 일으키지 않는다.

### 단계 F — 통합 검증과 공개 출시

- [ ] 단계 A부터 E까지 모든 통과 기준을 충족한다. 일부 단계만 완료된 상태로 공개하지 않는다.
- [ ] 개인정보처리방침·OAuth 운영 설정·사용량 알림을 확인한다.
- [ ] 테스트 계정 → 소규모 사용자 → 전체 사용자 순으로 공개한다.

## 13. 검증 및 운영

자동 검증은 대기열 상태 전이, 업로드 멱등성, UID·연결 ID 격리, 삭제·복원 충돌, 목록 등록 실패 복구, 변경 커서 누락 방지, 설정·AI 결과의 revision 충돌에 집중한다. UI 모양만 복제하는 테스트는 피한다.

기존 검사: `npm run lint`, `npm test`, `npm run build`, Python 보안 테스트. 새 서버 API는 인증 실패·타인 파일 ID·토큰 로그 유출·잘못된 MIME/크기·요청 제한을 검사한다. Firestore 에뮬레이터로 접근 규칙·색인·계정 격리를 확인하고 실제 Google 계정 PoC는 별도로 수행한다.

플랫폼 검증:

- iOS·Android 단위·통합 테스트와 실제 기기 테스트를 모두 수행한다.
- 화면 꺼짐, 다른 앱 전환, 프로세스 종료, 앱 재실행, 기기 재부팅, Wi-Fi·모바일 네트워크 전환 후 업로드 지속·복구를 확인한다.
- 네이티브 OAuth 복귀, 권한 거절·철회, 접근 토큰 만료, Drive 용량 부족을 확인한다.
- PC 웹의 인증된 다운로드·오디오 부분 재생·캐시 무효화를 실제 브라우저에서 확인한다.
- 설치형 데스크톱 앱의 폴더 권한, 자동 보관, 재실행 복구, 충돌·삭제 정책, 코드 서명과 자동 업데이트를 확인한다.

서버·보안 검증:

- 갱신 토큰 암호화·복호화 권한, 키 교체, 철회, 사용자 탈퇴 시 삭제를 검사한다.
- Drive 변경 커서의 모든 페이지 처리와 앱 종료 중 예약 조정의 최대 지연 시간을 검사한다.
- 서버 AI 작업의 멱등성·취소·재시도·비용 중복 방지와 결과 동기화를 검사한다.
- 시간표·과목 분류·설정·AI 결과가 여러 기기의 동시 수정에서도 revision 규칙에 따라 수렴하는지 검사한다.

사용량 기록: 업로드/다운로드 바이트, API 메서드별 요청 수, 재시도 횟수, 성공률, 대기 시간, 백그라운드 작업 복구 횟수, 변경 반영 지연, AI 작업 시간·비용, 사용자별 목록 읽기량. 파일 본문·파일명·토큰·OAuth 코드·세션 URI는 기록하지 않는다.

사용자 Drive 요금, Drive API 사용료, Firestore·Railway·AI 비용은 별도 항목이다. 원본을 Railway로 중계하면 서버 전송비가 생기므로 일반 업로드·다운로드는 직접 경로를 우선 검증한다. 현재 발표만으로 미래 Drive 초과 사용료를 확정하지 않는다. 출시 전 [공식 한도·가격 문서](https://developers.google.com/workspace/drive/api/guides/limits)를 다시 확인하고 Google Cloud 사용량과 앱 측 집계를 대조한다.

배포 시에는 기능 플래그를 기본 OFF로 둔다. Firestore 구조·색인과 서버 전용 비밀 저장소를 준비하고, Railway API·예약 작업·토큰 암호화·메타데이터 저장을 먼저 검증한다. 이후 서명된 iOS·Android 앱, PC 웹, 서명된 설치형 데스크톱 앱 순으로 내부 테스트 계정에 활성화한다. 단계 A부터 E까지의 통합 검증을 마친 동일 기능 세트를 소규모 사용자에게 활성화한 뒤 전체 공개한다.

롤백은 플랫폼별 신규 업로드·변경 조정·서버 AI·데스크톱 자동 보관을 기능 플래그로 중단하는 방식으로 수행한다. 기존 Drive 파일·기기 원본·암호화된 토큰·대기 작업·영구 삭제 표식·작업 기록은 임의로 삭제하지 않는다. 재개 시 완료된 작업을 중복 실행하지 않도록 각 작업의 멱등 키와 마지막 확인 상태를 보존한다. 보안 사고로 토큰 폐기가 필요한 경우에만 별도의 사고 대응 절차에 따라 토큰을 철회하고 사용자에게 재연결을 안내한다.

## 14. 완료의 정의

단계 A부터 F까지 모두 통과해야 최초 공개 출시 완료로 본다. 모바일에서 생성한 자료가 화면 꺼짐·다른 앱 사용·일시적인 프로세스 중단 후에도 Drive로 전송되거나 자동 재개되고, PC·태블릿에서 같은 사용자 파일을 안전하게 열 수 있어야 한다. 이름 변경·외부 Drive 변경·삭제·복원·시간표·분류·설정·AI 결과가 기기 사이에서 일관되게 동기화되어야 한다. 앱 종료 후 서버 AI, 갱신 토큰의 안전한 관리, 데스크톱 원본 자동 보관과 PC 파일 가져오기도 검증을 마쳐야 한다. 계정 전환·권한 해제·용량 부족·중복 재시도를 처리하며 업로드 대기 중인 로컬 원본이 손실되어서는 안 된다.

사용자의 명시적 강제 종료·기기 전원 종료·권한 철회·운영체제의 극단적인 배터리 제한 중 즉시 업로드, 무제한 무료 API, 모든 녹음의 즉시 AI 요약은 첫 출시의 보장 사항이 아니다. 해당 조건이 해소되거나 앱이 다시 실행되면 안전하게 재개해야 한다.
