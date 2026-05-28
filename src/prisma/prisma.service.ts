import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from './create-prisma-adapter';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    if (databaseUrl.startsWith('prisma+postgres://')) {
      throw new Error(
        'DATABASE_URL uses prisma+postgres://, which is not supported. Use postgresql:// with Neon or local Postgres.',
      );
    }

    const adapter = createPrismaAdapter({
      databaseUrl,
      databaseUrlLocal: configService.get<string>('DATABASE_URL_LOCAL'),
      useNeonDirect: configService.get<string>('NEON_USE_DIRECT') === '1',
    });

    super({ adapter });
  }

  async onModuleInit() {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Database connected');
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Database connect attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );
        if (attempt === maxAttempts) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
