import type { PoolConfig } from 'pg';

/**
 * Normalizes PostgreSQL URLs for Prisma + node-pg (Neon pooler, local Docker, etc.).
 */
/** Neon pooler host → direct host (some networks only reach direct endpoint). */
export function neonPoolerToDirect(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('-pooler')) {
      parsed.hostname = parsed.hostname.replace('-pooler', '');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveDatabaseUrl(
  databaseUrl: string,
  options?: { preferLocal?: string; useNeonDirect?: boolean },
): string {
  const raw = options?.preferLocal?.trim() || databaseUrl;
  let resolved = normalizeDatabaseUrl(raw);
  if (options?.useNeonDirect) {
    resolved = neonPoolerToDirect(resolved);
  }
  return resolved;
}

export function normalizeDatabaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('postgresql://') && !trimmed.startsWith('postgres://')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    url.searchParams.delete('channel_binding');
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '30');
    }
    if (!url.searchParams.has('sslmode')) {
      const host = url.hostname.toLowerCase();
      if (host.includes('neon.tech') || host.includes('supabase')) {
        url.searchParams.set('sslmode', 'require');
      }
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function isRemoteManagedDatabase(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('neon.tech') ||
    lower.includes('supabase.co') ||
    lower.includes('neon.database')
  );
}

export function buildPgPoolConfig(rawConnectionString: string): PoolConfig {
  const connectionString = normalizeDatabaseUrl(rawConnectionString);
  const remote = isRemoteManagedDatabase(connectionString);
  const config: PoolConfig = {
    connectionString,
    max: remote ? 5 : 10,
    idleTimeoutMillis: remote ? 20_000 : 30_000,
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
  };
  if (remote || connectionString.includes('sslmode=require')) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}
