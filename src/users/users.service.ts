import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async listAll(query: ListUsersDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
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

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
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
        lastLoginAt: true,
        lockedUntil: true,
        _count: {
          select: {
            ownedProperties: true,
            agreementsAsLandlord: true,
            agreementsAsTenant: true,
            reportedDisputes: true,
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

  async getDashboardStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const [
      propertiesByStatus,
      agreementsByStatus,
      disputesByStatus,
      disputesByPriority,
      adjustmentsByStatus,
      usersByRole,
      propertiesBySubCity,
      recentProperties,
      recentAgreements,
      recentDisputes,
    ] = await Promise.all([
      // Properties by status
      this.prisma.property.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: true,
      }),
      // Agreements by status
      this.prisma.tenancyAgreement.groupBy({
        by: ['status'],
        _count: true,
      }),
      // Disputes by status
      this.prisma.dispute.groupBy({
        by: ['status'],
        _count: true,
      }),
      // Disputes by priority
      this.prisma.dispute.groupBy({
        by: ['priority'],
        _count: true,
      }),
      // Rent adjustments by status
      this.prisma.rentAdjustment.groupBy({
        by: ['status'],
        _count: true,
      }),
      // Users by role
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: true,
      }),
      // Properties by sub-city (top 8)
      this.prisma.property.groupBy({
        by: ['subCity'],
        where: { deletedAt: null },
        _count: true,
        orderBy: { _count: { subCity: 'desc' } },
        take: 8,
      }),
      // Recent properties (last 30 days per week)
      this.prisma.property.count({
        where: { createdAt: { gte: thirtyDaysAgo }, deletedAt: null },
      }),
      // Recent agreements (last 30 days)
      this.prisma.tenancyAgreement.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      // Recent disputes (last 30 days)
      this.prisma.dispute.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    // Monthly trend for the last 6 months
    const monthlyTrend: { month: string; properties: number; agreements: number; disputes: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = start.toLocaleString('en-US', { month: 'short', year: '2-digit' });

      const [props, agrs, disps] = await Promise.all([
        this.prisma.property.count({ where: { createdAt: { gte: start, lte: end }, deletedAt: null } }),
        this.prisma.tenancyAgreement.count({ where: { createdAt: { gte: start, lte: end } } }),
        this.prisma.dispute.count({ where: { createdAt: { gte: start, lte: end } } }),
      ]);

      monthlyTrend.push({ month: label, properties: props, agreements: agrs, disputes: disps });
    }

    return {
      overview: {
        totalProperties: propertiesByStatus.reduce((s, r) => s + r._count, 0),
        totalAgreements: agreementsByStatus.reduce((s, r) => s + r._count, 0),
        totalDisputes: disputesByStatus.reduce((s, r) => s + r._count, 0),
        totalUsers: usersByRole.reduce((s, r) => s + r._count, 0),
        recentProperties,
        recentAgreements,
        recentDisputes,
      },
      propertiesByStatus: propertiesByStatus.map((r) => ({ status: r.status, count: r._count })),
      agreementsByStatus: agreementsByStatus.map((r) => ({ status: r.status, count: r._count })),
      disputesByStatus: disputesByStatus.map((r) => ({ status: r.status, count: r._count })),
      disputesByPriority: disputesByPriority.map((r) => ({ priority: r.priority, count: r._count })),
      adjustmentsByStatus: adjustmentsByStatus.map((r) => ({ status: r.status, count: r._count })),
      usersByRole: usersByRole.map((r) => ({ role: r.role, count: r._count })),
      propertiesBySubCity: propertiesBySubCity.map((r) => ({ subCity: r.subCity, count: r._count })),
      monthlyTrend,
    };
  }

  async listAuditLogs(query: ListAuditLogsDto) {
    const where: Prisma.AuditLogWhereInput = {
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

  async listSystemParameters() {
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
  ) {
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
      data: dto,
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

    return updated;
  }
}
