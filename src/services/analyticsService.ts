import { auth } from '../lib/firebase';
import { UserRole } from '../types';

/**
 * Analytics Event Names
 */
export enum AnalyticsEvent {
  TENANT_ONBOARDED = 'Tenant_Onboarded_Successfully',
  ORDER_CREATED = 'Order_Created',
  MEASUREMENTS_ADDED = 'Measurements_Added',
  PAYMENT_COMPLETED = 'Payment_Completed',
  ORDER_DELIVERED = 'Order_Delivered',
  LOW_STOCK_ALERT = 'Low_Stock_Alert',
  SUBSCRIPTION_UPGRADED = 'Subscription_Upgraded',
  SUBSCRIPTION_RENEWED = 'Subscription_Renewed',
  SUBSCRIPTION_CHURNED = 'Subscription_Churned',
  MRR_UPDATE = 'MRR_Update',
}

/**
 * Super Properties for Tenant Isolation
 */
export interface SuperProperties {
  tenant_id: string;
  tenant_name: string;
  plan_type: string;
  category: string;
  user_id?: string;
  user_role?: UserRole;
  user_email?: string | null;
}

/**
 * Analytics Middleware Service
 * Acts as a CDP (Customer Data Platform) to route events to multiple destinations.
 */
class AnalyticsService {
  private superProperties: SuperProperties | null = null;
  private isInitialized = false;

  /**
   * Initialize the service with tenant and user context
   */
  public init(props: SuperProperties) {
    this.superProperties = props;
    this.isInitialized = true;
    console.log('[Analytics] Initialized with Super Properties:', props);
    
    // In a real scenario, you would call:
    // mixpanel.identify(props.user_id);
    // mixpanel.register(props);
  }

  /**
   * Track an event with properties
   */
  public track(event: AnalyticsEvent, properties: Record<string, any> = {}) {
    if (!this.isInitialized && event !== AnalyticsEvent.TENANT_ONBOARDED) {
      console.warn(`[Analytics] Event "${event}" tracked before initialization.`);
    }

    const payload = {
      ...this.superProperties,
      ...properties,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      user_agent: navigator.userAgent,
    };

    // Route to Console (Development)
    console.log(`[Analytics] Event: ${event}`, payload);

    // Route to Mixpanel (Simulated)
    this.routeToMixpanel(event, payload);

    // Route to Zoho Analytics (Simulated)
    this.routeToZoho(event, payload);
  }

  /**
   * Track a server-side event (Simulated)
   * Bypasses client-side ad-blockers by using a direct API call or backend proxy.
   */
  public trackServerSide(event: AnalyticsEvent, properties: Record<string, any> = {}) {
    console.log(`[Analytics-ServerSide] Event: ${event}`, {
      ...this.superProperties,
      ...properties,
      source: 'backend_sync',
    });
    
    // This would typically be a fetch() to a backend endpoint or a direct call to Mixpanel's /track API
  }

  private routeToMixpanel(event: string, payload: any) {
    // Simulated Mixpanel call
    // window.mixpanel.track(event, payload);
  }

  private routeToZoho(event: string, payload: any) {
    // Simulated Zoho Analytics call
    // fetch('https://analyticsapi.zoho.com/api/...', { method: 'POST', body: JSON.stringify(payload) });
  }
}

export const analytics = new AnalyticsService();
