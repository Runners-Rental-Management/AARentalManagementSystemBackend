import { DisputeStatus, PriorityLevel, Prisma, UserRole } from '@prisma/client';
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
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ListDisputesDto } from './dto/list-disputes.dto';
import { ReviewDisputeDto } from './dto/review-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, role: UserRole, dto: CreateDisputeDto) {
    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id: dto.agreementId },
      select: {
        id: true,
        propertyId: true,
        landlordId: true,
        tenantId: true,
        status: true,
      },
    });

    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }

    const isLandlord = agreement.landlordId === userId;
    const isTenant = agreement.tenantId === userId;
    if (!isLandlord && !isTenant) {
      throw new ForbiddenException('Only agreement parties can file disputes');
    }
    if (role !== UserRole.landlord && role !== UserRole.tenant) {
      throw new ForbiddenException(
        'Only landlord/tenant users can file disputes',
      );
    }

    const respondentId = isLandlord ? agreement.tenantId : agreement.landlordId;

    const dispute = await this.prisma.dispute.create({
      data: {
        agreementId: agreement.id,
        propertyId: agreement.propertyId,
        reporterId: userId,
        respondentId,
        violationType: dto.violationType,
        title: dto.title,
        description: dto.description,
        evidence: dto.evidence,
        priority: dto.priority ?? PriorityLevel.medium,
        status: DisputeStatus.open,
      },
      include: {
        agreement: {
          select: { id: true, status: true, propertyId: true },
        },
        property: {
          select: { id: true, title: true, address: true, subCity: true },
        },
        reporter: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondent: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    // Notify respondent + admins
    this.notifications
      .adminIdsForSubCity(dispute.property.subCity)
      .then((adminIds) => {
        const payloads = [
          {
            userId: respondentId,
            title: 'A dispute has been filed against you',
            message: `A dispute titled "${dto.title}" has been filed regarding "${dispute.property.title}".`,
            type: 'warning' as const,
            category: 'dispute' as const,
            link: `/dashboard/disputes/${dispute.id}`,
          },
          ...adminIds.map((aId) => ({
            userId: aId,
            title: 'New dispute filed',
            message: `A new dispute "${dto.title}" was filed for a property in ${dispute.property.subCity}.`,
            type: 'info' as const,
            category: 'dispute' as const,
            link: `/disputes/${dispute.id}`,
          })),
        ];
        return this.notifications.notifyMany(payloads);
      })
      .catch(() => undefined);

    return dispute;
  }

  async list(userId: string, role: UserRole, query: ListDisputesDto) {
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    const where: Prisma.DisputeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.violationType ? { violationType: query.violationType } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(adminScope ? { property: scopedPropertyWhere(adminScope) } : {}),
    };

    const isAuthority = isAdminRole(role);

    if (!isAuthority) {
      where.OR = [{ reporterId: userId }, { respondentId: userId }];
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const items = await this.prisma.dispute.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        agreement: { select: { id: true, status: true } },
        property: { select: { id: true, title: true, address: true, subCity: true } },
        reporter: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondent: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
    const total = await this.prisma.dispute.count({ where });

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
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        agreement: { select: { id: true, status: true, propertyId: true } },
        property: { select: { id: true, title: true, address: true, subCity: true } },
        reporter: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondent: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const isAuthority = isAdminRole(role);
    const isParty =
      dispute.reporterId === userId || dispute.respondentId === userId;
    if (!isAuthority && !isParty) {
      throw new ForbiddenException('You cannot access this dispute');
    }
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    if (adminScope) {
      assertSubCityInScope(adminScope, dispute.property.subCity);
    }

    return dispute;
  }

  async review(
    id: string,
    actorId: string,
    actorRole: UserRole,
    dto: ReviewDisputeDto,
  ) {
    if (!isAdminRole(actorRole)) {
      throw new ForbiddenException('Only authority users can review disputes');
    }
    const adminScope = await requireAdminLocationScope(
      this.prisma,
      actorId,
      actorRole,
    );

    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        property: { select: { subCity: true } },
      },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }
    assertSubCityInScope(adminScope, dispute.property.subCity);

    if (
      dispute.status === DisputeStatus.closed ||
      dispute.status === DisputeStatus.resolved
    ) {
      throw new UnprocessableEntityException('Dispute is already finalized');
    }

    if (dto.assignedToId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: dto.assignedToId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!assignee || assignee.deletedAt) {
        throw new NotFoundException('Assigned user not found');
      }
      const allowedAssignee = assignee.role === UserRole.admin;
      if (!allowedAssignee) {
        throw new UnprocessableEntityException(
          'Assigned user must be an authority user',
        );
      }
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: dto.status,
        assignedToId: dto.assignedToId,
        priority: dto.priority,
        resolution: dto.resolution,
        resolvedAt:
          dto.status === DisputeStatus.resolved ||
          dto.status === DisputeStatus.closed
            ? new Date()
            : null,
      },
      include: {
        agreement: { select: { id: true, status: true } },
        property: { select: { id: true, title: true, address: true } },
        reporter: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondent: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });

    const statusLabel = dto.status.replace(/_/g, ' ');
    this.notifications
      .notifyMany([
        {
          userId: updated.reporterId,
          title: `Dispute status updated`,
          message: `Your dispute "${updated.title}" is now "${statusLabel}".${dto.resolution ? ' Resolution: ' + dto.resolution : ''}`,
          type: dto.status === DisputeStatus.resolved ? 'success' : 'info',
          category: 'dispute',
          link: `/dashboard/disputes/${updated.id}`,
        },
        {
          userId: updated.respondentId,
          title: `Dispute status updated`,
          message: `The dispute "${updated.title}" filed against you is now "${statusLabel}".`,
          type: dto.status === DisputeStatus.resolved ? 'success' : 'info',
          category: 'dispute',
          link: `/dashboard/disputes/${updated.id}`,
        },
      ])
      .catch(() => undefined);

    return updated;
  }
}
