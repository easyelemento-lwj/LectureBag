/** A single actionable sentence; raw diagnostic text stays out of status UI. */
export function syncActionMessage(message = '', states: string[] = [], disconnected = false): string {
  if (/기존 LectureBag 권한/.test(message)) return 'Google 계정에서 기존 LectureBag 권한을 삭제한 뒤 다시 연결해 주세요.';
  if (/내부 테스트가 활성화되지 않은 계정/.test(message)) return '이 계정은 Drive 테스트 사용 등록이 필요합니다. 운영자에게 문의해 주세요.';
  if (/Drive 서버 설정|Drive 서버의 OAuth/.test(message)) return 'Drive 서버 설정 확인이 필요합니다. 운영자에게 문의해 주세요.';
  if (/오프라인|인터넷|네트워크|offline|network/i.test(message) || states.includes('offline')) return '인터넷 연결 후 자동으로 다시 시도합니다.';
  if (/PC 저장 공간|기기 저장 공간|QuotaExceeded/i.test(message)) return '이 기기의 저장 공간을 확보해 주세요.';
  if (/저장 공간|용량|quota/i.test(message) || states.includes('quota_full')) return 'Drive 저장 공간을 확보해 주세요.';
  if (disconnected || states.includes('needs_auth')) return 'Google 계정을 다시 연결해 주세요.';
  if (/요청이 많|잠시 후|429|retry.after/i.test(message)) return '잠시 기다린 뒤 다시 시도해 주세요.';
  if (/원본.*(접근|확인)|접근.*원본/i.test(message)) return 'Drive에서 원본과 접근 권한을 확인해 주세요.';
  if (/권한|인증|연결.*필요|needs_auth|scope/i.test(message)) return 'Google 계정을 다시 연결해 주세요.';
  return 'Google Drive 버블에서 다시 시도를 눌러 주세요.';
}
