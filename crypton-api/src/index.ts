import { Hono } from "hono";
import { put, get } from "./storage";
import { get_signing_sub_key_id, get_pub_key_user_ids } from "crypton-wasm";
import { WasmReturnValue } from "crypton-common";

const app = new Hono();

app.get("/", (c) => {
  return c.text("");
});

app.get("/user/:id/pubkeys.asc", async (c) => {
  const data = await get(`user-data/user/${c.req.param("id")}/pubkeys.asc`);
  return new Response(data);
});

app.post("/user/:id/pubkeys.asc", async (c) => {
  const body = await c.req.text();
  const id = c.req.param("id");
  const user_ids = WasmReturnValue.safeParse(get_pub_key_user_ids(id));
  if (
    !user_ids.success ||
    user_ids.data.result !== "ok" ||
    !user_ids.data.value.map((v) => v.data).includes(id)
  ) {
    return Response.json({ success: false }, { status: 400 });
  }
  const parsed = WasmReturnValue.safeParse(get_signing_sub_key_id(body));
  if (parsed.success && parsed.data.result === "ok") {
    await put(`user-data/user/${id}/pubkeys.asc`, body);
    return Response.json({ success: true });
  } else {
    return Response.json({ success: false }, { status: 400 });
  }
});

export default app;
