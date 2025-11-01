import { eventHandler, getRouterParam } from "h3";
import { validateInternalRequest } from "../../../../bolt/middleware/validate-internal-request";
import { db } from "../../../db";
import { workspaceConfig } from "@slackbound/db";
import { eq } from "drizzle-orm";

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

		const config = await db
			.select()
			.from(workspaceConfig)
			.where(eq(workspaceConfig.teamId, teamId))
			.limit(1);

		if (config.length === 0) {
			return {
				success: true,
				data: {
					shouldShowFullEmail: false,
					sendingDomain: null,
				},
			};
		}

		return {
			success: true,
			data: {
				shouldShowFullEmail: config[0].shouldShowFullEmail ?? false,
				sendingDomain: config[0].sendingDomain ?? null,
			},
		};
	} catch (error) {
		console.error("Error fetching workspace config:", error);
		return {
			success: false,
			error: "Failed to fetch workspace configuration",
		};
	}
});

