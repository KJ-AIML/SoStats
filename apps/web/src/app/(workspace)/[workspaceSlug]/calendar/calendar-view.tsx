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
import { ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
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
  id: string;
  title: string;
  channel: string;
  date: Date;
};

const today = new Date();
const initialPosts: Post[] = [
  {
    id: "1",
    title: "Why AI workflows beat prompts",
    channel: "LinkedIn",
    date: new Date(today.getFullYear(), today.getMonth(), 5, 9, 30),
  },
  {
    id: "2",
    title: "Product workflow carousel",
    channel: "Instagram",
    date: new Date(today.getFullYear(), today.getMonth(), 11, 13, 0),
  },
  {
    id: "3",
    title: "Founder automation stack",
    channel: "X",
    date: new Date(today.getFullYear(), today.getMonth(), 15, 10, 0),
  },
  {
    id: "4",
    title: "SoStats product demo",
    channel: "TikTok",
    date: new Date(today.getFullYear(), today.getMonth(), 22, 18, 30),
  },
  {
    id: "5",
    title: "Stats → next content",
    channel: "LinkedIn",
    date: new Date(today.getFullYear(), today.getMonth(), 28, 9, 0),
  },
];

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(today);
  const [posts, setPosts] = useState(initialPosts);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [open, setOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

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
    setOpen(true);
  };

  const save = () => {
    if (!selectedPost) return;
    const [year, month, day] = editDate.split("-").map(Number);
    const [hours, minutes] = editTime.split(":").map(Number);
    const nextDate = new Date(year, month - 1, day, hours, minutes);
    setPosts((current) =>
      current.map((post) =>
        post.id === selectedPost.id
          ? { ...post, title: editTitle, date: nextDate }
          : post,
      ),
    );
    setOpen(false);
  };

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
                          className="w-full rounded-lg border border-[#ef2b2d]/10 bg-[#fff7f7] p-2 text-left transition hover:border-[#ef2b2d]/20 hover:bg-[#fff1f1]"
                        >
                          <div className="flex items-center gap-1 text-[8px] font-semibold text-[#d92023]">
                            <Clock3 className="h-2.5 w-2.5" />
                            {format(post.date, "HH:mm")} · {post.channel}
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="tracking-[-0.02em]">Edit scheduled content</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold">Content</label>
              <Textarea
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold">Date</label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold">Time</label>
                <Input
                  type="time"
                  value={editTime}
                  onChange={(event) => setEditTime(event.target.value)}
                  className="rounded-xl"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button onClick={save} className="rounded-xl bg-[#ef2b2d] hover:bg-[#da2427]">
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
