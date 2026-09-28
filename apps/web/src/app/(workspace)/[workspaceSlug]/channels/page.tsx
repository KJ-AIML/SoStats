import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { ChannelBadge } from "@/components/ChannelBadge"

const CHANNELS = [
  { id: 'linkedin', name: 'LinkedIn', connected: true, username: '@company_li' },
  { id: 'x', name: 'X', connected: true, username: '@company_x' },
  { id: 'tiktok', name: 'TikTok', connected: false, username: null },
  { id: 'instagram', name: 'Instagram', connected: false, username: null },
  { id: 'facebook', name: 'Facebook', connected: false, username: null },
  { id: 'youtube', name: 'YouTube', connected: false, username: null },
]

export default async function ChannelsPage(props: { params: Promise<{ workspaceSlug: string }> }) {
  const params = await props.params;

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Channels</h1>
        <p className="text-muted-foreground">
          Manage your connected social media channels for {params.workspaceSlug}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((channel) => (
          <Card key={channel.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xl">{channel.name}</CardTitle>
              <ChannelBadge name={channel.name} connected={channel.connected} />
            </CardHeader>
            <CardContent>
              <CardDescription className="min-h-[20px] mt-2">
                {channel.connected && channel.username ? (
                  <span>Connected as {channel.username}</span>
                ) : (
                  <span>Connect your account to publish content</span>
                )}
              </CardDescription>
            </CardContent>
            <CardFooter>
              {channel.connected ? (
                <Button variant="outline" className="w-full">
                  Manage Connection
                </Button>
              ) : (
                <Link href={`#connect-${channel.id}`} className="w-full">
                  <Button className="w-full">
                    Connect {channel.name}
                  </Button>
                </Link>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
