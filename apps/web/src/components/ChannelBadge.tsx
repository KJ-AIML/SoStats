import { Badge } from "@/components/ui/badge"

export function ChannelBadge({ name, connected }: { name: string; connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "secondary"}>
      {connected ? "Connected" : "Not Connected"}
    </Badge>
  )
}
