import {
  AgreementStatus,
  Prisma,
  PropertyStatus,
  UserRole,
} from '@prisma/client';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertSubCityInScope,
  getAdminLocationScope,
  isAdminRole,
  requireAdminLocationScope,
  scopedPropertyWhere,
} from '../auth/admin-location-scope';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { CreateTenantAgreementDto } from './dto/create-tenant-agreement.dto';
import { ListAgreementsDto } from './dto/list-agreements.dto';
import { ReviewAgreementDto } from './dto/review-agreement.dto';

const OPEN_AGREEMENT_STATUSES: AgreementStatus[] = [
  AgreementStatus.draft,
  AgreementStatus.pending_tenant_signature,
  AgreementStatus.pending_verification,
  AgreementStatus.pending_dara_verification,
  AgreementStatus.active,
];

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createAsLandlord(landlordId: string, dto: CreateAgreementDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: { id: true, landlordId: true, status: true, deletedAt: true },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }
    if (property.landlordId !== landlordId) {
      throw new ForbiddenException(
        'You can only create agreements for your property',
      );
    }
    if (property.status !== PropertyStatus.available) {
      throw new UnprocessableEntityException(
        'Property is not available for agreement',
      );
    }

    const tenant = await this.prisma.user.findUnique({
      where: { id: dto.tenantId },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }
    if (tenant.role !== UserRole.tenant) {
      throw new UnprocessableEntityException('Target user must be a tenant');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new UnprocessableEntityException('endDate must be after startDate');
    }

    const agreement = await this.prisma.tenancyAgreement.create({
      data: {
        propertyId: dto.propertyId,
        landlordId,
        tenantId: dto.tenantId,
        monthlyRent: new Prisma.Decimal(dto.monthlyRent),
        advancePayment: new Prisma.Decimal(dto.advancePayment),
        startDate,
        endDate,
        utilities: dto.utilities,
        status: AgreementStatus.pending_tenant_signature,
        terminationReason: dto.terminationReason,
      },
      include: {
        property: {
          select: { id: true, title: true, address: true, status: true },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // Notify the tenant about the new agreement awaiting signature
    this.notifications
      .notifyUser({
        userId: agreement.tenantId,
        title: 'New tenancy agreement awaiting your signature',
        message: `A landlord has created an agreement for "${agreement.property.title}". Please review and sign.`,
        type: 'info',
        category: 'agreement',
        link: `/dashboard/agreements/${agreement.id}`,
      })
      .catch(() => undefined);

    return agreement;
  }

  async tenantRequestAsTenant(tenantId: string, dto: CreateTenantAgreementDto) {
    const tenant = await this.prisma.user.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        role: true,
        deletedAt: true,
        faydaVerified: true,
      },
    });

    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }
    if (tenant.role !== UserRole.tenant) {
      throw new ForbiddenException('Only tenants can request agreements');
    }
    if (!tenant.faydaVerified) {
      throw new UnprocessableEntityException(
        'Fayda identity verification is required before signing a contract',
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: {
        id: true,
        landlordId: true,
        status: true,
        deletedAt: true,
        monthlyRent: true,
        amenities: true,
      },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }
    if (property.status !== PropertyStatus.available) {
      throw new UnprocessableEntityException(
        'Property is not available for agreement',
      );
    }

    const existing = await this.prisma.tenancyAgreement.findFirst({
      where: {
        propertyId: dto.propertyId,
        tenantId,
        status: { in: OPEN_AGREEMENT_STATUSES },
      },
      select: { id: true },
    });
    if (existing) {
      throw new UnprocessableEntityException(
        'An open agreement already exists for this property',
      );
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 2);
    const monthlyRent = Number(property.monthlyRent);
    const advancePayment = monthlyRent * 2;
    const utilities =
      dto.utilities?.length && dto.utilities.length > 0
        ? dto.utilities
        : property.amenities.slice(0, 5);

    const agreement = await this.prisma.tenancyAgreement.create({
      data: {
        propertyId: dto.propertyId,
        landlordId: property.landlordId,
        tenantId,
        monthlyRent: new Prisma.Decimal(monthlyRent),
        advancePayment: new Prisma.Decimal(advancePayment),
        startDate,
        endDate,
        utilities,
        status: AgreementStatus.draft,
        tenantSignedAt: new Date(),
      },
      include: {
        property: {
          select: { id: true, title: true, address: true, status: true },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // Notify the landlord about the tenant's rental request
    this.notifications
      .notifyUser({
        userId: agreement.landlord.id,
        title: 'Tenant has requested an agreement',
        message: `A tenant has requested a tenancy for "${agreement.property.title}". Please review and counter-sign.`,
        type: 'info',
        category: 'agreement',
        link: `/dashboard/agreements/${agreement.id}`,
      })
      .catch(() => undefined);

    return agreement;
  }

  async landlordSignAgreement(id: string, landlordId: string) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        status: true,
        tenantSignedAt: true,
        landlordSignedAt: true,
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Only the property landlord can counter-sign this agreement',
      );
    }
    if (agreement.status !== AgreementStatus.draft) {
      throw new UnprocessableEntityException(
        'Agreement is not awaiting landlord counter-signature',
      );
    }
    if (!agreement.tenantSignedAt) {
      throw new UnprocessableEntityException(
        'Tenant must sign before landlord counter-signature',
      );
    }

    const updated = await this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.pending_verification,
        landlordSignedAt: agreement.landlordSignedAt ?? new Date(),
      },
      include: {
        property: {
          select: { id: true, title: true, address: true, status: true, subCity: true },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // Notify admins that an agreement is pending verification
    this.notifications
      .adminIdsForSubCity(updated.property.subCity)
      .then((adminIds) =>
        this.notifications.notifyMany(
          adminIds.map((aId) => ({
            userId: aId,
            title: 'Agreement pending verification',
            message: `An agreement for "${updated.property.title}" is ready for authority review.`,
            type: 'info' as const,
            category: 'agreement' as const,
            link: `/agreements/${updated.id}`,
          })),
        ),
      )
      .catch(() => undefined);

    return updated;
  }

  async listForUser(userId: string, role: UserRole, query: ListAgreementsDto) {
    const search = query.search?.trim();
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    const where: Prisma.TenancyAgreementWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(role === UserRole.landlord ? { landlordId: userId } : {}),
      ...(role === UserRole.tenant ? { tenantId: userId } : {}),
      ...(adminScope ? { property: scopedPropertyWhere(adminScope) } : {}),
      ...(search
        ? {
            OR: [
              {
                property: {
                  title: { contains: search, mode: 'insensitive' },
                },
              },
              {
                property: {
                  address: { contains: search, mode: 'insensitive' },
                },
              },
              {
                landlord: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
              {
                tenant: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const items = await this.prisma.tenancyAgreement.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        property: {
          select: { id: true, title: true, address: true, subCity: true },
        },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const total = await this.prisma.tenancyAgreement.count({ where });

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

  async getById(id: string, userId: string, role: UserRole) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      include: {
        property: true,
        landlord: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }

    const isAdmin = isAdminRole(role);
    const isParty =
      agreement.landlordId === userId || agreement.tenantId === userId;
    if (!isAdmin && !isParty) {
      throw new ForbiddenException('You cannot access this agreement');
    }
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    if (adminScope) {
      assertSubCityInScope(adminScope, agreement.property.subCity);
    }

    return agreement;
  }

  async tenantSign(id: string, userId: string) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: { id: true, tenantId: true, status: true, tenantSignedAt: true },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.tenantId !== userId) {
      throw new ForbiddenException(
        'Only assigned tenant can sign this agreement',
      );
    }
    if (agreement.status !== AgreementStatus.pending_tenant_signature) {
      throw new UnprocessableEntityException(
        'Agreement is not awaiting tenant signature',
      );
    }

    const signed = await this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.pending_verification,
        tenantSignedAt: agreement.tenantSignedAt ?? new Date(),
      },
      include: {
        property: { select: { id: true, title: true, status: true, subCity: true } },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Notify the landlord that the tenant signed
    this.notifications
      .notifyUser({
        userId: signed.landlordId,
        title: 'Tenant signed the agreement',
        message: `Your tenant signed the agreement for "${signed.property.title}". It is now pending authority verification.`,
        type: 'success',
        category: 'agreement',
        link: `/dashboard/agreements/${signed.id}`,
      })
      .catch(() => undefined);

    return signed;
  }

  async reviewByAuthority(
    id: string,
    userId: string,
    role: UserRole,
    dto: ReviewAgreementDto,
  ) {
    if (!isAdminRole(role)) {
      throw new ForbiddenException(
        'Only authority users can review agreements',
      );
    }
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);

    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        propertyId: true,
        status: true,
        property: { select: { subCity: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    assertSubCityInScope(adminScope, agreement.property.subCity);
    if (agreement.status !== AgreementStatus.pending_verification) {
      throw new UnprocessableEntityException(
        'Agreement is not in review state',
      );
    }

    if (
      dto.status !== AgreementStatus.active &&
      dto.status !== AgreementStatus.rejected
    ) {
      throw new UnprocessableEntityException(
        'Review status must be active or rejected',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedAgreement = await tx.tenancyAgreement.update({
        where: { id },
        data: {
          status: dto.status,
          verifiedAt: dto.status === AgreementStatus.active ? new Date() : null,
          terminationReason:
            dto.status === AgreementStatus.rejected ? dto.reason : null,
        },
        include: {
          property: { select: { id: true, title: true, status: true } },
          landlord: { select: { id: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.property.update({
        where: { id: agreement.propertyId },
        data: {
          status:
            dto.status === AgreementStatus.active
              ? PropertyStatus.rented
              : PropertyStatus.available,
        },
      });

      return updatedAgreement;
    });

    const activated = dto.status === AgreementStatus.active;
    this.notifications
      .notifyMany([
        {
          userId: result.landlordId,
          title: activated ? 'Agreement approved' : 'Agreement rejected',
          message: activated
            ? `The agreement for "${result.property.title}" is now active.`
            : `The agreement for "${result.property.title}" was rejected by the authority.`,
          type: activated ? 'success' : 'warning',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
        {
          userId: result.tenantId,
          title: activated ? 'Your tenancy is confirmed' : 'Agreement rejected',
          message: activated
            ? `Your tenancy agreement for "${result.property.title}" has been approved. Welcome home!`
            : `The agreement for "${result.property.title}" was rejected. Please contact your landlord.`,
          type: activated ? 'success' : 'warning',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
      ])
      .catch(() => undefined);

    return result;
  }
}
