import {
  AgreementStatus,
  Prisma,
  RentAdjustmentStatus,
  UserRole,
} from '@prisma/client';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRentAdjustmentDto } from './dto/create-rent-adjustment.dto';
import { ListRentAdjustmentsDto } from './dto/list-rent-adjustments.dto';
import { ReviewRentAdjustmentDto } from './dto/review-rent-adjustment.dto';

@Injectable()
export class RentAdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRentAdjustmentDto) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id: dto.agreementId },
      select: {
        id: true,
        landlordId: true,
        monthlyRent: true,
        status: true,
      },
    });
    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.landlordId !== userId) {
      throw new ForbiddenException(
        'Only agreement landlord can request rent adjustments',
      );
    }
    if (
      agreement.status !== AgreementStatus.active &&
      agreement.status !== AgreementStatus.extended
    ) {
      throw new UnprocessableEntityException(
        'Agreement must be active or extended for rent adjustment',
      );
    }

    const currentRent = Number(agreement.monthlyRent);
    if (dto.proposedRent <= currentRent) {
      throw new UnprocessableEntityException(
        'Proposed rent must be greater than current rent',
      );
    }

    const increasePercentage =
      ((dto.proposedRent - currentRent) / currentRent) * 100;
    const maxAllowedPercentage = 7;

    return this.prisma.rentAdjustment.create({
      data: {
        agreementId: agreement.id,
        landlordId: userId,
        currentRent: new Prisma.Decimal(currentRent),
        proposedRent: new Prisma.Decimal(dto.proposedRent),
        increasePercentage: new Prisma.Decimal(increasePercentage),
        maxAllowedPercentage: new Prisma.Decimal(maxAllowedPercentage),
        reason: dto.reason,
        status: RentAdjustmentStatus.pending,
      },
      include: {
        agreement: {
          select: { id: true, status: true, propertyId: true, tenantId: true },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
  }

  async list(userId: string, role: UserRole, query: ListRentAdjustmentsDto) {
    const where: Prisma.RentAdjustmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };

    const isAuthority =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;

    if (!isAuthority) {
      where.landlordId = userId;
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const items = await this.prisma.rentAdjustment.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        agreement: {
          select: {
            id: true,
            status: true,
            property: { select: { id: true, title: true, address: true } },
          },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
    const total = await this.prisma.rentAdjustment.count({ where });

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

  async review(
    id: string,
    reviewerId: string,
    role: UserRole,
    dto: ReviewRentAdjustmentDto,
  ) {
    const isAuthority =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;
    if (!isAuthority) {
      throw new ForbiddenException(
        'Only authority users can review rent adjustments',
      );
    }

    const adjustment = await this.prisma.rentAdjustment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        proposedRent: true,
        agreementId: true,
      },
    });
    if (!adjustment) {
      throw new NotFoundException('Rent adjustment not found');
    }
    if (adjustment.status !== RentAdjustmentStatus.pending) {
      throw new UnprocessableEntityException(
        'Only pending rent adjustments can be reviewed',
      );
    }
    if (
      dto.status !== RentAdjustmentStatus.approved &&
      dto.status !== RentAdjustmentStatus.rejected &&
      dto.status !== RentAdjustmentStatus.under_review
    ) {
      throw new UnprocessableEntityException(
        'Review status must be approved, rejected, or under_review',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rentAdjustment.update({
        where: { id },
        data: {
          status: dto.status,
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
          reviewNotes: dto.reviewNotes,
        },
        include: {
          agreement: {
            select: {
              id: true,
              status: true,
              property: { select: { id: true, title: true, address: true } },
            },
          },
          landlord: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
        },
      });

      if (dto.status === RentAdjustmentStatus.approved) {
        await tx.tenancyAgreement.update({
          where: { id: adjustment.agreementId },
          data: { monthlyRent: adjustment.proposedRent },
        });
      }

      return updated;
    });
  }
}
