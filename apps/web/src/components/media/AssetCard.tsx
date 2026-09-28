import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

export interface Asset {
  id: string;
  url: string;
  type: "image" | "video";
  title: string;
  tags: string[];
}

interface AssetCardProps {
  asset: Asset;
}

export function AssetCard({ asset }: AssetCardProps) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <div className="cursor-pointer overflow-hidden rounded-xl group hover:ring-2 hover:ring-primary transition-all">
            <Card className="h-full border-none shadow-none bg-transparent">
              <CardContent className="p-0 relative aspect-square">
                {asset.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt={asset.title}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center relative transition-transform group-hover:scale-105">
                    <video src={asset.url} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/50 rounded-full p-3">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-white"
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                  <p className="text-white text-sm font-medium truncate">{asset.title}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {asset.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-white/20 text-white hover:bg-white/30 border-none">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        }
      />
      
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden bg-black/90 border-none" showCloseButton={false}>
        <div className="relative w-full h-[80vh] flex items-center justify-center">
          {asset.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.url}
              alt={asset.title}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <video
              src={asset.url}
              controls
              autoPlay
              className="max-w-full max-h-full"
            />
          )}
        </div>
        <div className="p-4 absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md">
          <h3 className="text-lg font-semibold text-white">{asset.title}</h3>
          <div className="flex gap-2 mt-2">
            {asset.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="bg-white/20 text-white border-none">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
