import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AdminLocationScope = {
  allLocations: boolean;
  subCities: string[];
};

export function isAdminRole(role: UserRole) {
  return role === UserRole.admin;
}

export async function getAdminLocationScope(
  prisma: PrismaService,
  userId: string,
  role: UserRole,
): Promise<AdminLocationScope | null> {
  if (!isAdminRole(role)) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      adminAllLocations: true,
      adminSubCities: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new ForbiddenException('Admin account is not active');
  }

  return {
    allLocations: user.adminAllLocations,
    subCities: user.adminSubCities,
  };
}

export async function requireAdminLocationScope(
  prisma: PrismaService,
  userId: string,
  role: UserRole,
) {
  const scope = await getAdminLocationScope(prisma, userId, role);
  if (!scope) throw new ForbiddenException('Only admins can access this action');
  return scope;
}

export function scopedPropertyWhere(
  scope: AdminLocationScope | null,
): Prisma.PropertyWhereInput {
  if (!scope || scope.allLocations) return {};
  if (scope.subCities.length === 0) return { id: { equals: '__no_scope__' } };
  return { subCity: { in: scope.subCities, mode: 'insensitive' } };
}

export function assertSubCityInScope(
  scope: AdminLocationScope,
  subCity: string,
) {
  if (scope.allLocations) return;
  const allowed = scope.subCities.some(
    (item) => item.toLowerCase() === subCity.toLowerCase(),
  );
  if (!allowed) {
    throw new ForbiddenException('You cannot access this sub-city');
  }
}
