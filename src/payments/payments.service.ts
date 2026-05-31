import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgreementStatus,
  NotificationCategory,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PropertyStatus,
  UserRole,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChapaService } from './chapa/chapa.service';
import { ChapaWebhookPayload } from './chapa/chapa.types';
import { ListPaymentsDto } from './dto/list-payments.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chapa: ChapaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForUser(userId: string, role: UserRole, query: ListPaymentsDto) {
    const where: Prisma.RentPaymentWhereInput = {
      ...(role === UserRole.tenant ? { payerId: userId } : {}),
      ...(role === UserRole.landlord ? { recipientId: userId } : {}),
    };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.rentPayment.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { dueDate: 'desc' },
        include: {
          agreement: {
            select: {
              id: true,
              status: true,
              property: { select: { id: true, title: true, subCity: true } },
            },
          },
          payer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          recipient: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.rentPayment.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getById(id: string, userId: string, role: UserRole) {
    const payment = await this.prisma.rentPayment.findUnique({
      where: { id },
      include: {
        agreement: {
          select: {
            id: true,
            status: true,
            property: { select: { id: true, title: true, subCity: true } },
          },
        },
        payer: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        recipient: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    this.assertCanAccessPayment(payment, userId, role);
    return payment;
  }

  async initiateChapaAdvancePayment(agreementId: string, userId: string) {
    this.chapa.assertConfigured();

    const agreement = await this.prisma.tenancyAgreement.findUnique({
      where: { id: agreementId },
      include: {
        property: { select: { title: true } },
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!agreement) {
      throw new NotFoundException('Agreement not found');
    }

    if (agreement.tenantId !== userId) {
      throw new ForbiddenException('Only the tenant can pay the advance rent');
    }

    if (agreement.status !== AgreementStatus.pending_payment) {
      throw new UnprocessableEntityException(
        'Agreement is not awaiting initial payment',
      );
    }

    let payment = await this.prisma.rentPayment.findFirst({
      where: {
        agreementId,
        payerId: userId,
        status: { in: [PaymentStatus.pending, PaymentStatus.overdue] },
      },
    });

    if (!payment) {
      payment = await this.prisma.rentPayment.create({
        data: {
          agreementId,
          payerId: agreement.tenantId,
          recipientId: agreement.landlordId,
          amount: agreement.advancePayment,
          dueDate: agreement.startDate,
          status: PaymentStatus.pending,
        },
      });
    }

    const txRef = this.chapa.generateTxRef(payment.id);
    const phone = this.chapa.normalizePhone(agreement.tenant.phone);

    const returnBase = this.chapa.getReturnUrl();
    const returnUrl = `${returnBase}${returnBase.includes('?') ? '&' : '?'}type=agreement&agreementId=${agreement.id}&paymentId=${payment.id}`;

    const init = await this.chapa.initialize({
      amount: payment.amount.toString(),
      email: this.chapa.paymentEmail(agreement.tenant.email, agreement.tenant.id),
      first_name: agreement.tenant.firstName,
      last_name: agreement.tenant.lastName,
      ...(phone ? { phone_number: phone } : {}),
      tx_ref: txRef,
      return_url: returnUrl,
      customization: {
        title: this.chapa.paymentTitle('Advance Rent'),
        description: `Advance rent for ${agreement.property.title}`.slice(0, 200),
      },
      meta: {
        rentPaymentId: payment.id,
        agreementId: agreement.id,
        paymentKind: 'advance',
      },
    });

    await this.prisma.rentPayment.update({
      where: { id: payment.id },
      data: {
        chapaTxRef: txRef,
        method: PaymentMethod.chapa,
        reference: txRef,
      },
    });

    return {
      checkoutUrl: init.data!.checkout_url,
      txRef,
      amount: payment.amount,
      currency: 'ETB',
      paymentId: payment.id,
    };
  }

  async initiateChapaPayment(paymentId: string, userId: string) {
    this.chapa.assertConfigured();

    const payment = await this.prisma.rentPayment.findUnique({
      where: { id: paymentId },
      include: {
        payer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        agreement: {
          select: {
            id: true,
            status: true,
            property: { select: { title: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.payerId !== userId) {
      throw new ForbiddenException('Only the tenant can pay this rent');
    }

    if (payment.status === PaymentStatus.paid) {
      throw new UnprocessableEntityException('This payment is already paid');
    }

    const activeStatuses: AgreementStatus[] = [
      AgreementStatus.active,
      AgreementStatus.extended,
    ];
    if (!activeStatuses.includes(payment.agreement.status)) {
      throw new UnprocessableEntityException(
        'Rent can only be paid for active agreements',
      );
    }

    const txRef = this.chapa.generateTxRef(payment.id);
    const phone = this.chapa.normalizePhone(payment.payer.phone);

    const returnBase = this.chapa.getReturnUrl();
    const returnUrl = `${returnBase}${returnBase.includes('?') ? '&' : '?'}type=rent&paymentId=${payment.id}`;

    const init = await this.chapa.initialize({
      amount: payment.amount.toString(),
      email: this.chapa.paymentEmail(payment.payer.email, payment.payer.id),
      first_name: payment.payer.firstName,
      last_name: payment.payer.lastName,
      ...(phone ? { phone_number: phone } : {}),
      tx_ref: txRef,
      return_url: returnUrl,
      customization: {
        title: this.chapa.paymentTitle('Rent Payment'),
        description: `Rent for ${payment.agreement.property.title}`.slice(0, 200),
      },
      meta: {
        rentPaymentId: payment.id,
        agreementId: payment.agreement.id,
      },
    });

    await this.prisma.rentPayment.update({
      where: { id: payment.id },
      data: {
        chapaTxRef: txRef,
        method: PaymentMethod.chapa,
        reference: txRef,
      },
    });

    return {
      checkoutUrl: init.data!.checkout_url,
      txRef,
      amount: payment.amount,
      currency: 'ETB',
    };
  }

  async handleChapaCallback(txRef: string | undefined) {
    if (!txRef) {
      throw new BadRequestException('Missing transaction reference');
    }

    return this.finalizeChapaPayment(txRef);
  }

  async handleChapaWebhook(payload: ChapaWebhookPayload) {
    const txRef = payload.tx_ref;
    if (!txRef) {
      this.logger.warn('Webhook received without tx_ref');
      return { received: true };
    }

    if (payload.event && !payload.event.includes('success')) {
      this.logger.log(`Ignoring webhook event: ${payload.event}`);
      return { received: true };
    }

    await this.finalizeChapaPayment(txRef);
    return { received: true };
  }

  async verifyChapaPayment(txRef: string, userId: string, role: UserRole) {
    const payment = await this.prisma.rentPayment.findUnique({
      where: { chapaTxRef: txRef },
      include: {
        agreement: { select: { id: true, status: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found for this transaction');
    }

    this.assertCanAccessPayment(payment, userId, role);

    const verification = await this.chapa.verify(txRef);
    const verified = this.chapa.isSuccessfulVerification(verification.data);

    if (verified) {
      await this.markPaymentPaid(payment.id, verification.data?.reference);
    }

    const updated = await this.prisma.rentPayment.findUnique({
      where: { id: payment.id },
    });

    return {
      txRef,
      verified,
      chapaStatus: verification.data?.status ?? verification.status,
      payment: updated,
    };
  }

  private async findPaymentByChapaRef(txRef: string) {
    try {
      const byChapaRef = await this.prisma.rentPayment.findUnique({
        where: { chapaTxRef: txRef },
      });
      if (byChapaRef) return byChapaRef;
    } catch (error) {
      this.logger.error(
        `Failed to lookup payment by chapaTxRef: ${(error as Error).message}`,
      );
    }

    return this.prisma.rentPayment.findFirst({
      where: { OR: [{ reference: txRef }, { chapaTxRef: txRef }] },
    });
  }

  private async finalizeChapaPayment(txRef: string) {
    const payment = await this.findPaymentByChapaRef(txRef);

    if (!payment) {
      this.logger.warn(`No rent payment found for tx_ref ${txRef}`);
      return { status: 'not_found', txRef };
    }

    if (payment.status === PaymentStatus.paid) {
      return { status: 'already_paid', txRef, paymentId: payment.id };
    }

    const verification = await this.chapa.verify(txRef);

    if (!this.chapa.isSuccessfulVerification(verification.data)) {
      return {
        status: 'pending',
        txRef,
        paymentId: payment.id,
        chapaStatus: verification.data?.status,
      };
    }

    const expectedAmount = Number(payment.amount);
    const paidAmount = Number(verification.data!.amount);
    if (Math.abs(expectedAmount - paidAmount) > 0.01) {
      this.logger.error(
        `Amount mismatch for ${txRef}: expected ${expectedAmount}, got ${paidAmount}`,
      );
      return { status: 'amount_mismatch', txRef, paymentId: payment.id };
    }

    await this.markPaymentPaid(payment.id, verification.data?.reference);

    return { status: 'success', txRef, paymentId: payment.id };
  }

  private async markPaymentPaid(paymentId: string, chapaRefId?: string) {
    const payment = await this.prisma.rentPayment.findUnique({
      where: { id: paymentId },
      include: {
        agreement: {
          select: {
            property: { select: { title: true } },
          },
        },
      },
    });

    if (!payment || payment.status === PaymentStatus.paid) {
      return;
    }

    const agreementBefore = await this.prisma.tenancyAgreement.findUnique({
      where: { id: payment.agreementId },
      select: { status: true, propertyId: true },
    });

    await this.prisma.rentPayment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.paid,
        paidDate: new Date(),
        method: PaymentMethod.chapa,
        chapaRefId: chapaRefId ?? payment.chapaRefId,
      },
    });

    const propertyTitle = payment.agreement.property.title;

    if (agreementBefore?.status === AgreementStatus.pending_payment) {
      const paidAt = new Date();
      await this.prisma.$transaction([
        this.prisma.tenancyAgreement.update({
          where: { id: payment.agreementId },
          data: {
            status: AgreementStatus.active,
            initialPaymentAt: paidAt,
          },
        }),
        this.prisma.property.update({
          where: { id: agreementBefore.propertyId },
          data: { status: PropertyStatus.rented },
        }),
      ]);

      await this.notifications.notifyMany([
        {
          userId: payment.recipientId,
          title: 'Advance payment received',
          message: `The tenant has paid the advance rent for "${propertyTitle}". The tenancy is now active.`,
          type: NotificationType.success,
          category: NotificationCategory.agreement,
          link: `/dashboard/agreements/${payment.agreementId}`,
        },
        {
          userId: payment.payerId,
          title: 'Tenancy activated',
          message: `Your payment for "${propertyTitle}" was confirmed. Your tenancy is now active. Welcome home!`,
          type: NotificationType.success,
          category: NotificationCategory.agreement,
          link: `/dashboard/agreements/${payment.agreementId}`,
        },
      ]);
      return;
    }

    await this.notifications.notifyMany([
      {
        userId: payment.payerId,
        title: 'Rent payment successful',
        message: `Your rent payment of ${payment.amount} ETB for ${propertyTitle} was received.`,
        type: NotificationType.success,
        category: NotificationCategory.agreement,
        link: `/payments/${payment.id}`,
      },
      {
        userId: payment.recipientId,
        title: 'Rent received',
        message: `Rent of ${payment.amount} ETB for ${propertyTitle} was paid via Chapa.`,
        type: NotificationType.success,
        category: NotificationCategory.agreement,
        link: `/payments/${payment.id}`,
      },
    ]);
  }

  private assertCanAccessPayment(
    payment: { payerId: string; recipientId: string },
    userId: string,
    role: UserRole,
  ) {
    const authorityRoles: UserRole[] = [UserRole.admin];

    if (authorityRoles.includes(role)) {
      return;
    }

    if (role === UserRole.tenant && payment.payerId !== userId) {
      throw new ForbiddenException('You cannot access this payment');
    }

    if (role === UserRole.landlord && payment.recipientId !== userId) {
      throw new ForbiddenException('You cannot access this payment');
    }
  }
}
