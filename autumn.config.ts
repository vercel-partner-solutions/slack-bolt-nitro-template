import {
	feature,
	product,
	featureItem,
	pricedFeatureItem,
	priceItem,
} from "atmn";

// Features
export const seat = feature({
	id: "seat",
	name: "Seat",
	type: "continuous_use",
});

// Products
export const freeTier = product({
	id: "free_tier",
	name: "Free Tier",
	items: [
		featureItem({
			feature_id: seat.id,
			included_usage: 2,
		}),
	],
});

export const proPlan = product({
	id: "pro_plan",
	name: "Pro Plan",
	items: [
		pricedFeatureItem({
			feature_id: seat.id,
			price: 15,
			interval: "month",
			included_usage: 2,
			billing_units: 1,
			usage_model: "prepaid",
		}),
	],
});
