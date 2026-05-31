import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import {
  ChapaCallbackQuery,
  ChapaInitializePayload,
  ChapaInitializeResponse,
  ChapaVerifyResponse,
} from './chapa.types';

const CHAPA_BASE_URL = 'https://api.chapa.co/v1';

@Injectable()
export class ChapaService {
  private readonly logger = new Logger(ChapaService.name);
  private readonly secretKey: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly appUrl: string;
  private readonly returnUrl: string;
  private readonly callbackUrl: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('CHAPA_SECRET_KEY');
    this.webhookSecret =
      this.config.get<string>('CHAPA_WEBHOOK_SECRET') ?? this.secretKey;
    this.appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3001';
    this.returnUrl =
      this.config.get<string>('CHAPA_RETURN_URL') ??
      `${this.appUrl}/payments/chapa/return`;
    this.callbackUrl =
      this.config.get<string>('CHAPA_CALLBACK_URL') ??
      `${this.appUrl}/payments/chapa/callback`;
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  assertConfigured(): void {
    if (!this.secretKey) {
      throw new BadRequestException(
        'Chapa is not configured. Set CHAPA_SECRET_KEY in environment variables.',
      );
    }
  }

  generateTxRef(paymentId: string): string {
    const suffix = randomBytes(4).toString('hex');
    return `rent-${paymentId}-${suffix}`;
  }

  getCallbackUrl(): string {
    return this.callbackUrl;
  }

  getReturnUrl(): string {
    return this.returnUrl;
  }

  /** Chapa rejects some dev emails (e.g. *.local). Use a valid fallback. */
  paymentEmail(email: string, userId: string): string {
    if (email && !email.endsWith('.local') && email.includes('@')) {
      return email;
    }
    return `payments+${userId}@aarental.et`;
  }

  /** Chapa title max 16 characters. */
  paymentTitle(title: string): string {
    return title.length <= 16 ? title : title.slice(0, 16);
  }

  normalizePhone(phone: string): string | undefined {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && /^0[79]/.test(digits)) {
      return digits;
    }
    if (digits.length === 12 && digits.startsWith('251')) {
      return `0${digits.slice(3)}`;
    }
    return undefined;
  }

  async initialize(
    payload: Omit<
      ChapaInitializePayload,
      'callback_url' | 'return_url' | 'currency'
    > & { callback_url?: string; return_url?: string; currency?: string },
  ): Promise<ChapaInitializeResponse> {
    this.assertConfigured();

    const body: ChapaInitializePayload = {
      currency: payload.currency ?? 'ETB',
      callback_url: payload.callback_url ?? this.callbackUrl,
      return_url: payload.return_url ?? this.returnUrl,
      ...payload,
    };

    const response = await fetch(`${CHAPA_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await response.json()) as ChapaInitializeResponse;

    if (!response.ok || data.status !== 'success' || !data.data?.checkout_url) {
      this.logger.error(
        `Chapa initialize failed (${response.status}): ${JSON.stringify(data)}`,
      );
      throw new BadRequestException(
        data.message ?? 'Failed to initialize Chapa payment',
      );
    }

    return data;
  }

  async verify(txRef: string): Promise<ChapaVerifyResponse> {
    this.assertConfigured();

    const response = await fetch(
      `${CHAPA_BASE_URL}/transaction/verify/${encodeURIComponent(txRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );

    const data = (await response.json()) as ChapaVerifyResponse;

    if (!response.ok) {
      this.logger.error(
        `Chapa verify failed (${response.status}): ${JSON.stringify(data)}`,
      );
      throw new BadRequestException(
        data.message ?? 'Failed to verify Chapa payment',
      );
    }

    return data;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('CHAPA_WEBHOOK_SECRET not set — skipping signature check');
      return true;
    }
    if (!signature) {
      return false;
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    return expected === signature;
  }

  extractTxRefFromCallback(query: ChapaCallbackQuery): string | undefined {
    return query.trx_ref ?? query.tx_ref;
  }

  isSuccessfulVerification(data: ChapaVerifyResponse['data']): boolean {
    return data?.status?.toLowerCase() === 'success';
  }
}
