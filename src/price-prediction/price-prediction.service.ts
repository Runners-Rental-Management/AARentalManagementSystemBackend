import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PredictPriceDto } from './dto/predict-price.dto';
import { PricePredictionResult } from './dto/price-prediction-result.interface';

@Injectable()
export class PricePredictionService {
  private readonly logger = new Logger(PricePredictionService.name);
  private readonly mlServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.mlServiceUrl = this.config.get<string>('ML_SERVICE_URL')!;
  }

  async predict(dto: PredictPriceDto): Promise<PricePredictionResult> {
    const payload = {
      subCity: dto.subCity,
      propertyType: dto.propertyType,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      area: dto.area,
      homeCondition: dto.homeCondition ?? 'good',
      furnishing: dto.furnishing ?? 'unfurnished',
      amenities: dto.amenities ?? [],
    };

    try {
      const response = await fetch(`${this.mlServiceUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`ML service error ${response.status}: ${text}`);
        throw new Error(`ML service returned ${response.status}`);
      }

      return response.json() as Promise<PricePredictionResult>;
    } catch (err) {
      this.logger.error(`ML service unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Price prediction service is temporarily unavailable. Please try again later.',
      );
    }
  }

  async getHealth(): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.mlServiceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.json() as Promise<Record<string, unknown>>;
    } catch {
      return { status: 'unreachable' };
    }
  }

  async triggerRetrain(): Promise<{ status: string }> {
    try {
      const response = await fetch(`${this.mlServiceUrl}/retrain`, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      });
      return response.json() as Promise<{ status: string }>;
    } catch (err) {
      this.logger.error(`Retrain trigger failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not trigger retraining. Is the ML service running?',
      );
    }
  }
}
