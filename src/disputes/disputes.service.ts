import { DisputeStatus, PriorityLevel, Prisma, UserRole } from '@prisma/client';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ListDisputesDto } from './dto/list-disputes.dto';
import { ReviewDisputeDto } from './dto/review-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.dispute.create({
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
          select: { id: true, title: true, address: true },
        },
        reporter: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondent: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
  }

  async list(userId: string, role: UserRole, query: ListDisputesDto) {
    const where: Prisma.DisputeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.violationType ? { violationType: query.violationType } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
    };

    const isAuthority =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;

    if (!isAuthority) {
      where.OR = [{ reporterId: userId }, { respondentId: userId }];
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }],
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
      }),
      this.prisma.dispute.count({ where }),
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
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        agreement: { select: { id: true, status: true, propertyId: true } },
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

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const isAuthority =
      role === UserRole.admin ||
      role === UserRole.system_admin ||
      role === UserRole.dara_agent;
    const isParty =
      dispute.reporterId === userId || dispute.respondentId === userId;
    if (!isAuthority && !isParty) {
      throw new ForbiddenException('You cannot access this dispute');
    }

    return dispute;
  }

  async review(id: string, actorRole: UserRole, dto: ReviewDisputeDto) {
    const isAuthority =
      actorRole === UserRole.admin ||
      actorRole === UserRole.system_admin ||
      actorRole === UserRole.dara_agent;
    if (!isAuthority) {
      throw new ForbiddenException('Only authority users can review disputes');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

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
      const allowedAssignee =
        assignee.role === UserRole.admin ||
        assignee.role === UserRole.system_admin ||
        assignee.role === UserRole.dara_agent;
      if (!allowedAssignee) {
        throw new UnprocessableEntityException(
          'Assigned user must be an authority user',
        );
      }
    }

    return this.prisma.dispute.update({
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
  }
}
