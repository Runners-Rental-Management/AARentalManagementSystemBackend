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
import {
  assertSubCityInScope,
  getAdminLocationScope,
  isAdminRole,
  requireAdminLocationScope,
  scopedPropertyWhere,
} from '../auth/admin-location-scope';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRentAdjustmentDto } from './dto/create-rent-adjustment.dto';
import { ListRentAdjustmentsDto } from './dto/list-rent-adjustments.dto';
import { ReviewRentAdjustmentDto } from './dto/review-rent-adjustment.dto';

@Injectable()
export class RentAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

    const created = await this.prisma.rentAdjustment.create({
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
          select: {
            id: true,
            status: true,
            propertyId: true,
            tenantId: true,
            property: { select: { title: true, subCity: true } },
          },
        },
        landlord: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    // Notify tenant + admins
    this.notifications
      .adminIdsForSubCity(created.agreement.property.subCity)
      .then((adminIds) => {
        const payloads = [
          {
            userId: created.agreement.tenantId,
            title: 'Rent adjustment request',
            message: `Your landlord has requested a rent increase for "${created.agreement.property.title}" to ETB ${dto.proposedRent}/mo.`,
            type: 'warning' as const,
            category: 'rent_adjustment' as const,
            link: `/dashboard/agreements/${created.agreementId}`,
          },
          ...adminIds.map((aId) => ({
            userId: aId,
            title: 'New rent adjustment pending review',
            message: `A rent adjustment request was submitted for "${created.agreement.property.title}".`,
            type: 'info' as const,
            category: 'rent_adjustment' as const,
            link: `/rent-adjustments/${created.id}`,
          })),
        ];
        return this.notifications.notifyMany(payloads);
      })
      .catch(() => undefined);

    return created;
  }

  async list(userId: string, role: UserRole, query: ListRentAdjustmentsDto) {
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    const where: Prisma.RentAdjustmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(adminScope
        ? { agreement: { property: scopedPropertyWhere(adminScope) } }
        : {}),
    };

    const isAuthority = isAdminRole(role);

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
            property: {
              select: { id: true, title: true, address: true, subCity: true },
            },
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
    if (!isAdminRole(role)) {
      throw new ForbiddenException(
        'Only authority users can review rent adjustments',
      );
    }
    const adminScope = await requireAdminLocationScope(
      this.prisma,
      reviewerId,
      role,
    );

    const adjustment = await this.prisma.rentAdjustment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        proposedRent: true,
        agreementId: true,
        agreement: { select: { property: { select: { subCity: true } } } },
      },
    });
    if (!adjustment) {
      throw new NotFoundException('Rent adjustment not found');
    }
    assertSubCityInScope(adminScope, adjustment.agreement.property.subCity);
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

    const result = await this.prisma.$transaction(async (tx) => {
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

    // Fetch tenant id to notify
    const fullAgreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id: adjustment.agreementId },
      select: { tenantId: true },
    });

    const approved = dto.status === RentAdjustmentStatus.approved;
    const parties: string[] = [result.landlordId];
    if (fullAgreement?.tenantId) parties.push(fullAgreement.tenantId);

    this.notifications
      .notifyMany(
        parties.map((uid, i) => ({
          userId: uid,
          title: approved
            ? 'Rent adjustment approved'
            : dto.status === RentAdjustmentStatus.rejected
              ? 'Rent adjustment rejected'
              : 'Rent adjustment under review',
          message: approved
            ? `The rent adjustment for "${result.agreement.property.title}" has been approved.${i === 1 ? ' Your new rent is ETB ' + Number(adjustment.proposedRent) + '/mo.' : ''}`
            : `The rent adjustment for "${result.agreement.property.title}" was ${dto.status.replace(/_/g, ' ')}.`,
          type: approved ? ('success' as const) : ('warning' as const),
          category: 'rent_adjustment' as const,
          link: `/dashboard/agreements/${result.agreementId}`,
        })),
      )
      .catch(() => undefined);

    return result;
  }
}
