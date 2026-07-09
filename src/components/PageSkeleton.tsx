import React from 'react';

export default function PageSkeleton() {
  return (
    <div className="space-y-6 text-right animate-pulse" dir="rtl">
      {/* Header Skeleton */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface p-6 rounded-3xl border border-border shadow-sm">
        <div className="space-y-2 w-full md:w-1/3">
          <div className="h-8 bg-surface-muted rounded-xl w-3/4"></div>
          <div className="h-4 bg-surface-muted rounded-xl w-1/2"></div>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="h-12 w-32 bg-surface-muted rounded-2xl"></div>
          <div className="h-12 w-32 bg-brand/10 rounded-2xl"></div>
        </div>
      </div>

      {/* Toolbar Skeleton */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 h-14 bg-surface-muted rounded-2xl"></div>
        <div className="w-full md:w-48 h-14 bg-surface-muted rounded-2xl"></div>
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-surface p-6 rounded-[2.5rem] border border-border space-y-4 shadow-sm">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-muted"></div>
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-surface-muted rounded-lg"></div>
                  <div className="h-3 w-16 bg-surface-muted rounded-lg"></div>
                </div>
              </div>
              <div className="h-8 w-8 bg-surface-muted rounded-xl"></div>
            </div>
            <div className="space-y-2 pt-4 border-t border-border">
              <div className="h-3 w-full bg-surface-muted rounded-lg"></div>
              <div className="h-3 w-3/4 bg-surface-muted rounded-lg"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
