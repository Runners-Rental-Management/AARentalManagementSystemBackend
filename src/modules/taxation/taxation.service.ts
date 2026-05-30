import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LeaseRegistrationStatus,
  NotificationCategory,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  ComplianceReportItemDto,
  TaxCalculationResponseDto,
  VacancyAlertItemDto,
} from './dto/tax-calculation.dto';
import {
  CalculationFailedException,
  LandlordNotFoundException,
  PropertyAccessDeniedException,
  TaxAccessDeniedException,
  TaxRecordNotFoundException,
} from './exceptions/taxation.exceptions';
import { TaxMailService } from './tax-mail.service';
import {
  AVG_DAYS_PER_MONTH,
  LONG_TERM_VACANCY_DAYS,
  VacancyPeriod,
  calculateEstimatedTax,
  contractOverlapsYear,
  daysBetween,
  decimalToNumber,
  monthsActiveInYear,
  formatUserName,
  percentageFromVacancy,
  vacancyMonthsFromDays,
} from './taxation.utils';

/**
 * Example 1: Calculate tax for a single landlord
 * ```typescript
 * const record = await taxationService.generateTaxCalculation('landlord-uuid', 2025);
 * await taxationService.notifyLandlordOfTax('landlord-uuid', Number(record.calculatedTaxAmount), 2025);
 * ```
 *
 * Example 2: Admin bulk run for a tax year
 * ```typescript
 * const records = await taxationService.calculateBulkTaxForYear(2025);
 * ```
 *
 * Example 3: Check vacancy gaps for a property
 * ```typescript
 * const gaps = await taxationService.identifyVacancyPeriods('property-uuid');
 * ```
 */
@Injectable()
export class TaxationService {
  private readonly logger = new Logger(TaxationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly taxMail: TaxMailService,
    private readonly notifications: NotificationsService,
  ) {}

  private getTaxRate(): number {
    return Number(this.config.get<string>('RENTAL_INCOME_TAX_RATE', '0.15'));
  }

  private async assertLandlordExists(landlordId: string) {
    const landlord = await this.prisma.user.findFirst({
      where: {
        id: landlordId,
        deletedAt: null,
        role: UserRole.landlord,
      },
      select: { id: true },
    });
    if (!landlord) {
      throw new LandlordNotFoundException(landlordId);
    }
  }

  /** Approved registered leases plus verified platform agreements for income. */
  private async incomeSourcesForLandlord(landlordId: string, year: number) {
    const approvedStatuses: LeaseRegistrationStatus[] = [
      LeaseRegistrationStatus.approved,
      LeaseRegistrationStatus.terminated,
      LeaseRegistrationStatus.expired,
    ];

    const contracts = await this.prisma.leaseContract.findMany({
      where: {
        landlordId,
        status: { in: approvedStatuses },
      },
      select: {
        id: true,
        propertyId: true,
        monthlyRent: true,
        startDate: true,
        endDate: true,
        status: true,
        approvedAt: true,
      },
    });

    const registered = contracts.filter(
      (c) =>
        c.approvedAt &&
        contractOverlapsYear(c.startDate, c.endDate, year),
    );

    if (registered.length > 0) {
      return registered.map((c) => ({
        propertyId: c.propertyId,
        monthlyRent: decimalToNumber(c.monthlyRent),
        startDate: c.startDate,
        endDate: c.endDate,
      }));
    }

    const agreements = await this.prisma.tenancyAgreement.findMany({
      where: {
        landlordId,
        verifiedAt: { not: null },
        status: {
          in: ['active', 'extended', 'terminated', 'expired'],
        },
      },
      select: {
        propertyId: true,
        monthlyRent: true,
        startDate: true,
        endDate: true,
      },
    });

    return agreements
      .filter((a) =>
        contractOverlapsYear(a.startDate, a.endDate, year),
      )
      .map((a) => ({
        propertyId: a.propertyId,
        monthlyRent: decimalToNumber(a.monthlyRent),
        startDate: a.startDate,
        endDate: a.endDate,
      }));
  }

  async calculateAnnualIncome(
    landlordId: string,
    year: number,
  ): Promise<number> {
    this.logger.log(`calculateAnnualIncome landlord=${landlordId} year=${year}`);
    try {
      await this.assertLandlordExists(landlordId);
      const sources = await this.incomeSourcesForLandlord(landlordId, year);
      let total = 0;
      for (const src of sources) {
        const months = monthsActiveInYear(src.startDate, src.endDate, year);
        total += src.monthlyRent * months;
      }
      this.logger.log(`Annual income for ${landlordId}/${year}: ${total}`);
      return Math.round(total * 100) / 100;
    } catch (err) {
      if (err instanceof LandlordNotFoundException) throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`calculateAnnualIncome failed: ${msg}`);
      throw new CalculationFailedException(
        `Failed to calculate annual income: ${msg}`,
      );
    }
  }

  async identifyVacancyPeriods(propertyId: string): Promise<VacancyPeriod[]> {
    this.logger.log(`identifyVacancyPeriods property=${propertyId}`);
    const statuses: LeaseRegistrationStatus[] = [
      LeaseRegistrationStatus.approved,
      LeaseRegistrationStatus.terminated,
      LeaseRegistrationStatus.expired,
    ];

    let leases = await this.prisma.leaseContract.findMany({
      where: { propertyId, status: { in: statuses }, approvedAt: { not: null } },
      orderBy: { endDate: 'asc' },
      select: { startDate: true, endDate: true },
    });

    if (leases.length === 0) {
      const agreements = await this.prisma.tenancyAgreement.findMany({
        where: {
          propertyId,
          verifiedAt: { not: null },
          status: { in: ['active', 'extended', 'terminated', 'expired'] },
        },
        orderBy: { endDate: 'asc' },
        select: { startDate: true, endDate: true },
      });
      leases = agreements;
    }

    const gaps: VacancyPeriod[] = [];
    for (let i = 0; i < leases.length - 1; i++) {
      const prevEnd = leases[i].endDate;
      const nextStart = leases[i + 1].startDate;
      if (nextStart <= prevEnd) continue;
      const days = daysBetween(prevEnd, nextStart);
      if (days >= LONG_TERM_VACANCY_DAYS) {
        gaps.push({
          startDate: prevEnd,
          endDate: nextStart,
          daysVacant: days,
        });
      }
    }

    const lastLease = leases[leases.length - 1];
    if (lastLease) {
      const now = new Date();
      if (now > lastLease.endDate) {
        const days = daysBetween(lastLease.endDate, now);
        if (days >= LONG_TERM_VACANCY_DAYS) {
          gaps.push({
            startDate: lastLease.endDate,
            endDate: now,
            daysVacant: days,
          });
        }
      }
    }

    return gaps;
  }

  calculatePotentialIncome(monthlyRent: number, vacancyDays: number): number {
    const vacancyMonths = vacancyMonthsFromDays(vacancyDays);
    return Math.round(monthlyRent * vacancyMonths * 100) / 100;
  }

  async calculateTotalTaxableIncome(
    landlordId: string,
    year: number,
  ): Promise<{ actual: number; potentialVacancy: number; total: number }> {
    const actual = await this.calculateAnnualIncome(landlordId, year);
    const properties = await this.prisma.property.findMany({
      where: { landlordId, deletedAt: null },
      select: { id: true, monthlyRent: true },
    });

    let potentialVacancy = 0;
    for (const property of properties) {
      const gaps = await this.identifyVacancyPeriods(property.id);
      const rent = decimalToNumber(property.monthlyRent);
      for (const gap of gaps) {
        const gapStart = gap.startDate;
        const gapEnd = gap.endDate;
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31);
        if (gapEnd < yearStart || gapStart > yearEnd) continue;
        const effectiveStart = new Date(
          Math.max(gapStart.getTime(), yearStart.getTime()),
        );
        const effectiveEnd = new Date(
          Math.min(gapEnd.getTime(), yearEnd.getTime()),
        );
        const days = daysBetween(effectiveStart, effectiveEnd);
        if (days >= LONG_TERM_VACANCY_DAYS) {
          potentialVacancy += this.calculatePotentialIncome(rent, days);
        }
      }
    }

    potentialVacancy = Math.round(potentialVacancy * 100) / 100;
    return {
      actual,
      potentialVacancy,
      total: Math.round((actual + potentialVacancy) * 100) / 100,
    };
  }

  async generateTaxCalculation(landlordId: string, year: number) {
    this.logger.log(`generateTaxCalculation landlord=${landlordId} year=${year}`);
    try {
      await this.assertLandlordExists(landlordId);
      const { actual, potentialVacancy, total } =
        await this.calculateTotalTaxableIncome(landlordId, year);
      const taxRate = this.getTaxRate();
      const taxAmount = calculateEstimatedTax(total, taxRate);

      const sources = await this.incomeSourcesForLandlord(landlordId, year);
      let occupiedMonths = 0;
      for (const s of sources) {
        occupiedMonths += monthsActiveInYear(s.startDate, s.endDate, year);
      }
      const vacancyMonths =
        potentialVacancy > 0 && sources.length > 0
          ? potentialVacancy /
            (sources.reduce((a, s) => a + s.monthlyRent, 0) /
              Math.max(sources.length, 1) /
              AVG_DAYS_PER_MONTH)
          : vacancyMonthsFromDays(
              potentialVacancy > 0 ? LONG_TERM_VACANCY_DAYS : 0,
            );

      const breakdown = {
        actualIncome: actual,
        vacancyIncome: potentialVacancy,
        percentageFromVacancy: percentageFromVacancy(actual, potentialVacancy),
      };

      const record = await this.prisma.landlordTaxRecord.upsert({
        where: { landlordId_taxYear: { landlordId, taxYear: year } },
        create: {
          landlordId,
          taxYear: year,
          grossAnnualIncome: actual,
          occupiedMonths,
          vacancyMonths,
          potentialVacancyIncome: potentialVacancy,
          totalTaxableIncome: total,
          calculatedTaxAmount: taxAmount,
          taxRateApplied: taxRate,
          breakdownJson: breakdown as Prisma.InputJsonValue,
        },
        update: {
          grossAnnualIncome: actual,
          occupiedMonths,
          vacancyMonths,
          potentialVacancyIncome: potentialVacancy,
          totalTaxableIncome: total,
          calculatedTaxAmount: taxAmount,
          taxRateApplied: taxRate,
          breakdownJson: breakdown as Prisma.InputJsonValue,
        },
      });

      await this.prisma.taxCalculationLog.create({
        data: {
          landlordId,
          taxYear: year,
          action: 'calculate',
          resultJson: {
            recordId: record.id,
            breakdown,
            total,
            taxAmount,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ...record,
        breakdown: {
          actual,
          potential: potentialVacancy,
          total,
        },
      };
    } catch (err) {
      if (
        err instanceof LandlordNotFoundException ||
        err instanceof CalculationFailedException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`generateTaxCalculation failed: ${msg}`);
      throw new CalculationFailedException(msg);
    }
  }

  async notifyLandlordOfTax(
    landlordId: string,
    taxAmount: number,
    year: number,
  ): Promise<void> {
    this.logger.log(`notifyLandlordOfTax landlord=${landlordId} year=${year}`);
    const landlord = await this.prisma.user.findFirst({
      where: { id: landlordId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!landlord) throw new LandlordNotFoundException(landlordId);

    const record = await this.prisma.landlordTaxRecord.findUnique({
      where: { landlordId_taxYear: { landlordId, taxYear: year } },
    });
    if (!record) {
      throw new TaxRecordNotFoundException(landlordId, year);
    }

    const breakdown = (record.breakdownJson ?? {}) as {
      actualIncome?: number;
      vacancyIncome?: number;
    };
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const pdfUrl = `${appUrl}/api/taxation/landlord/${landlordId}/tax-record/${year}/pdf`;

    await this.taxMail.sendTaxNotification(landlord.email, {
      landlordName: formatUserName(landlord),
      taxYear: year,
      actualIncome: decimalToNumber(record.grossAnnualIncome).toFixed(2),
      vacancyIncome: decimalToNumber(record.potentialVacancyIncome).toFixed(2),
      totalTaxableIncome: decimalToNumber(record.totalTaxableIncome).toFixed(2),
      estimatedTax: taxAmount.toFixed(2),
      pdfUrl,
      authorityName: this.config.get<string>(
        'TAX_AUTHORITY_NAME',
        'Addis Ababa Revenue Bureau',
      ),
      paymentDeadline: `31 March ${year + 1}`,
      appName: this.config.get<string>('APP_NAME', 'Addis Ababa House Rental'),
      generatedDate: new Date().toLocaleDateString('en-ET'),
    });

    await this.prisma.landlordTaxRecord.update({
      where: { id: record.id },
      data: {
        notificationSent: true,
        notificationSentAt: new Date(),
        status: 'notified',
      },
    });

    await this.prisma.taxCalculationLog.create({
      data: {
        landlordId,
        taxYear: year,
        action: 'notify_email',
        resultJson: { taxAmount, email: landlord.email } as Prisma.InputJsonValue,
      },
    });

    await this.notifications.notifyUser({
      userId: landlordId,
      title: `Tax calculation ready (${year})`,
      message: `Your estimated rental tax is ETB ${taxAmount.toFixed(2)}. See your email for details.`,
      type: NotificationType.info,
      category: NotificationCategory.taxation,
      link: `/dashboard/tax/${year}`,
    });
  }

  async generateTaxReportPDF(landlordId: string, year: number): Promise<Buffer> {
    const landlord = await this.prisma.user.findFirst({
      where: { id: landlordId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!landlord) throw new LandlordNotFoundException(landlordId);

    const record = await this.prisma.landlordTaxRecord.findUnique({
      where: { landlordId_taxYear: { landlordId, taxYear: year } },
    });
    if (!record) throw new TaxRecordNotFoundException(landlordId, year);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const authority = this.config.get<string>(
        'TAX_AUTHORITY_NAME',
        'Addis Ababa Revenue Bureau',
      );

      doc.fontSize(18).text('Annual Rental Income Tax Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11);
      doc.text(`Landlord: ${formatUserName(landlord)}`);
      doc.text(`Landlord ID: ${landlord.id}`);
      doc.text(`Email: ${landlord.email}`);
      doc.text(`Tax year: ${year}`);
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown();
      doc.text(
        `Actual annual income: ETB ${decimalToNumber(record.grossAnnualIncome).toFixed(2)}`,
      );
      doc.text(
        `Vacancy-related income: ETB ${decimalToNumber(record.potentialVacancyIncome).toFixed(2)}`,
      );
      doc.text(
        `Total taxable income: ETB ${decimalToNumber(record.totalTaxableIncome).toFixed(2)}`,
      );
      doc.text(
        `Tax amount (est.): ETB ${decimalToNumber(record.calculatedTaxAmount).toFixed(2)}`,
      );
      doc.moveDown();
      doc
        .fontSize(10)
        .fillColor('#555555')
        .text(
          `For information only. Payment must be made directly to ${authority}. This platform does not collect taxes.`,
        );

      doc.end();

      void this.prisma.taxCalculationLog.create({
        data: {
          landlordId,
          taxYear: year,
          action: 'pdf_generated',
        },
      });
    });
  }

  private async notifyLandlordOfVacancy(
    trackerId: string,
    propertyId: string,
    landlordId: string,
  ): Promise<void> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { title: true, subCity: true },
    });
    await this.notifications.notifyUser({
      userId: landlordId,
      title: 'Long-term property vacancy alert',
      message: `Property "${property?.title ?? propertyId}" has been vacant for more than 6 months. Under Proclamation 1320/2024, potential rental income may be included in your tax assessment.`,
      type: NotificationType.warning,
      category: NotificationCategory.taxation,
      link: `/dashboard/properties/${propertyId}`,
    });
    await this.prisma.propertyVacancyTracker.update({
      where: { id: trackerId },
      data: { landlordNotifiedAt: new Date() },
    });
  }

  async monitorPropertyVacancies(): Promise<void> {
    this.logger.log('monitorPropertyVacancies: daily run');
    try {
      const properties = await this.prisma.property.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          landlordId: true,
          monthlyRent: true,
          title: true,
        },
      });

      const now = new Date();
      for (const property of properties) {
        const activeLease = await this.prisma.leaseContract.findFirst({
          where: {
            propertyId: property.id,
            status: LeaseRegistrationStatus.approved,
            startDate: { lte: now },
            endDate: { gte: now },
          },
        });
        const activeAgreement = !activeLease
          ? await this.prisma.tenancyAgreement.findFirst({
              where: {
                propertyId: property.id,
                status: { in: ['active', 'extended'] },
                startDate: { lte: now },
                endDate: { gte: now },
              },
            })
          : null;

        if (activeLease || activeAgreement) {
          await this.prisma.propertyVacancyTracker.deleteMany({
            where: { propertyId: property.id },
          });
          continue;
        }

        const gaps = await this.identifyVacancyPeriods(property.id);
        const currentGap = gaps[gaps.length - 1];
        if (!currentGap) continue;

        const daysVacant = currentGap.daysVacant;
        const rent = decimalToNumber(property.monthlyRent);
        const estimatedTax = calculateEstimatedTax(
          this.calculatePotentialIncome(rent, daysVacant),
          this.getTaxRate(),
        );

        const tracker = await this.prisma.propertyVacancyTracker.upsert({
          where: { propertyId: property.id },
          create: {
            propertyId: property.id,
            landlordId: property.landlordId,
            vacancyStartDate: currentGap.startDate,
            daysVacant,
            monthlyRent: rent,
            isLongTermVacancy: daysVacant >= LONG_TERM_VACANCY_DAYS,
            estimatedVacancyTax: estimatedTax,
          },
          update: {
            vacancyStartDate: currentGap.startDate,
            daysVacant,
            monthlyRent: rent,
            isLongTermVacancy: daysVacant >= LONG_TERM_VACANCY_DAYS,
            estimatedVacancyTax: estimatedTax,
          },
        });

        if (daysVacant >= LONG_TERM_VACANCY_DAYS) {
          await this.prisma.propertyVacancyTracker.update({
            where: { id: tracker.id },
            data: { isLongTermVacancy: true },
          });
          if (!tracker.landlordNotifiedAt) {
            await this.notifyLandlordOfVacancy(
              tracker.id,
              property.id,
              property.landlordId,
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`monitorPropertyVacancies failed: ${msg}`);
      throw new CalculationFailedException(msg);
    }
  }

  async calculateBulkTaxForYear(year: number) {
    this.logger.log(`calculateBulkTaxForYear year=${year}`);
    const landlordIds = await this.prisma.leaseContract.findMany({
      where: { status: LeaseRegistrationStatus.approved },
      distinct: ['landlordId'],
      select: { landlordId: true },
    });

    let ids = landlordIds.map((r) => r.landlordId);
    if (ids.length === 0) {
      const fromAgreements = await this.prisma.tenancyAgreement.findMany({
        where: { verifiedAt: { not: null } },
        distinct: ['landlordId'],
        select: { landlordId: true },
      });
      ids = fromAgreements.map((r) => r.landlordId);
    }

    const records: Awaited<ReturnType<TaxationService['generateTaxCalculation']>>[] =
      [];
    for (const landlordId of ids) {
      const record = await this.generateTaxCalculation(landlordId, year);
      records.push(record);
      await this.prisma.taxCalculationLog.create({
        data: {
          landlordId,
          taxYear: year,
          action: 'bulk_calculate',
          resultJson: { recordId: record.id } as Prisma.InputJsonValue,
        },
      });
    }
    return records;
  }

  toTaxResponseDto(record: {
    landlordId: string;
    taxYear: number;
    grossAnnualIncome: Prisma.Decimal;
    occupiedMonths: Prisma.Decimal;
    vacancyMonths: Prisma.Decimal;
    potentialVacancyIncome: Prisma.Decimal;
    totalTaxableIncome: Prisma.Decimal;
    calculatedTaxAmount: Prisma.Decimal;
    createdAt: Date;
    breakdownJson: Prisma.JsonValue;
    notificationSent: boolean;
    notificationSentAt: Date | null;
  }): TaxCalculationResponseDto {
    const breakdownJson = (record.breakdownJson ?? {}) as {
      actualIncome?: number;
      vacancyIncome?: number;
      percentageFromVacancy?: number;
    };
    const actual =
      breakdownJson.actualIncome ?? decimalToNumber(record.grossAnnualIncome);
    const vacancy =
      breakdownJson.vacancyIncome ??
      decimalToNumber(record.potentialVacancyIncome);

    return {
      landlordId: record.landlordId,
      taxYear: record.taxYear,
      grossAnnualIncome: actual,
      occupiedMonths: decimalToNumber(record.occupiedMonths),
      vacancyMonths: decimalToNumber(record.vacancyMonths),
      potentialVacancyIncome: vacancy,
      totalTaxableIncome: decimalToNumber(record.totalTaxableIncome),
      calculatedTaxAmount: decimalToNumber(record.calculatedTaxAmount),
      calculationDate: record.createdAt,
      breakdown: {
        actualIncome: actual,
        vacancyIncome: vacancy,
        percentageFromVacancy:
          breakdownJson.percentageFromVacancy ??
          percentageFromVacancy(actual, vacancy),
      },
      notificationSent: record.notificationSent,
      notificationDate: record.notificationSentAt ?? undefined,
    };
  }

  async getTaxRecord(landlordId: string, year: number) {
    const record = await this.prisma.landlordTaxRecord.findUnique({
      where: { landlordId_taxYear: { landlordId, taxYear: year } },
    });
    if (!record) throw new TaxRecordNotFoundException(landlordId, year);
    return this.toTaxResponseDto(record);
  }

  async getPropertyVacancyStatus(propertyId: string) {
    const tracker = await this.prisma.propertyVacancyTracker.findUnique({
      where: { propertyId },
    });
    if (!tracker) {
      return {
        propertyId,
        vacancyStartDate: null,
        daysVacant: 0,
        isLongTermVacancy: false,
      };
    }
    return {
      propertyId,
      vacancyStartDate: tracker.vacancyStartDate,
      daysVacant: tracker.daysVacant,
      isLongTermVacancy: tracker.isLongTermVacancy,
    };
  }

  async getComplianceReport(
    year: number,
    sortBy?: string,
    status?: string,
  ): Promise<ComplianceReportItemDto[]> {
    const records = await this.prisma.landlordTaxRecord.findMany({
      where: { taxYear: year },
      include: {
        landlord: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    const items: ComplianceReportItemDto[] = [];
    for (const r of records) {
      const propCount = await this.prisma.property.count({
        where: { landlordId: r.landlordId, deletedAt: null },
      });
      const vacantCount = await this.prisma.propertyVacancyTracker.count({
        where: {
          landlordId: r.landlordId,
          isLongTermVacancy: true,
        },
      });

      if (status === 'notified' && !r.notificationSent) continue;
      if (status === 'pending' && r.notificationSent) continue;
      if (status === 'paid' && r.status !== 'paid') continue;

      items.push({
        landlordId: r.landlordId,
        landlordName: formatUserName(r.landlord),
        landlordEmail: r.landlord.email,
        taxYear: r.taxYear,
        grossIncome: decimalToNumber(r.grossAnnualIncome),
        vacancyIncome: decimalToNumber(r.potentialVacancyIncome),
        totalTaxOwed: decimalToNumber(r.calculatedTaxAmount),
        propertiesManaged: propCount,
        vacantProperties: vacantCount,
        notificationSent: r.notificationSent,
        lastCalculationDate: r.updatedAt,
      });
    }

    const sortKey = sortBy ?? 'name';
    items.sort((a, b) => {
      switch (sortKey) {
        case 'income':
          return b.grossIncome - a.grossIncome;
        case 'tax':
          return b.totalTaxOwed - a.totalTaxOwed;
        case 'vacancies':
          return b.vacantProperties - a.vacantProperties;
        default:
          return a.landlordName.localeCompare(b.landlordName);
      }
    });
    return items;
  }

  async getVacancyAlertList(): Promise<VacancyAlertItemDto[]> {
    const trackers = await this.prisma.propertyVacancyTracker.findMany({
      where: { isLongTermVacancy: true },
      include: {
        property: {
          select: {
            title: true,
            address: true,
            subCity: true,
            landlord: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { daysVacant: 'desc' },
    });

    return trackers.map((t) => ({
      propertyId: t.propertyId,
      address:
        t.property.address ??
        `${t.property.title}, ${t.property.subCity}`,
      landlordName: formatUserName(t.property.landlord),
      vacancyStart: t.vacancyStartDate,
      daysSinceVacant: t.daysVacant,
      estimatedTax: decimalToNumber(t.estimatedVacancyTax),
    }));
  }

  async assertTaxAccess(
    userId: string,
    role: UserRole,
    landlordId: string,
  ): Promise<void> {
    if (role === UserRole.admin) return;
    if (userId === landlordId) return;
    throw new TaxAccessDeniedException();
  }

  async assertPropertyOwner(
    userId: string,
    role: UserRole,
    propertyId: string,
  ): Promise<void> {
    if (role === UserRole.admin) return;
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { landlordId: true },
    });
    if (!property || property.landlordId !== userId) {
      throw new PropertyAccessDeniedException();
    }
  }
}
