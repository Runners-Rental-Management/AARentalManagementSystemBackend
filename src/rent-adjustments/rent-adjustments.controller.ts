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
import { CreateRentAdjustmentDto } from './dto/create-rent-adjustment.dto';
import { ListRentAdjustmentsDto } from './dto/list-rent-adjustments.dto';
import { ReviewRentAdjustmentDto } from './dto/review-rent-adjustment.dto';
import { RentAdjustmentsService } from './rent-adjustments.service';

@Controller('rent-adjustments')
export class RentAdjustmentsController {
  constructor(
    private readonly rentAdjustmentsService: RentAdjustmentsService,
  ) {}

  @Roles(UserRole.landlord)
  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateRentAdjustmentDto,
  ) {
    return this.rentAdjustmentsService.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListRentAdjustmentsDto,
  ) {
    return this.rentAdjustmentsService.list(userId, role, query);
  }

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewRentAdjustmentDto,
  ) {
    return this.rentAdjustmentsService.review(id, reviewerId, role, dto);
  }
}
