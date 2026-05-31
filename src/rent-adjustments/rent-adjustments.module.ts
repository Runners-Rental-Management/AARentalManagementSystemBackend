import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RentAdjustmentsController } from './rent-adjustments.controller';
import { RentAdjustmentsService } from './rent-adjustments.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [RentAdjustmentsController],
  providers: [RentAdjustmentsService],
  exports: [RentAdjustmentsService],
})
export class RentAdjustmentsModule {}
