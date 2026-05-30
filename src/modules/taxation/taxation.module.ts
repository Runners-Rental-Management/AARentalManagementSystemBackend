import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxMailService } from './tax-mail.service';
import { TaxationController } from './taxation.controller';
import { TaxationCronService } from './taxation.cron.service';
import { TaxationService } from './taxation.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [TaxationController],
  providers: [TaxationService, TaxMailService, TaxationCronService],
  exports: [TaxationService],
})
export class TaxationModule {}
