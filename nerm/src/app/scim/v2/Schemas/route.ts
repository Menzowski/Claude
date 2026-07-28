import {
  CORE_GROUP_SCHEMA,
  CORE_USER_SCHEMA,
  ENTERPRISE_USER_SCHEMA,
  NERM_USER_SCHEMA,
  listResponse,
} from '@/lib/scim/mapper';
import { baseUrlFrom, scimJson } from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

type Attr = {
  name: string;
  type: string;
  multiValued?: boolean;
  required?: boolean;
  mutability?: string;
  returned?: string;
  uniqueness?: string;
  caseExact?: boolean;
  canonicalValues?: string[];
  subAttributes?: Attr[];
};

function attr(name: string, type: string, extra: Partial<Attr> = {}): Attr {
  return {
    name,
    type,
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    ...extra,
  };
}

const userSchema = {
  id: CORE_USER_SCHEMA,
  name: 'User',
  description: 'A non-employee managed by the platform',
  attributes: [
    attr('userName', 'string', { required: true, uniqueness: 'server' }),
    attr('name', 'complex', {
      subAttributes: [attr('givenName', 'string'), attr('familyName', 'string'), attr('formatted', 'string')],
    }),
    attr('displayName', 'string'),
    attr('title', 'string'),
    attr('active', 'boolean'),
    attr('emails', 'complex', {
      multiValued: true,
      subAttributes: [attr('value', 'string'), attr('primary', 'boolean'), attr('type', 'string')],
    }),
  ],
};

const enterpriseSchema = {
  id: ENTERPRISE_USER_SCHEMA,
  name: 'EnterpriseUser',
  description: 'Enterprise User extension',
  attributes: [
    attr('department', 'string'),
    attr('manager', 'complex', {
      subAttributes: [attr('value', 'string'), attr('displayName', 'string', { mutability: 'readOnly' })],
    }),
  ],
};

/**
 * The extension that carries what makes a non-employee distinct. Exposing these
 * as first-class attributes is what lets Identity Security Cloud write policy
 * against risk tier and end date instead of parsing them out of a description.
 */
const nermSchema = {
  id: NERM_USER_SCHEMA,
  name: 'NonEmployee',
  description: 'Non-employee lifecycle and risk attributes',
  attributes: [
    attr('personType', 'string', {
      canonicalValues: ['CONTRACTOR', 'VENDOR', 'VOLUNTEER', 'INTERN', 'SERVICE'],
    }),
    attr('lifecycleState', 'string', {
      mutability: 'readOnly',
      canonicalValues: [
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'ACTIVE',
        'EXPIRING',
        'SUSPENDED',
        'INACTIVE',
        'REJECTED',
        'ARCHIVED',
      ],
    }),
    attr('riskTier', 'string', { canonicalValues: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }),
    attr('startDate', 'dateTime'),
    attr('endDate', 'dateTime'),
    attr('location', 'string'),
    attr('vendorCompany', 'complex', {
      mutability: 'readOnly',
      subAttributes: [attr('value', 'string'), attr('display', 'string')],
    }),
  ],
};

const groupSchema = {
  id: CORE_GROUP_SCHEMA,
  name: 'Group',
  description: 'A vendor company, projected as a group of its workers',
  attributes: [
    attr('displayName', 'string', { required: true }),
    attr('members', 'complex', {
      multiValued: true,
      mutability: 'readOnly',
      subAttributes: [attr('value', 'string'), attr('display', 'string')],
    }),
  ],
};

export async function GET(request: Request) {
  const baseUrl = baseUrlFrom(request);
  const schemas = [userSchema, enterpriseSchema, nermSchema, groupSchema].map((schema) => ({
    ...schema,
    meta: { resourceType: 'Schema', location: `${baseUrl}/scim/v2/Schemas/${schema.id}` },
  }));

  return scimJson(listResponse(schemas, schemas.length, 1, schemas.length));
}
