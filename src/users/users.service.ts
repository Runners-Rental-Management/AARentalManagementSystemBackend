import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  AdminLocationScope,
  requireAdminLocationScope,
  scopedPropertyWhere,
} from '../auth/admin-location-scope';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateMeDto } from './dto/update-me.dto';

const tenantPublicProfileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isVerified: true,
  address: true,
  fatherName: true,
  grandfatherName: true,
  faydaNumber: true,
  faydaVerified: true,
  faydaVerifiedAt: true,
  createdAt: true,
  _count: {
    select: {
      agreementsAsTenant: true,
    },
  },
} satisfies Prisma.UserSelect;

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${phone.slice(0, Math.min(8, phone.length))} *** ***`;
}

function maskFaydaNumber(faydaNumber: string): string {
  if (faydaNumber.length < 8) return '****';
  return `${faydaNumber.slice(0, 4)} **** **** ${faydaNumber.slice(-4)}`;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private scopedUserWhere(
    requesterId: string,
    scope: AdminLocationScope,
  ): Prisma.UserWhereInput {
    if (scope.allLocations) return {};
    const propertyWhere = scopedPropertyWhere(scope);
    return {
      OR: [
        { id: requesterId },
        { ownedProperties: { some: propertyWhere } },
        { agreementsAsLandlord: { some: { property: propertyWhere } } },
        { agreementsAsTenant: { some: { property: propertyWhere } } },
      ],
    };
  }

  private async requireAllLocationAdmin(userId: string, role: UserRole) {
    const scope = await requireAdminLocationScope(this.prisma, userId, role);
    if (!scope.allLocations) {
      throw new ForbiddenException('Only all-location admins can access this');
    }
    return scope;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        adminSubCities: true,
        adminAllLocations: true,
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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async listAll(userId: string, role: UserRole, query: ListUsersDto) {
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);
    const searchWhere: Prisma.UserWhereInput | undefined = query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : undefined;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      AND: [
        this.scopedUserWhere(userId, adminScope),
        ...(searchWhere ? [searchWhere] : []),
      ],
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          adminSubCities: true,
          adminAllLocations: true,
          isVerified: true,
          faydaVerified: true,
          createdAt: true,
          lastLoginAt: true,
          lockedUntil: true,
          _count: {
            select: {
              ownedProperties: true,
              agreementsAsLandlord: true,
              agreementsAsTenant: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getUserById(id: string, requesterId: string, role: UserRole) {
    const adminScope = await requireAdminLocationScope(
      this.prisma,
      requesterId,
      role,
    );
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        AND: [this.scopedUserWhere(requesterId, adminScope)],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        adminSubCities: true,
        adminAllLocations: true,
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
        lastLoginAt: true,
        lockedUntil: true,
        _count: {
          select: {
            ownedProperties: true,
            agreementsAsLandlord: true,
            agreementsAsTenant: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private formatTenantPublicProfile(
    user: Prisma.UserGetPayload<{ select: typeof tenantPublicProfileSelect }>,
  ) {
    const fullName = [user.firstName, user.fatherName, user.grandfatherName]
      .filter(Boolean)
      .join(' ');

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fatherName: user.fatherName,
      grandfatherName: user.grandfatherName,
      fullName: fullName || `${user.firstName} ${user.lastName}`.trim(),
      phone: user.phone,
      maskedPhone: maskPhone(user.phone),
      address: user.address,
      role: user.role,
      isVerified: user.isVerified,
      faydaVerified: user.faydaVerified,
      faydaVerifiedAt: user.faydaVerifiedAt,
      maskedFaydaNumber: user.faydaNumber
        ? maskFaydaNumber(user.faydaNumber)
        : null,
      createdAt: user.createdAt,
      agreementCountAsTenant: user._count.agreementsAsTenant,
    };
  }

  async lookupTenantByFayda(faydaNumber: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        role: UserRole.tenant,
        faydaVerified: true,
        faydaNumber,
      },
      select: tenantPublicProfileSelect,
    });

    if (!user) {
      throw new NotFoundException(
        'No Fayda-verified tenant found with this number',
      );
    }

    return this.formatTenantPublicProfile(user);
  }

  async getTenantPublicProfile(tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: tenantId,
        deletedAt: null,
        role: UserRole.tenant,
        faydaVerified: true,
      },
      select: tenantPublicProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('Tenant profile not found');
    }

    return this.formatTenantPublicProfile(user);
  }

  async getDashboardStats(userId: string, role: UserRole) {
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);
    const propertyWhere = scopedPropertyWhere(adminScope);
    const agreementWhere: Prisma.TenancyAgreementWhereInput = adminScope.allLocations
      ? {}
      : { property: propertyWhere };
    const adjustmentWhere: Prisma.RentAdjustmentWhereInput =
      adminScope.allLocations ? {} : { agreement: { property: propertyWhere } };
    const userWhere = this.scopedUserWhere(userId, adminScope);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      propertiesByStatus,
      agreementsByStatus,
      adjustmentsByStatus,
      usersByRole,
      propertiesBySubCity,
      recentProperties,
      recentAgreements,
    ] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...propertyWhere },
        _count: true,
      }),
      this.prisma.tenancyAgreement.groupBy({
        by: ['status'],
        where: agreementWhere,
        _count: true,
      }),
      this.prisma.rentAdjustment.groupBy({
        by: ['status'],
        where: adjustmentWhere,
        _count: true,
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null, AND: [userWhere] },
        _count: true,
      }),
      this.prisma.property.groupBy({
        by: ['subCity'],
        where: { deletedAt: null, ...propertyWhere },
        _count: true,
        orderBy: { _count: { subCity: 'desc' } },
        take: 8,
      }),
      this.prisma.property.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          deletedAt: null,
          ...propertyWhere,
        },
      }),
      this.prisma.tenancyAgreement.count({
        where: { createdAt: { gte: thirtyDaysAgo }, ...agreementWhere },
      }),
    ]);

    const monthlyTrend: { month: string; properties: number; agreements: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = start.toLocaleString('en-US', { month: 'short', year: '2-digit' });

      const [props, agrs] = await Promise.all([
        this.prisma.property.count({
          where: { createdAt: { gte: start, lte: end }, deletedAt: null, ...propertyWhere },
        }),
        this.prisma.tenancyAgreement.count({
          where: { createdAt: { gte: start, lte: end }, ...agreementWhere },
        }),
      ]);

      monthlyTrend.push({ month: label, properties: props, agreements: agrs });
    }

    return {
      overview: {
        totalProperties: propertiesByStatus.reduce((s, r) => s + r._count, 0),
        totalAgreements: agreementsByStatus.reduce((s, r) => s + r._count, 0),
        totalUsers: usersByRole.reduce((s, r) => s + r._count, 0),
        recentProperties,
        recentAgreements,
      },
      propertiesByStatus: propertiesByStatus.map((r) => ({ status: r.status, count: r._count })),
      agreementsByStatus: agreementsByStatus.map((r) => ({ status: r.status, count: r._count })),
      adjustmentsByStatus: adjustmentsByStatus.map((r) => ({ status: r.status, count: r._count })),
      usersByRole: usersByRole.map((r) => ({ role: r.role, count: r._count })),
      propertiesBySubCity: propertiesBySubCity.map((r) => ({ subCity: r.subCity, count: r._count })),
      monthlyTrend,
    };
  }

  async listAuditLogs(userId: string, role: UserRole, query: ListAuditLogsDto) {
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);
    const where: Prisma.AuditLogWhereInput = {
      user: this.scopedUserWhere(userId, adminScope),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async listSystemParameters(userId: string, role: UserRole) {
    await this.requireAllLocationAdmin(userId, role);
    return this.prisma.systemParameter.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
      include: {
        updatedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async updateSystemParameter(
    key: string,
    value: string,
    updatedById: string,
    role: UserRole,
  ) {
    await this.requireAllLocationAdmin(updatedById, role);
    const param = await this.prisma.systemParameter.findUnique({
      where: { key },
    });
    if (!param) throw new NotFoundException(`Parameter '${key}' not found`);

    return this.prisma.systemParameter.update({
      where: { key },
      data: { value, updatedById },
      include: {
        updatedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        address: dto.address,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        adminSubCities: true,
        adminAllLocations: true,
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

    return updated;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.email.toLowerCase() !== dto.email.trim().toLowerCase()) {
      throw new UnauthorizedException('Email credential check failed');
    }

    const currentPasswordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Invalid current password');
    }

    const samePassword = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (samePassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 12),
      },
    });

    this.notifications
      .notifyUser({
        userId,
        title: 'Password changed successfully',
        message:
          'Your account password was changed. If you did not do this, contact support immediately.',
        type: 'success',
        category: 'system',
      })
      .catch(() => undefined);

    return { ok: true };
  }
}
