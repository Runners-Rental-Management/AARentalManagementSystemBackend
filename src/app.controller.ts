import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        ok: true,
        api: 'up',
        database: 'connected',
        port: Number(process.env.PORT ?? 3001),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        api: 'up',
        database: 'disconnected',
        hint:
          'Set DATABASE_URL_LOCAL to local Postgres (postgresql://aarental:aarental@127.0.0.1:5433/aarental) or fix Neon in .env, then restart.',
        error: message,
      };
    }
  }
}
