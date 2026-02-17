export async function GET(request: Request) {
  const url = new URL(request.url);
  const hostname = process.env.NEXT_PUBLIC_SERVER_HOSTNAME || url.host;
  const origin = `https://${hostname}`;

  return Response.json({
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "Xrypton",
    client_uri: origin,
    grant_types: ["authorization_code", "refresh_token"],
    scope: "atproto transition:generic",
    response_types: ["code"],
    redirect_uris: [`${origin}/atproto/callback`],
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: "none",
    application_type: "web",
  });
}
