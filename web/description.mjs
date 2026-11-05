export const MAX_DESCRIPTION_LENGTH = 8000;

export function isValidDescription(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_DESCRIPTION_LENGTH;
}
