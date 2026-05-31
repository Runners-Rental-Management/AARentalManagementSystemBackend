import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PredictPriceDto } from './dto/predict-price.dto';
import { PricePredictionService } from './price-prediction.service';

@Controller('price-prediction')
export class PricePredictionController {
  constructor(private readonly service: PricePredictionService) {}

  /** Predict fair rent range — authority admins only. */
  @Roles(UserRole.admin)
  @Post('predict')
  predict(@Body() dto: PredictPriceDto) {
    return this.service.predict(dto);
  }

  @Roles(UserRole.admin)
  @Get('health')
  health() {
    return this.service.getHealth();
  }

  @Roles(UserRole.admin)
  @Post('retrain')
  retrain() {
    return this.service.triggerRetrain();
  }
}
