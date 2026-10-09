/** Shared settings for the province map scripts. */

/** About 1 km: vertices the server may move when simplifying (0.01° of latitude ≈ 1.1 km). */
export const SIMPLIFY = 0.01;
export const QUANTIZATION = 3e4;

/**
 * Smallest hole kept per layer (km²). Region holes this small are gaps between simplified
 * neighbours; small local holes are filled and the enclave inside is drawn on top instead.
 */
export const HOLE_LIMITS = { regions: { minHoleKm2: 50 }, local: { minHoleKm2: 3 } };
