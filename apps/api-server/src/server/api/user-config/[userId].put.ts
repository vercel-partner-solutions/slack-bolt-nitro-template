import { eventHandler, getRouterParam, readBody } from "h3";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userConfig } from "@slackbound/db";

interface UpdateConfigBody {
	sendingDomain?: string;
	shouldShowFullEmail?: boolean;
}

export default eventHandler(async (event) => {
	try {
		const userId = getRouterParam(event, "userId");

		if (!userId) {
			return {
				success: false,
				error: "User ID is required",
			};
		}

		const body = await readBody<UpdateConfigBody>(event);

		if (!body || (body.sendingDomain === undefined && body.shouldShowFullEmail === undefined)) {
			return {
				success: false,
				error: "At least one field (sendingDomain or shouldShowFullEmail) is required",
			};
		}

		// Check if user config exists
		const existingConfig = await db
			.select()
			.from(userConfig)
			.where(eq(userConfig.userId, userId))
			.limit(1);

		let result;

		if (existingConfig.length === 0) {
			// Create new config - sendingDomain is optional but recommended
			result = await db
				.insert(userConfig)
				.values({
					userId,
					sendingDomain: body.sendingDomain,
					shouldShowFullEmail: body.shouldShowFullEmail ?? false,
					updatedAt: new Date(),
				})
				.returning();
		} else {
			// Update existing config
			const updateData: {
				sendingDomain?: string;
				shouldShowFullEmail?: boolean;
				updatedAt: Date;
			} = {
				updatedAt: new Date(),
			};

			if (body.sendingDomain !== undefined) {
				updateData.sendingDomain = body.sendingDomain;
			}
			if (body.shouldShowFullEmail !== undefined) {
				updateData.shouldShowFullEmail = body.shouldShowFullEmail;
			}

			result = await db
				.update(userConfig)
				.set(updateData)
				.where(eq(userConfig.userId, userId))
				.returning();
		}

		return {
			success: true,
			data: result[0],
		};
	} catch (error) {
		console.error("Error updating user config:", error);
		return {
			success: false,
			error: "Failed to update user configuration",
		};
	}
});

