import { eventHandler, getRouterParam } from "h3";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userConfig } from "@slackbound/db";
import { validateInternalRequest } from "../../../bolt/middleware/validate-internal-request";

export default eventHandler(async (event) => {
	// Validate internal API key
	await validateInternalRequest(event);
	
	try {
		const userId = getRouterParam(event, "userId");

		if (!userId) {
			return {
				success: false,
				error: "User ID is required",
			};
		}

		const config = await db
			.select()
			.from(userConfig)
			.where(eq(userConfig.userId, userId))
			.limit(1);

		if (config.length === 0) {
			return {
				success: false,
				error: "User configuration not found",
			};
		}

		return {
			success: true,
			data: config[0],
		};
	} catch (error) {
		console.error("Error fetching user config:", error);
		return {
			success: false,
			error: "Failed to fetch user configuration",
		};
	}
});

