import React from 'react';
import { Scissors } from 'lucide-react';

export default function MainSkeleton() {
  return (
    <div className="flex h-screen bg-surface-muted font-sans overflow-hidden animate-pulse">
      {/* Sidebar Skeleton */}
      <aside className="w-64 bg-surface border-l border-border flex flex-col z-30">
        <div className="p-6 flex items-center gap-3 border-b border-border">
          <div className="bg-border p-2 rounded-lg text-white">
            <Scissors size={24} className="opacity-20" />
          </div>
          <div className="h-6 w-32 bg-border rounded-lg"></div>
        </div>
        
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 bg-surface-muted rounded-xl h-12"></div>
          ))}
        </div>
        
        <div className="p-4 border-t border-border space-y-4">
          <div className="h-10 bg-surface-muted rounded-xl"></div>
          <div className="h-10 bg-surface-muted rounded-xl"></div>
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <main className="flex-1 overflow-auto p-8 flex flex-col space-y-8">
          {/* Header Row */}
          <div className="flex justify-between items-center bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
            <div className="space-y-2">
              <div className="h-8 w-48 bg-border rounded-lg"></div>
              <div className="h-4 w-32 bg-surface-muted rounded-lg"></div>
            </div>
            <div className="flex gap-2">
              <div className="h-10 w-10 bg-border rounded-full"></div>
              <div className="h-10 w-10 bg-border rounded-full"></div>
            </div>
          </div>

          {/* Grid Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-surface rounded-[2rem] border border-border shadow-sm"></div>
            ))}
          </div>

          {/* Table/Charts Area */}
          <div className="flex-1 bg-surface rounded-[2rem] border border-border shadow-sm p-8 space-y-6">
            <div className="h-8 w-1/4 bg-border rounded-lg"></div>
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-surface-muted rounded-xl"></div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
