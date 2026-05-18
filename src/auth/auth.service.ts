import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        passwordHash,
        role: dto.role as UserRole,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, {
      ipAddress,
      userAgent,
    });

    return { user, ...tokens };
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.trackFailedLogin(user.id, user.failedLoginCount);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    return user;
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.validateUser(dto.email, dto.password);

    if (user.role !== dto.role) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role, {
      ipAddress,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string, ipAddress?: string, userAgent?: string) {
    const decoded = await this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: decoded.sessionId },
      include: { user: true },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    const matches = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash,
    );
    if (!matches) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token is invalid');
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    return this.issueTokens(
      session.user.id,
      session.user.email,
      session.user.role,
      {
        ipAddress,
        userAgent,
      },
    );
  }

  async logout(userId: string, sessionId: string) {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, isRevoked: true },
    });

    if (!session || session.isRevoked) {
      return { success: true };
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    return { success: true };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const refreshJti = randomUUID();
    const refreshTtlSeconds = this.configService.get<number>(
      'JWT_REFRESH_TTL_SECONDS',
      60 * 60 * 24 * 14,
    );
    const accessTtlSeconds = this.configService.get<number>(
      'JWT_ACCESS_TTL_SECONDS',
      60 * 15,
    );
    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const accessSecret =
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');

    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        jti: refreshJti,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        refreshTokenHash: 'pending',
      },
      select: { id: true },
    });

    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      sessionId: session.id,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessTtlSeconds,
    });
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, jti: refreshJti },
      { secret: refreshSecret, expiresIn: refreshTtlSeconds },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash },
    });

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(refreshToken: string) {
    try {
      const refreshSecret =
        this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
      return await this.jwtService.verifyAsync<JwtPayload & { jti: string }>(
        refreshToken,
        {
          secret: refreshSecret,
        },
      );
    } catch {
      throw new UnauthorizedException('Refresh token is invalid');
    }
  }

  private async trackFailedLogin(userId: string, failedLoginCount: number) {
    const nextCount = failedLoginCount + 1;
    const shouldLock = nextCount >= 5;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
  }
}
