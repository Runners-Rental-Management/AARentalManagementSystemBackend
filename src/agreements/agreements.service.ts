import {
  AgreementStatus,
  PaymentMethod,
  PaymentStatus,
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
import { ConfirmAgreementPaymentDto } from './dto/confirm-agreement-payment.dto';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { CreateTenantAgreementDto } from './dto/create-tenant-agreement.dto';
import { ListAgreementsDto } from './dto/list-agreements.dto';
import { RequestExtensionDto } from './dto/request-extension.dto';
import { ReviewAgreementDto } from './dto/review-agreement.dto';
import { ReviewPendingRequestDto } from './dto/review-pending-request.dto';
import { TerminateAgreementDto } from './dto/terminate-agreement.dto';

const OPEN_AGREEMENT_STATUSES: AgreementStatus[] = [
  AgreementStatus.draft,
  AgreementStatus.pending_tenant_signature,
  AgreementStatus.pending_verification,
  AgreementStatus.pending_dara_verification,
  AgreementStatus.pending_payment,
];

const WITHDRAWABLE_AGREEMENT_STATUSES: AgreementStatus[] = [
  AgreementStatus.draft,
  AgreementStatus.pending_tenant_signature,
  AgreementStatus.pending_verification,
  AgreementStatus.pending_dara_verification,
  AgreementStatus.pending_payment,
];

const ACTIVE_TENANCY_STATUSES: AgreementStatus[] = [
  AgreementStatus.active,
  AgreementStatus.extended,
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

    const approved = dto.status === AgreementStatus.active;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedAgreement = await tx.tenancyAgreement.update({
        where: { id },
        data: {
          status: approved
            ? AgreementStatus.pending_payment
            : AgreementStatus.rejected,
          verifiedAt: approved ? new Date() : null,
          terminationReason: approved ? null : dto.reason,
        },
        include: {
          property: { select: { id: true, title: true, status: true } },
          landlord: { select: { id: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (!approved) {
        await tx.property.update({
          where: { id: agreement.propertyId },
          data: { status: PropertyStatus.available },
        });
      }

      return updatedAgreement;
    });

    this.notifications
      .notifyMany([
        {
          userId: result.landlordId,
          title: approved ? 'Agreement verified' : 'Agreement rejected',
          message: approved
            ? `The agreement for "${result.property.title}" has been verified by the authority. Awaiting tenant advance payment.`
            : `The agreement for "${result.property.title}" was rejected by the authority.`,
          type: approved ? 'success' : 'warning',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
        {
          userId: result.tenantId,
          title: approved ? 'Pay advance to activate tenancy' : 'Agreement rejected',
          message: approved
            ? `Your agreement for "${result.property.title}" has been verified. Please pay the advance rent to activate your tenancy.`
            : `The agreement for "${result.property.title}" was rejected. Please contact your landlord.`,
          type: approved ? 'info' : 'warning',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
      ])
      .catch(() => undefined);

    return result;
  }

  async confirmInitialPayment(
    id: string,
    tenantId: string,
    dto: ConfirmAgreementPaymentDto,
  ) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        landlordId: true,
        propertyId: true,
        status: true,
        advancePayment: true,
        startDate: true,
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.tenantId !== tenantId) {
      throw new ForbiddenException('Only the tenant can confirm payment');
    }
    if (agreement.status !== AgreementStatus.pending_payment) {
      throw new UnprocessableEntityException(
        'Agreement is not awaiting initial payment',
      );
    }

    const paidAt = new Date();
    const method = dto.method ?? PaymentMethod.mobile_money;
    const reference =
      dto.reference?.trim() ||
      `ADV-${agreement.id.slice(-8).toUpperCase()}-${paidAt.getTime()}`;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.rentPayment.create({
        data: {
          agreementId: agreement.id,
          payerId: agreement.tenantId,
          recipientId: agreement.landlordId,
          amount: agreement.advancePayment,
          dueDate: agreement.startDate,
          paidDate: paidAt,
          status: PaymentStatus.paid,
          method,
          reference,
        },
      });

      const updatedAgreement = await tx.tenancyAgreement.update({
        where: { id },
        data: {
          status: AgreementStatus.active,
          initialPaymentAt: paidAt,
        },
        include: {
          property: { select: { id: true, title: true, status: true } },
          landlord: { select: { id: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.property.update({
        where: { id: agreement.propertyId },
        data: { status: PropertyStatus.rented },
      });

      return updatedAgreement;
    });

    this.notifications
      .notifyMany([
        {
          userId: result.landlordId,
          title: 'Advance payment received',
          message: `The tenant has paid the advance rent for "${result.property.title}". The tenancy is now active.`,
          type: 'success',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
        {
          userId: result.tenantId,
          title: 'Tenancy activated',
          message: `Your payment for "${result.property.title}" was confirmed. Your tenancy is now active. Welcome home!`,
          type: 'success',
          category: 'agreement',
          link: `/dashboard/agreements/${result.id}`,
        },
      ])
      .catch(() => undefined);

    return result;
  }

  async withdrawAgreement(
    id: string,
    userId: string,
    role: UserRole,
    dto: TerminateAgreementDto,
  ) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        tenantId: true,
        propertyId: true,
        status: true,
        property: { select: { title: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }

    const isParty =
      agreement.landlordId === userId || agreement.tenantId === userId;
    if (!isParty && role !== UserRole.admin) {
      throw new ForbiddenException('You cannot withdraw from this agreement');
    }
    if (!WITHDRAWABLE_AGREEMENT_STATUSES.includes(agreement.status)) {
      throw new UnprocessableEntityException(
        'Withdrawal is only available before the tenant pays and the tenancy is activated',
      );
    }

    const terminatedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedAgreement = await tx.tenancyAgreement.update({
        where: { id },
        data: {
          status: AgreementStatus.terminated,
          terminatedAt,
          terminationReason: dto.reason.trim(),
        },
        include: {
          property: { select: { id: true, title: true, status: true } },
          landlord: { select: { id: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.property.update({
        where: { id: agreement.propertyId },
        data: { status: PropertyStatus.available },
      });

      return updatedAgreement;
    });

    const otherPartyId =
      userId === agreement.landlordId
        ? agreement.tenantId
        : agreement.landlordId;
    const initiatorLabel =
      userId === agreement.landlordId ? 'The landlord' : 'The tenant';

    this.notifications
      .notifyUser({
        userId: otherPartyId,
        title: 'Agreement withdrawn',
        message: `${initiatorLabel} has withdrawn from the agreement for "${agreement.property.title}".`,
        type: 'warning',
        category: 'agreement',
        link: `/dashboard/agreements/${result.id}`,
      })
      .catch(() => undefined);

    return result;
  }

  async requestTermination(
    id: string,
    userId: string,
    role: UserRole,
    dto: TerminateAgreementDto,
  ) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        tenantId: true,
        status: true,
        startDate: true,
        property: { select: { title: true, subCity: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }

    const isTenant = agreement.tenantId === userId && role === UserRole.tenant;
    const isLandlord =
      agreement.landlordId === userId && role === UserRole.landlord;
    if (!isTenant && !isLandlord) {
      throw new ForbiddenException('You cannot request termination for this agreement');
    }
    if (!ACTIVE_TENANCY_STATUSES.includes(agreement.status)) {
      throw new UnprocessableEntityException(
        'Termination requests are only available for active tenancies',
      );
    }

    if (isLandlord) {
      const twoYearMark = new Date(agreement.startDate);
      twoYearMark.setFullYear(twoYearMark.getFullYear() + 2);
      if (new Date() < twoYearMark) {
        throw new UnprocessableEntityException(
          'Landlords may request termination only after 2 years of the tenancy',
        );
      }
    }

    const initiatorLabel = isLandlord ? 'The landlord' : 'The tenant';
    const otherPartyId = isLandlord ? agreement.tenantId : agreement.landlordId;

    const result = await this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.termination_requested,
        terminationReason: dto.reason.trim(),
      },
      include: {
        property: { select: { id: true, title: true, status: true } },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    this.notifications
      .notifyMany([
        {
          userId: otherPartyId,
          title: 'Termination requested',
          message: `${initiatorLabel} has requested termination of the agreement for "${agreement.property.title}".`,
          type: 'warning',
          category: 'agreement',
          link: `/dashboard/agreements/${agreement.id}`,
        },
      ])
      .catch(() => undefined);

    this.notifications
      .adminIdsForSubCity(agreement.property.subCity)
      .then((adminIds) =>
        this.notifications.notifyMany(
          adminIds.map((aId) => ({
            userId: aId,
            title: 'Termination request submitted',
            message: `${initiatorLabel} requested termination for "${agreement.property.title}". Reason: ${dto.reason.trim().slice(0, 200)}`,
            type: 'info' as const,
            category: 'agreement' as const,
            link: `/agreements/${agreement.id}`,
          })),
        ),
      )
      .catch(() => undefined);

    return result;
  }

  async requestExtension(
    id: string,
    landlordId: string,
    dto: RequestExtensionDto,
  ) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        tenantId: true,
        status: true,
        endDate: true,
        property: { select: { title: true, subCity: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.landlordId !== landlordId) {
      throw new ForbiddenException('Only the landlord can request an extension');
    }
    if (!ACTIVE_TENANCY_STATUSES.includes(agreement.status)) {
      throw new UnprocessableEntityException(
        'Extensions can only be requested for active tenancies',
      );
    }

    const proposedEnd = new Date(dto.newEndDate);
    if (proposedEnd <= agreement.endDate) {
      throw new UnprocessableEntityException(
        'Proposed end date must be after the current end date',
      );
    }

    const result = await this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.extension_requested,
        proposedEndDate: proposedEnd,
        proposedMonthlyRent:
          dto.newMonthlyRent != null
            ? new Prisma.Decimal(dto.newMonthlyRent)
            : null,
        terminationReason: dto.reference?.trim() || null,
      },
      include: {
        property: { select: { id: true, title: true, status: true } },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    this.notifications
      .notifyMany([
        {
          userId: agreement.tenantId,
          title: 'Extension requested',
          message: `Your landlord has requested to extend the tenancy for "${agreement.property.title}". The authority will review the request.`,
          type: 'info',
          category: 'agreement',
          link: `/dashboard/agreements/${agreement.id}`,
        },
      ])
      .catch(() => undefined);

    this.notifications
      .adminIdsForSubCity(agreement.property.subCity)
      .then((adminIds) =>
        this.notifications.notifyMany(
          adminIds.map((aId) => ({
            userId: aId,
            title: 'Extension request submitted',
            message: `A landlord requested an extension for "${agreement.property.title}".`,
            type: 'info' as const,
            category: 'agreement' as const,
            link: `/agreements/${agreement.id}`,
          })),
        ),
      )
      .catch(() => undefined);

    return result;
  }

  async reviewTerminationRequest(
    id: string,
    userId: string,
    role: UserRole,
    dto: ReviewPendingRequestDto,
  ) {
    if (!isAdminRole(role)) {
      throw new ForbiddenException('Only authority users can review termination requests');
    }
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);

    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        propertyId: true,
        landlordId: true,
        tenantId: true,
        status: true,
        terminationReason: true,
        property: { select: { title: true, subCity: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    assertSubCityInScope(adminScope, agreement.property.subCity);
    if (agreement.status !== AgreementStatus.termination_requested) {
      throw new UnprocessableEntityException('Agreement is not awaiting termination review');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenancyAgreement.update({
        where: { id },
        data: dto.approved
          ? {
              status: AgreementStatus.terminated,
              terminatedAt: new Date(),
              terminationReason:
                dto.reason?.trim() ||
                agreement.terminationReason ||
                'Termination approved by authority',
            }
          : {
              status: AgreementStatus.active,
              terminationReason: dto.reason?.trim() || null,
            },
        include: {
          property: { select: { id: true, title: true, status: true } },
          landlord: { select: { id: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (dto.approved) {
        await tx.property.update({
          where: { id: agreement.propertyId },
          data: { status: PropertyStatus.available },
        });
      }

      return updated;
    });

    const message = dto.approved
      ? `Termination of "${agreement.property.title}" was approved by the authority.`
      : `Termination request for "${agreement.property.title}" was rejected. The tenancy remains active.`;

    this.notifications
      .notifyMany([
        { userId: agreement.landlordId, title: 'Termination review complete', message, type: dto.approved ? 'warning' : 'info', category: 'agreement', link: `/dashboard/agreements/${id}` },
        { userId: agreement.tenantId, title: 'Termination review complete', message, type: dto.approved ? 'warning' : 'info', category: 'agreement', link: `/dashboard/agreements/${id}` },
      ])
      .catch(() => undefined);

    return result;
  }

  async reviewExtensionRequest(
    id: string,
    userId: string,
    role: UserRole,
    dto: ReviewPendingRequestDto,
  ) {
    if (!isAdminRole(role)) {
      throw new ForbiddenException('Only authority users can review extension requests');
    }
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);

    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        tenantId: true,
        status: true,
        proposedEndDate: true,
        proposedMonthlyRent: true,
        property: { select: { title: true, subCity: true } },
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    assertSubCityInScope(adminScope, agreement.property.subCity);
    if (agreement.status !== AgreementStatus.extension_requested) {
      throw new UnprocessableEntityException('Agreement is not awaiting extension review');
    }

    const result = await this.prisma.tenancyAgreement.update({
      where: { id },
      data: dto.approved
        ? {
            status: AgreementStatus.extended,
            endDate: agreement.proposedEndDate ?? undefined,
            monthlyRent: agreement.proposedMonthlyRent ?? undefined,
            proposedEndDate: null,
            proposedMonthlyRent: null,
            terminationReason: null,
          }
        : {
            status: AgreementStatus.active,
            proposedEndDate: null,
            proposedMonthlyRent: null,
            terminationReason: dto.reason?.trim() || null,
          },
      include: {
        property: { select: { id: true, title: true, status: true } },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const message = dto.approved
      ? `Extension for "${agreement.property.title}" was approved by the authority.`
      : `Extension request for "${agreement.property.title}" was rejected.`;

    this.notifications
      .notifyMany([
        { userId: agreement.landlordId, title: 'Extension review complete', message, type: dto.approved ? 'success' : 'warning', category: 'agreement', link: `/dashboard/agreements/${id}` },
        { userId: agreement.tenantId, title: 'Extension review complete', message, type: dto.approved ? 'success' : 'warning', category: 'agreement', link: `/dashboard/agreements/${id}` },
      ])
      .catch(() => undefined);

    return result;
  }
}
