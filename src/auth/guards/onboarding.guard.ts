import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import {
  ONBOARDING_OPTIONS_KEY,
  type OnboardingRouteOptions,
} from '../onboarding-options.decorator';
import { SKIP_ONBOARDING_KEY } from '../skip-onboarding.decorator';
import { OnboardingService } from '../onboarding.service';

@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly onboarding: OnboardingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ONBOARDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { sub: string; role: UserRole };
    }>();
    const user = request.user;
    if (!user?.sub || !user.role) {
      return true;
    }

    const routeOptions =
      this.reflector.getAllAndOverride<OnboardingRouteOptions>(
        ONBOARDING_OPTIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? {};

    await this.onboarding.assertOnboarded(user.sub, user.role, routeOptions);
    return true;
  }
}
