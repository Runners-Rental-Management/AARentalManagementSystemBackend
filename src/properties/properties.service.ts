import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgreementStatus,
  Prisma,
  PropertyStatus,
  RelatedEntityType,
  UserRole,
} from '@prisma/client';
import {
  assertSubCityInScope,
  getAdminLocationScope,
  isAdminRole,
  requireAdminLocationScope,
  scopedPropertyWhere,
} from '../auth/admin-location-scope';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ListPropertiesDto } from './dto/list-properties.dto';
import { ReviewPropertyDto } from './dto/review-property.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findPublic(query: ListPropertiesDto) {
    const where: Prisma.PropertyWhereInput = {
      deletedAt: null,
      status: PropertyStatus.available,
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      ...(query.subCity
        ? { subCity: { equals: query.subCity, mode: 'insensitive' } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { address: { contains: query.search, mode: 'insensitive' } },
              { subCity: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.minRent
        ? { monthlyRent: { gte: new Prisma.Decimal(query.minRent) } }
        : {}),
      ...(query.maxRent
        ? { monthlyRent: { lte: new Prisma.Decimal(query.maxRent) } }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const items = await this.prisma.property.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        landlord: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
    const total = await this.prisma.property.count({ where });

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

  async create(userId: string, role: UserRole, dto: CreatePropertyDto) {
    if (role !== UserRole.landlord) {
      throw new ForbiddenException('Only landlords can register properties');
    }

    const { ownershipDocuments, ...propertyData } = dto;

    const property = await this.prisma.property.create({
      data: {
        ...propertyData,
        landlordId: userId,
        status: PropertyStatus.pending_verification,
        area: new Prisma.Decimal(dto.area),
        monthlyRent: new Prisma.Decimal(dto.monthlyRent),
      },
      include: {
        landlord: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (ownershipDocuments?.length) {
      await this.prisma.supportingDocument.createMany({
        data: ownershipDocuments.map((doc) => ({
          uploaderId: userId,
          relatedEntityType: RelatedEntityType.property,
          relatedEntityId: property.id,
          propertyId: property.id,
          fileName: doc.fileName,
          fileType: doc.fileType,
          fileSize: doc.fileSize,
          storageKey: doc.url,
          description: doc.description ?? 'Proof of ownership',
        })),
      });
    }

    // Notify all admins who cover this sub-city
    this.notifications
      .adminIdsForSubCity(property.subCity)
      .then((adminIds) =>
        this.notifications.notifyMany(
          adminIds.map((id) => ({
            userId: id,
            title: 'New property pending verification',
            message: `"${property.title}" in ${property.subCity} requires review.`,
            type: 'info' as const,
            category: 'verification' as const,
            link: `/properties/${property.id}`,
          })),
        ),
      )
      .catch(() => undefined);

    return property;
  }

  async findAll(userId: string, role: UserRole, query: ListPropertiesDto) {
    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    const baseWhere: Prisma.PropertyWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      ...(query.subCity
        ? { subCity: { equals: query.subCity, mode: 'insensitive' } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { address: { contains: query.search, mode: 'insensitive' } },
              { subCity: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.minRent
        ? { monthlyRent: { gte: new Prisma.Decimal(query.minRent) } }
        : {}),
      ...(query.maxRent
        ? { monthlyRent: { lte: new Prisma.Decimal(query.maxRent) } }
        : {}),
    };

    const where: Prisma.PropertyWhereInput = { ...baseWhere };

    if (role === UserRole.landlord) {
      where.landlordId = userId;
    } else if (role === UserRole.tenant) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];

      where.AND = [
        ...existingAnd,
        {
          OR: [
            { status: PropertyStatus.available },
            {
              agreements: {
                some: {
                  tenantId: userId,
                  status: {
                    in: [
                      AgreementStatus.pending_tenant_signature,
                      AgreementStatus.pending_verification,
                      AgreementStatus.pending_dara_verification,
                      AgreementStatus.active,
                      AgreementStatus.extended,
                    ],
                  },
                },
              },
            },
          ],
        },
      ];
    } else if (adminScope) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, scopedPropertyWhere(adminScope)];
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const items = await this.prisma.property.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        landlord: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
    });
    const total = await this.prisma.property.count({ where });

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

  async findOne(id: string, userId: string, role: UserRole) {
    const isAdmin = isAdminRole(role);
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        landlord: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            role: true,
          },
        },
        // Include ownership documents for admin reviewers
        documents: isAdmin
          ? {
              select: {
                id: true,
                fileName: true,
                fileType: true,
                fileSize: true,
                storageKey: true,
                description: true,
                uploadedAt: true,
              },
            }
          : false,
      },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }

    if (role === UserRole.landlord && property.landlordId !== userId) {
      throw new ForbiddenException('You cannot access this property');
    }

    const adminScope = await getAdminLocationScope(this.prisma, userId, role);
    if (adminScope) {
      assertSubCityInScope(adminScope, property.subCity);
    }

    if (role === UserRole.tenant) {
      const hasAgreement = await this.prisma.tenancyAgreement.findFirst({
        where: {
          propertyId: id,
          tenantId: userId,
          status: {
            in: [
              AgreementStatus.pending_tenant_signature,
              AgreementStatus.pending_verification,
              AgreementStatus.pending_dara_verification,
              AgreementStatus.active,
              AgreementStatus.extended,
            ],
          },
        },
        select: { id: true },
      });

      if (property.status !== PropertyStatus.available && !hasAgreement) {
        throw new ForbiddenException('You cannot access this property');
      }
    }

    return property;
  }

  async reviewProperty(
    id: string,
    userId: string,
    role: UserRole,
    dto: ReviewPropertyDto,
  ) {
    if (!isAdminRole(role)) {
      throw new ForbiddenException('Only authority users can review properties');
    }
    const adminScope = await requireAdminLocationScope(this.prisma, userId, role);

    const property = await this.prisma.property.findUnique({
      where: { id },
      select: { id: true, status: true, subCity: true, deletedAt: true },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }
    assertSubCityInScope(adminScope, property.subCity);

    if (property.status !== PropertyStatus.pending_verification) {
      throw new UnprocessableEntityException(
        'Only pending properties can be reviewed',
      );
    }

    if (
      dto.status !== PropertyStatus.available &&
      dto.status !== PropertyStatus.rejected
    ) {
      throw new UnprocessableEntityException(
        'Review status must be available or rejected',
      );
    }

    const approved = dto.status === PropertyStatus.available;

    const updated = await this.prisma.property.update({
      where: { id },
      data: {
        status: dto.status,
        verifiedAt: approved ? new Date() : null,
        ...(approved
          ? {
              isPostedToExplore: true,
              postedToExploreAt: new Date(),
            }
          : {}),
      },
      include: {
        landlord: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            role: true,
          },
        },
      },
    });

    this.notifications
      .notifyUser({
        userId: updated.landlordId,
        title: approved ? 'Property approved' : 'Property listing rejected',
        message: approved
          ? `Your property "${updated.title}" has been approved and is now listed on Explore.`
          : `Your property "${updated.title}" was not approved.${dto.rejectionReason ? ` Reason: ${dto.rejectionReason}` : ' Please review and resubmit.'}`,
        type: approved ? 'success' : 'warning',
        category: 'verification',
        link: `/dashboard/properties/${updated.id}`,
      })
      .catch(() => undefined);

    return updated;
  }

  async postToExplore(id: string, userId: string, role: UserRole) {
    if (role !== UserRole.landlord) {
      throw new ForbiddenException(
        'Only landlords can post properties to explore',
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { id },
      select: {
        id: true,
        landlordId: true,
        status: true,
        deletedAt: true,
        isPostedToExplore: true,
      },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }

    if (property.landlordId !== userId) {
      throw new ForbiddenException('You cannot post this property');
    }

    if (property.status !== PropertyStatus.available) {
      throw new UnprocessableEntityException(
        'Only approved available properties can be posted to explore',
      );
    }

    if (property.isPostedToExplore) {
      return this.findOne(id, userId, role);
    }

    await this.prisma.property.update({
      where: { id },
      data: {
        isPostedToExplore: true,
        postedToExploreAt: new Date(),
      },
    });

    return this.findOne(id, userId, role);
  }
}
