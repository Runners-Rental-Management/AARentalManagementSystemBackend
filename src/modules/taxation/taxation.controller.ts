import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import {
  BulkTaxResponseDto,
  ComplianceReportQueryDto,
  ResendNotificationResponseDto,
} from './dto/tax-calculation.dto';
import { TaxationService } from './taxation.service';

@Controller('api/taxation')
export class TaxationController {
  private readonly logger = new Logger(TaxationController.name);

  constructor(private readonly taxationService: TaxationService) {}

  /**
   * GET /api/taxation/landlord/:landlordId/tax-record/:year
   * Landlord owner or admin — annual tax calculation.
   */
  @Get('landlord/:landlordId/tax-record/:year')
  async getTaxRecord(
    @Param('landlordId') landlordId: string,
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    this.logger.log(`getTaxRecord landlord=${landlordId} year=${year}`);
    await this.taxationService.assertTaxAccess(userId, role, landlordId);
    return this.taxationService.getTaxRecord(landlordId, year);
  }

  /**
   * GET /api/taxation/landlord/:landlordId/tax-record/:year/pdf
   * Download PDF tax report.
   */
  @Get('landlord/:landlordId/tax-record/:year/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadTaxPdf(
    @Param('landlordId') landlordId: string,
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`downloadTaxPdf landlord=${landlordId} year=${year}`);
    await this.taxationService.assertTaxAccess(userId, role, landlordId);
    const buffer = await this.taxationService.generateTaxReportPDF(
      landlordId,
      year,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tax-report-${landlordId}-${year}.pdf"`,
    );
    return new StreamableFile(buffer);
  }

  /**
   * GET /api/taxation/property/:propertyId/vacancy-status
   * Property owner or admin.
   */
  @Get('property/:propertyId/vacancy-status')
  async getVacancyStatus(
    @Param('propertyId') propertyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    this.logger.log(`getVacancyStatus property=${propertyId}`);
    await this.taxationService.assertPropertyOwner(userId, role, propertyId);
    return this.taxationService.getPropertyVacancyStatus(propertyId);
  }

  /**
   * POST /api/taxation/admin/calculate-all/:year
   * Admin bulk tax calculation.
   */
  @Roles(UserRole.admin)
  @Post('admin/calculate-all/:year')
  @HttpCode(HttpStatus.OK)
  async calculateAll(
    @Param('year', ParseIntPipe) year: number,
  ): Promise<BulkTaxResponseDto> {
    this.logger.log(`calculateAll year=${year}`);
    const records = await this.taxationService.calculateBulkTaxForYear(year);
    return {
      success: true,
      processed: records.length,
      timestamp: new Date(),
    };
  }

  /**
   * GET /api/taxation/admin/compliance-report/:year
   * Admin compliance dashboard.
   */
  @Roles(UserRole.admin)
  @Get('admin/compliance-report/:year')
  async complianceReport(
    @Param('year', ParseIntPipe) year: number,
    @Query() query: ComplianceReportQueryDto,
  ) {
    this.logger.log(`complianceReport year=${year}`);
    return this.taxationService.getComplianceReport(
      year,
      query.sortBy,
      query.status,
    );
  }

  /**
   * POST /api/taxation/landlord/:landlordId/resend-notification/:year
   * Resend tax notification email.
   */
  @Post('landlord/:landlordId/resend-notification/:year')
  @HttpCode(HttpStatus.OK)
  async resendNotification(
    @Param('landlordId') landlordId: string,
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ): Promise<ResendNotificationResponseDto> {
    this.logger.log(`resendNotification landlord=${landlordId} year=${year}`);
    await this.taxationService.assertTaxAccess(userId, role, landlordId);
    const record = await this.taxationService.getTaxRecord(landlordId, year);
    await this.taxationService.notifyLandlordOfTax(
      landlordId,
      record.calculatedTaxAmount,
      year,
    );
    return { success: true, emailSent: new Date() };
  }

  /**
   * GET /api/taxation/admin/vacancy-alert-list
   * Properties vacant more than 6 months.
   */
  @Roles(UserRole.admin)
  @Get('admin/vacancy-alert-list')
  async vacancyAlertList() {
    this.logger.log('vacancyAlertList');
    return this.taxationService.getVacancyAlertList();
  }
}
