import { SetMetadata } from '@nestjs/common';

export const SKIP_ONBOARDING_KEY = 'skipOnboarding';

/** Allows tenant/landlord access before Fayda verification and (landlords) first property. */
export const SkipOnboarding = () => SetMetadata(SKIP_ONBOARDING_KEY, true);
