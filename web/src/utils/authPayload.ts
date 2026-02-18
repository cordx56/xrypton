export function buildAuthPayload(): string {
  return JSON.stringify({
    nonce: {
      random: crypto.randomUUID(),
      time: new Date().toISOString(),
    },
  });
}
