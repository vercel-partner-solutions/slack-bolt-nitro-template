import type { Installation, InstallationQuery, InstallationStore } from '@slack/oauth';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { type NewSlackInstallation, slackInstallations } from '../db/schema';

export const installationStore: InstallationStore = {
  storeInstallation: async (installation: Installation) => {
    const record: NewSlackInstallation = {
      teamId: installation.team?.id ?? null,
      enterpriseId: installation.enterprise?.id ?? null,
      userId: installation.user.id,
      isEnterpriseInstall: installation.isEnterpriseInstall ?? false,
      appId: installation.appId ?? null,
      tokenType: installation.tokenType ?? null,

      // Bot credentials
      botToken: installation.bot?.token ?? null,
      botId: installation.bot?.id ?? null,
      botUserId: installation.bot?.userId ?? null,
      botScopes: installation.bot?.scopes ?? null,
      botRefreshToken: installation.bot?.refreshToken ?? null,
      botTokenExpiresAt: installation.bot?.expiresAt ? new Date(installation.bot.expiresAt * 1000) : null,

      // User credentials
      userToken: installation.user.token ?? null,
      userScopes: installation.user.scopes ?? null,
      userRefreshToken: installation.user.refreshToken ?? null,
      userTokenExpiresAt: installation.user.expiresAt ? new Date(installation.user.expiresAt * 1000) : null,

      // Metadata
      teamName: installation.team?.name ?? null,
      enterpriseName: installation.enterprise?.name ?? null,
      enterpriseUrl: installation.enterpriseUrl ?? null,

      // Incoming webhook
      incomingWebhookUrl: installation.incomingWebhook?.url ?? null,
      incomingWebhookChannel: installation.incomingWebhook?.channel ?? null,
      incomingWebhookChannelId: installation.incomingWebhook?.channelId ?? null,
      incomingWebhookConfigurationUrl: installation.incomingWebhook?.configurationUrl ?? null,

      updatedAt: new Date(),
    };

    // Simple upsert logic: enterprise installs use enterprise_id, workspace installs use team_id
    const whereConditions = eq(
      getInstallationRow({
        isEnterpriseInstall: installation.isEnterpriseInstall,
      }),
      getInstallationId({
        isEnterpriseInstall: installation.isEnterpriseInstall,
        enterpriseId: installation.enterprise?.id,
        teamId: installation.team?.id,
      }),
    );

    const existing = await db
      .select({ id: slackInstallations.id })
      .from(slackInstallations)
      .where(whereConditions)
      .limit(1);

    if (existing.length > 0) {
      await db.update(slackInstallations).set(record).where(whereConditions);
    } else {
      await db.insert(slackInstallations).values(record);
    }
  },

  fetchInstallation: async (query: InstallationQuery<boolean>): Promise<Installation> => {
    // Simple lookup: enterprise installs use enterprise_id, workspace installs use team_id
    const results = await db
      .select()
      .from(slackInstallations)
      .where(eq(getInstallationRow(query), getInstallationId(query)));

    if (results.length === 0) {
      throw new Error(
        `Installation not found for ${
          query.isEnterpriseInstall ? 'enterprise' : 'team'
        }: ${query.enterpriseId || query.teamId}`,
      );
    }

    const record = results[0];

    // Validate required fields
    if (!record.userId) {
      throw new Error('Invalid installation: missing userId');
    }

    // Convert database record back to Installation type
    const installation: Installation = {
      team: record.teamId
        ? {
            id: record.teamId,
            name: record.teamName ?? undefined,
          }
        : undefined,
      enterprise: record.enterpriseId
        ? {
            id: record.enterpriseId,
            name: record.enterpriseName ?? undefined,
          }
        : undefined,
      enterpriseUrl: record.enterpriseUrl ?? undefined,
      user: {
        id: record.userId,
        token: record.userToken ?? undefined,
        scopes: record.userScopes ?? undefined,
        refreshToken: record.userRefreshToken ?? undefined,
        expiresAt: record.userTokenExpiresAt ? Math.floor(record.userTokenExpiresAt.getTime() / 1000) : undefined,
      },
      bot:
        record.botToken && record.botId && record.botUserId
          ? {
              token: record.botToken,
              scopes: record.botScopes ?? [],
              id: record.botId,
              userId: record.botUserId,
              refreshToken: record.botRefreshToken ?? undefined,
              expiresAt: record.botTokenExpiresAt ? Math.floor(record.botTokenExpiresAt.getTime() / 1000) : undefined,
            }
          : undefined,
      incomingWebhook: record.incomingWebhookUrl
        ? {
            url: record.incomingWebhookUrl,
            channel: record.incomingWebhookChannel ?? undefined,
            channelId: record.incomingWebhookChannelId ?? undefined,
            configurationUrl: record.incomingWebhookConfigurationUrl ?? undefined,
          }
        : undefined,
      appId: record.appId ?? undefined,
      tokenType: (record.tokenType as 'bot') ?? undefined,
      isEnterpriseInstall: record.isEnterpriseInstall,
    };

    return installation;
  },

  deleteInstallation: async (query: InstallationQuery<boolean>) => {
    // Simple delete: enterprise installs use enterprise_id, workspace installs use team_id
    const whereConditions = eq(getInstallationRow(query), getInstallationId(query));

    await db.delete(slackInstallations).where(whereConditions);
  },
};

function getInstallationId(query: { isEnterpriseInstall?: boolean; enterpriseId?: string; teamId?: string }) {
  const id = query?.isEnterpriseInstall ? query.enterpriseId : query.teamId;
  if (!id) {
    throw new Error('Malformed installation query');
  }
  return id;
}

function getInstallationRow(query: { isEnterpriseInstall?: boolean }) {
  return query?.isEnterpriseInstall ? slackInstallations.enterpriseId : slackInstallations.teamId;
}
