"use client";

import React, { useState } from "react";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Image as ImageIcon, Video, FileText, Share2, PenTool, LayoutTemplate } from "lucide-react";

export default function AiStudioPage() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Form State
  const [brief, setBrief] = useState("");
  const [goal, setGoal] = useState("brand-awareness");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("professional");
  const [channels, setChannels] = useState({
    twitter: true,
    linkedin: true,
    instagram: false,
    facebook: false
  });

  const handleGenerate = () => {
    setIsGenerating(true);
    // Simulate generation time
    setTimeout(() => {
      setIsGenerating(false);
      setShowResults(true);
    }, 1500);
  };

  const handleChannelChange = (channel: keyof typeof channels) => {
    setChannels(prev => ({
      ...prev,
      [channel]: !prev[channel]
    }));
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl h-full flex flex-col space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            AI Studio
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate full campaigns, posts, and media tailored to your Brand Brain.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full flex-1">
        {/* LEFT PANEL: PROMPT INTERFACE */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <Card className="flex-1 border-primary/20 shadow-sm">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <CardTitle className="text-lg">Campaign Brief</CardTitle>
              <CardDescription>Configure your generation parameters.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              
              {/* Brief */}
              <div className="space-y-2">
                <Label htmlFor="brief" className="font-semibold">What do you want to create?</Label>
                <Textarea 
                  id="brief" 
                  placeholder="E.g., A product launch campaign for our new AI feature targeting marketing agencies..." 
                  className="min-h-[120px] resize-none"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </div>

              {/* Goal */}
              <div className="space-y-2">
                <Label htmlFor="goal" className="font-semibold">Goal</Label>
                <select 
                  id="goal" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                >
                  <option value="brand-awareness">Brand Awareness</option>
                  <option value="lead-generation">Lead Generation</option>
                  <option value="engagement">Engagement & Community</option>
                  <option value="sales">Sales / Conversions</option>
                  <option value="education">Customer Education</option>
                </select>
              </div>

              {/* Audience */}
              <div className="space-y-2">
                <Label htmlFor="audience" className="font-semibold">Target Audience (Optional)</Label>
                <Input 
                  id="audience" 
                  placeholder="Defaults to Brand Brain audience" 
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <Label htmlFor="tone" className="font-semibold">Tone Override</Label>
                <select 
                  id="tone" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="humorous">Humorous / Witty</option>
                  <option value="authoritative">Authoritative & Bold</option>
                  <option value="empathetic">Empathetic</option>
                </select>
              </div>

              {/* Channels Checklist */}
              <div className="space-y-3 pt-2">
                <Label className="font-semibold">Target Channels</Label>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(channels).map(([channel, isChecked]) => (
                    <label key={channel} className="flex items-center space-x-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={isChecked}
                        onChange={() => handleChannelChange(channel as keyof typeof channels)}
                      />
                      <span className="text-sm capitalize">{channel}</span>
                    </label>
                  ))}
                </div>
              </div>

            </CardContent>
            <CardFooter className="pt-2 pb-6 px-6">
              <Button 
                className="w-full font-bold shadow-md hover:shadow-lg transition-all" 
                size="lg"
                onClick={handleGenerate}
                disabled={isGenerating || brief.length < 10}
              >
                {isGenerating ? (
                  <>
                    <Sparkles className="mr-2 h-5 w-5 animate-spin" />
                    Generating Magic...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Generate Campaign
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* RIGHT PANEL: RESULTS */}
        <div className="lg:col-span-8 flex flex-col">
          {!showResults && !isGenerating && (
            <Card className="flex-1 flex flex-col items-center justify-center border-dashed border-2 bg-muted/10 min-h-[500px]">
              <div className="text-center space-y-4 p-8 max-w-md">
                <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <LayoutTemplate className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold">Ready to Create?</h3>
                <p className="text-muted-foreground">
                  Fill out the brief on the left and hit generate. We&apos;ll craft a full strategy, draft posts, and suggest visual concepts based on your Brand Brain settings.
                </p>
              </div>
            </Card>
          )}

          {isGenerating && (
            <Card className="flex-1 flex flex-col items-center justify-center border-dashed border-2 bg-muted/10 min-h-[500px]">
              <div className="text-center space-y-6">
                <Sparkles className="h-12 w-12 text-primary animate-pulse mx-auto" />
                <div>
                  <h3 className="text-xl font-bold animate-pulse">Consulting the Brand Brain...</h3>
                  <p className="text-muted-foreground mt-2">Analyzing audience, defining pillars, and drafting copy.</p>
                </div>
              </div>
            </Card>
          )}

          {showResults && !isGenerating && (
            <Card className="flex-1 border-primary/20 shadow-md flex flex-col min-h-[600px]">
              <Tabs defaultValue="strategy" className="flex-1 flex flex-col">
                <div className="px-6 pt-6 pb-2 border-b">
                  <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="strategy" className="px-4 py-2">
                      <LayoutTemplate className="h-4 w-4 mr-2" /> Strategy
                    </TabsTrigger>
                    <TabsTrigger value="posts" className="px-4 py-2">
                      <FileText className="h-4 w-4 mr-2" /> Posts
                    </TabsTrigger>
                    <TabsTrigger value="images" className="px-4 py-2">
                      <ImageIcon className="h-4 w-4 mr-2" /> Images
                    </TabsTrigger>
                    <TabsTrigger value="video" className="px-4 py-2">
                      <Video className="h-4 w-4 mr-2" /> Video Scripts
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 p-0 overflow-y-auto max-h-[700px]">
                  
                  {/* STRATEGY TAB */}
                  <TabsContent value="strategy" className="m-0 p-6 space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold mb-2">Campaign Strategy</h3>
                      <p className="text-muted-foreground">
                        Generated based on your brief targeting {goal.replace("-", " ")} and optimized for {Object.keys(channels).filter(k => channels[k as keyof typeof channels]).join(", ")}.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="bg-muted/20">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-md">Core Message</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm">
                            Empower your marketing agency to scale faster by automating repetitive tasks, allowing your team to focus on creative strategy.
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/20">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-md">Primary Audience Pain Points</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="list-disc pl-4 text-sm space-y-1">
                            <li>Spending too much time on reporting.</li>
                            <li>Inconsistent client communication.</li>
                            <li>Difficulty scaling operations without hiring.</li>
                          </ul>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-bold border-b pb-2">Content Pillars</h4>
                      <div className="space-y-4 mt-4">
                        <div className="flex gap-4">
                          <div className="bg-primary/10 p-3 rounded-lg text-primary font-bold">1</div>
                          <div>
                            <h5 className="font-semibold">The Cost of Manual Work</h5>
                            <p className="text-sm text-muted-foreground">Highlighting the hours lost each week to manual data entry and reporting.</p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="bg-primary/10 p-3 rounded-lg text-primary font-bold">2</div>
                          <div>
                            <h5 className="font-semibold">Scaling with AI</h5>
                            <p className="text-sm text-muted-foreground">Demonstrating how automation acts as a multiplier for agency teams.</p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="bg-primary/10 p-3 rounded-lg text-primary font-bold">3</div>
                          <div>
                            <h5 className="font-semibold">Success Stories</h5>
                            <p className="text-sm text-muted-foreground">Sharing quick case studies of agencies that grew revenue without adding headcount.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* POSTS TAB */}
                  <TabsContent value="posts" className="m-0 p-6 space-y-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold">Generated Posts</h3>
                      <Button variant="outline" size="sm"><PenTool className="h-4 w-4 mr-2"/> Edit All</Button>
                    </div>

                    {channels.twitter && (
                      <Card className="border-blue-200">
                        <CardHeader className="bg-blue-50/50 pb-3 flex flex-row items-center justify-between space-y-0">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-blue-500 hover:bg-blue-600">Twitter (X)</Badge>
                            <span className="text-xs text-muted-foreground">Thread (3 tweets)</span>
                          </div>
                          <Button variant="ghost" size="sm"><Share2 className="h-4 w-4"/></Button>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-4">
                          <div className="space-y-2 border-l-2 border-blue-200 pl-4 relative">
                            <div className="absolute w-2 h-2 rounded-full bg-blue-500 -left-[5px] top-2"></div>
                            <p className="text-sm">Agencies are dying by a thousand cuts. 🔪 <br/><br/>Not from lack of leads, but from hours spent copy-pasting numbers into spreadsheets. It&apos;s 2024. Your team&apos;s time is too valuable for manual reporting. 🧵 1/3</p>
                          </div>
                          <div className="space-y-2 border-l-2 border-blue-200 pl-4 relative">
                            <div className="absolute w-2 h-2 rounded-full bg-blue-500 -left-[5px] top-2"></div>
                            <p className="text-sm">Enter AI automation. <br/><br/>Imagine generating comprehensive client reports across 5 platforms in 30 seconds. That&apos;s 15 hours saved per account manager every month. What could they do with that time? 2/3</p>
                          </div>
                          <div className="space-y-2 border-l-2 border-blue-200 pl-4 relative">
                            <div className="absolute w-2 h-2 rounded-full bg-blue-500 -left-[5px] top-2"></div>
                            <p className="text-sm">Stop scaling your payroll. Start scaling your systems. <br/><br/>Try our new AI reporting suite today and get your weekends back. 👇 [Link in bio] 3/3</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {channels.linkedin && (
                      <Card className="border-blue-100">
                        <CardHeader className="bg-slate-50 pb-3 flex flex-row items-center justify-between space-y-0">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-slate-700 hover:bg-slate-800">LinkedIn</Badge>
                            <span className="text-xs text-muted-foreground">Thought Leadership</span>
                          </div>
                          <Button variant="ghost" size="sm"><Share2 className="h-4 w-4"/></Button>
                        </CardHeader>
                        <CardContent className="pt-4">
                          <p className="text-sm whitespace-pre-line">
                            The biggest lie in agency growth is that you need more people to handle more clients.
                            
                            Last year, we audited 50+ mid-sized marketing agencies. The average account manager spends 22% of their week pulling data, formatting slides, and writing repetitive emails.
                            
                            That&apos;s not strategy. That&apos;s data entry.
                            
                            We just launched our new AI Automation suite to fix this. It handles the manual reporting, insights extraction, and anomaly detection so your team can focus on what actually moves the needle: creative strategy and client relationships.
                            
                            When you automate the tedious tasks, margins improve, burnout drops, and clients get better results.
                            
                            How much time does your team spend on reporting every week? Let me know below. 👇
                            
                            #AgencyGrowth #MarketingAutomation #AI
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  {/* IMAGES TAB */}
                  <TabsContent value="images" className="m-0 p-6 space-y-6">
                    <h3 className="text-xl font-bold mb-4">Visual Concepts</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Card>
                        <div className="aspect-video bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white p-6 text-center">
                          <h2 className="text-2xl font-bold">Stop Scaling Payroll.<br/>Start Scaling Systems.</h2>
                        </div>
                        <CardContent className="pt-4 pb-4">
                          <h4 className="font-semibold text-sm">Graphic 1: Bold Statement</h4>
                          <p className="text-xs text-muted-foreground mt-1">Suggested for LinkedIn & Twitter. High contrast typography.</p>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <div className="aspect-video bg-slate-100 flex items-center justify-center p-6 border-b">
                          <div className="bg-white p-4 rounded shadow-lg w-full max-w-[200px] flex flex-col gap-2">
                            <div className="h-2 w-full bg-slate-200 rounded"></div>
                            <div className="flex gap-2">
                              <div className="h-12 w-1/2 bg-green-100 rounded border border-green-200 flex items-end justify-center pb-1"><span className="text-[10px] text-green-700 font-bold">+24%</span></div>
                              <div className="h-12 w-1/2 bg-blue-100 rounded border border-blue-200 flex items-end justify-center pb-1"><span className="text-[10px] text-blue-700 font-bold">15h Saved</span></div>
                            </div>
                          </div>
                        </div>
                        <CardContent className="pt-4 pb-4">
                          <h4 className="font-semibold text-sm">Graphic 2: UI Dashboard Sneak Peek</h4>
                          <p className="text-xs text-muted-foreground mt-1">Showcasing the actual product UI with focus on time saved metrics.</p>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* VIDEO TAB */}
                  <TabsContent value="video" className="m-0 p-6 space-y-6">
                    <h3 className="text-xl font-bold mb-4">Short-form Video Scripts</h3>
                    
                    <Card>
                      <CardHeader className="bg-muted/20 pb-3">
                        <CardTitle className="text-md">TikTok / Reels: &quot;Agency Owner Reality Check&quot;</CardTitle>
                        <CardDescription>Length: 15-20 seconds. Energy: Fast-paced, direct.</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="space-y-4">
                          <div className="grid grid-cols-[100px_1fr] gap-4 text-sm border-b pb-3">
                            <div className="font-semibold text-muted-foreground">0:00 - 0:03</div>
                            <div>
                              <span className="font-semibold text-primary block mb-1">Visual:</span>
                              Creator looking stressed, holding a huge stack of papers or looking at 5 screens.
                              <span className="font-semibold text-primary block mt-2 mb-1">Audio:</span>
                              &quot;If you run a marketing agency and you&apos;re still manually building client reports...&quot;
                            </div>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-4 text-sm border-b pb-3">
                            <div className="font-semibold text-muted-foreground">0:03 - 0:08</div>
                            <div>
                              <span className="font-semibold text-primary block mb-1">Visual:</span>
                              Quick transition. Creator looking relaxed, sipping coffee while pointing at a slick dashboard on screen.
                              <span className="font-semibold text-primary block mt-2 mb-1">Audio:</span>
                              &quot;...you are literally burning money. Your team should be strategizing, not doing data entry.&quot;
                            </div>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-4 text-sm">
                            <div className="font-semibold text-muted-foreground">0:08 - 0:15</div>
                            <div>
                              <span className="font-semibold text-primary block mb-1">Visual:</span>
                              Screen recording of the tool generating a report in one click. Call to action text pops up.
                              <span className="font-semibold text-primary block mt-2 mb-1">Audio:</span>
                              &quot;Use this AI tool to automate all your reporting in 30 seconds. Link in bio to try it free.&quot;
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                </div>
              </Tabs>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
