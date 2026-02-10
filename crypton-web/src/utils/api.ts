import { z } from "zod";

export const ApiSchema = {
  notification: {
    publicKey: {
      response: z.object({ key: z.string() }),
    },
  },
};

export const ApiCall = (domain: string) => {
  const baseUrl = `https://${domain}`;
  return {
    user: {
      getKeys: async (userId: string) => {
        const resp = await fetch(new URL(`/user/${userId}/pubkeys.asc`, baseUrl));
        if (!resp.ok) {
          throw new Error("failed to fetch user public key");
        }
        return resp.text();
      },
      postKeys: async (userId: string, keys: string) => {
        const resp = await fetch(new URL(`/user/${userId}/pubkeys.asc`, baseUrl), { method: "POST", body: keys });
        if (!resp.ok) {
          throw new Error("failed to set user public key");
        }
      },
    },
    notification: {
      publicKey: async () => {
        const resp = await fetch(new URL("/notification/public-key", baseUrl));
        if (!resp.ok) {
          throw new Error("failed to fetch notification public key");
        }
        const parsed = ApiSchema.notification.publicKey.response.parse(
          await resp.json(),
        );
        return parsed.key;
      },
      subscribe: async (subscription: PushSubscription) => {
        await fetch(new URL("/notification/subscribe", baseUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      },
    },
  };
};
