import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementStatus,
  Prisma,
  PropertyStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ListPropertiesDto } from './dto/list-properties.dto';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

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

    const property = await this.prisma.property.create({
      data: {
        ...dto,
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

    return property;
  }

  async findAll(userId: string, role: UserRole, query: ListPropertiesDto) {
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
      },
    });

    if (!property || property.deletedAt) {
      throw new NotFoundException('Property not found');
    }

    if (role === UserRole.landlord && property.landlordId !== userId) {
      throw new ForbiddenException('You cannot access this property');
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
}
