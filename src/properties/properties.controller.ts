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
import { OnboardingOptions } from '../auth/onboarding-options.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SkipOnboarding } from '../auth/skip-onboarding.decorator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ListPropertiesDto } from './dto/list-properties.dto';
import { ReviewPropertyDto } from './dto/review-property.dto';
import { PropertiesService } from './properties.service';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Public()
  @Get('public')
  listPublic(@Query() query: ListPropertiesDto) {
    return this.propertiesService.findPublic(query);
  }

  @SkipOnboarding()
  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListPropertiesDto,
  ) {
    return this.propertiesService.findAll(userId, role, query);
  }

  @SkipOnboarding()
  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.propertiesService.findOne(id, userId, role);
  }

  @Roles(UserRole.landlord)
  @OnboardingOptions({ requireProperty: false })
  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: CreatePropertyDto,
  ) {
    return this.propertiesService.create(userId, role, dto);
  }

  @Roles(UserRole.admin)
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: ReviewPropertyDto,
  ) {
    return this.propertiesService.reviewProperty(id, userId, role, dto);
  }

  @Roles(UserRole.landlord)
  @Patch(':id/post-to-explore')
  postToExplore(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.propertiesService.postToExplore(id, userId, role);
  }
}
