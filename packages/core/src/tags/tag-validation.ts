/**
 * Tag name normalization and validation.
 *
 * Rules:
 * - Max 20 characters
 * - Normalize: trim() + toLowerCase()
 * - Collapse multiple internal spaces to one
 * - Only alphanumeric (including áéíóúñü), hyphens, underscores, and single spaces
 * - Regex: /^[a-z0-9áéíóúñü][a-z0-9áéíóúñü _-]{0,18}[a-z0-9áéíóúñü]$/ (or single char)
 */

export const TAG_NAME_MAX_LENGTH = 20;

const TAG_NAME_REGEX = /^[a-z0-9áéíóúñü]([a-z0-9áéíóúñü _-]{0,18}[a-z0-9áéíóúñü])?$/;

export interface TagValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

export function normalizeTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function validateTagName(raw: string): TagValidationResult {
  const normalized = normalizeTagName(raw);

  if (normalized.length === 0) {
    return { valid: false, normalized, error: "Tag name cannot be empty." };
  }

  if (normalized.length > TAG_NAME_MAX_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `Tag name exceeds maximum length of ${TAG_NAME_MAX_LENGTH} characters.`
    };
  }

  if (!TAG_NAME_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Tag name contains invalid characters. Only letters, numbers, hyphens, underscores, and single spaces are allowed."
    };
  }

  return { valid: true, normalized };
}

export function assertValidTagName(raw: string): string {
  const result = validateTagName(raw);

  if (!result.valid) {
    throw new Error(result.error);
  }

  return result.normalized;
}
