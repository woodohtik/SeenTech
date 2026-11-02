import { test, expect } from 'vitest';
import { getPlanName, getSubscriptionInfo } from './tenantSubscription';
import type { Tenant, Plan } from '../types';

const plans: Plan[] = [
  { id: 'free', name: 'مجانية', price: 0, features: [], maxStaff: 1, maxOrders: 10 },
  { id: 'basic', name: 'أساسية', price: 99, features: [], maxStaff: 5, maxOrders: 1000 },
];

const baseTenant: Tenant = {
  id: 't1',
  name: 'محل تجريبي',
  ownerEmail: 'owner@example.com',
  phone: '0500000000',
  status: 'active',
  planId: 'basic',
  inventoryStrategy: 'centralized',
  createdAt: new Date().toISOString(),
};

test('getPlanName returns the matching plan name', () => {
  expect(getPlanName(plans, 'basic', 'خطة مخصصة')).toBe('أساسية');
});

test('getPlanName falls back to the custom-plan label when no plan matches', () => {
  expect(getPlanName(plans, 'nonexistent', 'خطة مخصصة')).toBe('خطة مخصصة');
});

const labels = { trialBadge: 'تجربة', paidSubscription: 'اشتراك مدفوع' };

test('getSubscriptionInfo treats a free planId as a trial, expiring 14 days after creation', () => {
  const createdAt = new Date();
  const tenant: Tenant = { ...baseTenant, planId: 'free', createdAt: createdAt.toISOString() };
  const info = getSubscriptionInfo(plans, tenant, labels);
  expect(info.isTrial).toBe(true);
  expect(info.type).toBe('تجربة');
  expect(info.daysLeft).toBeLessThanOrEqual(14);
  expect(info.daysLeft).toBeGreaterThan(12);
});

test('getSubscriptionInfo uses subscription_end_date as the expiry for a paid tenant when set', () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  const tenant: Tenant = { ...baseTenant, planId: 'basic', subscription_end_date: expiry.toISOString() };
  const info = getSubscriptionInfo(plans, tenant, labels);
  expect(info.isTrial).toBe(false);
  expect(info.type).toBe('اشتراك مدفوع');
  expect(info.expiryDate.toDateString()).toBe(expiry.toDateString());
  expect(info.daysLeft).toBeLessThanOrEqual(30);
  expect(info.daysLeft).toBeGreaterThan(28);
});

test('getSubscriptionInfo falls back to createdAt + 365 days for a paid tenant with no subscription_end_date', () => {
  const createdAt = new Date();
  const tenant: Tenant = { ...baseTenant, planId: 'basic', createdAt: createdAt.toISOString(), subscription_end_date: null };
  const info = getSubscriptionInfo(plans, tenant, labels);
  expect(info.isTrial).toBe(false);
  expect(info.daysLeft).toBeLessThanOrEqual(365);
  expect(info.daysLeft).toBeGreaterThan(363);
});

test('getSubscriptionInfo clamps progress between 0 and 100', () => {
  const expiredTenant: Tenant = {
    ...baseTenant,
    planId: 'basic',
    createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    subscription_end_date: new Date(Date.now() - 1000).toISOString(),
  };
  const info = getSubscriptionInfo(plans, expiredTenant, labels);
  expect(info.progress).toBeGreaterThanOrEqual(0);
  expect(info.progress).toBeLessThanOrEqual(100);
  expect(info.daysLeft).toBe(0);
});
