import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { EmailSendException } from './exceptions/taxation.exceptions';

export interface TaxEmailContext {
  landlordName: string;
  taxYear: number;
  actualIncome: string;
  vacancyIncome: string;
  totalTaxableIncome: string;
  estimatedTax: string;
  pdfUrl?: string;
  authorityName: string;
  paymentDeadline: string;
  appName: string;
  generatedDate: string;
}

@Injectable()
export class TaxMailService {
  private readonly logger = new Logger(TaxMailService.name);
  private templateCompiled: Handlebars.TemplateDelegate | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT', 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (!host || !user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  private loadTemplate(): Handlebars.TemplateDelegate {
    if (this.templateCompiled) return this.templateCompiled;
    const templatePath = path.join(
      process.cwd(),
      'dist',
      'src',
      'modules',
      'taxation',
      'templates',
      'tax-notification.hbs',
    );
    const devPath = path.join(
      __dirname,
      'templates',
      'tax-notification.hbs',
    );
    const resolved = fs.existsSync(templatePath) ? templatePath : devPath;
    const source = fs.readFileSync(resolved, 'utf8');
    this.templateCompiled = Handlebars.compile(source);
    return this.templateCompiled;
  }

  async sendTaxNotification(
    to: string,
    context: TaxEmailContext,
  ): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(
        'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS); skipping email send',
      );
      throw new EmailSendException(
        'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.',
      );
    }

    try {
      const template = this.loadTemplate();
      const html = template(context);
      const from =
        this.config.get<string>('SMTP_FROM') ??
        'noreply@house-rental-addis.local';

      await transporter.sendMail({
        from,
        to,
        subject: `Your Annual Property Tax Calculation - ${context.taxYear}`,
        html,
      });
      this.logger.log(`Tax notification email sent to ${to}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown email send error';
      this.logger.error(`Failed to send tax email: ${message}`);
      throw new EmailSendException(message);
    }
  }
}
