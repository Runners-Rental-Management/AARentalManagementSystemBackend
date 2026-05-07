import 'dotenv/config';
import { PrismaClient, PropertyStatus, PropertyType, UserRole } from '@prisma/client';
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

async function seedUsers() {
  const passwordHash = await bcrypt.hash('Passw0rd!234', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@aarental.local' },
    update: {
      firstName: 'System',
      lastName: 'Admin',
      phone: '+251900000001',
      role: UserRole.system_admin,
      isVerified: true,
      passwordHash,
    },
    create: {
      email: 'admin@aarental.local',
      firstName: 'System',
      lastName: 'Admin',
      phone: '+251900000001',
      role: UserRole.system_admin,
      isVerified: true,
      passwordHash,
    },
  });

  const landlord = await prisma.user.upsert({
    where: { email: 'landlord@aarental.local' },
    update: {
      firstName: 'Abebe',
      lastName: 'Kebede',
      phone: '+251900000002',
      role: UserRole.landlord,
      isVerified: true,
      passwordHash,
    },
    create: {
      email: 'landlord@aarental.local',
      firstName: 'Abebe',
      lastName: 'Kebede',
      phone: '+251900000002',
      role: UserRole.landlord,
      isVerified: true,
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
      passwordHash,
    },
    create: {
      email: 'tenant@aarental.local',
      firstName: 'Tigist',
      lastName: 'Haile',
      phone: '+251900000003',
      role: UserRole.tenant,
      isVerified: true,
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

async function main() {
  const { landlord } = await seedUsers();
  await seedProperties(landlord.id);
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
