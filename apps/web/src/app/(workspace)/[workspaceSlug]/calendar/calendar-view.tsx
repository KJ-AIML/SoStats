"use client";

import { useState } from "react";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Post = {
  id: string;
  content: string;
  date: Date;
};

const today = new Date();
const initialPosts: Post[] = [
  {
    id: "1",
    content: "Excited to announce our new feature dropping next week!",
    date: new Date(today.getFullYear(), today.getMonth(), 5, 10, 0),
  },
  {
    id: "2",
    content: "Behind the scenes look at our development process.",
    date: new Date(today.getFullYear(), today.getMonth(), 15, 14, 30),
  },
  {
    id: "3",
    content: "Happy Friday! What is everyone working on?",
    date: new Date(today.getFullYear(), today.getMonth(), 28, 9, 0),
  },
];

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Edit state
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
    setEditContent(post.content);
    setEditDate(format(post.date, "yyyy-MM-dd"));
    setEditTime(format(post.date, "HH:mm"));
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!selectedPost) return;
    
    // Parse new date and time
    const [year, month, day] = editDate.split("-").map(Number);
    const [hours, minutes] = editTime.split(":").map(Number);
    
    const newDate = new Date(year, month - 1, day, hours, minutes);
    
    setPosts(posts.map(p => p.id === selectedPost.id ? { ...p, content: editContent, date: newDate } : p));
    setIsDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-medium">{format(currentDate, "MMMM yyyy")}</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border rounded-lg bg-border overflow-hidden flex flex-col gap-px">
        <div className="grid grid-cols-7 gap-px">
          {daysOfWeek.map((day) => (
            <div key={day} className="py-2 text-center text-sm font-medium text-muted-foreground bg-card">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px auto-rows-[120px]">
          {days.map((day) => {
            const dayPosts = posts.filter(post => isSameDay(post.date, day));
            return (
              <div
                key={day.toString()}
                className={cn(
                  "p-2 flex flex-col gap-1 overflow-y-auto bg-card transition-colors hover:bg-muted/50",
                  !isSameMonth(day, monthStart) && "bg-muted/20 text-muted-foreground",
                  isSameDay(day, today) && "bg-accent/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-sm font-medium h-7 w-7 flex items-center justify-center rounded-full",
                    isSameDay(day, today) && "bg-primary text-primary-foreground"
                  )}>
                    {format(day, "d")}
                  </span>
                </div>
                
                <div className="flex flex-col gap-1 mt-1">
                  {dayPosts.map((post) => (
                    <div
                      key={post.id}
                      onClick={() => handlePostClick(post)}
                      className="text-xs bg-secondary/80 hover:bg-secondary p-1.5 rounded cursor-pointer truncate transition-colors border"
                      title={post.content}
                    >
                      <div className="font-medium flex items-center gap-1 mb-0.5">
                        <Clock className="h-3 w-3" />
                        {format(post.date, "h:mm a")}
                      </div>
                      <div className="truncate text-muted-foreground">{post.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Scheduled Post</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea 
                value={editContent} 
                onChange={e => setEditContent(e.target.value)} 
                rows={4}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input 
                  type="date" 
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input 
                  type="time" 
                  value={editTime}
                  onChange={e => setEditTime(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}