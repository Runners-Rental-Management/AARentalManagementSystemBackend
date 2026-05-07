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
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ListDisputesDto } from './dto/list-disputes.dto';
import { ReviewDisputeDto } from './dto/review-dispute.dto';
import { DisputesService } from './disputes.service';

@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Roles(UserRole.landlord, UserRole.tenant)
  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: CreateDisputeDto,
  ) {
    return this.disputesService.create(userId, role, dto);
  }

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListDisputesDto,
  ) {
    return this.disputesService.list(userId, role, query);
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.disputesService.getById(id, userId, role);
  }

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewDisputeDto,
  ) {
    return this.disputesService.review(id, role, dto);
  }
}
