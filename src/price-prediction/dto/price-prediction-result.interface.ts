export interface PricePredictionResult {
  predictedMin: number;
  predictedMax: number;
  predictedMedian: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'model' | 'rule_based';
  currency: string;
  note?: string;
}
