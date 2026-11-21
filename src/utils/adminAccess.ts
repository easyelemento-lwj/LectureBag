import type { User } from 'firebase/auth';

// Navigation hint only. The feedback API independently verifies the ID token.
export function isFeedbackAdminAccount(user: User | null): boolean {
  return user?.emailVerified === true && user.email?.trim().toLowerCase() === 'easyelemento@gmail.com';
}
