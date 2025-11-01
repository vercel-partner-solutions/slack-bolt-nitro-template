import { eventHandler, getRouterParam, readBody } from "h3";
import { validateInternalRequest } from "../../../../bolt/middleware/validate-internal-request";
import { db } from "../../../db";
import { workspaceConfig } from "@slackbound/db";
import { eq } from "drizzle-orm";

interface UpdateConfigBody {
	shouldShowFullEmail?: boolean;
	sendingDomain?: string | null;
}

export default eventHandler(async (event) => {
	await validateInternalRequest(event);

	const teamId = getRouterParam(event, "teamId");

	if (!teamId) {
		return {
			success: false,
			error: "teamId is required",
		};
	}

	try {
		const body = await readBody<UpdateConfigBody>(event);

		if (body.shouldShowFullEmail === undefined && body.sendingDomain === undefined) {
			return {
				success: false,
				error: "At least one field is required",
			};
		}

		const existingConfig = await db
			.select()
			.from(workspaceConfig)
			.where(eq(workspaceConfig.teamId, teamId))
			.limit(1);

		let result;

		if (existingConfig.length === 0) {
			// Create new config
			const values: {
				teamId: string;
				shouldShowFullEmail?: boolean;
				sendingDomain?: string | null;
				emailIntegrationEnabled: boolean;
				updatedAt: Date;
			} = {
				teamId,
				emailIntegrationEnabled: true,
				updatedAt: new Date(),
			};
			
			if (body.shouldShowFullEmail !== undefined) {
				values.shouldShowFullEmail = body.shouldShowFullEmail;
			}
			
			if (body.sendingDomain !== undefined) {
				values.sendingDomain = body.sendingDomain;
			}
			
			result = await db
				.insert(workspaceConfig)
				.values(values)
				.returning();
		} else {
			// Update existing config
			const updateValues: {
				shouldShowFullEmail?: boolean;
				sendingDomain?: string | null;
				updatedAt: Date;
			} = {
				updatedAt: new Date(),
			};
			
			if (body.shouldShowFullEmail !== undefined) {
				updateValues.shouldShowFullEmail = body.shouldShowFullEmail;
			}
			
			if (body.sendingDomain !== undefined) {
				updateValues.sendingDomain = body.sendingDomain;
			}
			
			result = await db
				.update(workspaceConfig)
				.set(updateValues)
				.where(eq(workspaceConfig.teamId, teamId))
				.returning();
		}

		return {
			success: true,
			data: result[0],
		};
	} catch (error) {
		console.error("Error updating workspace config:", error);
		return {
			success: false,
			error: "Failed to update workspace configuration",
		};
	}
});

