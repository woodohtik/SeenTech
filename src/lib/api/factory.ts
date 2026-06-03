import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase/client';
import { Database } from '../../types/supabase';

type TableName = keyof Database['public']['Tables'];

interface UseEntityOptions {
  tenantId?: string | null;
  enabled?: boolean;
}

export function createServiceHooks<T extends TableName>(tableName: T) {
  type Row = Database['public']['Tables'][T]['Row'];
  type Insert = Database['public']['Tables'][T]['Insert'];
  type Update = Database['public']['Tables'][T]['Update'];

  const useGetAll = (options: UseEntityOptions = {}) => {
    return useQuery({
      queryKey: [tableName, options.tenantId, 'list'],
      queryFn: async () => {
        let query = supabase.from(tableName as string).select('*');
        if (options.tenantId) {
          query = query.eq('tenant_id', options.tenantId);
        } else if (tableName !== 'users' && tableName !== 'tenants' && tableName !== 'plans' && tableName !== 'saas_users') {
             // For tables that expect tenant_id but none was provided
             // return empty array if not a global table
             // To be strictly isolated, throwing an error might be appropriate, but returning [] avoids crashes.
             return [] as Row[];
        }
        const { data, error } = await query;
        if (error) throw error;
        return data as Row[];
      },
      enabled: options.enabled !== false,
    });
  };

  const useGetById = (id: string | null, options: UseEntityOptions = {}) => {
    return useQuery({
      queryKey: [tableName, options.tenantId, 'detail', id],
      queryFn: async () => {
        if (!id) return null;
        let query = supabase.from(tableName as string).select('*').eq('id', id);
        if (options.tenantId) {
          query = query.eq('tenant_id', options.tenantId);
        }
        const { data, error } = await query.single();
        if (error) throw error;
        return data as Row;
      },
      enabled: !!id && options.enabled !== false,
    });
  };

  const useCreate = () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (payload: Insert) => {
        const { data, error } = await supabase.from(tableName as string).insert(payload as any).select().single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: (_, variables) => {
        // Find tenant_id from variables if present to invalidate intelligently
        const tenantId = (variables as any).tenant_id || undefined;
        queryClient.invalidateQueries({ queryKey: [tableName, tenantId] });
        queryClient.invalidateQueries({ queryKey: [tableName, undefined] });
      },
    });
  };

  const useUpdate = () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, payload }: { id: string | number; payload: Update }) => {
        const { data, error } = await supabase
            .from(tableName as string)
            .update(payload as any)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: (data) => {
        const tenantId = (data as any).tenant_id || undefined;
        queryClient.invalidateQueries({ queryKey: [tableName, tenantId] });
        queryClient.invalidateQueries({ queryKey: [tableName, undefined] });
      },
    });
  };

  const useDelete = () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (id: string | number) => {
        const { data, error } = await supabase.from(tableName as string).delete().eq('id', id).select().maybeSingle();
        if (error) throw error;
        return data as Row | null;
      },
      onSuccess: (data) => {
        const tenantId = data ? (data as any).tenant_id : undefined;
        queryClient.invalidateQueries({ queryKey: [tableName, tenantId] });
        queryClient.invalidateQueries({ queryKey: [tableName, undefined] });
      },
    });
  };

  return {
    useGetAll,
    useGetById,
    useCreate,
    useUpdate,
    useDelete,
  };
}
