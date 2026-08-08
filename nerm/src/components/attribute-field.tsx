import type { AttributeDefinition } from '@prisma/client';
import { Lock } from 'lucide-react';

/**
 * Renders one configured attribute as a form field.
 *
 * The form is generated from `AttributeDefinition` rows, so adding a field to a
 * profile type is a configuration change — nobody edits a React component to
 * capture a new piece of information about a contractor.
 */
export function AttributeField({
  definition,
  defaultValue,
}: {
  definition: AttributeDefinition;
  defaultValue?: string | number | boolean | null;
}) {
  const name = `attr:${definition.key}`;
  const sensitive =
    definition.sensitivity === 'PII' || definition.sensitivity === 'SENSITIVE_PII';

  const describedBy = definition.helpText ? `${name}-help` : undefined;

  return (
    <div>
      <label htmlFor={name} className="label mb-1.5">
        {definition.label}
        {definition.required && (
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        )}
        {sensitive && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <Lock className="h-3 w-3" />
            {definition.sensitivity === 'SENSITIVE_PII' ? 'Sensitive' : 'Personal data'}
          </span>
        )}
      </label>

      {renderControl(definition, name, describedBy, defaultValue)}

      {definition.helpText && (
        <p id={describedBy} className="mt-1 text-xs text-muted-foreground">
          {definition.helpText}
        </p>
      )}
    </div>
  );
}

function renderControl(
  definition: AttributeDefinition,
  name: string,
  describedBy: string | undefined,
  defaultValue?: string | number | boolean | null,
) {
  const common = {
    id: name,
    name,
    required: definition.required,
    'aria-describedby': describedBy,
    className: 'input',
  } as const;

  switch (definition.kind) {
    case 'TEXT':
      return <textarea {...common} rows={3} defaultValue={String(defaultValue ?? '')} />;

    case 'BOOLEAN':
      return (
        <label className="flex items-center gap-2 py-1 text-sm">
          <input
            id={name}
            name={name}
            type="checkbox"
            defaultChecked={Boolean(defaultValue)}
            aria-describedby={describedBy}
            className="h-4 w-4 rounded border-input"
          />
          Yes
        </label>
      );

    case 'SELECT': {
      const options = Array.isArray(definition.options)
        ? (definition.options as { value: string; label: string }[])
        : [];
      return (
        <select {...common} defaultValue={String(defaultValue ?? '')}>
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    case 'NUMBER':
      return <input {...common} type="number" defaultValue={String(defaultValue ?? '')} />;

    case 'DATE':
      return <input {...common} type="date" defaultValue={String(defaultValue ?? '')} />;

    case 'EMAIL':
      return <input {...common} type="email" defaultValue={String(defaultValue ?? '')} />;

    case 'PHONE':
      return <input {...common} type="tel" defaultValue={String(defaultValue ?? '')} />;

    default:
      return <input {...common} type="text" defaultValue={String(defaultValue ?? '')} />;
  }
}
