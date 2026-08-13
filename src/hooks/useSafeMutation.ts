import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';

interface SafeMutationOptions<TData, TError, TVariables, TContext> {
  successMessage?: string;
  errorMessage?: string;
  invalidateKeys?: any[][];
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void | Promise<unknown>;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void | Promise<unknown>;
}

export function useSafeMutation<TData = unknown, TError = any, TVariables = void, TContext = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: SafeMutationOptions<TData, TError, TVariables, TContext> = {}
) {
  const queryClient = useQueryClient();
  const { success: toastSuccess, handleError } = useToast();

  const mutation = useMutation<TData, TError, TVariables, TContext>({
    mutationFn,
    onSuccess: async (data, variables, context) => {
      // 1. Invalidate queries first to make sure UI fetches fresh data from DB
      if (options.invalidateKeys) {
        for (const key of options.invalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }

      // 2. ONLY show success toast if backend actually returned successfully
      if (options.successMessage) {
        toastSuccess(options.successMessage);
      }

      // 3. Custom success callback
      if (options.onSuccess) {
        await options.onSuccess(data, variables, context);
      }
    },
    onError: async (error, variables, context) => {
      // 1. Show descriptive system error toast
      if (options.errorMessage) {
        handleError(error, options.errorMessage);
      } else {
        handleError(error);
      }

      // 2. Custom error callback
      if (options.onError) {
        await options.onError(error, variables, context);
      }
    }
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError
  };
}
