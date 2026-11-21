// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

// seen-permissions-fix-task.md Phase 4: pages follow permissions, not role lists.
const granted = new Set<string>(['orders.view', 'customers.view']);
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (k: string) => granted.has(k), loading: false }),
}));
vi.mock('./AccessDenied', () => ({ default: () => <div>access-denied</div> }));
vi.mock('./PageSkeleton', () => ({ default: () => <div>loading</div> }));

import { ProtectedRoute } from './ProtectedRoute';
import { NAVIGATION_CONFIG, getFilteredNavItems } from '../config/navigation';
import { SHOWN_PERMISSIONS } from '../constants/permissions';

const tailor = { id: 't1', role: 'tailor', tenantId: 'x', name: 't', email: 't@example.invalid', phone: '', status: 'active', createdAt: '' } as any;

describe('a tailor given customers.view', () => {
  test('sees Customers in the menu', () => {
    const item = getFilteredNavItems('tailor').find((i) => i.to === '/customers');
    expect(item?.permission).toBe('customers.view');
  });

  test("opens the page although the route's old role list does not name tailors", () => {
    render(
      <MemoryRouter>
        <ProtectedRoute allowedRoles={['owner', 'admin', 'manager', 'cashier']} permission="customers.view" userRole="tailor" staff={tailor}>
          <div>customers-page</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('customers-page')).toBeTruthy();
  });

  test('without the permission, the page is refused', () => {
    granted.delete('customers.view');
    render(
      <MemoryRouter>
        <ProtectedRoute allowedRoles={['owner', 'admin', 'manager', 'cashier', 'tailor']} permission="customers.view" userRole="tailor" staff={tailor}>
          <div>customers-page-2</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.queryByText('customers-page-2')).toBeNull();
    expect(screen.getByText('access-denied')).toBeTruthy();
    granted.add('customers.view');
  });
});

// Acceptance: no permission on the permissions screen controls nothing -- every
// shown key is checked somewhere in the app, the database or the server.
describe('every permission on the screen has an effect', () => {
  test('each shown key is used outside its own definitions', () => {
    const skip = ['constants/permissions.ts', 'services/permissionService.ts', 'shared/permissionsMatrix', '.test.', '/i18n/'];
    const texts: string[] = [fs.readFileSync('server.ts', 'utf-8')];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name).replace(/\\/g, '/');
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|sql)$/.test(p) && !skip.some((s) => p.includes(s))) {
          const t = fs.readFileSync(p, 'utf-8');
          texts.push(t.includes('-- END generated') ? t.split('-- END generated').pop()! : t);
        }
      }
    };
    walk('src');
    walk('supabase/migrations');
    const all = texts.join('\n');
    const unused = SHOWN_PERMISSIONS.map((p) => p.id).filter((k) => !all.includes(`'${k}'`));
    expect(unused).toEqual([]);
    expect(NAVIGATION_CONFIG.length).toBeGreaterThan(0);
  });
});
