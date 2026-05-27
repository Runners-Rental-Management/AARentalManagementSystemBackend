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

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Get('admin/stats')
  getDashboardStats() {
    return this.usersService.getDashboardStats();
  }

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Get('admin/list')
  listAll(@Query() query: ListUsersDto) {
    return this.usersService.listAll(query);
  }

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Get('admin/:id')
  getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Roles(UserRole.admin, UserRole.system_admin, UserRole.dara_agent)
  @Get('admin/audit-logs/list')
  listAuditLogs(@Query() query: ListAuditLogsDto) {
    return this.usersService.listAuditLogs(query);
  }

  @Roles(UserRole.admin, UserRole.system_admin)
  @Get('admin/system-parameters/list')
  listSystemParameters() {
    return this.usersService.listSystemParameters();
  }

  @Roles(UserRole.system_admin)
  @Patch('admin/system-parameters/:key')
  updateSystemParameter(
    @Param('key') key: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateSystemParameterDto,
  ) {
    return this.usersService.updateSystemParameter(key, dto.value, userId);
  }
}
