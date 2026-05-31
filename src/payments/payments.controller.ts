import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SkipOnboarding } from '../auth/skip-onboarding.decorator';
import { ChapaService } from './chapa/chapa.service';
import { ChapaWebhookPayload } from './chapa/chapa.types';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly chapaService: ChapaService,
  ) {}

  @Get()
  @SkipOnboarding()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListPaymentsDto,
  ) {
    return this.paymentsService.listForUser(userId, role, query);
  }

  /** Chapa redirects here after payment (public). Must be before :id routes. */
  @Public()
  @Get('chapa/callback')
  async chapaCallback(
    @Query('trx_ref') trxRefLegacy: string | undefined,
    @Query('tx_ref') txRef: string | undefined,
    @Query('ref_id') refId: string | undefined,
    @Query('status') callbackStatus: string | undefined,
  ) {
    const resolvedTxRef = trxRefLegacy ?? txRef;
    const result = await this.paymentsService.handleChapaCallback(resolvedTxRef);

    return {
      message: 'Payment callback received',
      refId,
      callbackStatus,
      ...result,
    };
  }

  /** Browser redirect after checkout — public landing endpoint. */
  @Public()
  @Get('chapa/return')
  chapaReturn(
    @Query('trx_ref') trxRefLegacy: string | undefined,
    @Query('tx_ref') txRef: string | undefined,
    @Query('status') status: string | undefined,
  ) {
    const resolvedTxRef = trxRefLegacy ?? txRef;
    return {
      message: 'Payment completed. You can close this page or return to the app.',
      txRef: resolvedTxRef,
      status: status ?? 'unknown',
    };
  }

  /** Chapa server webhook — verifies signature then confirms payment. */
  @Public()
  @Post('chapa/webhook')
  async chapaWebhook(
    @Req() req: RawBodyRequest,
    @Headers('x-chapa-signature') xChapaSignature: string | undefined,
    @Headers('chapa-signature') chapaSignature: string | undefined,
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signature = xChapaSignature ?? chapaSignature;

    if (!this.chapaService.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid Chapa webhook signature');
    }

    const payload = req.body as ChapaWebhookPayload;
    return this.paymentsService.handleChapaWebhook(payload);
  }

  /** Manually verify a transaction (tenant, landlord, or authority). */
  @Get('chapa/verify/:txRef')
  @SkipOnboarding()
  verify(
    @Param('txRef') txRef: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.paymentsService.verifyChapaPayment(txRef, userId, role);
  }

  @Get(':id')
  @SkipOnboarding()
  getById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.paymentsService.getById(id, userId, role);
  }

  /** Tenant starts Chapa checkout for a pending rent payment. */
  @Roles(UserRole.tenant)
  @SkipOnboarding()
  @Post(':id/pay-with-chapa')
  payWithChapa(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.paymentsService.initiateChapaPayment(id, userId);
  }
}
