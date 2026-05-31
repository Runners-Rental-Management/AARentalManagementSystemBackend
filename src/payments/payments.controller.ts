import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConfirmRentPaymentDto } from './dto/confirm-rent-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListPaymentsDto,
  ) {
    return this.paymentsService.listForUser(userId, role, query);
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.paymentsService.getById(id, userId, role);
  }

  @Roles(UserRole.tenant)
  @Patch(':id/confirm')
  confirm(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ConfirmRentPaymentDto,
  ) {
    return this.paymentsService.confirmRentPayment(id, userId, dto);
  }
}
