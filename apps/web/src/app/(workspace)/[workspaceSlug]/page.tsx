import React from "react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Activity, 
  CalendarDays, 
  CheckCircle2, 
  Clock, 
  FileText, 
  Lightbulb, 
  Sparkles, 
  TrendingUp, 
  Wand2 
} from "lucide-react";

// Mock Data
const KPIS = [
  { title: "Content Created", value: "124", change: "+12% from last month", icon: FileText },
  { title: "Scheduled", value: "24", change: "+4 this week", icon: CalendarDays },
  { title: "Published", value: "89", change: "+18% from last month", icon: CheckCircle2 },
  { title: "AI Time Saved", value: "42h", change: "+5h from last week", icon: Sparkles },
];

const CONTENT_QUEUE = {
  drafts: [
    { id: 1, title: "Q3 Marketing Update", platform: "LinkedIn", updatedAt: "2 hours ago" },
    { id: 2, title: "New Feature Announcement", platform: "Twitter", updatedAt: "5 hours ago" },
  ],
  review: [
    { id: 3, title: "Weekly Newsletter - Week 42", platform: "Email", updatedAt: "1 day ago" },
  ],
  scheduled: [
    { id: 4, title: "Product Tips & Tricks", platform: "Instagram", scheduledFor: "Tomorrow, 10:00 AM" },
    { id: 5, title: "Customer Success Story", platform: "LinkedIn", scheduledFor: "Oct 24, 2:00 PM" },
  ]
};

const AI_RECOMMENDATIONS = [
  { id: 1, text: "Your audience is most active at 10:00 AM on Tuesdays. Consider rescheduling your next LinkedIn post.", type: "optimization" },
  { id: 2, text: "Based on recent trends, posts about 'AI automation' are performing 30% better. Generate a new post?", type: "idea" },
];

const CHANNEL_PERFORMANCE = [
  { platform: "LinkedIn", followers: "12.4k", engagement: "4.8%", trend: "up" },
  { platform: "Twitter", followers: "8.2k", engagement: "3.2%", trend: "up" },
  { platform: "Instagram", followers: "15.1k", engagement: "5.1%", trend: "down" },
];

const UPCOMING_CALENDAR = [
  { id: 1, title: "Feature Release Video", time: "Today, 2:00 PM", platform: "YouTube", status: "Ready" },
  { id: 2, title: "Product Tips", time: "Tomorrow, 10:00 AM", platform: "Instagram", status: "Scheduled" },
  { id: 3, title: "Q3 Wrap up", time: "Oct 25, 9:00 AM", platform: "LinkedIn", status: "Needs Review" },
];

export default function WorkspaceDashboardPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          <Button>
            <Wand2 className="mr-2 h-4 w-4" />
            Generate Content
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((kpi, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {kpi.title}
              </CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
              <p className="text-xs text-muted-foreground">
                {kpi.change}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Left Column */}
        <div className="col-span-4 space-y-4">
          
          {/* Upcoming Content Calendar */}
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Upcoming Content</CardTitle>
              <CardDescription>
                Your schedule for the next few days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                {UPCOMING_CALENDAR.map((item) => (
                  <div key={item.id} className="flex items-center">
                    <div className="ml-4 space-y-1">
                      <p className="text-sm font-medium leading-none">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.time} &middot; {item.platform}
                      </p>
                    </div>
                    <div className="ml-auto font-medium">
                      <Badge variant={item.status === "Ready" || item.status === "Scheduled" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Content Queue */}
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Content Queue</CardTitle>
              <CardDescription>Manage your active content pipeline.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="drafts" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="drafts">Drafts ({CONTENT_QUEUE.drafts.length})</TabsTrigger>
                  <TabsTrigger value="review">Review ({CONTENT_QUEUE.review.length})</TabsTrigger>
                  <TabsTrigger value="scheduled">Scheduled ({CONTENT_QUEUE.scheduled.length})</TabsTrigger>
                </TabsList>
                
                <TabsContent value="drafts" className="space-y-4 mt-4">
                  {CONTENT_QUEUE.drafts.map((item) => (
                    <div key={item.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.platform} &middot; Updated {item.updatedAt}</p>
                      </div>
                      <Button variant="outline" size="sm">Edit</Button>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="review" className="space-y-4 mt-4">
                  {CONTENT_QUEUE.review.map((item) => (
                    <div key={item.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.platform} &middot; Ready for review</p>
                      </div>
                      <Button variant="outline" size="sm">Review</Button>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="scheduled" className="space-y-4 mt-4">
                  {CONTENT_QUEUE.scheduled.map((item) => (
                    <div key={item.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.platform} &middot; Scheduled for {item.scheduledFor}</p>
                      </div>
                      <Button variant="outline" size="sm">View</Button>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="col-span-3 space-y-4">
          
          {/* AI Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                AI Insights
              </CardTitle>
              <CardDescription>
                Personalized recommendations to improve your strategy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {AI_RECOMMENDATIONS.map((rec) => (
                <div key={rec.id} className="rounded-lg border p-3 flex flex-col gap-2">
                  <p className="text-sm">{rec.text}</p>
                  <div>
                    <Button variant={rec.type === "idea" ? "default" : "secondary"} size="sm">
                      {rec.type === "idea" ? "Generate Draft" : "Apply Insight"}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Channel Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Channel Performance</CardTitle>
              <CardDescription>
                Overview of your connected accounts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {CHANNEL_PERFORMANCE.map((channel, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                        <Activity className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{channel.platform}</p>
                        <p className="text-xs text-muted-foreground">{channel.followers} followers</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        {channel.engagement}
                        <TrendingUp className={`h-3 w-3 ${channel.trend === 'up' ? 'text-green-500' : 'text-red-500 rotate-180'}`} />
                      </div>
                      <p className="text-xs text-muted-foreground">Engagement</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
