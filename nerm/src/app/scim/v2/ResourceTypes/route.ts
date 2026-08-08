import {
  CORE_GROUP_SCHEMA,
  CORE_USER_SCHEMA,
  ENTERPRISE_USER_SCHEMA,
  NERM_USER_SCHEMA,
  listResponse,
} from '@/lib/scim/mapper';
import { baseUrlFrom, scimJson } from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const baseUrl = baseUrlFrom(request);

  const resourceTypes = [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      description: 'Non-employees managed by the platform',
      schema: CORE_USER_SCHEMA,
      schemaExtensions: [
        { schema: ENTERPRISE_USER_SCHEMA, required: false },
        { schema: NERM_USER_SCHEMA, required: true },
      ],
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/scim/v2/ResourceTypes/User` },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'Vendor companies',
      schema: CORE_GROUP_SCHEMA,
      schemaExtensions: [],
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/scim/v2/ResourceTypes/Group` },
    },
  ];

  return scimJson(listResponse(resourceTypes, resourceTypes.length, 1, resourceTypes.length));
}
