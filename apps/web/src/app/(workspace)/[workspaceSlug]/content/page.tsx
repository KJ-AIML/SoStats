import React from "react";
import { ContentBoard } from "@/components/content/content-board";

export default function ContentPage() {
  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground">
          Manage and track your content pipeline.
        </p>
      </div>
      
      <div className="flex-1 overflow-hidden min-h-[600px]">
        <ContentBoard />
      </div>
    </div>
  );
}
