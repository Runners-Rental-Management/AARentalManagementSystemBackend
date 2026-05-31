export const authUserRoles = [
  'tenant',
  'landlord',
  'admin',
] as const;

export type AuthUserRole = (typeof authUserRoles)[number];
