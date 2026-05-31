import { Injectable } from '@nestjs/common';
import { NotificationCategory, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

export interface NotifyPayload {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  category: NotificationCategory;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notifyUser(payload: NotifyPayload) {
    return this.prisma.notification.create({ data: payload });
  }

  async notifyMany(payloads: NotifyPayload[]) {
    if (!payloads.length) return;
    return this.prisma.notification.createMany({ data: payloads });
  }

  /** Returns IDs of all admins that can see the given sub-city. */
  async adminIdsForSubCity(subCity: string): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        role: UserRole.admin,
        OR: [{ adminAllLocations: true }, { adminSubCities: { has: subCity } }],
      },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  async listForUser(userId: string, query: ListNotificationsDto) {
    const where = {
      userId,
      ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
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

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
