import { Module } from '@nestjs/common';
import { PricePredictionController } from './price-prediction.controller';
import { PricePredictionService } from './price-prediction.service';

@Module({
  controllers: [PricePredictionController],
  providers: [PricePredictionService],
  exports: [PricePredictionService],
})
export class PricePredictionModule {}
