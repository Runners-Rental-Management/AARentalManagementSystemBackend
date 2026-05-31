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
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { CreateTenantAgreementDto } from './dto/create-tenant-agreement.dto';
import { ListAgreementsDto } from './dto/list-agreements.dto';
import { ReviewAgreementDto } from './dto/review-agreement.dto';

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
}
