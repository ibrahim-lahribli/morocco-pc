/**
 * Engine 5b - persistence input validation (Decision 19/20, validation only).
 * Validates the `selected` array from selectDiverseTop before persistence.
 * Pure: no DB, no I/O, no clock, no randomness, no mutation.
 * Category and build.currency are never read (Decision 19).
 * Decision 22 item 5: entry.explanation is REQUIRED non-empty string.
 */
'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { COMPONENT_ROLES } = require('../candidates/roles');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 3-letter uppercase code, no trim, no folding (mirrors assembly/prices.js).
const CURRENCY_RE = /^[A-Z]{3}$/;

// Hex groups 8-4-4-4-12 (mirrors assembly/prices.js; private there).
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Strict UTC ISO-8601 check (mirrors assembly/prices.js isUtcIsoTimestamp).
function isUtcIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  if (value.indexOf('T') === -1) return false;
  if (!/(Z|\+00:00)$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  if (Number.isNaN(Date.parse(canonical))) return false;
  const normalized = value.replace(/\+00:00$/, 'Z');
  if (Date.parse(normalized) !== parsed) return false;
  if (Date.parse(canonical) !== parsed) return false;
  return true;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validatePrice(price, cwhere) {
  if (price === undefined || price === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.price is required');
  }
  if (typeof price !== 'object' || Array.isArray(price)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price must be an object');
  }
  if (price.selected_price === undefined || price.selected_price === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.price.selected_price is required');
  }
  if (!isFiniteNumber(price.selected_price) || price.selected_price <= 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price.selected_price must be a finite number greater than 0');
  }
  if (price.currency === undefined || price.currency === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.price.currency is required');
  }
  if (typeof price.currency !== 'string' || !CURRENCY_RE.test(price.currency)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price.currency must match /^[A-Z]{3}$/');
  }
  if (price.store_id === undefined) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.price.store_id is required');
  }
  if (price.store_id !== null && !isUuid(price.store_id)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price.store_id must be a UUID or null');
  }
  if (price.price_checked_at === undefined) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.price.price_checked_at is required');
  }
  if (price.price_checked_at !== null && !isUtcIsoTimestamp(price.price_checked_at)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price.price_checked_at must be an ISO-8601 UTC timestamp or null');
  }
  if (price.store_id !== null && price.price_checked_at === null) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.price.store_id requires price_checked_at (migration 011 CHECK: store_id IS NULL OR price_checked_at IS NOT NULL)');
  }
}


function validateComponent(component, cwhere) {
  if (component === null || typeof component !== 'object' || Array.isArray(component)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + ' must be a component object');
  }
  if (component.product_id === undefined || component.product_id === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.product_id is required');
  }
  if (typeof component.product_id !== 'string' || component.product_id.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.product_id must be a non-empty string');
  }
  if (component.component_role === undefined || component.component_role === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.component_role is required');
  }
  if (typeof component.component_role !== 'string' || !COMPONENT_ROLES.includes(component.component_role)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.component_role "' + String(component.component_role) + '" is not one of the 9 component_role enum values');
  }
  if (component.status === undefined || component.status === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', cwhere + '.status is required');
  }
  if (component.status !== 'PASS' && component.status !== 'UNKNOWN') {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', cwhere + '.status must be exactly "PASS" or "UNKNOWN"');
  }
  validatePrice(component.price, cwhere);
}

function validateEntry(entry, index) {
  const where = 'selected[' + index + ']';
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + ' must be an object');
  }
  if (entry.total_price === undefined || entry.total_price === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.total_price is required');
  }
  if (!isFiniteNumber(entry.total_price) || entry.total_price <= 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.total_price must be a finite number greater than 0');
  }
  if (entry.build_score === undefined || entry.build_score === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.build_score is required');
  }
  if (!isFiniteNumber(entry.build_score) || entry.build_score < 0 || entry.build_score > 100) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.build_score must be a finite number in [0, 100]');
  }
  if (entry.compatibility_status === undefined || entry.compatibility_status === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.compatibility_status is required');
  }
  if (entry.compatibility_status !== 'PASS' && entry.compatibility_status !== 'UNKNOWN') {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.compatibility_status must be exactly "PASS" or "UNKNOWN"');
  }
  if (entry.explanation === undefined || entry.explanation === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.explanation is required');
  }
  if (typeof entry.explanation !== 'string' || entry.explanation.trim().length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.explanation must be a non-empty string');
  }
  if (entry.build === undefined || entry.build === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.build is required');
  }
  if (typeof entry.build !== 'object' || Array.isArray(entry.build)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.build must be an object');
  }
  if (entry.build.components === undefined || entry.build.components === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.build.components is required');
  }
  if (!Array.isArray(entry.build.components) || entry.build.components.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.build.components must be a non-empty array');
  }
  for (let c = 0; c < entry.build.components.length; c += 1) {
    validateComponent(entry.build.components[c], where + '.build.components[' + c + ']');
  }
}

function validateSelected(selected) {
  if (!Array.isArray(selected)) {
    fail(ERROR_CODES.INVALID_INPUT, 'selected', '"selected" must be an array');
  }
  if (selected.length === 0) {
    return undefined;
  }
  for (let i = 0; i < selected.length; i += 1) {
    const entry = selected[i];
    const where = 'selected[' + i + ']';
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + ' must be an object');
    }
    if (entry.persisted_rank === undefined || entry.persisted_rank === null) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'selected', where + '.persisted_rank is required');
    }
    if (!Number.isInteger(entry.persisted_rank) || entry.persisted_rank !== i + 1) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, 'selected', where + '.persisted_rank must be ' + (i + 1) + ' (contiguous integers starting at 1)');
    }
  }
  for (let i = 0; i < selected.length; i += 1) {
    validateEntry(selected[i], i);
  }
  return undefined;
}

module.exports = { validateSelected };

