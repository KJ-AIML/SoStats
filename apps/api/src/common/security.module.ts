import { Global, Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { ApiKeyService } from './auth/api-key.service.js';
import { SessionService } from './auth/session.service.js';
import { NotificationPreferencesService } from './notifications/notification-preferences.service.js';
import { AuditLogService } from './audit/audit-log.service.js';
import { OutboxService } from './outbox/outbox.service.js';
import { WorkspaceAccessService } from './workspace/workspace-access.service.js';
import { WorkspaceGuard } from './workspace/workspace.guard.js';

@Global()
@Module({
  imports: [DbModule],
  providers: [
    AuthService,
    ApiKeyService,
    SessionService,
    NotificationPreferencesService,
    AuditLogService,
    OutboxService,
    AuthGuard,
    WorkspaceAccessService,
    WorkspaceGuard,
  ],
  exports: [
    AuthService,
    ApiKeyService,
    SessionService,
    NotificationPreferencesService,
    AuditLogService,
    OutboxService,
    AuthGuard,
    WorkspaceAccessService,
    WorkspaceGuard,
  ],
})
export class SecurityModule {}
