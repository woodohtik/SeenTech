import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconInput, IconInputProps } from './IconInput';

export interface PasswordInputProps extends Omit<IconInputProps, 'type' | 'endIcon'> {}

/** seen-fields-unification-task.md #3: IconInput + زر إظهار/إخفاء -- يحل محل النسخ المحلية المكرَّرة (AddEmployeeModal.tsx وغيره). */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>((props, ref) => {
  const [show, setShow] = useState(false);
  return (
    <IconInput
      ref={ref}
      type={show ? 'text' : 'password'}
      endIcon={
        <button type="button" onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      }
      {...props}
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
