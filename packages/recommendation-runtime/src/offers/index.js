/**
 * Engine 2 - Stage 1: offer pre-selection (public surface).
 *
 * Boundary-only barrel: re-exports selectOfferPrices without wrappers,
 * logic, orchestration, or additional contracts.
 */

'use strict';

const { selectOfferPrices, SELECT_OFFER_PRICES_SQL } = require('./select');

module.exports = { selectOfferPrices, SELECT_OFFER_PRICES_SQL };
