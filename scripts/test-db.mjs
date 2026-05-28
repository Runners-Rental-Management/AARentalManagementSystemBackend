import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

function cleanUrl(raw) {
  const u = new URL(raw);
  u.searchParams.delete('channel_binding');
  return u.toString();
}

const url = cleanUrl(process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL);
const useNeon = url.includes('neon.tech');

console.log('Testing', useNeon ? 'Neon adapter' : 'Pg adapter', url.replace(/:[^:@]+@/, ':***@'));

const adapter = useNeon
  ? new PrismaNeon({ connectionString: url })
  : new PrismaPg({ connectionString: url, ssl: { rejectUnauthorized: false } });

const prisma = new PrismaClient({ adapter });

try {
  const r = await prisma.$queryRaw`SELECT 1 as ok`;
  console.log('OK', r);
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
