import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { WorkspaceAccessService } from '../../common/workspace/workspace-access.service.js';

function normalizedEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (
    !email ||
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new BadRequestException('A valid invitation email is required');
  }
  return email;
}

function invitationRole(value: unknown) {
  const role = String(value || 'member').trim().toLowerCase();
  if (!['admin', 'member'].includes(role)) {
    throw new BadRequestException('Invitation role must be admin or member');
  }
  return role;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function inviteTtlMs() {
  const configured = Number.parseInt(
    process.env.WORKSPACE_INVITE_TTL_HOURS || '168',
    10,
  );
  const hours =
    Number.isFinite(configured) && configured >= 1 && configured <= 720
      ? configured
      : 168;
  return hours * 60 * 60 * 1000;
}

function maskedEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'invited user';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(2, Math.min(6, local.length - head.length)))}@${domain}`;
}

@Injectable()
export class WorkspaceInvitationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
  ) {}

  private effectiveStatus(
    invitation: typeof schema.workspaceInvitations.$inferSelect,
  ) {
    if (
      invitation.status === 'pending' &&
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      return 'expired';
    }
    return invitation.status;
  }

  private serialize(
    invitation: typeof schema.workspaceInvitations.$inferSelect & {
      invitedBy?: typeof schema.users.$inferSelect | null;
    },
  ) {
    return {
      id: invitation.id,
      workspaceId: invitation.workspaceId,
      email: invitation.email,
      role: invitation.role,
      status: this.effectiveStatus(invitation),
      invitedBy: invitation.invitedBy
        ? {
            id: invitation.invitedBy.id,
            name: invitation.invitedBy.name,
            email: invitation.invitedBy.email,
          }
        : null,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      rejectedAt: invitation.rejectedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };
  }

  async listForWorkspace(workspaceId: number, actorUserId: number) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    const invitations = await this.db.query.workspaceInvitations.findMany({
      where: eq(schema.workspaceInvitations.workspaceId, workspaceId),
      with: {
        invitedBy: true,
      },
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.createdAt),
      ],
      limit: 100,
    });

    return invitations.map((invitation) => this.serialize(invitation));
  }

  async create(
    workspaceId: number,
    actorUserId: number,
    input: { email?: string; role?: string },
  ) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    const email = normalizedEmail(input.email);
    const role = invitationRole(input.role);
    const token = newToken();
    const hash = tokenHash(token);
    const expiresAt = new Date(Date.now() + inviteTtlMs());

    const invitation = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${workspaceId}, hashtext(${email}))`,
      );

      const existingUser = await tx.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      if (existingUser) {
        const membership = await tx.query.workspaceMembers.findFirst({
          where: and(
            eq(schema.workspaceMembers.workspaceId, workspaceId),
            eq(schema.workspaceMembers.userId, existingUser.id),
          ),
        });
        if (membership) {
          throw new ConflictException(
            'This user is already a workspace member',
          );
        }
      }

      const pending = await tx.query.workspaceInvitations.findFirst({
        where: and(
          eq(schema.workspaceInvitations.workspaceId, workspaceId),
          eq(schema.workspaceInvitations.email, email),
          eq(schema.workspaceInvitations.status, 'pending'),
        ),
        orderBy: (fields, { desc: orderDesc }) => [
          orderDesc(fields.createdAt),
        ],
      });

      if (pending && pending.expiresAt.getTime() > Date.now()) {
        throw new ConflictException(
          'An active invitation already exists for this email. Regenerate its link instead.',
        );
      }

      if (pending) {
        const [renewed] = await tx
          .update(schema.workspaceInvitations)
          .set({
            role,
            tokenHash: hash,
            status: 'pending',
            invitedByUserId: actorUserId,
            acceptedByUserId: null,
            expiresAt,
            acceptedAt: null,
            rejectedAt: null,
            revokedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.workspaceInvitations.id, pending.id))
          .returning();
        return renewed;
      }

      const [created] = await tx
        .insert(schema.workspaceInvitations)
        .values({
          workspaceId,
          email,
          role,
          tokenHash: hash,
          status: 'pending',
          invitedByUserId: actorUserId,
          expiresAt,
        })
        .returning();

      return created;
    });

    return {
      invitation: this.serialize(invitation),
      token,
    };
  }

  async regenerate(
    workspaceId: number,
    actorUserId: number,
    invitationId: number,
  ) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    const token = newToken();
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${workspaceId}, ${invitationId})`,
      );

      const current = await tx.query.workspaceInvitations.findFirst({
        where: and(
          eq(schema.workspaceInvitations.id, invitationId),
          eq(schema.workspaceInvitations.workspaceId, workspaceId),
        ),
      });
      if (!current) return { status: 'not_found' as const };

      const effective = this.effectiveStatus(current);
      if (!['pending', 'expired'].includes(effective)) {
        return { status: 'not_actionable' as const, effective };
      }

      const [updated] = await tx
        .update(schema.workspaceInvitations)
        .set({
          tokenHash: tokenHash(token),
          status: 'pending',
          invitedByUserId: actorUserId,
          expiresAt: new Date(Date.now() + inviteTtlMs()),
          acceptedByUserId: null,
          acceptedAt: null,
          rejectedAt: null,
          revokedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.workspaceInvitations.id, invitationId),
            eq(schema.workspaceInvitations.workspaceId, workspaceId),
          ),
        )
        .returning();

      return { status: 'updated' as const, invitation: updated };
    });

    if (outcome.status === 'not_found') {
      throw new NotFoundException('Invitation not found');
    }
    if (outcome.status === 'not_actionable') {
      throw new ConflictException(
        `Invitation is ${outcome.effective} and cannot regenerate a link`,
      );
    }

    return {
      invitation: this.serialize(outcome.invitation),
      token,
    };
  }

  async revoke(
    workspaceId: number,
    actorUserId: number,
    invitationId: number,
  ) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${workspaceId}, ${invitationId})`,
      );

      const current = await tx.query.workspaceInvitations.findFirst({
        where: and(
          eq(schema.workspaceInvitations.id, invitationId),
          eq(schema.workspaceInvitations.workspaceId, workspaceId),
        ),
      });
      if (!current) return { status: 'not_found' as const };

      const effective = this.effectiveStatus(current);
      if (!['pending', 'expired'].includes(effective)) {
        return { status: 'not_actionable' as const, effective };
      }

      const [updated] = await tx
        .update(schema.workspaceInvitations)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.workspaceInvitations.id, invitationId),
            eq(schema.workspaceInvitations.workspaceId, workspaceId),
          ),
        )
        .returning();

      return { status: 'updated' as const, invitation: updated };
    });

    if (outcome.status === 'not_found') {
      throw new NotFoundException('Invitation not found');
    }
    if (outcome.status === 'not_actionable') {
      throw new ConflictException(
        `Invitation is ${outcome.effective} and cannot be revoked`,
      );
    }

    return this.serialize(outcome.invitation);
  }

  async inspect(token: string) {
    const invitation = await this.requireByToken(token);
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, invitation.workspaceId),
      columns: { id: true, name: true, slug: true },
    });
    if (!workspace) throw new NotFoundException('Invitation not found');

    return {
      workspace,
      email: maskedEmail(invitation.email),
      role: invitation.role,
      status: this.effectiveStatus(invitation),
      expiresAt: invitation.expiresAt,
    };
  }

  async accept(token: string) {
    const initial = await this.requireByToken(token);

    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${initial.workspaceId}, ${initial.id})`,
      );

      const invitation = await tx.query.workspaceInvitations.findFirst({
        where: and(
          eq(schema.workspaceInvitations.id, initial.id),
          eq(schema.workspaceInvitations.tokenHash, tokenHash(token)),
        ),
      });
      if (!invitation) {
        return { status: 'invalid' as const };
      }

      if (invitation.status !== 'pending') {
        return {
          status: invitation.status as
            | 'accepted'
            | 'rejected'
            | 'revoked'
            | 'expired',
          workspaceId: invitation.workspaceId,
        };
      }

      if (invitation.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(schema.workspaceInvitations)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.workspaceInvitations.id, invitation.id));
        return {
          status: 'expired' as const,
          workspaceId: invitation.workspaceId,
        };
      }

      await tx
        .insert(schema.users)
        .values({ email: invitation.email })
        .onConflictDoNothing({ target: schema.users.email });

      const user = await tx.query.users.findFirst({
        where: eq(schema.users.email, invitation.email),
      });
      if (!user) {
        throw new ConflictException('Invited identity could not be resolved');
      }

      await tx
        .insert(schema.workspaceMembers)
        .values({
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
        })
        .onConflictDoNothing();

      await tx
        .update(schema.workspaceInvitations)
        .set({
          status: 'accepted',
          acceptedByUserId: user.id,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceInvitations.id, invitation.id));

      return {
        status: 'accepted' as const,
        workspaceId: invitation.workspaceId,
      };
    });

    if (outcome.status === 'invalid') {
      throw new NotFoundException('Invitation not found');
    }
    if (outcome.status !== 'accepted') {
      throw new ConflictException(
        `Invitation is ${outcome.status} and cannot be accepted`,
      );
    }

    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, outcome.workspaceId),
      columns: { id: true, name: true, slug: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    return {
      status: 'accepted',
      workspace,
      next: `/${workspace.slug}`,
    };
  }

  async reject(token: string) {
    const initial = await this.requireByToken(token);

    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${initial.workspaceId}, ${initial.id})`,
      );

      const invitation = await tx.query.workspaceInvitations.findFirst({
        where: and(
          eq(schema.workspaceInvitations.id, initial.id),
          eq(schema.workspaceInvitations.tokenHash, tokenHash(token)),
        ),
      });
      if (!invitation) return 'invalid' as const;

      if (invitation.status !== 'pending') {
        return invitation.status;
      }

      if (invitation.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(schema.workspaceInvitations)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.workspaceInvitations.id, invitation.id));
        return 'expired' as const;
      }

      await tx
        .update(schema.workspaceInvitations)
        .set({
          status: 'rejected',
          rejectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceInvitations.id, invitation.id));

      return 'rejected' as const;
    });

    if (outcome === 'invalid') {
      throw new NotFoundException('Invitation not found');
    }
    if (!['rejected', 'expired'].includes(outcome)) {
      throw new ConflictException(
        `Invitation is ${outcome} and cannot be rejected`,
      );
    }

    return { status: outcome };
  }

  private async requireByToken(token: string) {
    const value = String(token || '').trim();
    if (value.length < 40 || value.length > 100) {
      throw new NotFoundException('Invitation not found');
    }

    const invitation = await this.db.query.workspaceInvitations.findFirst({
      where: eq(schema.workspaceInvitations.tokenHash, tokenHash(value)),
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    return invitation;
  }
}
