"use client";

import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Post = {
  id: number;
  title: string;
  channel: string;
  date: Date;
  status: string;
  failureReason?: string;
  postUrl?: string;
};

const today = new Date();
const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusTone(status: string) {
  switch (status) {
    case "published":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "publishing":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "cancelled":
      return "border-neutral-200 bg-neutral-100 text-neutral-500";
    default:
      return "border-[#ef2b2d]/10 bg-[#fff7f7] text-[#d92023]";
  }
}

export function CalendarView({
  workspaceSlug,
  initialSchedules,
}: {
  workspaceSlug: string;
  initialSchedules: Array<{
    id: number;
    title: string;
    channel: string;
    scheduledAt: string;
    status: string;
    failureReason?: string;
    postUrl?: string;
  }>;
}) {
  const [currentDate, setCurrentDate] = useState(today);
  const [posts, setPosts] = useState<Post[]>(
    initialSchedules.map((schedule) => ({
      id: schedule.id,
      title: schedule.title,
      channel: schedule.channel,
      date: new Date(schedule.scheduledAt),
      status: schedule.status,
      failureReason: schedule.failureReason,
      postUrl: schedule.postUrl,
    })),
  );
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [open, setOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthStart = startOfMonth(currentDate);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(endOfMonth(monthStart)),
  });

  const openPost = (post: Post) => {
    setSelectedPost(post);
    setEditTitle(post.title);
    setEditDate(format(post.date, "yyyy-MM-dd"));
    setEditTime(format(post.date, "HH:mm"));
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!selectedPost) return;
    const [year, month, day] = editDate.split("-").map(Number);
    const [hours, minutes] = editTime.split(":").map(Number);
    const nextDate = new Date(year, month - 1, day, hours, minutes);

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/schedules/${selectedPost.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduledAt: nextDate.toISOString() }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Unable to update schedule");
      }

      setPosts((current) =>
        current.map((post) =>
          post.id === selectedPost.id
            ? {
                ...post,
                title: editTitle,
                date: nextDate,
                status: "scheduled",
                failureReason: undefined,
              }
            : post,
        ),
      );
      setOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update schedule",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const canReschedule =
    selectedPost &&
    !["published", "cancelled", "publishing"].includes(selectedPost.status);

  return (
    <>
      <div className="sostats-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
              {format(currentDate, "MMMM yyyy")}
            </h2>
            <button
              onClick={() => setCurrentDate(today)}
              className="rounded-lg border border-black/[0.06] px-2.5 py-1 text-[9px] font-semibold text-neutral-500"
            >
              Today
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-7 border-b border-black/[0.045] bg-neutral-50">
              {daysOfWeek.map((day) => (
                <div
                  key={day}
                  className="border-r border-black/[0.045] py-2.5 text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground last:border-r-0"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((day, index) => {
                const dayPosts = posts.filter((post) => isSameDay(post.date, day));
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[126px] border-b border-r border-black/[0.045] bg-white p-2 last:border-r-0",
                      index % 7 === 6 && "border-r-0",
                      !isSameMonth(day, monthStart) && "bg-neutral-50/70",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-2 flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold",
                        isSameDay(day, today)
                          ? "bg-[#ef2b2d] text-white"
                          : !isSameMonth(day, monthStart)
                            ? "text-neutral-300"
                            : "text-neutral-600",
                      )}
                    >
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1.5">
                      {dayPosts.map((post) => (
                        <button
                          key={post.id}
                          onClick={() => openPost(post)}
                          className={cn(
                            "w-full rounded-lg border p-2 text-left transition hover:shadow-sm",
                            statusTone(post.status),
                          )}
                        >
                          <div className="flex items-center gap-1 text-[8px] font-semibold capitalize">
                            {post.status === "published" ? (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            ) : post.status === "failed" ? (
                              <AlertCircle className="h-2.5 w-2.5" />
                            ) : post.status === "publishing" ? (
                              <RefreshCw className="h-2.5 w-2.5" />
                            ) : (
                              <Clock3 className="h-2.5 w-2.5" />
                            )}
                            {format(post.date, "HH:mm")} · {post.channel} · {post.status}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[9px] font-medium leading-3.5 text-neutral-700">
                            {post.title}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {posts.length === 0 && (
          <div className="border-t border-black/[0.045] px-5 py-4 text-[10px] text-muted-foreground">
            Nothing scheduled yet. Move reviewed content to Scheduled to add it to the publishing queue.
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="tracking-[-0.02em]">
              {selectedPost?.status === "failed"
                ? "Retry failed publication"
                : "Publication details"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold">Content</label>
              <Textarea
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="rounded-xl"
                disabled
              />
              <p className="mt-1 text-[8px] text-muted-foreground">
                Copy is edited in Content. This dialog controls the publishing time.
              </p>
            </div>

            <div className="rounded-xl border border-black/[0.06] bg-neutral-50 p-3">
              <p className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                Publication state
              </p>
              <p className="mt-1 text-[10px] font-semibold capitalize">
                {selectedPost?.status || "scheduled"}
              </p>
              {selectedPost?.failureReason && (
                <p className="mt-2 text-[9px] leading-4 text-red-700">
                  {selectedPost.failureReason}
                </p>
              )}
              {selectedPost?.postUrl && (
                <a
                  href={selectedPost.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-700"
                >
                  Open published post
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold">Date</label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  className="rounded-xl"
                  disabled={!canReschedule}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold">Time</label>
                <Input
                  type="time"
                  value={editTime}
                  onChange={(event) => setEditTime(event.target.value)}
                  className="rounded-xl"
                  disabled={!canReschedule}
                />
              </div>
            </div>

            {selectedPost?.status === "failed" && (
              <p className="text-[8px] leading-4 text-muted-foreground">
                Choose a new time and save. That creates a new schedule version, so any old queue job becomes stale and cannot publish.
              </p>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-[9px] text-red-700">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
              Close
            </Button>
            {canReschedule && (
              <Button
                onClick={save}
                disabled={isSaving}
                className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]"
              >
                {isSaving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                {selectedPost?.status === "failed" ? "Retry publication" : "Save changes"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
