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
import { OnboardingService } from '../auth/onboarding.service';
import { Roles } from '../auth/roles.decorator';
import { SkipOnboarding } from '../auth/skip-onboarding.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { LookupTenantDto } from './dto/lookup-tenant.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateSystemParameterDto } from './dto/update-system-parameter.dto';
import { VerifyFaydaDto } from './dto/verify-fayda.dto';
import { UsersService } from './users.service';

@SkipOnboarding()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.usersService.getMe(userId);
  }

  @Patch('me')
  updateMe(@CurrentUser('sub') userId: string, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(userId, dto);
  }

  @Patch('me/password')
  changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(userId, dto);
  }

  @Post('me/fayda/verify')
  verifyFayda(@CurrentUser('sub') userId: string, @Body() dto: VerifyFaydaDto) {
    return this.onboarding.verifyFayda(userId, dto);
  }

  // ─── Landlord: tenant directory ──────────────────────────────────────────

  @Roles(UserRole.landlord)
  @Get('tenants/lookup')
  lookupTenant(@Query() query: LookupTenantDto) {
    return this.usersService.lookupTenantByFayda(query.faydaNumber);
  }

  @Roles(UserRole.landlord)
  @Get('tenants/:id')
  getTenantProfile(@Param('id') id: string) {
    return this.usersService.getTenantPublicProfile(id);
  }

  // ─── Admin endpoints ─────────────────────────────────────────────────────

  @Roles(UserRole.admin)
  @Get('admin/stats')
  getDashboardStats(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.usersService.getDashboardStats(userId, role);
  }

  @Roles(UserRole.admin)
  @Get('admin/list')
  listAll(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListUsersDto,
  ) {
    return this.usersService.listAll(userId, role, query);
  }

  @Roles(UserRole.admin)
  @Get('admin/:id')
  getUserById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.usersService.getUserById(id, userId, role);
  }

  @Roles(UserRole.admin)
  @Get('admin/audit-logs/list')
  listAuditLogs(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query() query: ListAuditLogsDto,
  ) {
    return this.usersService.listAuditLogs(userId, role, query);
  }

  @Roles(UserRole.admin)
  @Get('admin/system-parameters/list')
  listSystemParameters(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    return this.usersService.listSystemParameters(userId, role);
  }

  @Roles(UserRole.admin)
  @Patch('admin/system-parameters/:key')
  updateSystemParameter(
    @Param('key') key: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: UpdateSystemParameterDto,
  ) {
    return this.usersService.updateSystemParameter(key, dto.value, userId, role);
  }
}
