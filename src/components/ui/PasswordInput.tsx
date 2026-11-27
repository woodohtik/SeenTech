import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconInput, IconInputProps } from './IconInput';

export type PasswordInputProps = Omit<IconInputProps, 'type' | 'endIcon'>;

/** seen-fields-unification-task.md #3: IconInput + زر إظهار/إخفاء -- يحل محل النسخ المحلية المكرَّرة (AddEmployeeModal.tsx وغيره). */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>((props, ref) => {
  const [show, setShow] = useState(false);
  const { t } = useTranslation();
  return (
    <IconInput
      ref={ref}
      type={show ? 'text' : 'password'}
      endIcon={
        // Named, and a 44px tap box around the icon (seen-ui-responsive-alignment-audit-task.md, finding 16).
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={t(show ? 'common.hide_password' : 'common.show_password')} aria-pressed={show}
          className="p-3 -m-3 rounded-full cursor-pointer">
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      }
      {...props}
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
