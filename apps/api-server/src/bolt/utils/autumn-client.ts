import { Autumn } from 'autumn-js';

/**
 * Get Autumn API key from environment
 */
function getAutumnApiKey(): string {
	const apiKey = process.env.AUTUMN_API_KEY;
	if (!apiKey) {
		throw new Error('AUTUMN_API_KEY environment variable is not set');
	}
	return apiKey;
}

/**
 * Initialize Autumn client
 */
function getAutumnClient(): Autumn {
	return new Autumn({ secretKey: getAutumnApiKey() });
}

/**
 * Check if a customer has available seats
 * 
 * @param customerId - WorkOS organization ID
 * @returns Object with allowed status and current usage
 */
export async function checkSeatAvailability(customerId: string): Promise<{
	allowed: boolean;
	currentUsage: number;
	limit: number;
}> {
	try {
		const autumn = getAutumnClient();
		const result = await autumn.check({
			customer_id: customerId,
			feature_id: 'seat',
		});

	return {
		allowed: result.data?.allowed ?? false,
		currentUsage: result.data?.usage ?? 0,
		limit: result.data?.included_usage ?? 0,
	};
	} catch (error) {
		console.error('[Autumn] Error checking seat availability:', error);
		throw error;
	}
}

/**
 * Track seat usage for a customer
 * Increments the seat count when value is positive, decrements when negative
 * 
 * @param customerId - WorkOS organization ID
 * @param value - Number of seats to add (positive) or remove (negative)
 * @param idempotencyKey - Optional idempotency key for deduplication
 */
export async function trackSeatUsage(
	customerId: string,
	value: number,
	idempotencyKey?: string,
): Promise<void> {
	try {
		const autumn = getAutumnClient();
		await autumn.track({
			customer_id: customerId,
			feature_id: 'seat',
			value,
			...(idempotencyKey && { idempotency_key: idempotencyKey }),
		});

		console.log(`[Autumn] Tracked ${value} seat(s) for customer ${customerId}`);
	} catch (error) {
		console.error('[Autumn] Error tracking seat usage:', error);
		throw error;
	}
}

/**
 * Get current seat count for a customer
 * 
 * @param customerId - WorkOS organization ID
 * @returns Current number of seats in use
 */
export async function getSeatCount(customerId: string): Promise<number> {
	try {
		const autumn = getAutumnClient();
		const result = await autumn.check({
			customer_id: customerId,
			feature_id: 'seat',
		});

		return result.data?.usage ?? 0;
	} catch (error) {
		console.error('[Autumn] Error getting seat count:', error);
		throw error;
	}
}

/**
 * Attach a product to a customer
 * This is used when a workspace first installs or upgrades their plan
 * 
 * @param customerId - WorkOS organization ID
 * @param productId - Product ID from autumn.config.ts ('free_tier' or 'pro_plan')
 */
export async function attachProduct(
	customerId: string,
	productId: string,
): Promise<void> {
	try {
		const autumn = getAutumnClient();
		await autumn.attach({
			customer_id: customerId,
			product_id: productId,
		});

		console.log(`[Autumn] Attached product ${productId} to customer ${customerId}`);
	} catch (error) {
		console.error('[Autumn] Error attaching product:', error);
		throw error;
	}
}

/**
 * Update customer metadata in Autumn
 * This makes customers searchable and identifiable in the Autumn dashboard
 * 
 * @param customerId - WorkOS organization ID
 * @param name - Customer name (e.g., Slack workspace name)
 * @param email - Optional customer email
 */
export async function updateCustomerMetadata(
	customerId: string,
	name: string,
	email?: string,
): Promise<void> {
	try {
		const autumn = getAutumnClient();
		await autumn.customers.update(customerId, {
			name,
			...(email && { email }),
		});

		console.log(`[Autumn] Updated customer metadata for ${customerId}: ${name}`);
	} catch (error) {
		console.error('[Autumn] Error updating customer metadata:', error);
		// Don't throw - this is non-critical metadata update
	}
}

