export const MIN_PASSPHRASE_LENGTH = 4;

export function hasMinPassphraseLength(value: string): boolean {
  return value.length >= MIN_PASSPHRASE_LENGTH;
}

export function allPassphrasesMeetMinLength(...values: string[]): boolean {
  return values.every(hasMinPassphraseLength);
}
