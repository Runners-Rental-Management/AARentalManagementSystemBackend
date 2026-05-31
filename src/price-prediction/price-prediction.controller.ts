import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PredictPriceDto } from './dto/predict-price.dto';
import { PricePredictionService } from './price-prediction.service';

@Controller('price-prediction')
export class PricePredictionController {
  constructor(private readonly service: PricePredictionService) {}

  /**
   * Predict the fair rent range for a property.
   * Used by authority roles when verifying a landlord's listed price.
   */
  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Post('predict')
  predict(@Body() dto: PredictPriceDto) {
    return this.service.predict(dto);
  }

  /**
   * Get ML service health and model metadata.
   * Admin / system_admin only.
   */
  @Roles(UserRole.admin, UserRole.system_admin)
  @Get('health')
  health() {
    return this.service.getHealth();
  }

  /**
   * Trigger model retraining using latest platform data.
   * Admin / system_admin only.
   */
  @Roles(UserRole.admin, UserRole.system_admin)
  @Post('retrain')
  retrain() {
    return this.service.triggerRetrain();
  }
}
