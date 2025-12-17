import { z } from "zod";

export const Notification = z.object({
  encrypted: z.string(),
});

export const WasmResultData = z.union([
  z.object({ type: z.literal("string"), data: z.string() }),
  z.object({ type: z.literal("base64"), data: z.string() }),
]);

export const WasmReturnValue = z.union([
  z.object({ result: z.literal("ok"), value: z.array(WasmResultData) }),
  z.object({ result: z.literal("error"), message: z.string() }),
]);
