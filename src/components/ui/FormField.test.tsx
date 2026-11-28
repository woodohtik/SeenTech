// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FormField, FormRow } from './FormField';

// seen-ui-responsive-alignment-audit-task.md, phase 1: one field component --
// the label tied to its control, a label action that stays on the label's
// line, help or error under the control -- in a row that keeps controls aligned.
afterEach(cleanup);

describe('FormField', () => {
  it('ties the label to the control (by id), with the required mark', () => {
    render(<FormField label="الكمية" required>{(id) => <input id={id} />}</FormField>);
    expect(screen.getByLabelText(/الكمية/)).toBeTruthy();
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('a label action sits in the label line, not above the control', () => {
    render(<FormField label="الخياط المسؤول" action={<button type="button">+ إضافة خياط</button>}>{(id) => <input id={id} />}</FormField>);
    const action = screen.getByRole('button', { name: '+ إضافة خياط' });
    expect(action.closest('[data-form-field-label]')).toBeTruthy();
  });

  it('an error is announced and described on the control', () => {
    render(<FormField label="السعر" error="السعر مطلوب">{(id, describedBy) => <input id={id} aria-describedby={describedBy} />}</FormField>);
    expect(screen.getByRole('alert').textContent).toBe('السعر مطلوب');
    expect(screen.getByLabelText('السعر').getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('in a FormRow every field takes the same three rows (label, control, help)', () => {
    const { container } = render(
      <FormRow columns={3}>
        <FormField label="الصنف">{(id) => <input id={id} />}</FormField>
        <FormField label="سعر الشراء (التكلفة) للمتر، وهو طويل">{(id) => <input id={id} />}</FormField>
      </FormRow>,
    );
    const fields = container.querySelectorAll('[data-form-field]');
    expect(fields).toHaveLength(2);
    for (const f of fields) expect(f.className).toContain('grid-rows-subgrid');
  });
});
