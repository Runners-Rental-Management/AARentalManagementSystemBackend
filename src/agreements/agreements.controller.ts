import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AgreementsService } from './agreements.service';
import { ConfirmAgreementPaymentDto } from './dto/confirm-agreement-payment.dto';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { CreateTenantAgreementDto } from './dto/create-tenant-agreement.dto';
import { ListAgreementsDto } from './dto/list-agreements.dto';
import { RequestExtensionDto } from './dto/request-extension.dto';
import { ReviewAgreementDto } from './dto/review-agreement.dto';
import { ReviewPendingRequestDto } from './dto/review-pending-request.dto';
import { TerminateAgreementDto } from './dto/terminate-agreement.dto';

@Controller('agreements')
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Roles(UserRole.landlord)
  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateAgreementDto) {
    return this.agreementsService.createAsLandlord(userId, dto);
  }

  @Roles(UserRole.tenant)
  @Post('tenant-request')
  tenantRequest(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTenantAgreementDto,
  ) {
    return this.agreementsService.tenantRequestAsTenant(userId, dto);
  }

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListAgreementsDto,
  ) {
    return this.agreementsService.listForUser(userId, role, query);
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.agreementsService.getById(id, userId, role);
  }

  @Roles(UserRole.tenant)
  @Patch(':id/tenant-sign')
  tenantSign(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.agreementsService.tenantSign(id, userId);
  }

  @Roles(UserRole.landlord)
  @Patch(':id/landlord-sign')
  landlordSign(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.agreementsService.landlordSignAgreement(id, userId);
  }

  @Roles(UserRole.admin)
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewAgreementDto,
  ) {
    return this.agreementsService.reviewByAuthority(id, userId, role, dto);
  }

  @Roles(UserRole.tenant)
  @Patch(':id/confirm-payment')
  confirmPayment(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ConfirmAgreementPaymentDto,
  ) {
    return this.agreementsService.confirmInitialPayment(id, userId, dto);
  }

  @Roles(UserRole.tenant, UserRole.landlord)
  @Patch(':id/withdraw')
  withdraw(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: TerminateAgreementDto,
  ) {
    return this.agreementsService.withdrawAgreement(id, userId, role, dto);
  }

  @Roles(UserRole.tenant, UserRole.landlord)
  @Patch(':id/request-termination')
  requestTermination(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: TerminateAgreementDto,
  ) {
    return this.agreementsService.requestTermination(id, userId, role, dto);
  }

  @Roles(UserRole.landlord)
  @Patch(':id/request-extension')
  requestExtension(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: RequestExtensionDto,
  ) {
    return this.agreementsService.requestExtension(id, userId, dto);
  }

  @Roles(UserRole.admin)
  @Patch(':id/review-termination')
  reviewTermination(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewPendingRequestDto,
  ) {
    return this.agreementsService.reviewTerminationRequest(id, userId, role, dto);
  }

  @Roles(UserRole.admin)
  @Patch(':id/review-extension')
  reviewExtension(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewPendingRequestDto,
  ) {
    return this.agreementsService.reviewExtensionRequest(id, userId, role, dto);
  }
}
