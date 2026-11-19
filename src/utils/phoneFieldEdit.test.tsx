// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatSaudiPhone } from './phoneUtils';

// Mirrors exactly how Customers.tsx wires its phone field (register() +
// a custom onBlur, uncontrolled input, same transform-based schema shape)
// so we can drive the real DOM input the way a browser would and see
// whether a mid-string edit really does break submission.
const phoneRegex = /^(\+?\d{1,3}[- ]?)?\d{8,12}$/;
const schema = z.object({
  name: z.string().min(2),
  phone: z.string().transform((val) => formatSaudiPhone(val)).pipe(z.string().regex(phoneRegex)),
});

function TestForm({ onSubmit, defaultPhone }: { onSubmit: (data: any) => void; defaultPhone: string }) {
  const { register, handleSubmit, setValue } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: 'Test Customer', phone: defaultPhone },
  });
  return (
    <form onSubmit={handleSubmit(onSubmit, (errors) => onSubmit({ __invalid: true, errors }))}>
      <input
        aria-label="phone"
        {...register('phone')}
        onBlur={(e) => setValue('phone', formatSaudiPhone(e.target.value))}
      />
      <button type="submit">save</button>
    </form>
  );
}

/** Simulates clicking into the middle of an existing value and editing one
 * digit there, the way a real cursor-positioned edit works -- not just
 * replacing the whole string. */
function editAtPosition(input: HTMLInputElement, position: number, deleteCount: number, insert: string) {
  const current = input.value;
  const next = current.slice(0, position) + insert + current.slice(position + deleteCount);
  input.setSelectionRange(position, position);
  fireEvent.input(input, { target: { value: next } });
}

afterEach(cleanup);

describe('editing an existing phone number mid-string', () => {
  test('changing one digit in the middle of an already +966-formatted number still submits', async () => {
    const onSubmit = (data: any) => { (window as any).__result = data; };
    render(<TestForm onSubmit={onSubmit} defaultPhone="+966501234567" />);
    const input = screen.getByLabelText('phone') as HTMLInputElement;
    // "+966501234567" -> change the "5" right after +966 to "5" then "0"->"1"
    // at position 7 (the digit right after "+96650"), mimicking a real fix.
    editAtPosition(input, 7, 1, '9');
    fireEvent.blur(input);
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect((window as any).__result).toBeDefined());
    expect((window as any).__result.__invalid).not.toBe(true);
    delete (window as any).__result;
  });

  test('replacing a leading 05-number digit by digit still submits', async () => {
    const onSubmit = (data: any) => { (window as any).__result = data; };
    render(<TestForm onSubmit={onSubmit} defaultPhone="0501234567" />);
    const input = screen.getByLabelText('phone') as HTMLInputElement;
    editAtPosition(input, 2, 1, '9');
    fireEvent.blur(input);
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect((window as any).__result).toBeDefined());
    expect((window as any).__result.__invalid).not.toBe(true);
    delete (window as any).__result;
  });

  test('saving without touching the phone field at all still submits (field never focused)', async () => {
    const onSubmit = (data: any) => { (window as any).__result = data; };
    render(<TestForm onSubmit={onSubmit} defaultPhone="+966501234567" />);
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect((window as any).__result).toBeDefined());
    expect((window as any).__result.__invalid).not.toBe(true);
    delete (window as any).__result;
  });
});
