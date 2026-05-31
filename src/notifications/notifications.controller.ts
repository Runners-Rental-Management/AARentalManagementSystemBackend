import { Controller, Get, Patch, Param, Query, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

type AuthReq = { user: { id: string } };

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Request() req: AuthReq, @Query() query: ListNotificationsDto) {
    return this.notificationsService.listForUser(req.user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@Request() req: AuthReq) {
    const count = await this.notificationsService.countUnread(req.user.id);
    return { count };
  }

  @Patch('read-all')
  markAllRead(@Request() req: AuthReq) {
    return this.notificationsService.markAllRead(req.user.id);
  }

  @Patch(':id/read')
  markRead(@Request() req: AuthReq, @Param('id') id: string) {
    return this.notificationsService.markRead(id, req.user.id);
  }
}
