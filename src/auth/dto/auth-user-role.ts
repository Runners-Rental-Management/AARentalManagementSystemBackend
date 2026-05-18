export const authUserRoles = [
  'tenant',
  'landlord',
  'admin',
  'dara_agent',
  'system_admin',
] as const;

export type AuthUserRole = (typeof authUserRoles)[number];
