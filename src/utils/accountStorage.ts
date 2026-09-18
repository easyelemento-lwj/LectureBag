// Unowned legacy keys are deliberately never read or assigned to the next login.
export function accountKey(uid: string, key: string): string {
  if (!uid) throw new Error('로그인이 필요합니다.');
  return `lecturebag:${encodeURIComponent(uid)}:${key}`;
}

export function documentKey(uid: string, id: string): string {
  return accountKey(uid, `document:${id}`);
}
