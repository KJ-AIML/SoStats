"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"
import { Users, MousePointerClick, Activity } from "lucide-react"

const kpiData = [
  {
    title: "Total Reach",
    value: "24.5k",
    description: "+12.5% from last month",
    icon: Users,
  },
  {
    title: "Engagement",
    value: "4,320",
    description: "+5.2% from last month",
    icon: Activity,
  },
  {
    title: "Clicks",
    value: "1,203",
    description: "-1.1% from last month",
    icon: MousePointerClick,
  },
]

const trendData = [
  { date: "Jan 1", reach: 1200, engagement: 400 },
  { date: "Jan 5", reach: 1800, engagement: 600 },
  { date: "Jan 10", reach: 1600, engagement: 550 },
  { date: "Jan 15", reach: 2400, engagement: 800 },
  { date: "Jan 20", reach: 2100, engagement: 700 },
  { date: "Jan 25", reach: 2900, engagement: 950 },
  { date: "Jan 30", reach: 3200, engagement: 1100 },
]

const chartConfig = {
  reach: {
    label: "Reach",
    color: "hsl(var(--chart-1))",
  },
  engagement: {
    label: "Engagement",
    color: "hsl(var(--chart-2))",
  },
}

const topContentData = [
  {
    id: 1,
    title: "10 Tips for Better Analytics",
    platform: "Twitter",
    reach: "12.4k",
    engagement: "1,240",
  },
  {
    id: 2,
    title: "New Feature Announcement",
    platform: "LinkedIn",
    reach: "8.2k",
    engagement: "890",
  },
  {
    id: 3,
    title: "Weekly Newsletter Issue #42",
    platform: "Email",
    reach: "5.1k",
    engagement: "450",
  },
]

export default function AnalyticsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {kpiData.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {kpi.title}
              </CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
              <p className="text-xs text-muted-foreground">
                {kpi.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle>Performance Trend</CardTitle>
            <CardDescription>Reach and Engagement over time.</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <ChartContainer config={chartConfig} className="h-[350px] w-full">
              <LineChart data={trendData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis 
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => String(value)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line 
                  type="monotone" 
                  dataKey="reach" 
                  stroke="var(--color-reach)" 
                  strokeWidth={2}
                  dot={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="engagement" 
                  stroke="var(--color-engagement)" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Top Content</CardTitle>
            <CardDescription>
              Best performing content across platforms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Reach</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topContentData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>{item.platform}</TableCell>
                    <TableCell className="text-right">{item.reach}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
