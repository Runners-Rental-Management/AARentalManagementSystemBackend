import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TaxationService } from './taxation.service';

@Injectable()
export class TaxationCronService implements OnModuleInit {
  private readonly logger = new Logger(TaxationCronService.name);

  constructor(private readonly taxationService: TaxationService) {}

  onModuleInit(): void {
    this.logger.log('Taxation cron registered (daily at midnight)');
  }

  /** Runs every day at 00:00 — monitors long-term vacancies per Proclamation 1320/2024. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleVacancyMonitoring(): Promise<void> {
    this.logger.log('handleVacancyMonitoring: starting');
    try {
      await this.taxationService.monitorPropertyVacancies();
      this.logger.log('handleVacancyMonitoring: completed successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`handleVacancyMonitoring failed: ${message}`);
    }
  }
}
