import { sanitizeCallbackUrl } from "./callbackUrl";

export function onboardingUrl(callbackUrl?: string | null): string {
  const safe = sanitizeCallbackUrl(callbackUrl);
  return safe ? `/onboarding?callbackUrl=${encodeURIComponent(safe)}` : "/onboarding";
}
