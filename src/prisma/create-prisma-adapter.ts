import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils';
import {
  buildPgPoolConfig,
  isRemoteManagedDatabase,
  resolveDatabaseUrl,
} from '../config/database-url';

export function createPrismaAdapter(options: {
  databaseUrl: string;
  databaseUrlLocal?: string;
  useNeonDirect?: boolean;
}): SqlDriverAdapterFactory {
  const connectionString = resolveDatabaseUrl(options.databaseUrl, {
    preferLocal: options.databaseUrlLocal,
    useNeonDirect: options.useNeonDirect,
  });

  if (isRemoteManagedDatabase(connectionString)) {
    return new PrismaNeon({ connectionString });
  }

  return new PrismaPg(buildPgPoolConfig(connectionString), {
    onPoolError: (err) => {
      console.error('[prisma] pool error', err.message);
    },
    onConnectionError: (err) => {
      console.error('[prisma] connection error', err.message);
    },
  });
}
