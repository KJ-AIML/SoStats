"use client";

import React, { useState } from "react";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Save } from "lucide-react";

export default function BrandBrainPage() {
  const [brandVoice, setBrandVoice] = useState("We are friendly, professional, and innovative.");
  const [adjectives, setAdjectives] = useState(["Friendly", "Professional", "Innovative"]);
  const [newAdjective, setNewAdjective] = useState("");

  const [audience, setAudience] = useState("Tech-savvy professionals looking to automate their workflows.");
  
  const [products, setProducts] = useState(["SoStats Analytics", "SoStats Pro"]);
  const [newProduct, setNewProduct] = useState("");

  const [contentPillars, setContentPillars] = useState(["Automation", "Productivity", "Growth"]);
  const [newPillar, setNewPillar] = useState("");

  const [bannedWords, setBannedWords] = useState(["Cheap", "Hacks", "Magic"]);
  const [newBannedWord, setNewBannedWord] = useState("");

  const handleAddItem = (
    value: string, 
    setValue: (val: string) => void, 
    list: string[], 
    setList: (list: string[]) => void
  ) => {
    if (value.trim() && !list.includes(value.trim())) {
      setList([...list, value.trim()]);
      setValue("");
    }
  };

  const handleRemoveItem = (
    itemToRemove: string, 
    list: string[], 
    setList: (list: string[]) => void
  ) => {
    setList(list.filter(item => item !== itemToRemove));
  };

  const handleSave = () => {
    // Dummy submission logic
    console.log("Saving Brand Brain settings...", {
      brandVoice,
      adjectives,
      audience,
      products,
      contentPillars,
      bannedWords
    });
    alert("Brand Brain settings saved!");
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Brain</h1>
          <p className="text-muted-foreground mt-1">
            Configure your AI assistant&apos;s voice, audience, and content guidelines.
          </p>
        </div>
        <Button onClick={handleSave} className="w-full md:w-auto">
          <Save className="mr-2 h-4 w-4" /> Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* BRAND VOICE */}
        <Card>
          <CardHeader>
            <CardTitle>Brand Voice</CardTitle>
            <CardDescription>Describe your brand&apos;s personality and tone of voice.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="voice-desc">Voice Description</Label>
              <Textarea 
                id="voice-desc" 
                placeholder="How does your brand sound?" 
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            
            <div className="space-y-3">
              <Label>Tone Adjectives</Label>
              <div className="flex flex-wrap gap-2">
                {adjectives.map((adj) => (
                  <Badge key={adj} variant="secondary" className="flex items-center gap-1 px-3 py-1 text-sm">
                    {adj}
                    <button 
                      onClick={() => handleRemoveItem(adj, adjectives, setAdjectives)}
                      className="ml-1 text-muted-foreground hover:text-foreground focus:outline-none"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input 
                  placeholder="Add an adjective..." 
                  value={newAdjective}
                  onChange={(e) => setNewAdjective(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddItem(newAdjective, setNewAdjective, adjectives, setAdjectives)}
                />
                <Button 
                  variant="outline" 
                  onClick={() => handleAddItem(newAdjective, setNewAdjective, adjectives, setAdjectives)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* TARGET AUDIENCE */}
        <Card>
          <CardHeader>
            <CardTitle>Target Audience</CardTitle>
            <CardDescription>Who are you writing for? Define your ideal customer profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="audience-desc">Audience Profile</Label>
              <Textarea 
                id="audience-desc" 
                placeholder="Describe your target audience..." 
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* PRODUCTS & SERVICES */}
        <Card>
          <CardHeader>
            <CardTitle>Products & Services</CardTitle>
            <CardDescription>What are the key offerings the AI should know about?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {products.map((product) => (
                <Badge key={product} variant="outline" className="flex items-center gap-1 px-3 py-1 text-sm bg-background">
                  {product}
                  <button 
                    onClick={() => handleRemoveItem(product, products, setProducts)}
                    className="ml-1 text-muted-foreground hover:text-destructive focus:outline-none"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input 
                placeholder="Add a product or service..." 
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem(newProduct, setNewProduct, products, setProducts)}
              />
              <Button 
                variant="outline" 
                onClick={() => handleAddItem(newProduct, setNewProduct, products, setProducts)}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* CONTENT PILLARS */}
        <Card>
          <CardHeader>
            <CardTitle>Content Pillars</CardTitle>
            <CardDescription>Core topics and themes your brand talks about.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {contentPillars.map((pillar) => (
                <Badge key={pillar} variant="secondary" className="flex items-center gap-1 px-3 py-1 text-sm">
                  {pillar}
                  <button 
                    onClick={() => handleRemoveItem(pillar, contentPillars, setContentPillars)}
                    className="ml-1 text-muted-foreground hover:text-foreground focus:outline-none"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input 
                placeholder="Add a content pillar..." 
                value={newPillar}
                onChange={(e) => setNewPillar(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem(newPillar, setNewPillar, contentPillars, setContentPillars)}
              />
              <Button 
                variant="outline" 
                onClick={() => handleAddItem(newPillar, setNewPillar, contentPillars, setContentPillars)}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* BANNED WORDS */}
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Banned Words</CardTitle>
            <CardDescription>Words or phrases the AI should never use.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {bannedWords.map((word) => (
                <Badge key={word} variant="destructive" className="flex items-center gap-1 px-3 py-1 text-sm">
                  {word}
                  <button 
                    onClick={() => handleRemoveItem(word, bannedWords, setBannedWords)}
                    className="ml-1 text-destructive-foreground/70 hover:text-destructive-foreground focus:outline-none"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input 
                placeholder="Add a banned word..." 
                value={newBannedWord}
                onChange={(e) => setNewBannedWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem(newBannedWord, setNewBannedWord, bannedWords, setBannedWords)}
              />
              <Button 
                variant="outline" 
                onClick={() => handleAddItem(newBannedWord, setNewBannedWord, bannedWords, setBannedWords)}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
