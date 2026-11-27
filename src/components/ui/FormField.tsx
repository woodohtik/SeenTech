import React, { useId } from 'react';
import { cn } from '../../lib/utils';

/**
 * One field (seen-ui-responsive-alignment-audit-task.md, phase 1; DESIGN.md
 * §7): the label (16px, tied to the control by id), its required mark, an
 * optional action that stays inside the label's line ("+ إضافة خياط"), the
 * control, then help or an error under it.
 *
 * Inside a FormRow every field takes the same three grid rows (label,
 * control, help) through subgrid -- so the controls of a row line up even
 * when one label wraps to two lines, one field has an action, or one has no
 * help. A field without a visible label still needs one: `labelHidden`.
 *
 * children: (id, describedBy) => the control, with that id.
 */
export interface FormFieldProps {
  label: React.ReactNode;
  required?: boolean;
  /** A small action on the label's line, e.g. "+ إضافة خياط". */
  action?: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  /** The label is read by screen readers but not shown (its row is still kept). */
  labelHidden?: boolean;
  className?: string;
  /** A fixed id for the control (otherwise one is made). */
  id?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}

export function FormField({ label, required, action, help, error, labelHidden, className, id, children }: FormFieldProps) {
  const made = useId();
  const controlId = id ?? `field-${made.replace(/:/g, '')}`;
  const helpId = `${controlId}-help`;
  const describedBy = error || help ? helpId : undefined;
  return (
    <div data-form-field className={cn('grid grid-rows-subgrid row-span-3 gap-y-1.5 min-w-0', className)}>
      <div data-form-field-label className={cn('flex items-end justify-between gap-2 min-h-6', labelHidden && 'sr-only')}>
        <label htmlFor={controlId} className="text-base font-bold text-content leading-6">
          {label}
          {required && <span className="text-danger ms-0.5" aria-hidden="true">*</span>}
        </label>
        {action && <span className="shrink-0 h-6 flex items-center text-sm font-bold">{action}</span>}
      </div>
      <div className="min-w-0">{children(controlId, describedBy)}</div>
      <div className="min-h-0">
        {error ? (
          <p id={helpId} role="alert" className="text-sm font-bold text-danger">{error}</p>
        ) : help ? (
          <p id={helpId} className="text-sm text-content-muted">{help}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row of FormFields whose controls always line up: one column on a narrow
 * container, `columns` from 640px of the container (as FormGrid measures).
 */
export function FormRow({ columns = 2, className, children }: { columns?: 1 | 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  return (
    <div className="@container w-full">
      <div className={cn(
        'grid grid-cols-1 gap-x-4 gap-y-4',
        columns === 2 && '@[640px]:grid-cols-2',
        columns === 3 && '@[640px]:grid-cols-3',
        columns === 4 && '@[640px]:grid-cols-2 @[900px]:grid-cols-4',
        className,
      )}>
        {children}
      </div>
    </div>
  );
}
