/**
 * Wipes all application data from PostgreSQL (users, properties, photos URLs,
 * agreements, payments, notifications, tax records, sessions, etc.).
 * Does NOT re-seed. Run: npm run db:reset
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { createPrismaAdapter } from '../src/prisma/create-prisma-adapter';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to reset the database.');
}
if (databaseUrl.startsWith('prisma+postgres://')) {
  throw new Error(
    'Reset requires a direct postgresql:// URL (not prisma+postgres://).',
  );
}

const prisma = new PrismaClient({
  adapter: createPrismaAdapter({
    databaseUrl,
    databaseUrlLocal: process.env.DATABASE_URL_LOCAL,
    useNeonDirect: process.env.NEON_USE_DIRECT === '1',
  }),
});

async function purgeCloudinaryFolder(): Promise<void> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_FOLDER ?? 'house';

  if (!cloudName || !apiKey || !apiSecret) {
    console.log('Cloudinary not configured — skipping photo purge.');
    return;
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

  let nextCursor: string | undefined;
  let deleted = 0;

  do {
    const listed = await cloudinary.api.resources({
      type: 'upload',
      prefix: `${folder}/`,
      max_results: 500,
      next_cursor: nextCursor,
    });

    const ids = (listed.resources ?? []).map(
      (r: { public_id: string }) => r.public_id,
    );
    if (ids.length > 0) {
      await cloudinary.api.delete_resources(ids);
      deleted += ids.length;
    }
    nextCursor = listed.next_cursor;
  } while (nextCursor);

  console.log(`Cloudinary: removed ${deleted} file(s) under folder "${folder}/".`);
}

async function wipeDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename::text NOT IN ('_prisma_migrations')
  `;

  if (tables.length === 0) {
    console.log('No application tables found.');
    return;
  }

  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log('Resetting database — all rows will be deleted…');
  await wipeDatabase();
  console.log('Database is empty (no users, properties, or notifications).');

  try {
    await purgeCloudinaryFolder();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Cloudinary purge skipped or failed: ${msg}`);
    console.warn('DB data was still cleared. Delete uploads manually in Cloudinary if needed.');
  }

  console.log('');
  console.log('Done. Next steps:');
  console.log('  1. Sign out on all browsers (clears JWT in localStorage).');
  console.log('  2. Register new users or run npm run db:seed for demo accounts only.');
}

main()
  .catch((error) => {
    console.error('Reset failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
