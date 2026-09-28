"use client";

import React, { useState } from "react";
import { AssetCard, Asset } from "@/components/media/AssetCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadIcon, SearchIcon, FilterIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const MOCK_ASSETS: Asset[] = [
  {
    id: "1",
    url: "https://images.unsplash.com/photo-1682687220742-aba13b6e50ba",
    type: "image",
    title: "Mountain Landscape",
    tags: ["nature", "travel", "landscape"]
  },
  {
    id: "2",
    url: "https://images.unsplash.com/photo-1682687982501-1e58f813fb3f",
    type: "image",
    title: "Ocean View",
    tags: ["nature", "water", "travel"]
  },
  {
    id: "3",
    url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    type: "video",
    title: "Sample Video Promo",
    tags: ["promo", "video"]
  },
  {
    id: "4",
    url: "https://images.unsplash.com/photo-1682695796954-bad0d0f59ff1",
    type: "image",
    title: "City Streets",
    tags: ["urban", "city"]
  },
  {
    id: "5",
    url: "https://images.unsplash.com/photo-1682687220199-d0124f48f95b",
    type: "image",
    title: "Desert Dunes",
    tags: ["nature", "desert"]
  },
  {
    id: "6",
    url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    type: "video",
    title: "Animation Short",
    tags: ["animation", "video"]
  },
];

export default function MediaLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Collect all unique tags for filtering
  const allTags = Array.from(new Set(MOCK_ASSETS.flatMap(asset => asset.tags)));

  // Filter assets based on search query and active filter
  const filteredAssets = MOCK_ASSETS.filter(asset => {
    const matchesSearch = asset.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          asset.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesFilter = activeFilter ? asset.tags.includes(activeFilter) : true;
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Media Library</h1>
          <p className="text-muted-foreground mt-1">Manage your images, videos, and files.</p>
        </div>
        
        <Dialog>
          <DialogTrigger
            render={
              <Button className="flex items-center gap-2">
                <UploadIcon className="w-4 h-4" />
                <span>Upload</span>
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Asset</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-muted-foreground gap-2 cursor-pointer hover:bg-muted/50 transition-colors">
                <UploadIcon className="w-8 h-8" />
                <p>Drag & drop files here or click to browse</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input id="tags" placeholder="e.g. social, campaign, product" />
              </div>
            </div>
            <DialogFooter showCloseButton>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button>Upload Files</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search assets..."
            className="pl-9 w-full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            <FilterIcon className="w-4 h-4" />
            <span>Filter:</span>
          </div>
          <Button 
            variant={activeFilter === null ? "default" : "outline"} 
            size="sm"
            onClick={() => setActiveFilter(null)}
          >
            All
          </Button>
          {allTags.map(tag => (
            <Button
              key={tag}
              variant={activeFilter === tag ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-muted/10 flex-1">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <SearchIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No assets found</h3>
          <p className="text-muted-foreground text-center max-w-sm mb-6">
            We couldn&apos;t find any assets matching your current search or filter criteria.
          </p>
          <Button variant="outline" onClick={() => {
            setSearchQuery("");
            setActiveFilter(null);
          }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 auto-rows-max">
          {filteredAssets.map(asset => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}
