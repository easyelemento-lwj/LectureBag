# Railway 웹 화면 배포

Railway의 기존 Python API가 `railway_web/`의 검토된 Vite 빌드를 함께 제공한다.
`/`는 웹 화면, `/health`는 상태 확인, `/api/*`는 기존 인증 API다.
저장소 루트나 `.env`는 정적 파일 경로에 포함하지 않는다.

현재 로컬 화면과 동일한 결과물을 배포하기 위해 프런트엔드는 로컬에서 빌드한다.
`npm run build:railway` 실행 후 `railway_web/`의 변경을 서버 코드와 함께 커밋하고
Railway와 연결된 main에 푸시한다. 빌드 시에는 브라우저 공개 설정인 VITE 변수만 사용하며
OAuth secret·서비스 계정·토큰 암호화 키를 빌드에 넣지 않는다.
프런트엔드 소스를 수정했더라도 이 명령을 다시 실행하지 않으면 Railway 화면은 갱신되지 않는다.

새 주소 `https://lecturebag-production.up.railway.app`에서 로그인이 동작하려면
Firebase Authentication 허용 도메인, 필요 시 Firebase API 키 리퍼러 제한,
Drive 웹 OAuth 클라이언트의 승인된 JavaScript 원본,
서버 DRIVE_WEB_ORIGINS에 해당 주소가 허용되어 있어야 한다.
보안 허용 목록은 배포 코드에서 자동으로 확대하지 않는다.
새 도메인의 브라우저 저장소는 localhost 및 Firebase 시험 주소와 별개이므로
처음 로그인하고 PC 자동 보관을 다시 활성화해야 한다. 기존 주소의 원본은 삭제하지 않는다.
