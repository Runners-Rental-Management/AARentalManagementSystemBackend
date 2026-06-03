import { AgreementStatus } from '@prisma/client';

/** Statuses that follow authority verification (verifiedAt is set on approval). */
const POST_VERIFICATION_STATUSES: AgreementStatus[] = [
  AgreementStatus.pending_payment,
  AgreementStatus.active,
  AgreementStatus.extended,
  AgreementStatus.extension_requested,
  AgreementStatus.termination_requested,
  AgreementStatus.terminated,
  AgreementStatus.expired,
];

export type AgreementPartyContact = {
  fullName: string;
  phone: string;
  address: string;
};

export type AgreementContactsPayload = {
  landlord: AgreementPartyContact;
  tenant: AgreementPartyContact;
};

type ContactUserFields = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string | null;
};

export function isAgreementContactsUnlocked(
  verifiedAt: Date | null | undefined,
  status: AgreementStatus,
): boolean {
  if (verifiedAt != null) {
    return true;
  }
  return POST_VERIFICATION_STATUSES.includes(status);
}

/** Landlord/tenant: after verification. Authority officials: anytime they can view the agreement. */
export function shouldExposeAgreementContacts(
  verifiedAt: Date | null | undefined,
  status: AgreementStatus,
  options: { isAdmin: boolean; isParty: boolean },
): boolean {
  if (options.isAdmin) {
    return true;
  }
  if (!options.isParty) {
    return false;
  }
  return isAgreementContactsUnlocked(verifiedAt, status);
}

function partyContact(user: ContactUserFields): AgreementPartyContact {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const address = user.address?.trim();
  return {
    fullName: fullName || '—',
    phone: user.phone,
    address: address && address.length > 0 ? address : 'Not provided',
  };
}

export function buildAgreementContacts(
  landlord: ContactUserFields,
  tenant: ContactUserFields,
): AgreementContactsPayload {
  return {
    landlord: partyContact(landlord),
    tenant: partyContact(tenant),
  };
}

/** Strip sensitive user fields; optionally attach contacts after verification. */
export function formatAgreementDetailForClient<
  T extends {
    verifiedAt: Date | null;
    status: AgreementStatus;
    landlord: ContactUserFields;
    tenant: ContactUserFields;
  },
>(agreement: T, exposeContacts: boolean) {
  const { landlord, tenant, ...rest } = agreement;

  const sanitized = {
    ...rest,
    landlord: {
      id: landlord.id,
      firstName: landlord.firstName,
      lastName: landlord.lastName,
    },
    tenant: {
      id: tenant.id,
      firstName: tenant.firstName,
      lastName: tenant.lastName,
    },
    contactsAvailable: exposeContacts,
  };

  if (!exposeContacts) {
    return sanitized;
  }

  return {
    ...sanitized,
    contacts: buildAgreementContacts(landlord, tenant),
  };
}
