import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';
import { encodeOrderPayload, decodeOrderPayload, decodeOrderRow } from '../../utils/orderHistoryHelper';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
if (supabaseUrl?.endsWith('/')) {
    supabaseUrl = supabaseUrl.slice(0, -1);
}
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const isPlaceholder = !supabaseUrl || (supabaseUrl && supabaseUrl.includes('placeholder')) || !supabaseUrl.startsWith('http');

if (isPlaceholder) {
    console.error(
        '[CRITICAL] Missing or invalid Supabase environment variables. Login and registration will fail.'
    );
}

export const supabase: SupabaseClient<any> =
    (globalThis as any).__supabase__ ??
    createClient<any>(
        supabaseUrl || 'https://missing-supabase-url.local',
        supabaseAnonKey || 'missing-key',
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
            global: {
                headers: { 'x-client-info': 'wdooh-web' },
                fetch: async (url, options) => {
                    const headers = new Headers(options?.headers);

                    // SECURITY: We intentionally do NOT send a client-controlled
                    // `x-tenant-id` header. Tenant isolation is derived server-side
                    // from the verified JWT (see app_current_tenant_id() in
                    // fix-rls.sql). Trusting a client header here previously allowed
                    // any user to impersonate any tenant by editing localStorage.
                    //
                    // The Authorization header itself is set by supabase-js from the
                    // persisted session before this fetch override runs — no manual
                    // token injection is needed here.

                    const urlStr = typeof url === 'string' ? url : (url && typeof url === 'object' && 'url' in url) ? (url as any).url : '';
                    const isOrdersRequest = urlStr.includes('/rest/v1/orders');
                    const isTenantsRequest = urlStr.includes('/rest/v1/tenants');

                    let modifiedOptions = options;

                    // Intercept writing requests (POST/PATCH/PUT) to encode raw 'history' into encoded string inside 'notes'
                    if (isOrdersRequest && options?.body && (options.method === 'POST' || options.method === 'PATCH' || options.method === 'PUT')) {
                        try {
                            const rawBody = typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body as any);
                            let parsedBody = JSON.parse(rawBody);

                            // If PATCH or PUT, dynamically retrieve existing order to merge virtual columns and prevent data loss
                            if (options.method === 'PATCH' || options.method === 'PUT') {
                                let orderId = parsedBody.id;
                                if (!orderId) {
                                    const match = urlStr.match(/orders\?id=eq\.([a-f0-9-]{36})/i);
                                    if (match) {
                                        orderId = match[1];
                                    }
                                }

                                if (orderId) {
                                    const baseUrl = urlStr.split('?')[0];
                                    const fetchUrl = `${baseUrl}?id=eq.${orderId}`;
                                    try {
                                        const getRes = await window.fetch(fetchUrl, { method: 'GET', headers });
                                        if (getRes.ok) {
                                            const text = await getRes.text();
                                            if (text) {
                                                const data = JSON.parse(text);
                                                const existingRaw = Array.isArray(data) ? data[0] : data;
                                                if (existingRaw) {
                                                    const decodedExisting = decodeOrderRow(existingRaw);
                                                    // Merge missing virtual columns
                                                    if (!('items' in parsedBody) && decodedExisting.items) {
                                                        parsedBody.items = decodedExisting.items;
                                                    }
                                                    if (!('history' in parsedBody) && decodedExisting.history) {
                                                        parsedBody.history = decodedExisting.history;
                                                    }
                                                    if (!('subtotal_amount' in parsedBody) && decodedExisting.subtotal_amount !== undefined) {
                                                        parsedBody.subtotal_amount = decodedExisting.subtotal_amount;
                                                    }
                                                }
                                            }
                                        }
                                    } catch (fetchErr) {
                                        console.warn('[Supabase Fetch Interceptor] Failed to fetch existing order for merge:', fetchErr);
                                    }
                                }
                            }

                            const encodedBody = encodeOrderPayload(parsedBody);
                            modifiedOptions = {
                                ...options,
                                body: JSON.stringify(encodedBody)
                            };
                        } catch (err) {
                            console.error('[Supabase Fetch Interceptor] Failed to encode orders request body:', err);
                        }
                    }

                    const responsePromise = fetch(url, { ...modifiedOptions, headers });

                    // Intercept fetched requests to decode 'history' back from 'notes'
                    if (isOrdersRequest) {
                        return responsePromise.then(async (res) => {
                            if (res.ok) {
                                const clonedRes = res.clone();
                                try {
                                    const text = await clonedRes.text();
                                    if (!text) return res;
                                    const parsed = JSON.parse(text);
                                    const decoded = decodeOrderPayload(parsed);
                                    return new Response(JSON.stringify(decoded), {
                                        status: res.status,
                                        statusText: res.statusText,
                                        headers: res.headers
                                    });
                                } catch (err) {
                                    console.warn('[Supabase Fetch Interceptor] Failed to decode orders response (likely network disconnect):', err);
                                    return res;
                                }
                            }
                            return res;
                        });
                    }

                    if (isTenantsRequest) {
                        return responsePromise.then(async (res) => {
                            if (res.ok) {
                                const clonedRes = res.clone();
                                try {
                                    const text = await clonedRes.text();
                                    if (!text) return res;
                                    let parsed = JSON.parse(text);

                                    const mapTenantRow = (row: any) => {
                                        if (row && row.legacy_id && row.legacy_id.startsWith('{')) {
                                            try {
                                                const parsedMeta = JSON.parse(row.legacy_id);
                                                if (parsedMeta) {
                                                    row.tax_settings = parsedMeta.tax_settings || parsedMeta;
                                                }
                                            } catch (e) {
                                                console.warn('[Supabase Fetch Interceptor] Failed to parse tenant metadata JSON:', e);
                                            }
                                        }
                                        return row;
                                    };

                                    if (Array.isArray(parsed)) {
                                        parsed = parsed.map(mapTenantRow);
                                    } else {
                                        parsed = mapTenantRow(parsed);
                                    }

                                    return new Response(JSON.stringify(parsed), {
                                        status: res.status,
                                        statusText: res.statusText,
                                        headers: res.headers
                                    });
                                } catch (err) {
                                    console.warn('[Supabase Fetch Interceptor] Failed to parse tenants response:', err);
                                    return res;
                                }
                            }
                            return res;
                        });
                    }

                    return responsePromise;
                }
            },
        }
    );

if (import.meta.env.DEV) {
    globalThis.__supabase__ = supabase;
}
