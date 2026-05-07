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
import { ListAgreementsDto } from './dto/list-agreements.dto';
import { ReviewAgreementDto } from './dto/review-agreement.dto';

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

  async listForUser(userId: string, role: UserRole, query: ListAgreementsDto) {
    const where: Prisma.TenancyAgreementWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(role === UserRole.landlord ? { landlordId: userId } : {}),
      ...(role === UserRole.tenant ? { tenantId: userId } : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenancyAgreement.findMany({
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
      }),
      this.prisma.tenancyAgreement.count({ where }),
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
