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
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.pending_verification,
        landlordSignedAt: agreement.landlordSignedAt ?? new Date(),
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
  }

  async listForUser(userId: string, role: UserRole, query: ListAgreementsDto) {
    const search = query.search?.trim();
    const where: Prisma.TenancyAgreementWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(role === UserRole.landlord ? { landlordId: userId } : {}),
      ...(role === UserRole.tenant ? { tenantId: userId } : {}),
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

    const isAdmin =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;
    const isParty =
      agreement.landlordId === userId || agreement.tenantId === userId;
    if (!isAdmin && !isParty) {
      throw new ForbiddenException('You cannot access this agreement');
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

    return this.prisma.tenancyAgreement.update({
      where: { id },
      data: {
        status: AgreementStatus.pending_verification,
        tenantSignedAt: agreement.tenantSignedAt ?? new Date(),
      },
      include: {
        property: { select: { id: true, title: true, status: true } },
        landlord: { select: { id: true, firstName: true, lastName: true } },
        tenant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async reviewByAuthority(id: string, role: UserRole, dto: ReviewAgreementDto) {
    const isAuthority =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;
    if (!isAuthority) {
      throw new ForbiddenException(
        'Only authority users can review agreements',
      );
    }

    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id },
      select: { id: true, propertyId: true, status: true },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
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

    return result;
  }
}
