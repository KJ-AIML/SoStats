"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FilterX,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
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
import { cn } from "@/lib/utils";

type ViewMode = "month" | "week" | "day";

type Post = {
  id: number;
  contentItemId: number;
  title: string;
  campaign: string;
  channel: string;
  accountName: string;
  variantLabel: string;
  variantCopy?: string;
  date: Date;
  status: string;
  attempts: number;
  failureType?: string;
  failureReason?: string;
  postUrl?: string;
  platformPostId?: string;
  resultAt?: string;
};

const initialToday = new Date();
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

function StatusIcon({ status }: { status: string }) {
  if (status === "published") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "failed") return <AlertCircle className="h-3 w-3" />;
  if (status === "publishing") return <RefreshCw className="h-3 w-3" />;
  if (status === "cancelled") return <XCircle className="h-3 w-3" />;
  return <Clock3 className="h-3 w-3" />;
}

function providerLabel(value: string) {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat("en-US", options);
  }
}

function dateKeyInZone(date: Date, timeZone: string) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function timeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function fullDateTimeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function zonedWallTimeToUtc(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  let timestamp = Date.UTC(year, month - 1, day, hour, minute);

  for (let index = 0; index < 3; index += 1) {
    const parts = formatter(timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
    );
    timestamp -= rendered - Date.UTC(year, month - 1, day, hour, minute);
  }

  return new Date(timestamp);
}

function conceptualKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function CalendarView({
  workspaceSlug,
  timezone,
  initialSchedules,
}: {
  workspaceSlug: string;
  timezone: string;
  initialSchedules: Array<{
    id: number;
    contentItemId: number;
    title: string;
    campaign: string;
    channel: string;
    accountName: string;
    variantLabel: string;
    variantCopy?: string;
    scheduledAt: string;
    status: string;
    attempts: number;
    failureType?: string;
    failureReason?: string;
    postUrl?: string;
    platformPostId?: string;
    resultAt?: string;
  }>;
}) {
  const [currentDate, setCurrentDate] = useState(initialToday);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [posts, setPosts] = useState<Post[]>(
    initialSchedules.map((schedule) => ({
      ...schedule,
      date: new Date(schedule.scheduledAt),
    })),
  );
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channels = useMemo(
    () => [...new Set(posts.map((post) => post.channel))].sort(),
    [posts],
  );
  const statuses = useMemo(
    () => [...new Set(posts.map((post) => post.status))].sort(),
    [posts],
  );

  const filteredPosts = useMemo(
    () =>
      posts.filter(
        (post) =>
          (channelFilter === "all" || post.channel === channelFilter) &&
          (statusFilter === "all" || post.status === statusFilter),
      ),
    [channelFilter, posts, statusFilter],
  );

  const counts = useMemo(
    () => ({
      scheduled: posts.filter((post) => post.status === "scheduled").length,
      publishing: posts.filter((post) => post.status === "publishing").length,
      failed: posts.filter((post) => post.status === "failed").length,
      published: posts.filter((post) => post.status === "published").length,
    }),
    [posts],
  );

  const monthStart = startOfMonth(currentDate);
  const monthDays = eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(endOfMonth(monthStart)),
  });
  const weekStart = startOfWeek(currentDate);
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(weekStart),
  });

  const openPost = (post: Post) => {
    setSelectedPost(post);
    setEditDate(dateKeyInZone(post.date, timezone));
    setEditTime(timeInZone(post.date, timezone));
    setError(null);
  };

  const closePost = () => {
    if (!isSaving && !isCancelling) setSelectedPost(null);
  };

  const canReschedule =
    selectedPost &&
    !["published", "cancelled", "publishing"].includes(selectedPost.status);
  const canCancel =
    selectedPost &&
    !["published", "cancelled", "publishing"].includes(selectedPost.status);

  const save = async () => {
    if (!selectedPost) return;
    const nextDate = zonedWallTimeToUtc(editDate, editTime, timezone);
    if (Number.isNaN(nextDate.getTime())) {
      setError("Choose a valid date and time.");
      return;
    }

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
      const payload = (await response.json()) as {
        error?: string;
        scheduledAt?: string;
        status?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update schedule");
      }

      const savedDate = new Date(payload.scheduledAt || nextDate.toISOString());
      setPosts((current) =>
        current.map((post) =>
          post.id === selectedPost.id
            ? {
                ...post,
                date: savedDate,
                status: payload.status || "scheduled",
                failureType: undefined,
                failureReason: undefined,
              }
            : post,
        ),
      );
      setSelectedPost(null);
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

  const cancel = async () => {
    if (!selectedPost) return;
    setIsCancelling(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/schedules/${selectedPost.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to cancel schedule");
      }

      setPosts((current) =>
        current.map((post) =>
          post.id === selectedPost.id
            ? { ...post, status: payload.status || "cancelled" }
            : post,
        ),
      );
      setSelectedPost(null);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Unable to cancel schedule",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const navigate = (direction: -1 | 1) => {
    if (viewMode === "month") {
      setCurrentDate((value) =>
        direction < 0 ? subMonths(value, 1) : addMonths(value, 1),
      );
      return;
    }
    if (viewMode === "week") {
      setCurrentDate((value) =>
        direction < 0 ? subWeeks(value, 1) : addWeeks(value, 1),
      );
      return;
    }
    setCurrentDate((value) =>
      direction < 0 ? subDays(value, 1) : addDays(value, 1),
    );
  };

  const heading =
    viewMode === "month"
      ? format(currentDate, "MMMM yyyy")
      : viewMode === "week"
        ? `${format(weekStart, "MMM d")} – ${format(
            weekDays[6],
            "MMM d, yyyy",
          )}`
        : format(currentDate, "EEEE, MMMM d, yyyy");

  const clearFilters = () => {
    setChannelFilter("all");
    setStatusFilter("all");
  };
  const hasFilters = channelFilter !== "all" || statusFilter !== "all";

  const postsForConceptualDay = (day: Date) =>
    filteredPosts
      .filter((post) => dateKeyInZone(post.date, timezone) === conceptualKey(day))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

  const dayPosts = postsForConceptualDay(currentDate);
  const metricCards = [
    { label: "Scheduled", value: counts.scheduled, Icon: CalendarClock },
    { label: "Publishing", value: counts.publishing, Icon: RefreshCw },
    { label: "Failed", value: counts.failed, Icon: AlertCircle },
    { label: "Published", value: counts.published, Icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ label, value, Icon }) => (
          <div key={label} className="sostats-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  {value}
                </p>
              </div>
              <div className="sostats-icon h-8 w-8">
                <Icon className="h-3.5 w-3.5 text-neutral-500" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="sostats-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] p-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold text-neutral-600 outline-none"
            >
              <option value="all">All channels</option>
              {channels.map((channel) => (
                <option key={channel} value={channel}>
                  {providerLabel(channel)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-xl border border-black/[0.06] bg-white px-3 text-[9px] font-semibold capitalize text-neutral-600 outline-none"
            >
              <option value="all">All states</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/[0.06] px-3 text-[9px] font-semibold text-neutral-500"
              >
                <FilterX className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
            <span className="text-[8px] text-muted-foreground">
              Times shown in {timezone}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center rounded-xl border border-black/[0.06] bg-neutral-50 p-1">
              {(["month", "week", "day"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={
                    viewMode === mode
                      ? "h-7 rounded-lg bg-white px-3 text-[9px] font-semibold capitalize shadow-sm"
                      : "h-7 rounded-lg px-3 text-[9px] font-medium capitalize text-neutral-400"
                  }
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
              {heading}
            </h2>
            <button
              type="button"
              onClick={() => setCurrentDate(initialToday)}
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
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {viewMode === "month" && (
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
                {monthDays.map((day, index) => {
                  const dayPosts = postsForConceptualDay(day);
                  const sameMonth = day.getMonth() === monthStart.getMonth();
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "min-h-[132px] border-b border-r border-black/[0.045] bg-white p-2",
                        index % 7 === 6 && "border-r-0",
                        !sameMonth && "bg-neutral-50/70",
                      )}
                    >
                      <div
                        className={cn(
                          "mb-2 flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold",
                          conceptualKey(day) === conceptualKey(initialToday)
                            ? "bg-[#ef2b2d] text-white"
                            : !sameMonth
                              ? "text-neutral-300"
                              : "text-neutral-600",
                        )}
                      >
                        {format(day, "d")}
                      </div>
                      <div className="space-y-1.5">
                        {dayPosts.slice(0, 4).map((post) => (
                          <CalendarPost
                            key={post.id}
                            post={post}
                            timezone={timezone}
                            onOpen={openPost}
                          />
                        ))}
                        {dayPosts.length > 4 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentDate(day);
                              setViewMode("day");
                            }}
                            className="w-full text-left text-[8px] font-semibold text-neutral-400"
                          >
                            +{dayPosts.length - 4} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {viewMode === "week" && (
          <div className="overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7">
              {weekDays.map((day, index) => {
                const dayPosts = postsForConceptualDay(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[520px] border-r border-black/[0.045] p-3",
                      index === 6 && "border-r-0",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentDate(day);
                        setViewMode("day");
                      }}
                      className="mb-3 w-full text-left"
                    >
                      <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {format(day, "EEE")}
                      </p>
                      <p className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                        {format(day, "d")}
                      </p>
                    </button>
                    <div className="space-y-2">
                      {dayPosts.map((post) => (
                        <CalendarPost
                          key={post.id}
                          post={post}
                          timezone={timezone}
                          onOpen={openPost}
                          roomy
                        />
                      ))}
                      {!dayPosts.length && (
                        <div className="rounded-xl border border-dashed border-black/[0.06] p-3 text-center text-[8px] text-muted-foreground">
                          No publications
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {viewMode === "day" && (
          <div className="p-4">
            {dayPosts.length ? (
              <div className="space-y-2">
                {dayPosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => openPost(post)}
                    className="flex w-full items-center gap-4 rounded-xl border border-black/[0.055] p-4 text-left transition hover:bg-neutral-50"
                  >
                    <div className="w-16 shrink-0 text-[11px] font-semibold">
                      {timeInZone(post.date, timezone)}
                    </div>
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                        statusTone(post.status),
                      )}
                    >
                      <StatusIcon status={post.status} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">
                        {post.title}
                      </p>
                      <p className="mt-0.5 truncate text-[8px] text-muted-foreground">
                        {post.campaign} · {post.accountName} · {post.variantLabel}
                      </p>
                    </div>
                    <span className="text-[8px] font-semibold capitalize text-neutral-500">
                      {post.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-black/[0.08] bg-neutral-50 text-center">
                <div>
                  <CalendarClock className="mx-auto h-5 w-5 text-neutral-300" />
                  <p className="mt-2 text-[10px] font-semibold">
                    Nothing scheduled for this day
                  </p>
                  <Link
                    href={`/${workspaceSlug}/content`}
                    className="mt-2 inline-block text-[9px] font-semibold text-[#df272a]"
                  >
                    Review content to schedule
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {!filteredPosts.length && posts.length > 0 && (
          <div className="border-t border-black/[0.045] px-5 py-4 text-[10px] text-muted-foreground">
            No publications match the current channel/status filters.
          </div>
        )}

        {!posts.length && (
          <div className="border-t border-black/[0.045] px-5 py-6 text-center text-[10px] text-muted-foreground">
            Nothing scheduled yet. Approve content in Content, then choose a real
            connected publishing channel.
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(selectedPost)}
        onOpenChange={(open) => {
          if (!open) closePost();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-xl">
          {selectedPost && (
            <>
              <DialogHeader>
                <DialogTitle className="tracking-[-0.02em]">
                  Publication details
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[8px] font-semibold capitalize",
                        statusTone(selectedPost.status),
                      )}
                    >
                      <StatusIcon status={selectedPost.status} />
                      {selectedPost.status}
                    </span>
                    <span className="text-[8px] text-muted-foreground">
                      Schedule #{selectedPost.id}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{selectedPost.title}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {selectedPost.campaign}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Info label="Channel" value={providerLabel(selectedPost.channel)} />
                  <Info label="Account" value={selectedPost.accountName} />
                  <Info label="Variant" value={providerLabel(selectedPost.variantLabel)} />
                  <Info label="Attempts" value={String(selectedPost.attempts)} />
                </div>

                {selectedPost.variantCopy && (
                  <div className="rounded-xl border border-black/[0.055] bg-neutral-50 p-3">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Scheduled variant copy
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[9px] leading-4 text-neutral-600">
                      {selectedPost.variantCopy}
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-black/[0.055] p-3">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Publication time
                  </p>
                  <p className="mt-1 text-[10px] font-semibold">
                    {fullDateTimeInZone(selectedPost.date, timezone)}
                  </p>
                </div>

                {selectedPost.status === "failed" && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                    <p className="text-[9px] font-semibold text-red-800">
                      {selectedPost.failureType || "Publication failed"}
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-red-700">
                      {selectedPost.failureReason || "Provider execution failed."}
                    </p>
                  </div>
                )}

                {selectedPost.status === "published" && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-[9px] font-semibold text-emerald-800">
                      Provider confirmed publication
                    </p>
                    {selectedPost.platformPostId && (
                      <p className="mt-1 text-[8px] text-emerald-700">
                        Post ID {selectedPost.platformPostId}
                      </p>
                    )}
                    {selectedPost.resultAt && (
                      <p className="mt-1 text-[8px] text-emerald-700">
                        Confirmed {fullDateTimeInZone(new Date(selectedPost.resultAt), timezone)}
                      </p>
                    )}
                    {selectedPost.postUrl && (
                      <a
                        href={selectedPost.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-800"
                      >
                        Open published post
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {canReschedule && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-semibold">
                        Date · {timezone}
                      </span>
                      <Input
                        type="date"
                        value={editDate}
                        onChange={(event) => setEditDate(event.target.value)}
                        className="rounded-xl"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-semibold">
                        Time · {timezone}
                      </span>
                      <Input
                        type="time"
                        value={editTime}
                        onChange={(event) => setEditTime(event.target.value)}
                        className="rounded-xl"
                      />
                    </label>
                  </div>
                )}

                {selectedPost.status === "failed" && canReschedule && (
                  <p className="rounded-xl bg-neutral-50 p-3 text-[8px] leading-4 text-muted-foreground">
                    Rescheduling a failed publication updates the persisted schedule
                    version. Any stale queue job cannot publish against the old version.
                  </p>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[9px] text-red-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                  </div>
                )}
              </div>

              <DialogFooter className="sm:justify-between">
                <div>
                  {canCancel && (
                    <Button
                      variant="outline"
                      onClick={cancel}
                      disabled={isCancelling || isSaving}
                      className="rounded-xl border-red-100 text-red-700 hover:bg-red-50"
                    >
                      {isCancelling ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="mr-2 h-4 w-4" />
                      )}
                      Cancel publication
                    </Button>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={closePost}
                    className="rounded-xl"
                    disabled={isSaving || isCancelling}
                  >
                    Close
                  </Button>
                  {canReschedule && (
                    <Button
                      onClick={save}
                      disabled={isSaving || isCancelling}
                      className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]"
                    >
                      {isSaving ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : selectedPost.status === "failed" ? (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      ) : (
                        <CalendarClock className="mr-2 h-4 w-4" />
                      )}
                      {selectedPost.status === "failed"
                        ? "Retry at new time"
                        : "Reschedule"}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CalendarPost({
  post,
  timezone,
  onOpen,
  roomy = false,
}: {
  post: Post;
  timezone: string;
  onOpen: (post: Post) => void;
  roomy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      className={cn(
        "w-full rounded-lg border p-2 text-left transition hover:shadow-sm",
        roomy && "p-2.5",
        statusTone(post.status),
      )}
    >
      <div className="flex items-center gap-1 text-[8px] font-semibold capitalize">
        <StatusIcon status={post.status} />
        {timeInZone(post.date, timezone)} · {providerLabel(post.channel)}
      </div>
      <p className="mt-1 line-clamp-2 text-[9px] font-medium leading-3.5 text-neutral-700">
        {post.title}
      </p>
      {roomy && (
        <p className="mt-1 truncate text-[8px] opacity-70">
          {post.accountName} · {post.status}
        </p>
      )}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[0.055] bg-neutral-50 p-3">
      <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[9px] font-semibold">{value}</p>
    </div>
  );
}
