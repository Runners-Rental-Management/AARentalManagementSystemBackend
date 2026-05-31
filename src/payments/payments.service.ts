import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmRentPaymentDto } from './dto/confirm-rent-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForUser(
    userId: string,
    role: UserRole,
    query: ListPaymentsDto,
  ) {
    const where =
      role === UserRole.tenant
        ? { payerId: userId }
        : role === UserRole.landlord
          ? { recipientId: userId }
          : {};

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    const skip = (query.page - 1) * query.pageSize;

    const [items, total] = await Promise.all([
      this.prisma.rentPayment.findMany({
        where,
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
        include: {
          agreement: {
            select: {
              id: true,
              property: { select: { id: true, title: true } },
            },
          },
          payer: { select: { id: true, firstName: true, lastName: true } },
          recipient: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.rentPayment.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
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
            property: { select: { id: true, title: true } },
          },
        },
        payer: { select: { id: true, firstName: true, lastName: true } },
        recipient: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (
      role !== UserRole.admin &&
      payment.payerId !== userId &&
      payment.recipientId !== userId
    ) {
      throw new ForbiddenException('You cannot view this payment');
    }

    return payment;
  }

  async confirmRentPayment(
    id: string,
    tenantId: string,
    dto: ConfirmRentPaymentDto,
  ) {
    const payment = await this.prisma.rentPayment.findUnique({
      where: { id },
      include: {
        agreement: {
          select: {
            id: true,
            property: { select: { title: true } },
          },
        },
        payer: { select: { id: true, firstName: true, lastName: true } },
        recipient: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.payerId !== tenantId) {
      throw new ForbiddenException('Only the tenant can confirm this payment');
    }

    if (payment.status === PaymentStatus.paid) {
      return payment;
    }

    if (
      payment.status !== PaymentStatus.pending &&
      payment.status !== PaymentStatus.overdue &&
      payment.status !== PaymentStatus.partial
    ) {
      throw new UnprocessableEntityException(
        'This payment cannot be confirmed in its current state',
      );
    }

    const paidAt = new Date();
    const method = dto.method ?? PaymentMethod.mobile_money;
    const reference =
      dto.reference?.trim() ||
      `RENT-${payment.id.slice(-8).toUpperCase()}-${paidAt.getTime()}`;

    const updated = await this.prisma.rentPayment.update({
      where: { id },
      data: {
        status: PaymentStatus.paid,
        paidDate: paidAt,
        method,
        reference,
      },
      include: {
        agreement: {
          select: {
            id: true,
            property: { select: { id: true, title: true } },
          },
        },
        payer: { select: { id: true, firstName: true, lastName: true } },
        recipient: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const propertyTitle =
      updated.agreement?.property?.title ?? 'your rental property';

    this.notifications
      .notifyMany([
        {
          userId: updated.recipientId,
          title: 'Rent payment received',
          message: `${updated.payer.firstName} ${updated.payer.lastName} paid rent for "${propertyTitle}". Reference: ${reference}.`,
          type: 'success',
          category: 'agreement',
          link: '/dashboard/payments',
        },
        {
          userId: updated.payerId,
          title: 'Rent payment confirmed',
          message: `Your rent payment for "${propertyTitle}" was successful. Reference: ${reference}.`,
          type: 'success',
          category: 'agreement',
          link: '/dashboard/payments',
        },
      ])
      .catch(() => undefined);

    return updated;
  }
}
