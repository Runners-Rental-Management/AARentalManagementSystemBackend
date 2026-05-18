import { SetMetadata } from '@nestjs/common';

export const ONBOARDING_OPTIONS_KEY = 'onboardingOptions';

export type OnboardingRouteOptions = {
  /** When false, landlords may call the route before registering a property. Default true. */
  requireProperty?: boolean;
};

export const OnboardingOptions = (options: OnboardingRouteOptions) =>
  SetMetadata(ONBOARDING_OPTIONS_KEY, options);
