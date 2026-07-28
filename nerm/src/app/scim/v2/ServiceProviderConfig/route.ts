import { baseUrlFrom, scimJson } from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

/**
 * RFC 7643 §5. Advertised capabilities are the ones actually implemented —
 * claiming support we do not have would send clients down code paths that then
 * fail mid-aggregation.
 */
export async function GET(request: Request) {
  const baseUrl = baseUrlFrom(request);

  return scimJson({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: `${baseUrl}/docs/scim`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: true },
    etag: { supported: true },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication using a platform-issued bearer token',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${baseUrl}/scim/v2/ServiceProviderConfig`,
    },
  });
}
