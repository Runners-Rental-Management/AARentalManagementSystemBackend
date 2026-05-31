import 'dotenv/config';
import {
  AgreementStatus,
  Prisma,
  PrismaClient,
  PropertyStatus,
  PropertyType,
  UserRole,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run seed.');
}
if (databaseUrl.startsWith('prisma+postgres://')) {
  throw new Error(
    'Seed requires a direct postgresql:// URL because it uses the pg adapter.',
  );
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const ADDIS_SUB_CITIES = [
  'Addis Ketema',
  'Akaky Kaliti',
  'Arada',
  'Bole',
  'Gullele',
  'Kirkos',
  'Kolfe Keranio',
  'Lideta',
  'Nifas Silk-Lafto',
  'Yeka',
  'Lemi Kura',
];

function adminEmailForSubCity(subCity: string) {
  const slug = subCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `admin-${slug}@aarental.local`;
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash('Passw0rd!234', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@aarental.local' },
    update: {
      firstName: 'System',
      lastName: 'Admin',
      phone: '+251900000001',
      role: UserRole.admin,
      adminAllLocations: true,
      adminSubCities: [],
      isVerified: true,
      passwordHash,
    },
    create: {
      email: 'admin@aarental.local',
      firstName: 'System',
      lastName: 'Admin',
      phone: '+251900000001',
      role: UserRole.admin,
      adminAllLocations: true,
      adminSubCities: [],
      isVerified: true,
      passwordHash,
    },
  });

  for (const [index, subCity] of ADDIS_SUB_CITIES.entries()) {
    await prisma.user.upsert({
      where: { email: adminEmailForSubCity(subCity) },
      update: {
        firstName: subCity,
        lastName: 'Admin',
        phone: `+251900001${String(index).padStart(3, '0')}`,
        role: UserRole.admin,
        adminAllLocations: false,
        adminSubCities: [subCity],
        isVerified: true,
        passwordHash,
      },
      create: {
        email: adminEmailForSubCity(subCity),
        firstName: subCity,
        lastName: 'Admin',
        phone: `+251900001${String(index).padStart(3, '0')}`,
        role: UserRole.admin,
        adminAllLocations: false,
        adminSubCities: [subCity],
        isVerified: true,
        passwordHash,
      },
    });
  }

  const landlord = await prisma.user.upsert({
    where: { email: 'landlord@aarental.local' },
    update: {
      firstName: 'Abebe',
      lastName: 'Kebede',
      phone: '+251900000002',
      role: UserRole.landlord,
      isVerified: true,
      faydaNumber: '1234567890123456',
      faydaVerified: true,
      faydaVerifiedAt: new Date(),
      fatherName: 'Kebede',
      grandfatherName: 'Tesfaye',
      passwordHash,
    },
    create: {
      email: 'landlord@aarental.local',
      firstName: 'Abebe',
      lastName: 'Kebede',
      phone: '+251900000002',
      role: UserRole.landlord,
      isVerified: true,
      faydaNumber: '1234567890123456',
      faydaVerified: true,
      faydaVerifiedAt: new Date(),
      fatherName: 'Kebede',
      grandfatherName: 'Tesfaye',
      passwordHash,
    },
  });

  const tenant = await prisma.user.upsert({
    where: { email: 'tenant@aarental.local' },
    update: {
      firstName: 'Tigist',
      lastName: 'Haile',
      phone: '+251900000003',
      role: UserRole.tenant,
      isVerified: true,
      faydaNumber: '9876543210987654',
      faydaVerified: true,
      faydaVerifiedAt: new Date(),
      fatherName: 'Haile',
      grandfatherName: 'Mekonnen',
      passwordHash,
    },
    create: {
      email: 'tenant@aarental.local',
      firstName: 'Tigist',
      lastName: 'Haile',
      phone: '+251900000003',
      role: UserRole.tenant,
      isVerified: true,
      faydaNumber: '9876543210987654',
      faydaVerified: true,
      faydaVerifiedAt: new Date(),
      fatherName: 'Haile',
      grandfatherName: 'Mekonnen',
      passwordHash,
    },
  });

  return { admin, landlord, tenant };
}

async function seedProperties(landlordId: string) {
  const properties = [
    {
      title: 'Modern 2BR Apartment in Bole',
      address: 'Bole Atlas, Near Edna Mall',
      subCity: 'Bole',
      woreda: '03',
      propertyType: PropertyType.apartment,
      bedrooms: 2,
      bathrooms: 1,
      area: 85,
      amenities: ['Parking', 'Guard/Security', 'Water Tank', 'Elevator'],
      monthlyRent: 15000,
      status: PropertyStatus.available,
      isPostedToExplore: true,
      postedToExploreAt: new Date(),
      description:
        'A modern apartment in the heart of Bole with great amenities and easy access to transportation.',
      images: [
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
      ],
    },
    {
      title: 'Spacious 3BR House in Yeka',
      address: 'Megenagna Area, Behind Yeka Mall',
      subCity: 'Yeka',
      woreda: '12',
      propertyType: PropertyType.house,
      bedrooms: 3,
      bathrooms: 2,
      area: 150,
      amenities: ['Parking', 'Garden', 'Water Tank'],
      monthlyRent: 25000,
      status: PropertyStatus.pending_verification,
      description:
        'Spacious family home with a private garden and secure parking in a quiet residential area.',
      images: [
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
      ],
    },
  ];

  for (const property of properties) {
    const existing = await prisma.property.findFirst({
      where: { landlordId, title: property.title, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.property.update({
        where: { id: existing.id },
        data: property,
      });
      continue;
    }

    await prisma.property.create({
      data: {
        ...property,
        landlordId,
      },
    });
  }
}

async function seedSystemParameters(adminId: string) {
  const params = [
    {
      key: 'max_annual_rent_increase_percent',
      label: 'Max Annual Rent Increase (%)',
      value: '7',
      category: 'rental' as const,
      description:
        'Maximum percentage a landlord may increase rent per year across all agreements.',
    },
    {
      key: 'dispute_resolution_days',
      label: 'Dispute Resolution Deadline (days)',
      value: '30',
      category: 'compliance' as const,
      description:
        'Number of days within which an authority agent must resolve a dispute.',
    },
    {
      key: 'agreement_verification_days',
      label: 'Agreement Verification Deadline (days)',
      value: '7',
      category: 'compliance' as const,
      description:
        'Number of days within which an authority agent must review a pending agreement.',
    },
    {
      key: 'property_verification_days',
      label: 'Property Verification Deadline (days)',
      value: '14',
      category: 'compliance' as const,
      description:
        'Number of days within which an authority agent must verify a newly listed property.',
    },
    {
      key: 'max_advance_payment_months',
      label: 'Max Advance Payment (months)',
      value: '2',
      category: 'rental' as const,
      description:
        'Maximum number of months rent a landlord may collect as advance payment.',
    },
    {
      key: 'notification_email_enabled',
      label: 'Email Notifications Enabled',
      value: 'true',
      category: 'notification' as const,
      description: 'Whether to send email notifications for key events.',
    },
    {
      key: 'notification_sms_enabled',
      label: 'SMS Notifications Enabled',
      value: 'false',
      category: 'notification' as const,
      description: 'Whether to send SMS notifications for key events.',
    },
    {
      key: 'system_maintenance_mode',
      label: 'Maintenance Mode',
      value: 'false',
      category: 'system' as const,
      description:
        'When set to true, the platform shows a maintenance notice to non-admin users.',
    },
    {
      key: 'min_lease_duration_months',
      label: 'Minimum Lease Duration (months)',
      value: '6',
      category: 'rental' as const,
      description: 'Minimum number of months for a tenancy agreement.',
    },
    {
      key: 'max_lease_duration_months',
      label: 'Maximum Lease Duration (months)',
      value: '36',
      category: 'rental' as const,
      description: 'Maximum number of months for a tenancy agreement.',
    },
  ];

  for (const param of params) {
    await prisma.systemParameter.upsert({
      where: { key: param.key },
      update: { value: param.value, updatedById: adminId },
      create: { ...param, updatedById: adminId },
    });
  }
}

async function seedRentPayments(landlordId: string, tenantId: string) {
  const agreement = await prisma.tenancyAgreement.findFirst({
    where: {
      landlordId,
      tenantId,
      status: AgreementStatus.active,
    },
    select: { id: true, monthlyRent: true },
  });

  if (!agreement) return;

  const existing = await prisma.rentPayment.findFirst({
    where: {
      agreementId: agreement.id,
      status: 'pending',
    },
    select: { id: true },
  });
  if (existing) return;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);

  await prisma.rentPayment.create({
    data: {
      agreementId: agreement.id,
      payerId: tenantId,
      recipientId: landlordId,
      amount: agreement.monthlyRent,
      dueDate,
      status: 'pending',
    },
  });
}

async function seedActiveAgreement(landlordId: string, tenantId: string) {
  const property = await prisma.property.findFirst({
    where: {
      landlordId,
      title: 'Cozy 1BR Condo in Kazanchis',
      deletedAt: null,
    },
    select: { id: true, monthlyRent: true },
  });
  if (!property) return;

  const existing = await prisma.tenancyAgreement.findFirst({
    where: {
      propertyId: property.id,
      status: AgreementStatus.active,
    },
    select: { id: true },
  });
  if (existing) return;

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);
  const monthlyRent = Number(property.monthlyRent);

  await prisma.tenancyAgreement.create({
    data: {
      propertyId: property.id,
      landlordId,
      tenantId,
      monthlyRent: new Prisma.Decimal(monthlyRent),
      advancePayment: new Prisma.Decimal(monthlyRent * 2),
      startDate,
      endDate,
      utilities: ['Water', 'Electricity'],
      status: AgreementStatus.active,
      tenantSignedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      landlordSignedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      verifiedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.property.update({
    where: { id: property.id },
    data: { status: PropertyStatus.rented },
  });
}

async function seedAgreements(landlordId: string, tenantId: string) {
  const property = await prisma.property.findFirst({
    where: {
      landlordId,
      title: 'Modern 2BR Apartment in Bole',
      deletedAt: null,
    },
    select: { id: true, monthlyRent: true },
  });
  if (!property) return;

  const existing = await prisma.tenancyAgreement.findFirst({
    where: {
      propertyId: property.id,
      status: AgreementStatus.pending_verification,
    },
    select: { id: true },
  });
  if (existing) return;

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 2);
  const monthlyRent = Number(property.monthlyRent);

  await prisma.tenancyAgreement.create({
    data: {
      propertyId: property.id,
      landlordId,
      tenantId,
      monthlyRent: new Prisma.Decimal(monthlyRent),
      advancePayment: new Prisma.Decimal(monthlyRent * 2),
      startDate,
      endDate,
      utilities: ['Water', 'Electricity', 'Parking'],
      status: AgreementStatus.pending_verification,
      tenantSignedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      landlordSignedAt: new Date(),
    },
  });
}

async function main() {
  const { landlord, admin, tenant } = await seedUsers();
  await seedProperties(landlord.id);
  await seedAgreements(landlord.id, tenant.id);
  await seedActiveAgreement(landlord.id, tenant.id);
  await seedRentPayments(landlord.id, tenant.id);
  await seedSystemParameters(admin.id);
  console.log('Seed completed successfully.');
  console.log('Default login password for seeded users: Passw0rd!234');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
