import type { Installation, InstallationQuery, InstallationStore } from '@slack/bolt';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../server/db';
import { encrypt, decrypt } from './encryption';

/**
 * Installation store for managing multi-workspace bot installations
 * Implements Bolt's InstallationStore interface
 */
export const installationStore: InstallationStore = {
  /**
   * Store a new installation or update an existing one
   */
  async storeInstallation(installation: Installation): Promise<void> {
    const teamId = installation.team?.id;
    const enterpriseId = installation.enterprise?.id;
    
    if (!teamId) {
      throw new Error('Installation missing team ID');
    }
    
    const botToken = installation.bot?.token;
    if (!botToken) {
      throw new Error('Installation missing bot token');
    }
    
    // Encrypt bot token before storage
    const encryptedToken = encrypt(botToken);
    
    // Check if installation already exists
    const existing = await db.query.workspaceInstallations.findFirst({
      where: eq(schema.workspaceInstallations.teamId, teamId),
    });
    
    const installationData = {
      teamId,
      enterpriseId: enterpriseId || null,
      teamName: installation.team?.name || 'Unknown',
      teamUrl: (installation as any).team?.url || null,
      botUserId: installation.bot?.id || '',
      botAccessToken: encryptedToken,
      botRefreshToken: installation.bot?.refreshToken || null,
      scopes: installation.bot?.scopes?.join(',') || '',
      isActive: true,
      uninstalledAt: null,
      updatedAt: new Date(),
    };
    
    if (existing) {
      // Update existing installation
      await db
        .update(schema.workspaceInstallations)
        .set(installationData)
        .where(eq(schema.workspaceInstallations.teamId, teamId));
      
      console.log(`[InstallationStore] Updated installation for team: ${teamId}`);
    } else {
      // Insert new installation
      // Note: installedBy will need to be set by the OAuth callback handler
      // For now, we'll use 'system' as a placeholder
      await db.insert(schema.workspaceInstallations).values({
        ...installationData,
        installedBy: 'system', // This should be overridden by OAuth callback
        installedAt: new Date(),
        createdAt: new Date(),
      });
      
      console.log(`[InstallationStore] Created new installation for team: ${teamId}`);
    }
  },

  /**
   * Fetch an installation by team ID and/or enterprise ID
   */
  async fetchInstallation(
    installQuery: InstallationQuery<boolean>
  ): Promise<Installation> {
    // Build query conditions based on what's provided
    const conditions = [];
    
    // Priority: enterpriseId + teamId > teamId > enterpriseId
    if (installQuery.enterpriseId && installQuery.teamId) {
      conditions.push(
        and(
          eq(schema.workspaceInstallations.enterpriseId, installQuery.enterpriseId),
          eq(schema.workspaceInstallations.teamId, installQuery.teamId)
        )
      );
    } else if (installQuery.teamId) {
      conditions.push(eq(schema.workspaceInstallations.teamId, installQuery.teamId));
    } else if (installQuery.enterpriseId) {
      conditions.push(eq(schema.workspaceInstallations.enterpriseId, installQuery.enterpriseId));
    } else {
      throw new Error('Installation query missing team or enterprise ID');
    }
    
    // Query with isActive filter
    const result = await db.query.workspaceInstallations.findFirst({
      where: and(
        conditions[0],
        eq(schema.workspaceInstallations.isActive, true)
      ),
    });
    
    if (!result) {
      throw new Error(
        `Installation not found for team: ${installQuery.teamId || 'unknown'}`
      );
    }
    
    // Decrypt token
    const decryptedToken = decrypt(result.botAccessToken);
    
    // Return installation in Bolt's expected format
    return {
      team: {
        id: result.teamId,
        name: result.teamName,
      },
      enterprise: result.enterpriseId
        ? { id: result.enterpriseId }
        : undefined,
      bot: {
        token: decryptedToken,
        id: result.botUserId,
        userId: result.botUserId,
        scopes: result.scopes.split(','),
        refreshToken: result.botRefreshToken || undefined,
      },
      user: {
        token: undefined,
        scopes: undefined,
        id: result.installedBy,
      },
      isEnterpriseInstall: !!result.enterpriseId,
    };
  },

  /**
   * Delete an installation (soft delete - marks as inactive)
   */
  async deleteInstallation(
    installQuery: InstallationQuery<boolean>
  ): Promise<void> {
    const teamId = installQuery.teamId;
    
    if (!teamId) {
      throw new Error('Cannot delete installation without team ID');
    }
    
    // Soft delete - mark as inactive
    await db
      .update(schema.workspaceInstallations)
      .set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceInstallations.teamId, teamId));
    
    console.log(`[InstallationStore] Deleted installation for team: ${teamId}`);
  },
};

