import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VerifyFaydaDto } from '../users/dto/verify-fayda.dto';

/** Platform sandbox OTP + Fayda eSignet test OTP (see Fayda integration docs). */
const FAYDA_TEST_OTPS = ['123456', '111111'];

function isAcceptedFaydaTestOtp(otpCode: string): boolean {
  if (process.env.NODE_ENV === 'production') {
    return otpCode === '123456';
  }
  return FAYDA_TEST_OTPS.includes(otpCode);
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyFayda(userId: string, dto: VerifyFaydaDto) {
    if (!isAcceptedFaydaTestOtp(dto.otpCode)) {
      throw new UnprocessableEntityException('Incorrect verification code');
    }

    const existingFan = await this.prisma.user.findFirst({
      where: {
        faydaNumber: dto.faydaNumber,
        id: { not: userId },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingFan) {
      throw new ConflictException('This Fayda number is already registered');
    }

    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, fatherName: true },
    });
    if (!account) {
      throw new ForbiddenException('User not found');
    }

    const registeredFatherName =
      account.fatherName?.trim() || account.lastName.trim();
    if (
      normalizeName(dto.firstName) !== normalizeName(account.firstName) ||
      normalizeName(dto.fatherName) !== normalizeName(registeredFatherName)
    ) {
      throw new UnprocessableEntityException(
        'Fayda names do not match your account registration',
      );
    }

    const now = new Date();
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName.trim(),
        fatherName: dto.fatherName.trim(),
        grandfatherName: dto.grandfatherName.trim(),
        faydaNumber: dto.faydaNumber,
        faydaVerified: true,
        faydaVerifiedAt: now,
        isVerified: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        avatar: true,
        isVerified: true,
        address: true,
        idNumber: true,
        fatherName: true,
        grandfatherName: true,
        faydaNumber: true,
        faydaVerified: true,
        faydaVerifiedAt: true,
        createdAt: true,
      },
    });
  }

  async assertOnboarded(
    userId: string,
    role: UserRole,
    options: { requireProperty?: boolean } = {},
  ) {
    if (role !== UserRole.tenant && role !== UserRole.landlord) {
      return;
    }

    const requireProperty = options.requireProperty !== false;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { faydaVerified: true, role: true },
    });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    if (!user.faydaVerified) {
      throw new ForbiddenException(
        'Complete Fayda (FAN) verification before using this feature',
      );
    }

    if (user.role === UserRole.landlord && requireProperty) {
      const propertyCount = await this.prisma.property.count({
        where: { landlordId: userId, deletedAt: null },
      });
      if (propertyCount < 1) {
        throw new ForbiddenException(
          'Register at least one property before using this feature',
        );
      }
    }
  }
}
